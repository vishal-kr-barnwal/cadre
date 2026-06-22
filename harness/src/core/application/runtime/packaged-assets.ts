import fs from "node:fs";
import path from "node:path";

import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString } from "../../../guards";

export interface PackagedAssets {
  skill?: JsonObject;
  protocols?: Record<string, JsonObject>;
  references?: Record<string, JsonObject>;
  templates?: Record<string, string>;
}

declare const __CADRE_EMBEDDED_ASSETS__: PackagedAssets | undefined;

const SEARCH_DEPTH = 8;

function embeddedAssets(): PackagedAssets | null {
  return typeof __CADRE_EMBEDDED_ASSETS__ !== "undefined" ? __CADRE_EMBEDDED_ASSETS__ : null;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readJsonFile(file: string): JsonObject | null {
  try {
    return asJsonObject(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function walkingCandidates(factory: (dir: string) => string[]): string[] {
  const candidates: string[] = [];
  let dir = __dirname;
  for (let depth = 0; depth < SEARCH_DEPTH; depth += 1) {
    candidates.push(...factory(dir));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return unique(candidates);
}

function findFile(candidates: string[]): string | null {
  return candidates.find(isFile) || null;
}

function jsonFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(dir, file))
      .filter(isFile)
      .sort();
  } catch {
    return [];
  }
}

function walkTemplateFiles(dir: string, base = dir): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTemplateFiles(full, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return files;
}

function referenceDirs(): string[] {
  return walkingCandidates((dir) => [
    path.join(dir, "references"),
    path.join(dir, "scripts", "agent-refs"),
    path.join(dir, "skills", "cadre", "references"),
  ]).filter(isDir);
}

function protocolDirs(): string[] {
  return walkingCandidates((dir) => [
    path.join(dir, "skills", "cadre", "protocols"),
    path.join(dir, "protocols"),
  ]).filter(isDir);
}

export function packagedSkillContract(): JsonObject | null {
  const embedded = embeddedAssets()?.skill;
  if (embedded) return embedded;
  const file = findFile(walkingCandidates((dir) => [
    path.join(dir, "skills", "cadre", "skill.json"),
    path.join(dir, "skill.json"),
  ]));
  return file ? readJsonFile(file) : null;
}

export function packagedWorkflowProtocols(): JsonObject[] {
  const embedded = embeddedAssets()?.protocols;
  if (embedded) {
    return Object.values(embedded)
      .map(asJsonObject)
      .sort((left, right) => String(left.workflow || left.id || "").localeCompare(String(right.workflow || right.id || "")));
  }
  const protocols = protocolDirs()
    .flatMap(jsonFiles)
    .map(readJsonFile)
    .filter((protocol): protocol is JsonObject => protocol !== null);
  return protocols.sort((left, right) => String(left.workflow || left.id || "").localeCompare(String(right.workflow || right.id || "")));
}

export function packagedWorkflowProtocol(workflow: string | null | undefined): JsonObject | null {
  const wanted = asOptionalString(workflow)?.trim();
  if (!wanted) return null;
  return packagedWorkflowProtocols().find((protocol) => {
    const id = asOptionalString(protocol.id) || "";
    const protocolWorkflow = asOptionalString(protocol.workflow) || "";
    return protocolWorkflow === wanted || id === wanted || id === `cadre-${wanted}`;
  }) || null;
}

export function packagedAgentReferences(): JsonObject[] {
  const embedded = embeddedAssets()?.references;
  if (embedded) {
    return Object.values(embedded)
      .map(asJsonObject)
      .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
  }
  const seen = new Set<string>();
  const references: JsonObject[] = [];
  for (const file of referenceDirs().flatMap(jsonFiles)) {
    const reference = readJsonFile(file);
    const id = asOptionalString(reference?.id) || path.basename(file, ".json");
    if (!reference || seen.has(id)) continue;
    seen.add(id);
    references.push(reference);
  }
  return references.sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
}

export function packagedAgentReference(id: string | null | undefined): JsonObject | null {
  const wanted = asOptionalString(id)?.trim();
  if (!wanted) return null;
  const embedded = embeddedAssets()?.references?.[wanted];
  if (embedded) return embedded;
  const file = findFile(walkingCandidates((dir) => [
    path.join(dir, "references", `${wanted}.json`),
    path.join(dir, "scripts", "agent-refs", `${wanted}.json`),
    path.join(dir, "skills", "cadre", "references", `${wanted}.json`),
  ]));
  return file ? readJsonFile(file) : null;
}

export function packagedTemplatePath(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  return findFile(walkingCandidates((dir) => [
    path.join(dir, "templates", normalized),
    path.join(dir, "skills", "cadre", "templates", normalized),
  ]));
}

export function packagedTemplateText(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  const embedded = embeddedAssets()?.templates?.[normalized];
  if (typeof embedded === "string") return embedded;
  const file = packagedTemplatePath(normalized);
  return file ? fs.readFileSync(file, "utf8") : null;
}

export function packagedTemplateJson(relativePath: string): JsonObject | null {
  const text = packagedTemplateText(relativePath);
  if (text === null) return null;
  try {
    return asJsonObject(JSON.parse(text));
  } catch {
    return null;
  }
}

export function packagedTemplatePaths(prefix = ""): string[] {
  const normalizedPrefix = normalizeRelativePath(prefix).replace(/\/$/, "");
  const embedded = embeddedAssets()?.templates;
  if (embedded) {
    return Object.keys(embedded)
      .filter((file) => !normalizedPrefix || file === normalizedPrefix || file.startsWith(`${normalizedPrefix}/`))
      .sort();
  }
  const manifest = packagedTemplatePath("manifest.json");
  if (!manifest) return [];
  const root = path.dirname(manifest);
  return walkTemplateFiles(root)
    .filter((file) => !normalizedPrefix || file === normalizedPrefix || file.startsWith(`${normalizedPrefix}/`))
    .sort();
}

export function packagedTemplateSource(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  if (typeof embeddedAssets()?.templates?.[normalized] === "string") return `embedded:${normalized}`;
  return packagedTemplatePath(normalized);
}
