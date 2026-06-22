import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { CoreResult, RepoExecutionEntry, RepoSymbol } from "./contracts";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { asArray } from "./status";
import { runCommand } from "../../infrastructure/runtime/system";
import { cachedWorkspaceValue } from "./workspace-cache";

export function isIgnoredRepoMapFile(file: unknown): boolean {
  const normalized = String(file || "").replace(/\\/g, "/");
  if (!normalized) return true;
  if (normalized.startsWith(".agents/")) return true;
  if (normalized.startsWith(".claude/")) return true;
  if (normalized.startsWith(".claude-plugin/")) return true;
  if (normalized.startsWith("plugins/cadre/")) return true;
  if (normalized.startsWith("plugins/cadre-claude/")) return true;
  return normalized
    .split("/")
    .some((part) => [".git", ".beads", "node_modules", "dist", "build", "coverage"].includes(part));
}

export function selectedRepoNames(args: RuntimeArgs = {}): Set<string> | null {
  const values = [
    asOptionalString(args.repo),
    ...asStringArray((args as UnknownRecord).repos),
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? new Set(values) : null;
}

export function intelRepoRoots(root: string, args: RuntimeArgs = {}): RepoExecutionEntry[] {
  const selected = selectedRepoNames(args);
  const topology = loadTopology(root);
  const control: RepoExecutionEntry = {
    repo: ".",
    root,
    path: ".",
    source: "control-root",
  };
  if (!topology.polyrepo) return selected && !selected.has(".") ? [] : [control];
  const entries: RepoExecutionEntry[] = [control];
  for (const raw of Array.isArray(topology.repos.repos) ? topology.repos.repos : []) {
    const repo = asJsonObject(raw);
    if (repo.enabled === false) continue;
    const name = asOptionalString(repo.name);
    const rel = asOptionalString(repo.submodule_path);
    if (!name || !rel) continue;
    entries.push({
      repo: name,
      root: path.resolve(root, rel),
      path: rel,
      source: "repos.json",
    });
  }
  return selected ? entries.filter((entry) => selected.has(entry.repo)) : entries;
}

export function combineLanguageCounts(entries: CoreResult[]): JsonObject {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const languages = asJsonObject(entry.by_language);
    for (const [language, count] of Object.entries(languages)) {
      counts[language] = (counts[language] || 0) + Number(count || 0);
    }
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

export const GENERIC_SYMBOL_PATTERNS = [
  /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g,
  /\b(?:export\s+)?(?:class|interface|type|enum|struct|record|trait)\s+([A-Za-z_$][\w$]*)\b/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g,
];

export const LANGUAGE_SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\b/gm, /^\s*class\s+([A-Za-z_][\w]*)\b/gm],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\b/gm, /^\s*type\s+([A-Za-z_][\w]*)\s+/gm],
  rust: [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:pub\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_][\w]*)\b/gm],
  java: [/^\s*(?:public|private|protected|static|final|abstract|sealed|non-sealed|\s)*(?:class|interface|enum|record)\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:public|private|protected|static|final|abstract|synchronized|native|\s)*[\w<>\[\].?,\s]+\s+([A-Za-z_][\w]*)\s*\(/gm],
  kotlin: [/^\s*(?:public|private|protected|internal|open|final|abstract|data|sealed|\s)*(?:class|interface|object|enum|typealias)\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:public|private|protected|internal|suspend|inline|tailrec|operator|infix|fun|\s)*fun\s+([A-Za-z_][\w]*)\b/gm],
  swift: [/^\s*(?:public|private|internal|open|fileprivate|static|final|mutating|nonmutating|\s)*(?:func|class|struct|enum|protocol)\s+([A-Za-z_][\w]*)\b/gm],
  csharp: [/^\s*(?:public|private|protected|internal|static|partial|sealed|abstract|virtual|override|\s)*(?:class|interface|record|struct|enum)\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:public|private|protected|internal|static|async|\s)*[\w<>\[\].?,\s]+\s+([A-Za-z_][\w]*)\s*\(/gm],
  ruby: [/^\s*(?:class|module|def)\s+([A-Za-z_][\w!?=]*)\b/gm],
  elixir: [/^\s*(?:defmodule|defp?|defmacro)\s+([A-Za-z_][\w!?]*)\b/gm],
  lua: [/^\s*(?:local\s+)?function\s+([A-Za-z_][\w.]*)\b/gm],
  terraform: [/^\s*(?:resource|module|variable|output|data)\s+"?([A-Za-z0-9_.-]+)"?/gim],
  sql: [/^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TYPE)\s+([A-Za-z_][\w."]*)\b/gim],
  shell: [/^\s*function\s+([A-Za-z_][\w-]*)\b/gm, /^\s*(?:local\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{/gm],
};

export function symbolPatternsForLanguage(language: string): RegExp[] {
  return [...GENERIC_SYMBOL_PATTERNS, ...(LANGUAGE_SYMBOL_PATTERNS[language] || [])].map(
    (pattern) => new RegExp(pattern.source, pattern.flags)
  );
}

export function extractRepoSymbols(root: string, file: string, limitPerFile = 40): RepoSymbol[] {
  const abs = path.join(root, file);
  if (!fileExists(abs)) return [];
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return [];
  }
  if (stat.size > 1024 * 1024) return [];
  const language = languageForFile(file);
  if (!language) return [];
  const text = fs.readFileSync(abs, "utf8");
  const patterns = symbolPatternsForLanguage(language);
  const symbols: RepoSymbol[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) && symbols.length < limitPerFile) {
      const prefix = text.slice(0, match.index);
      const line = prefix.split(/\r?\n/).length;
      const name = match[1];
      if (name) symbols.push({ name, file, line, language });
    }
  }
  return symbols;
}

export function repoMap(root: string, args: RuntimeArgs = {}): CoreResult {
  const limit = Number(args.limit || 200);
  const symbol = args.symbol ? String(args.symbol) : null;
  const repos = intelRepoRoots(root, args);
  if (symbol) {
    const repoResults = repos.map((entry) => {
      const result = runCommand("git", ["grep", "-n", "-w", "--", symbol], { cwd: entry.root, maxBuffer: 10 * 1024 * 1024 });
      const matches = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((line) => !isIgnoredRepoMapFile(line.split(":")[0] || ""))
        .slice(0, limit)
        .map((line) => {
          const [file, lineNo, ...rest] = line.split(":");
          return { repo: entry.repo, file: file || "", line: Number(lineNo), snippet: rest.join(":").trim().slice(0, 180) };
        });
      return { repo: entry.repo, root: entry.root, path: entry.path, ok: result.ok || matches.length > 0, matches, truncated: matches.length >= limit };
    });
    const matches = repoResults.flatMap((entry) => asArray(entry.matches)).slice(0, limit);
    return { ok: repoResults.some((entry) => entry.ok) || matches.length > 0, root, symbol, matches, repos: repoResults, truncated: matches.length >= limit };
  }
  return cachedWorkspaceValue(root, "repo-map", JSON.stringify({ limit, repos: repos.map((entry) => entry.repo) }), () => {
  const repoResults = repos.map((entry) => {
    const files = listWorkspaceFiles(entry.root).filter((file) => !isIgnoredRepoMapFile(file));
    const byLanguage: Record<string, number> = {};
    const symbols: RepoSymbol[] = [];
    for (const file of files) {
      const language = languageForFile(file);
      if (language) byLanguage[language] = (byLanguage[language] || 0) + 1;
      if (symbols.length < limit) symbols.push(...extractRepoSymbols(entry.root, file, 12).map((symbolEntry) => ({
        ...symbolEntry,
        repo: entry.repo,
      })));
      if (symbols.length > limit) symbols.length = limit;
    }
    return {
      ok: true,
      repo: entry.repo,
      root: entry.root,
      path: entry.path,
      files: files.length,
      by_language: Object.fromEntries(Object.entries(byLanguage).sort()),
      symbols,
      truncated: symbols.length >= limit,
    };
  });
  const files = repoResults.reduce((sum, entry) => sum + Number(entry.files || 0), 0);
  const symbols = repoResults.flatMap((entry) => asArray(entry.symbols)).slice(0, limit);
  return {
    ok: true,
    root,
    files,
    by_language: combineLanguageCounts(repoResults),
    symbols,
    repos: repoResults,
    truncated: symbols.length >= limit,
  };
  });
}
