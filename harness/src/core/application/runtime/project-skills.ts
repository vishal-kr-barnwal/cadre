import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import {
  PROJECT_SKILL_DEFAULT_MAX_CHARS,
  PROJECT_SKILL_ID_PATTERN,
  PROJECT_SKILL_MAX_CHARS,
  canonicalWorkflow,
} from "../../domain/project-skill-policy";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import {
  loadProjectSkill,
  projectSkillIds,
  projectSkillReferenceContent,
  type ProjectSkillRecord,
} from "../../infrastructure/runtime/project-skills-store";
import type { CoreResult } from "./contracts";
import { findTrack } from "./track-context";
import { parsePlanFile } from "./track-schedule";

function requestedSkillIds(value: unknown): string[] {
  const values = typeof value === "string" ? value.split(/[,\s]+/) : asStringArray(value);
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function boundedMaxChars(value: unknown, fallback: number): number {
  const requested = Number(value);
  const selected = Number.isFinite(requested) && requested > 0 ? requested : fallback;
  return Math.max(1000, Math.min(selected, PROJECT_SKILL_MAX_CHARS));
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
  const plan = asJsonObject(value);
  const phases = Array.isArray(plan.phases) ? plan.phases.map(asJsonObject) : [];
  const repos: string[] = [];
  for (const phase of phases) {
    const tasks = Array.isArray(phase.tasks) ? phase.tasks.map(asJsonObject) : [];
    for (const task of tasks) {
      const repo = asOptionalString(task.repo);
      if (repo) repos.push(repo);
    }
  }
  return repos;
}

export function projectSkillTargetRepos(root: string, args: RuntimeArgs = {}): string[] {
  const topology = loadTopology(root);
  const explicit = [
    asOptionalString(args.repo),
    ...asStringArray(args.repos),
    ...reposFromPlan(args.plan),
  ].filter((repo): repo is string => Boolean(repo));
  if (explicit.length > 0) return Array.from(new Set(explicit)).sort();
  const trackId = asOptionalString(args.trackId || args.track_id);
  const track = findTrack(root, trackId);
  if (track) {
    const repos = parsePlanFile(track.plan_path).tasks
      .map((task) => task.repo || (topology.polyrepo ? topology.defaultRepo : "."))
      .filter((repo): repo is string => Boolean(repo));
    if (repos.length > 0) return Array.from(new Set(repos)).sort();
  }
  return topology.polyrepo ? [] : ["."];
}

function referenceDescriptors(root: string, skill: ProjectSkillRecord): JsonObject[] {
  const uri = `cadre://project-skill?root=${encodeURIComponent(root)}&id=${encodeURIComponent(skill.id)}`;
  return skill.references.map((reference) => ({
    path: reference.path,
    bytes: reference.bytes,
    resource_uri: uri,
    content_in_response: false,
  }));
}

function selectedSkill(root: string, skill: ProjectSkillRecord, reasons: string[], maxChars: number): JsonObject {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    workflows: skill.workflows,
    repos: skill.repos,
    reasons,
    instructions: skill.instructions.slice(0, maxChars),
    truncated: skill.instructions.length > maxChars,
    bytes: skill.bytes,
    references: referenceDescriptors(root, skill),
    resource_uri: `cadre://project-skill?root=${encodeURIComponent(root)}&id=${encodeURIComponent(skill.id)}`,
  };
}

export function projectSkillSelection(root: string, workflowValue: string, args: RuntimeArgs = {}): CoreResult {
  const workflow = canonicalWorkflow(workflowValue);
  const requested = requestedSkillIds(args.skillIds);
  const requestedSet = new Set(requested);
  const targetRepos = projectSkillTargetRepos(root, args);
  const targetSet = new Set(targetRepos);
  const knownRepos = knownRepoNames(root);
  const maxChars = boundedMaxChars(args.skillMaxChars, PROJECT_SKILL_DEFAULT_MAX_CHARS);
  const warnings: string[] = [];
  const errors: string[] = [];
  const selected: JsonObject[] = [];
  const installed = projectSkillIds(root);
  const installedSet = new Set(installed);

  for (const id of requested) {
    if (!PROJECT_SKILL_ID_PATTERN.test(id) || !installedSet.has(id)) errors.push(`Explicit project skill is missing or invalid: ${id}`);
  }
  for (const id of installed) {
    const loaded = loadProjectSkill(root, id, knownRepos);
    if (!loaded.ok || !loaded.skill) {
      const messages = loaded.errors.map((error) => `${id}: ${error}`);
      if (requestedSet.has(id)) errors.push(...messages);
      else warnings.push(...messages);
      continue;
    }
    const skill = loaded.skill;
    const explicit = requestedSet.has(id);
    const workflowMatch = skill.workflows.includes("*") || skill.workflows.includes(workflow);
    const repoMatch = skill.repos.length === 0 || skill.repos.some((repo) => targetSet.has(repo));
    if (!explicit && (!workflowMatch || !repoMatch)) continue;
    const reasons = [
      explicit ? "explicit" : null,
      workflowMatch ? "workflow" : null,
      skill.repos.length === 0 ? "project" : (repoMatch ? "repo" : null),
    ].filter((reason): reason is string => Boolean(reason));
    selected.push(selectedSkill(root, skill, reasons, maxChars));
  }

  return {
    ok: errors.length === 0,
    source: "cadre/skills",
    workflow,
    requested,
    installed,
    selected,
    selected_ids: selected.map((skill) => skill.id),
    target_repos: targetRepos,
    max_chars_per_skill: maxChars,
    warnings,
    errors,
  };
}

export function projectSkillDetail(root: string, id: string, args: RuntimeArgs = {}): CoreResult {
  const knownRepos = knownRepoNames(root);
  const loaded = loadProjectSkill(root, id, knownRepos);
  if (!loaded.ok || !loaded.skill) return { ok: false, id, source: "cadre/skills", errors: loaded.errors };
  const skill = loaded.skill;
  const maxChars = boundedMaxChars(args.skillMaxChars, PROJECT_SKILL_MAX_CHARS);
  return {
    ok: true,
    source: "cadre/skills",
    skill: {
      ...selectedSkill(root, skill, ["resource"], maxChars),
      references: skill.references.map((reference) => projectSkillReferenceContent(reference, maxChars)),
    },
  };
}

export function projectSkillDiagnostics(root: string): CoreResult {
  const knownRepos = knownRepoNames(root);
  const skills = projectSkillIds(root).map((id) => loadProjectSkill(root, id, knownRepos));
  const invalid = skills.filter((skill) => !skill.ok);
  return {
    ok: invalid.length === 0,
    source: "cadre/skills",
    count: skills.length,
    valid: skills.filter((skill) => skill.ok).map((skill) => skill.id),
    invalid: invalid.map((skill) => ({ id: skill.id, errors: skill.errors })),
  };
}
