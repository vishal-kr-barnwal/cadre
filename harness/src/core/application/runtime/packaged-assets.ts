import fs from "node:fs";
import path from "node:path";

import type { JsonObject } from "../../../types";
import { asJsonObject } from "../../../guards";

export interface PackagedAssets {
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

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function templateCandidates(relativePath: string): string[] {
  const candidates: string[] = [];
  let dir = __dirname;
  for (let depth = 0; depth < SEARCH_DEPTH; depth += 1) {
    candidates.push(path.join(dir, "templates", relativePath));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
}

function findFile(candidates: string[]): string | null {
  return candidates.find(isFile) || null;
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

export function packagedTemplatePath(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  return findFile(templateCandidates(normalized));
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
