import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "../../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "../../guards";
import { isIgnoredFile, normalizeRel, shouldIgnore } from "../ignore-policy";

import { LspClient } from "./client";
import { MAX_SCAN_FILE_BYTES, MAX_TEXT_REFERENCE_RESULTS } from "./constants";
import { LspDiagnostic, LspLocation, LspPosition, LspServerConfig, LspSymbol, RelativeLocation, SymbolCandidate } from "./types";

export function flattenSymbols(symbols: unknown, out: LspSymbol[] = []): LspSymbol[] {
  if (!Array.isArray(symbols)) return out;
  for (const symbol of symbols) {
    const candidate = asJsonObject(symbol) as LspSymbol;
    if (candidate.name && candidate.selectionRange) out.push(candidate);
    if (candidate.children) flattenSymbols(candidate.children, out);
  }
  return out;
}

export function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function serverFileMatch(file: string, server: Pick<LspServerConfig, "extensions" | "filenames">): boolean {
  const extensionSet = new Set(server.extensions || []);
  const filenameSet = new Set((server.filenames || []).map((name) => name.toLowerCase()));
  const ext = path.extname(file);
  const basename = path.basename(file).toLowerCase();
  return extensionSet.has(ext) || filenameSet.has(basename);
}

export function scanTextReferences(root: string, symbol: string, changedPathSet: Set<string>, server: Pick<LspServerConfig, "extensions" | "filenames">): RelativeLocation[] {
  const results: RelativeLocation[] = [];
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_$])${escapeRegExp(symbol)}([^A-Za-z0-9_$]|$)`
  );

  function visit(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (shouldIgnore(root, full, entry.name)) continue;
      if (entry.isDirectory()) {
        visit(full);
        if (results.length >= MAX_TEXT_REFERENCE_RESULTS) return;
        continue;
      }
      if (!entry.isFile()) continue;
      if (!serverFileMatch(full, server)) continue;
      if (changedPathSet.has(path.resolve(full))) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_SCAN_FILE_BYTES) continue;
      let text: string;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] || "";
        if (!pattern.test(line)) continue;
        results.push({
          file: full,
          relativeFile: normalizeRel(path.relative(root, full)),
          line: i + 1,
          snippet: line.trim().slice(0, 160),
        });
        if (results.length >= MAX_TEXT_REFERENCE_RESULTS) return;
      }
    }
  }

  visit(root);
  return results;
}

export function externalReferenceFinding(server: LspServerConfig, candidate: SymbolCandidate, refs: RelativeLocation[], engine: string): JsonObject {
  const removed = candidate.changeType === "removed";
  return {
    severity: removed ? "blocking" : "warning",
    type: "external_reference",
    code: removed
      ? "external_reference_to_removed_symbol"
      : "external_reference_to_changed_symbol",
    server: server.id || server.command,
    engine,
    symbol: {
      name: candidate.name,
      changeType: candidate.changeType,
      status: candidate.status,
      changedFile: candidate.changedFile,
      oldPath: candidate.oldPath,
    },
    changedFile: candidate.changedFile,
    externalReferences: refs,
    message: `${candidate.name} has references outside the track diff after being ${removed ? "removed" : "changed"}.`,
  };
}

export function skipFinding(server: LspServerConfig, code: string, message: string, extra: JsonObject = {}): JsonObject {
  return {
    severity: "info",
    type: "skip",
    code,
    server: server.id || server.command || "unknown",
    message,
    ...(extra || {}),
  };
}

export function lspRefToLocation(root: string, ref: unknown): RelativeLocation | null {
  const location = asJsonObject(ref) as LspLocation;
  const uri = location.uri || location.targetUri;
  if (!uri) return null;
  try {
    const file = fileURLToPath(uri);
    const range = location.range || location.targetSelectionRange || location.targetRange;
    return {
      file,
      relativeFile: normalizeRel(path.relative(root, file)),
      line: (range?.start ? range.start.line : 0) + 1,
    };
  } catch {
    return null;
  }
}

export function locationsFromResult(root: string, value: unknown): RelativeLocation[] {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  return items
    .map((item) => {
      const object = asJsonObject(item);
      const ref = object.targetUri
        ? { uri: object.targetUri, range: object.targetSelectionRange || object.targetRange }
        : item;
      return lspRefToLocation(root, ref);
    })
    .filter((location): location is RelativeLocation => location !== null)
    .slice(0, 20);
}

export async function optionalLocations(client: LspClient, kind: string, file: string, position: LspPosition, root: string): Promise<RelativeLocation[]> {
  try {
    if (kind === "definition") return locationsFromResult(root, await client.definition(file, position));
    if (kind === "typeDefinition") return locationsFromResult(root, await client.typeDefinition(file, position));
    if (kind === "implementation") return locationsFromResult(root, await client.implementation(file, position));
  } catch {
    return [];
  }
  return [];
}

export function diagnosticFinding(server: LspServerConfig, file: string, diagnostic: LspDiagnostic): JsonObject {
  const severity = diagnostic.severity === 1 ? "blocking" : "warning";
  return {
    severity,
    type: "diagnostic",
    code: diagnostic.code || "lsp_diagnostic",
    server: server.id || server.command,
    file,
    line: diagnostic.range && diagnostic.range.start ? diagnostic.range.start.line + 1 : null,
    message: diagnostic.message || "LSP diagnostic",
  };
}

export function nearbyFileHints(root: string, files: string[]): JsonObject {
  const manifests = new Set<string>();
  const tests = new Set<string>();
  const manifestNames = new Set([
    "package.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
  ]);
  for (const file of files || []) {
    let dir = path.dirname(path.join(root, file));
    while (dir.startsWith(root)) {
      for (const name of manifestNames) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) manifests.add(normalizeRel(path.relative(root, candidate)));
      }
      if (dir === root) break;
      dir = path.dirname(dir);
    }
    const parsed = path.parse(file);
    const candidates = [
      path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
      path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`),
      path.join(parsed.dir, `${parsed.name}_test${parsed.ext}`),
      path.join("test", file),
      path.join("tests", file),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(root, candidate))) tests.add(normalizeRel(candidate));
    }
  }
  return {
    package_manifests: Array.from(manifests).slice(0, 20),
    likely_tests: Array.from(tests).slice(0, 30),
  };
}
