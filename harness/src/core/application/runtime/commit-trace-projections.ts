import fs from "node:fs";
import path from "node:path";

import { fileExists, textHash } from "../../infrastructure/runtime/json-store";
import { artifactDefinitions } from "./artifact-catalog";
import type { CoreResult } from "./contracts";

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter(Boolean))).sort();
}

export function projectionGuard(root: string, files: string[]): CoreResult {
  const touched = new Set(uniqueFiles(files));
  const errors: string[] = [];
  const checked: string[] = [];
  for (const definition of artifactDefinitions(root, { includeArchive: true })) {
    if (!definition.projection || !touched.has(definition.canonical)) continue;
    const canonical = path.join(root, definition.canonical);
    const projection = path.join(root, definition.projection);
    checked.push(definition.canonical);
    if (!fileExists(canonical) || !fileExists(projection)) {
      errors.push(`Canonical/projection pair is incomplete: ${definition.canonical} -> ${definition.projection}`);
      continue;
    }
    const marker = fs.readFileSync(projection, "utf8").match(/<!--\s*cadre:generated\b[^>]*canonical_hash="([a-f0-9]+)"[^>]*-->/i);
    const expected = textHash(fs.readFileSync(canonical, "utf8")).slice(0, 16);
    if (!marker?.[1] || marker[1] !== expected) {
      errors.push(`Projection marker is stale for ${definition.canonical}: ${definition.projection}`);
    }
  }
  return { ok: errors.length === 0, checked, errors, ...(errors.length ? { error: errors[0] } : {}) };
}
