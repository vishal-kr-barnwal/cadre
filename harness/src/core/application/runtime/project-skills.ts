import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { PROJECT_SKILL_ID_PATTERN, PROJECT_SKILL_INLINE_RULE_BUDGET, PROJECT_SKILL_MAX_INLINE_RULE_BUDGET, PROJECT_SKILL_MIN_INLINE_RULE_BUDGET, canonicalWorkflow } from "../../domain/project-skill-policy";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { loadProjectSkill, projectSkillIds, projectSkillReferenceContent, type ProjectSkillRecord, type ProjectSkillRule } from "../../infrastructure/runtime/project-skills-store";
import type { CoreResult } from "./contracts";
import { findTrack } from "./track-context";
import { parsePlanFile } from "./track-schedule";

function requestedSkillIds(value: unknown): string[] {
  const values = typeof value === "string" ? value.split(/[,\s]+/) : asStringArray(value);
  return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean))).sort();
}

function inlineRuleBudget(root: string, args: RuntimeArgs): { value: number; source: "argument" | "config" | "default"; requested: number | null; warnings: string[] } {
  const config = asJsonObject(loadTopology(root).config.project_skills);
  const argumentValue = args.skillRuleBudget ?? args.skill_rule_budget;
  const configuredValue = config.inline_rule_budget;
  const source = argumentValue !== undefined ? "argument" : configuredValue !== undefined ? "config" : "default";
  const raw = argumentValue ?? configuredValue;
  if (raw === undefined) return { value: PROJECT_SKILL_INLINE_RULE_BUDGET, source, requested: null, warnings: [] };
  const requested = Number(raw);
  if (!Number.isFinite(requested) || requested <= 0) {
    return {
      value: PROJECT_SKILL_INLINE_RULE_BUDGET,
      source,
      requested: Number.isFinite(requested) ? requested : null,
      warnings: [`Invalid project skill inline rule budget from ${source}; using default ${PROJECT_SKILL_INLINE_RULE_BUDGET}`],
    };
  }
  const value = Math.max(PROJECT_SKILL_MIN_INLINE_RULE_BUDGET, Math.min(Math.floor(requested), PROJECT_SKILL_MAX_INLINE_RULE_BUDGET));
  return {
    value,
    source,
    requested,
    warnings: value === requested ? [] : [`Project skill inline rule budget from ${source} was clamped to ${value}`],
  };
}

function knownRepoNames(root: string): Set<string> {
  const topology = loadTopology(root);
  const known = new Set([".", "root"]);
  for (const raw of Array.isArray(topology.repos.repos) ? topology.repos.repos : []) {
    const name = asOptionalString(asJsonObject(raw).name);
    if (name) known.add(name);
  }
  return known;
}

function reposFromPlan(value: unknown): string[] {
  return (Array.isArray(asJsonObject(value).phases) ? asJsonObject(value).phases as unknown[] : [])
    .flatMap((phase) => Array.isArray(asJsonObject(phase).tasks) ? asJsonObject(phase).tasks as unknown[] : [])
    .map((task) => asOptionalString(asJsonObject(task).repo))
    .filter((repo): repo is string => Boolean(repo));
}

function filesFromPlan(value: unknown): string[] {
  return (Array.isArray(asJsonObject(value).phases) ? asJsonObject(value).phases as unknown[] : [])
    .flatMap((phase) => Array.isArray(asJsonObject(phase).tasks) ? asJsonObject(phase).tasks as unknown[] : [])
    .flatMap((task) => asStringArray(asJsonObject(task).files));
}

export function projectSkillTargetRepos(root: string, args: RuntimeArgs = {}): string[] {
  const topology = loadTopology(root);
  const explicit = [asOptionalString(args.repo), ...asStringArray(args.repos), ...reposFromPlan(args.plan)].filter((repo): repo is string => Boolean(repo));
  if (explicit.length > 0) return Array.from(new Set(explicit)).sort();
  const track = findTrack(root, asOptionalString(args.trackId || args.track_id));
  if (track) {
    const repos = parsePlanFile(track.plan_path).tasks.map((task) => task.repo || (topology.polyrepo ? topology.defaultRepo : ".")).filter(Boolean);
    if (repos.length > 0) return Array.from(new Set(repos)).sort();
  }
  return topology.polyrepo ? [] : ["."];
}

function targetFiles(root: string, args: RuntimeArgs): string[] {
  const explicit = [...asStringArray(args.files), ...asStringArray(args.filesChanged || args.files_changed), ...filesFromPlan(args.plan)];
  if (explicit.length > 0) return Array.from(new Set(explicit)).sort();
  const track = findTrack(root, asOptionalString(args.trackId || args.track_id));
  return track ? Array.from(new Set(parsePlanFile(track.plan_path).tasks.flatMap((task) => task.files))).sort() : [];
}

function globMatch(pattern: string, file: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(file);
}

function selectorMatch(workflows: string[], repos: string[], patterns: string[], workflow: string, targets: string[], files: string[]): boolean {
  const workflowOk = workflows.length === 0 || workflows.includes("*") || workflows.includes(workflow);
  const repoOk = repos.length === 0 || repos.some((repo) => targets.includes(repo));
  const filesOk = patterns.length === 0 || files.some((file) => patterns.some((pattern) => globMatch(pattern, file)));
  return workflowOk && repoOk && filesOk;
}

function selectedRule(skill: ProjectSkillRecord, rule: ProjectSkillRule, root: string, workflow: string, repos: string[], files: string[]): JsonObject {
  return {
    id: rule.id,
    text: rule.text,
    priority: rule.priority,
    required: rule.required,
    references: rule.references.flatMap((id) => {
      const reference = skill.references.find((entry) => entry.id === id);
      if (!reference || !selectorMatch(reference.workflows, reference.repos, reference.filePatterns, workflow, repos, files)) return [];
      return [{ id, resource_uri: `cadre://project-skill?root=${encodeURIComponent(root)}&id=${encodeURIComponent(skill.id)}&reference=${encodeURIComponent(id)}` }];
    }),
  };
}

export function projectSkillSelection(root: string, workflowValue: string, args: RuntimeArgs = {}): CoreResult {
  const workflow = canonicalWorkflow(workflowValue);
  const requested = requestedSkillIds(args.skillIds);
  const requestedSet = new Set(requested);
  const repos = projectSkillTargetRepos(root, args);
  const files = targetFiles(root, args);
  const budget = inlineRuleBudget(root, args);
  const knownRepos = knownRepoNames(root);
  const installed = projectSkillIds(root);
  const errors: string[] = [];
  const warnings: string[] = [...budget.warnings];
  const selected: JsonObject[] = [];
  let inlineChars = 0;
  for (const id of requested) if (!PROJECT_SKILL_ID_PATTERN.test(id) || !installed.includes(id)) errors.push(`Explicit project skill is missing or invalid: ${id}`);
  for (const id of installed) {
    const loaded = loadProjectSkill(root, id, knownRepos);
    if (!loaded.ok || !loaded.skill) {
      const messages = loaded.errors.map((error) => `${id}: ${error}`);
      if (requestedSet.has(id)) errors.push(...messages); else warnings.push(...messages);
      continue;
    }
    const skill = loaded.skill;
    const explicit = requestedSet.has(id);
    if (!explicit && !selectorMatch(skill.workflows, skill.repos, skill.filePatterns, workflow, repos, files)) continue;
    const applicable = skill.rules.filter((rule) => selectorMatch(rule.workflows, rule.repos, rule.filePatterns, workflow, repos, files));
    const rules: JsonObject[] = [];
    for (const rule of applicable) {
      const cost = rule.text.length;
      if (inlineChars + cost > budget.value) {
        const message = `${id}/${rule.id} exceeds the ${budget.value}-character inline rule budget`;
        if (rule.required) errors.push(message); else warnings.push(`${message}; load the targeted project-skill resource if needed`);
        continue;
      }
      inlineChars += cost;
      rules.push(selectedRule(skill, rule, root, workflow, repos, files));
    }
    selected.push({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      path: skill.path,
      projection_path: skill.projectionPath,
      reasons: [explicit ? "explicit" : "selector"],
      rules,
      resource_uri: `cadre://project-skill?root=${encodeURIComponent(root)}&id=${encodeURIComponent(skill.id)}`,
    });
  }
  return {
    ok: errors.length === 0,
    source: "cadre/skills/*/skill.json",
    schema: "cadre.project-skill-selection.v1",
    workflow,
    requested,
    installed,
    selected,
    selected_ids: selected.map((skill) => skill.id),
    target_repos: repos,
    target_files: files,
    inline_rule_chars: inlineChars,
    inline_rule_budget: budget.value,
    inline_rule_budget_source: budget.source,
    inline_rule_budget_requested: budget.requested,
    decision: errors.length > 0 ? { kind: "narrow_scope", required: ["repos", "files"], reason: "Required project-skill rules exceed the inline context budget or a requested skill is invalid." } : null,
    warnings,
    errors,
  };
}

export function projectSkillDetail(root: string, id: string): CoreResult {
  const loaded = loadProjectSkill(root, id, knownRepoNames(root));
  if (!loaded.ok || !loaded.skill) return { ok: false, id, source: "cadre/skills", errors: loaded.errors };
  const skill = loaded.skill;
  return {
    ok: true,
    source: "cadre/skills",
    skill: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      selectors: { workflows: skill.workflows, repos: skill.repos, file_patterns: skill.filePatterns },
      rules: skill.rules,
      references: skill.references.map(projectSkillReferenceContent),
      projection_path: skill.projectionPath,
    },
  };
}

export function projectSkillDiagnostics(root: string): CoreResult {
  const loaded = projectSkillIds(root).map((id) => loadProjectSkill(root, id, knownRepoNames(root)));
  return {
    ok: loaded.every((skill) => skill.ok),
    source: "cadre/skills",
    count: loaded.length,
    valid: loaded.filter((skill) => skill.ok).map((skill) => skill.id),
    invalid: loaded.filter((skill) => !skill.ok).map((skill) => ({ id: skill.id, errors: skill.errors })),
  };
}
