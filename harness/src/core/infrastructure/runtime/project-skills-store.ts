import fs from "node:fs";
import path from "node:path";

import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray, errorMessage } from "../../../guards";
import {
  PROJECT_SKILL_ID_PATTERN,
  PROJECT_SKILL_MAX_FILE_BYTES,
  PROJECT_SKILL_REFERENCE_EXTENSIONS,
  PROJECT_SKILL_WORKFLOWS,
  canonicalWorkflow,
} from "../../domain/project-skill-policy";

export interface ProjectSkillRule {
  id: string;
  text: string;
  priority: number;
  required: boolean;
  workflows: string[];
  repos: string[];
  filePatterns: string[];
  references: string[];
}

export interface ProjectSkillReference {
  id: string;
  path: string;
  absolutePath: string;
  bytes: number;
  workflows: string[];
  repos: string[];
  filePatterns: string[];
}

export interface ProjectSkillRecord {
  id: string;
  name: string;
  description: string;
  workflows: string[];
  repos: string[];
  filePatterns: string[];
  rules: ProjectSkillRule[];
  references: ProjectSkillReference[];
  path: string;
  projectionPath: string | null;
  bytes: number;
}

export interface ProjectSkillLoadResult {
  id: string;
  ok: boolean;
  skill?: ProjectSkillRecord;
  errors: string[];
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function strings(value: unknown): string[] {
  return Array.from(new Set(asStringArray(value).map((entry) => entry.trim()).filter(Boolean)));
}

function selectors(value: unknown): { workflows: string[]; repos: string[]; filePatterns: string[] } {
  const raw = asJsonObject(value);
  return {
    workflows: strings(raw.workflows).map(canonicalWorkflow),
    repos: strings(raw.repos),
    filePatterns: strings(raw.file_patterns || raw.files),
  };
}

function referenceRecord(skillDir: string, value: unknown): { reference?: ProjectSkillReference; error?: string } {
  const raw = asJsonObject(value);
  const id = asOptionalString(raw.id)?.trim() || "";
  const rawPath = asOptionalString(raw.path)?.trim() || "";
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!id || !PROJECT_SKILL_ID_PATTERN.test(id)) return { error: `invalid reference id: ${id || "(missing)"}` };
  if (!normalized || path.isAbsolute(rawPath) || normalized.split("/").includes("..")) return { error: `reference must stay inside the skill directory: ${rawPath}` };
  if (!PROJECT_SKILL_REFERENCE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return { error: `unsupported reference type: ${rawPath}` };
  const absolutePath = path.resolve(skillDir, normalized);
  try {
    const realSkillDir = fs.realpathSync(skillDir);
    const realReference = fs.realpathSync(absolutePath);
    if (!isInside(realSkillDir, realReference)) return { error: `reference escapes the skill directory: ${rawPath}` };
    const stat = fs.statSync(realReference);
    if (!stat.isFile() || stat.size > PROJECT_SKILL_MAX_FILE_BYTES) return { error: `invalid or oversized reference: ${rawPath}` };
    if (fs.readFileSync(realReference).subarray(0, 8192).includes(0)) return { error: `binary reference is not supported: ${rawPath}` };
    return { reference: { id, path: normalized, absolutePath: realReference, bytes: stat.size, ...selectors(raw.when) } };
  } catch (error) {
    return { error: `reference cannot be resolved (${rawPath}): ${errorMessage(error)}` };
  }
}

export function projectSkillIds(root: string): string[] {
  const dir = path.join(root, "cadre", "skills");
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "skill.json")))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function loadProjectSkill(root: string, id: string, knownRepos: Set<string>): ProjectSkillLoadResult {
  const errors: string[] = [];
  if (!PROJECT_SKILL_ID_PATTERN.test(id)) return { id, ok: false, errors: [`invalid skill id: ${id}`] };
  const skillDir = path.join(root, "cadre", "skills", id);
  const file = path.join(skillDir, "skill.json");
  if (!fs.existsSync(file)) return { id, ok: false, errors: [`skill manifest not found: ${id}/skill.json`] };
  let raw: JsonObject;
  let stat: fs.Stats;
  try {
    const realCatalog = fs.realpathSync(path.join(root, "cadre", "skills"));
    const realDir = fs.realpathSync(skillDir);
    const realFile = fs.realpathSync(file);
    if (!isInside(realCatalog, realDir) || !isInside(realDir, realFile)) return { id, ok: false, errors: [`skill manifest escapes cadre/skills: ${id}`] };
    stat = fs.statSync(realFile);
    raw = asJsonObject(JSON.parse(fs.readFileSync(realFile, "utf8")));
  } catch (error) {
    return { id, ok: false, errors: [`skill manifest cannot be read: ${errorMessage(error)}`] };
  }
  if (stat.size > PROJECT_SKILL_MAX_FILE_BYTES) errors.push(`skill.json exceeds ${PROJECT_SKILL_MAX_FILE_BYTES} bytes: ${id}`);
  if (raw.schema !== "cadre.project-skill.v1" || raw.version !== 1) errors.push("skill.json must use cadre.project-skill.v1 version 1");
  if (asOptionalString(raw.id) !== id) errors.push(`manifest id must match directory id ${id}`);
  const name = asOptionalString(raw.name)?.trim() || "";
  const description = asOptionalString(raw.description)?.trim() || "";
  if (!name) errors.push("name is required");
  if (!description) errors.push("description is required");
  const baseSelectors = selectors(raw.selectors);
  if (baseSelectors.workflows.length === 0) errors.push("selectors.workflows must contain at least one workflow or *");
  for (const workflow of baseSelectors.workflows) if (workflow !== "*" && !PROJECT_SKILL_WORKFLOWS.has(workflow)) errors.push(`unknown workflow: ${workflow}`);
  for (const repo of baseSelectors.repos) if (!knownRepos.has(repo)) errors.push(`unknown repo: ${repo}`);
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).map((value, index): ProjectSkillRule | null => {
    const rule = asJsonObject(value);
    const ruleId = asOptionalString(rule.id)?.trim() || `rule-${index + 1}`;
    const text = asOptionalString(rule.text)?.trim() || "";
    if (!text) errors.push(`rule ${ruleId} text is required`);
    const match = selectors(rule.when);
    return {
      id: ruleId,
      text,
      priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 100,
      required: rule.required !== false,
      workflows: match.workflows,
      repos: match.repos,
      filePatterns: match.filePatterns,
      references: strings(rule.references),
    };
  }).filter((rule): rule is ProjectSkillRule => rule !== null);
  if (rules.length === 0) errors.push("rules must contain at least one atomic rule");
  const references: ProjectSkillReference[] = [];
  for (const value of Array.isArray(raw.references) ? raw.references : []) {
    const result = referenceRecord(skillDir, value);
    if (result.error) errors.push(result.error);
    else if (result.reference) references.push(result.reference);
  }
  const referenceIds = new Set(references.map((reference) => reference.id));
  for (const rule of rules) for (const reference of rule.references) if (!referenceIds.has(reference)) errors.push(`rule ${rule.id} references unknown id: ${reference}`);
  if (errors.length > 0) return { id, ok: false, errors };
  const projection = path.join(skillDir, "SKILL.md");
  return {
    id,
    ok: true,
    errors: [],
    skill: {
      id,
      name,
      description,
      ...baseSelectors,
      rules: rules.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id)),
      references,
      path: path.relative(root, file).split(path.sep).join("/"),
      projectionPath: fs.existsSync(projection) ? path.relative(root, projection).split(path.sep).join("/") : null,
      bytes: stat.size,
    },
  };
}

export function projectSkillReferenceContent(reference: ProjectSkillReference): JsonObject {
  const content = fs.readFileSync(reference.absolutePath, "utf8");
  return { id: reference.id, path: reference.path, bytes: reference.bytes, content };
}
