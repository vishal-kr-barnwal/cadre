import type { JsonObject } from "../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../guards";
import { PROJECT_SKILL_ID_PATTERN, PROJECT_SKILL_REFERENCE_EXTENSIONS, PROJECT_SKILL_WORKFLOWS, canonicalWorkflow } from "./project-skill-policy";

export type SkillOperation = "list" | "show" | "validate" | "create" | "update" | "rename" | "remove";
export interface ManagedReference { id: string; path: string; when?: JsonObject; content?: string }
export interface ManagedManifest extends JsonObject {
  version: 1; schema: "cadre.project-skill.v1"; id: string; name: string; description: string;
  selectors: JsonObject; rules: JsonObject[]; references: JsonObject[];
}

function absolutePath(value: string): boolean { return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value); }
function extension(value: string): string { const name = value.replace(/\\/g, "/").split("/").pop() || ""; const dot = name.lastIndexOf("."); return dot < 0 ? "" : name.slice(dot).toLowerCase(); }

function strings(value: unknown): string[] {
  return Array.from(new Set(asStringArray(value).map((item) => item.trim()).filter(Boolean)));
}

function selector(value: unknown): JsonObject {
  const raw = asJsonObject(value);
  return {
    workflows: strings(raw.workflows).map(canonicalWorkflow),
    repos: strings(raw.repos),
    file_patterns: strings(raw.file_patterns || raw.files),
  };
}

function upsert(items: JsonObject[], item: JsonObject): JsonObject[] {
  const id = asOptionalString(item.id);
  const index = items.findIndex((entry) => asOptionalString(entry.id) === id);
  if (index < 0) return [...items, item];
  return items.map((entry, position) => position === index ? item : entry);
}

export function emptyManagedManifest(id: string): ManagedManifest {
  return { version: 1, schema: "cadre.project-skill.v1", id, name: "", description: "", selectors: { workflows: [], repos: [], file_patterns: [] }, rules: [], references: [] };
}

export function applySkillChanges(base: ManagedManifest, changes: unknown): { manifest: ManagedManifest; referenceContent: Map<string, string>; removedReferences: Set<string>; errors: string[]; sourceRequests: JsonObject[] } {
  let manifest = structuredClone(base);
  const referenceContent = new Map<string, string>();
  const removedReferences = new Set<string>();
  const errors: string[] = [];
  const sourceRequests: JsonObject[] = [];
  for (const [index, value] of (Array.isArray(changes) ? changes : []).entries()) {
    const change = asJsonObject(value);
    const type = asOptionalString(change.type) || "";
    const id = asOptionalString(change.id)?.trim() || "";
    if (type === "metadata.set") {
      if (change.name !== undefined) manifest.name = asOptionalString(change.name)?.trim() || "";
      if (change.description !== undefined) manifest.description = asOptionalString(change.description)?.trim() || "";
    } else if (type === "selectors.set") {
      manifest.selectors = selector(change.selectors || change);
    } else if (type === "rule.upsert") {
      const rule = asJsonObject(change.rule || change);
      const ruleId = asOptionalString(rule.id)?.trim() || id;
      manifest.rules = upsert(manifest.rules, {
        id: ruleId, text: asOptionalString(rule.text)?.trim() || "", priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 100,
        required: rule.required !== false, when: selector(rule.when), references: strings(rule.references),
      });
    } else if (type === "rule.remove") {
      manifest.rules = manifest.rules.filter((rule) => asOptionalString(rule.id) !== id);
    } else if (type === "reference.upsert") {
      const reference = asJsonObject(change.reference || change);
      const referenceId = asOptionalString(reference.id)?.trim() || id;
      const referencePath = asOptionalString(reference.path)?.trim() || "";
      const content = asOptionalString(reference.content);
      const sourcePath = asOptionalString(reference.source_path || change.source_path);
      if (sourcePath && content === undefined) sourceRequests.push({ change_index: index, id: referenceId, source_path: sourcePath, target_path: referencePath });
      manifest.references = upsert(manifest.references, { id: referenceId, path: referencePath, when: selector(reference.when) });
      if (content !== undefined) referenceContent.set(referenceId, content);
      removedReferences.delete(referenceId);
    } else if (type === "reference.remove") {
      manifest.references = manifest.references.filter((reference) => asOptionalString(reference.id) !== id);
      removedReferences.add(id);
    } else errors.push(`change ${index + 1} has unknown type: ${type || "(missing)"}`);
  }
  return { manifest, referenceContent, removedReferences, errors, sourceRequests };
}

export function validateManagedManifest(manifest: ManagedManifest, knownRepos: Set<string>): string[] {
  const errors: string[] = [];
  if (manifest.schema !== "cadre.project-skill.v1" || manifest.version !== 1) errors.push("skill.json must use cadre.project-skill.v1 version 1");
  if (!PROJECT_SKILL_ID_PATTERN.test(manifest.id)) errors.push(`invalid skill id: ${manifest.id}`);
  if (!asOptionalString(manifest.name)?.trim()) errors.push("name is required");
  if (!asOptionalString(manifest.description)?.trim()) errors.push("description is required");
  const validateSelector = (value: unknown, label: string) => {
    const selected = selector(value);
    for (const workflow of asStringArray(selected.workflows)) if (workflow !== "*" && !PROJECT_SKILL_WORKFLOWS.has(workflow)) errors.push(`${label} has unknown workflow: ${workflow}`);
    for (const repo of asStringArray(selected.repos)) if (!knownRepos.has(repo)) errors.push(`${label} has unknown repo: ${repo}`);
  };
  const selectors = selector(manifest.selectors);
  const workflows = asStringArray(selectors.workflows);
  if (workflows.length === 0) errors.push("selectors.workflows must contain at least one workflow or *");
  for (const workflow of workflows) if (workflow !== "*" && !PROJECT_SKILL_WORKFLOWS.has(workflow)) errors.push(`unknown workflow: ${workflow}`);
  for (const repo of asStringArray(selectors.repos)) if (!knownRepos.has(repo)) errors.push(`unknown repo: ${repo}`);
  const ruleIds = new Set<string>();
  const referenceIds = new Set<string>();
  const referencePaths = new Set<string>();
  for (const reference of manifest.references) {
    const id = asOptionalString(reference.id) || "";
    const file = asOptionalString(reference.path) || "";
    if (!id || !PROJECT_SKILL_ID_PATTERN.test(id)) errors.push(`invalid reference id: ${id || "(missing)"}`);
    if (referenceIds.has(id)) errors.push(`duplicate reference id: ${id}`); else referenceIds.add(id);
    if (referencePaths.has(file)) errors.push(`duplicate reference path: ${file}`); else referencePaths.add(file);
    if (!file || absolutePath(file) || file.replace(/\\/g, "/").split("/").includes("..")) errors.push(`reference must stay inside the skill directory: ${file}`);
    if (!PROJECT_SKILL_REFERENCE_EXTENSIONS.has(extension(file))) errors.push(`unsupported reference type: ${file}`);
    validateSelector(reference.when, `reference ${id}`);
  }
  if (manifest.rules.length === 0) errors.push("rules must contain at least one atomic rule");
  for (const rule of manifest.rules) {
    const id = asOptionalString(rule.id) || "";
    if (!id || !PROJECT_SKILL_ID_PATTERN.test(id)) errors.push(`invalid rule id: ${id || "(missing)"}`);
    if (ruleIds.has(id)) errors.push(`duplicate rule id: ${id}`); else ruleIds.add(id);
    if (!asOptionalString(rule.text)?.trim()) errors.push(`rule ${id || "(missing)"} text is required`);
    validateSelector(rule.when, `rule ${id}`);
    for (const reference of asStringArray(rule.references)) if (!referenceIds.has(reference)) errors.push(`rule ${id} references unknown id: ${reference}`);
  }
  return Array.from(new Set(errors));
}
