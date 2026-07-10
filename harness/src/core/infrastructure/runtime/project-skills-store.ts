import fs from "node:fs";
import path from "node:path";

import type { JsonObject } from "../../../types";
import { asOptionalString, asStringArray, errorMessage } from "../../../guards";
import {
  PROJECT_SKILL_ID_PATTERN,
  PROJECT_SKILL_MAX_FILE_BYTES,
  PROJECT_SKILL_REFERENCE_EXTENSIONS,
  PROJECT_SKILL_WORKFLOWS,
  canonicalWorkflow,
} from "../../domain/project-skill-policy";

export interface ProjectSkillRecord {
  id: string;
  name: string;
  description: string;
  workflows: string[];
  repos: string[];
  references: ProjectSkillReference[];
  instructions: string;
  path: string;
  bytes: number;
}

export interface ProjectSkillReference {
  path: string;
  absolutePath: string;
  bytes: number;
}

export interface ProjectSkillLoadResult {
  id: string;
  ok: boolean;
  skill?: ProjectSkillRecord;
  errors: string[];
}

interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
  errors: string[];
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return String(JSON.parse(trimmed));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function inlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  const values: string[] = [];
  let token = "";
  let quote = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] || "";
    if ((character === '"' || character === "'") && body[index - 1] !== "\\") {
      quote = quote === character ? "" : (quote || character);
      token += character;
    } else if (character === "," && !quote) {
      values.push(scalar(token));
      token = "";
    } else {
      token += character;
    }
  }
  if (quote) return null;
  values.push(scalar(token));
  return values.map((entry) => entry.trim()).filter(Boolean);
}

function parseSkillFrontmatter(text: string): ParsedFrontmatter {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, content: "", errors: ["SKILL.md must start with YAML frontmatter"] };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return { data: {}, content: "", errors: ["SKILL.md frontmatter is not closed"] };
  const lines = normalized.slice(4, end).split("\n");
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):(?:\s*(.*))?$/);
    if (!match?.[1]) {
      errors.push(`unsupported frontmatter syntax on line ${index + 1}`);
      continue;
    }
    const key = match[1];
    const raw = match[2] || "";
    if (Object.prototype.hasOwnProperty.call(data, key)) errors.push(`duplicate frontmatter field: ${key}`);
    if (raw === "|" || raw === ">") {
      const parts: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1] || "")) {
        index += 1;
        parts.push((lines[index] || "").replace(/^\s{2}/, ""));
      }
      data[key] = raw === ">" ? parts.join(" ").trim() : parts.join("\n").trim();
      continue;
    }
    const parsedInline = inlineList(raw);
    if (parsedInline) {
      data[key] = parsedInline;
      continue;
    }
    if (!raw.trim()) {
      const values: string[] = [];
      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1] || "")) {
        index += 1;
        values.push(scalar((lines[index] || "").replace(/^\s+-\s+/, "")));
      }
      data[key] = values;
      continue;
    }
    data[key] = scalar(raw);
  }
  return { data, content: normalized.slice(end + 5), errors };
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  return asStringArray(value).map((entry) => entry.trim()).filter(Boolean);
}

function referenceRecord(skillDir: string, rawPath: string): { reference?: ProjectSkillReference; error?: string } {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || path.isAbsolute(rawPath) || normalized.split("/").includes("..")) {
    return { error: `reference must stay inside the skill directory: ${rawPath}` };
  }
  const extension = path.extname(normalized).toLowerCase();
  if (!PROJECT_SKILL_REFERENCE_EXTENSIONS.has(extension)) {
    return { error: `unsupported reference type: ${rawPath}` };
  }
  const absolutePath = path.resolve(skillDir, normalized);
  if (!fs.existsSync(absolutePath)) return { error: `reference not found: ${rawPath}` };
  let realSkillDir: string;
  let realReference: string;
  try {
    realSkillDir = fs.realpathSync(skillDir);
    realReference = fs.realpathSync(absolutePath);
  } catch (error) {
    return { error: `reference cannot be resolved (${rawPath}): ${errorMessage(error)}` };
  }
  if (!isInside(realSkillDir, realReference)) return { error: `reference escapes the skill directory: ${rawPath}` };
  const stat = fs.statSync(realReference);
  if (!stat.isFile()) return { error: `reference is not a file: ${rawPath}` };
  if (stat.size > PROJECT_SKILL_MAX_FILE_BYTES) return { error: `reference exceeds ${PROJECT_SKILL_MAX_FILE_BYTES} bytes: ${rawPath}` };
  const sample = fs.readFileSync(realReference).subarray(0, 8192);
  if (sample.includes(0)) return { error: `binary reference is not supported: ${rawPath}` };
  return { reference: { path: normalized, absolutePath: realReference, bytes: stat.size } };
}

export function projectSkillIds(root: string): string[] {
  const dir = path.join(root, "cadre", "skills");
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
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
  const file = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(file)) return { id, ok: false, errors: [`skill not found: ${id}`] };
  let realSkillDir: string;
  let realFile: string;
  let realCatalogDir: string;
  try {
    realCatalogDir = fs.realpathSync(path.join(root, "cadre", "skills"));
    realSkillDir = fs.realpathSync(skillDir);
    realFile = fs.realpathSync(file);
  } catch (error) {
    return { id, ok: false, errors: [`skill cannot be resolved: ${errorMessage(error)}`] };
  }
  if (!isInside(realCatalogDir, realSkillDir)) return { id, ok: false, errors: [`skill directory escapes cadre/skills: ${id}`] };
  if (!isInside(realSkillDir, realFile)) return { id, ok: false, errors: [`SKILL.md escapes the skill directory: ${id}`] };
  const stat = fs.statSync(realFile);
  if (!stat.isFile()) return { id, ok: false, errors: [`SKILL.md is not a file: ${id}`] };
  if (stat.size > PROJECT_SKILL_MAX_FILE_BYTES) {
    return { id, ok: false, errors: [`SKILL.md exceeds ${PROJECT_SKILL_MAX_FILE_BYTES} bytes: ${id}`] };
  }

  const parsed = parseSkillFrontmatter(fs.readFileSync(realFile, "utf8"));
  errors.push(...parsed.errors);
  const data = parsed.data;
  const name = asOptionalString(data.name)?.trim() || "";
  const description = asOptionalString(data.description)?.trim() || "";
  const workflows = Array.from(new Set(stringList(data.workflows).map(canonicalWorkflow))).sort();
  const repos = Array.from(new Set(stringList(data.repos))).sort();
  const referencePaths = Array.from(new Set(stringList(data.references))).sort();
  const instructions = parsed.content.trim();
  if (!name) errors.push("frontmatter.name is required");
  if (name && name !== id) errors.push(`frontmatter.name must match directory id ${id}`);
  if (!description) errors.push("frontmatter.description is required");
  if (workflows.length === 0) errors.push("frontmatter.workflows must contain at least one workflow or *");
  for (const workflow of workflows) {
    if (workflow !== "*" && !PROJECT_SKILL_WORKFLOWS.has(workflow)) errors.push(`unknown workflow: ${workflow}`);
  }
  for (const repo of repos) {
    if (!knownRepos.has(repo)) errors.push(`unknown repo: ${repo}`);
  }
  if (!instructions) errors.push("SKILL.md instructions are required");

  const references: ProjectSkillReference[] = [];
  for (const referencePath of referencePaths) {
    const result = referenceRecord(skillDir, referencePath);
    if (result.error) errors.push(result.error);
    else if (result.reference) references.push(result.reference);
  }
  if (errors.length > 0) return { id, ok: false, errors };
  return {
    id,
    ok: true,
    errors: [],
    skill: {
      id,
      name,
      description,
      workflows,
      repos,
      references,
      instructions,
      path: path.relative(root, file).split(path.sep).join("/"),
      bytes: stat.size,
    },
  };
}

export function projectSkillReferenceContent(reference: ProjectSkillReference, maxChars: number): JsonObject {
  const content = fs.readFileSync(reference.absolutePath, "utf8");
  return {
    path: reference.path,
    bytes: reference.bytes,
    content: content.slice(0, maxChars),
    truncated: content.length > maxChars,
  };
}
