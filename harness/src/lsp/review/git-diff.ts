import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "../../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "../../guards";
import { isIgnoredFile, normalizeRel, shouldIgnore } from "../ignore-policy";

import { ChangedEntry, SymbolCandidate } from "./types";

export function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

export function changedEntries(root: string, base: string, head: string): ChangedEntry[] {
  return runGit(root, ["diff", "--name-status", "--find-renames", `${base}...${head}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      const status = parts[0] || "M";
      const code = status[0] || "M";
      const oldPath = (code === "R" || code === "C" ? parts[1] : null) || null;
      const file = code === "R" || code === "C" ? parts[2] : parts[1];
      const kind = {
        A: "added",
        C: "copied",
        D: "deleted",
        M: "modified",
        R: "renamed",
        T: "type_changed",
        U: "unmerged",
        X: "unknown",
      }[code] || "modified";
      return {
        status,
        kind,
        path: file || "",
        oldPath,
        exists: file ? fs.existsSync(path.join(root, file)) : false,
      };
    })
    .filter((entry) => Boolean(entry.path) && !isIgnoredFile(root, entry.path));
}

export function changedSymbolCandidates(root: string, base: string, head: string, entry: ChangedEntry): SymbolCandidate[] {
  const paths = Array.from(new Set([entry.oldPath, entry.path].filter((item): item is string => typeof item === "string" && item.length > 0)));
  const diff = runGit(root, [
    "diff",
    "--unified=0",
    "--find-renames",
    `${base}...${head}`,
    "--",
    ...paths,
  ]);
  const byName = new Map<string, SymbolCandidate>();
  const patterns = [
    /^[+-]\s*(?:export\s+)?(?:async\s+)?(?:function|def)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:class|interface|type|enum|struct|module|namespace)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
    /^[+-]\s*(?:public|private|protected|internal|static|final|open|override|async|\s)*(?:fun|func)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
    /^[+-]\s*(?:local\s+)?function\s+([A-Za-z_][\w.]*)\b/,
    /^[+-]\s*(?:defp?|defmacro)\s+([A-Za-z_][\w!?]*)\b/,
    /^[+-]\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/,
    /^[+-]\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TYPE)\s+([A-Za-z_][\w."]*)\b/i,
    /^[+-]\s*(?:resource|module|variable|output|data)\s+"?([A-Za-z0-9_.-]+)"?/,
  ];
  for (const line of diff.split(/\r?\n/)) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const direction = line[0] === "-" ? "removed" : "added";
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1];
      if (!name) continue;
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          added: false,
          removed: false,
          changeType: "changed",
          changedFile: entry.path,
          oldPath: entry.oldPath,
          status: entry.kind,
          evidence: [],
        });
      }
      const candidate = byName.get(name);
      if (!candidate) continue;
      if (direction === "removed") candidate.removed = true;
      else candidate.added = true;
      if (candidate.evidence.length < 4) {
        candidate.evidence.push({
          direction,
          text: line.slice(1).trim().slice(0, 160),
        });
      }
    }
  }
  return Array.from(byName.values())
    .map((candidate) => ({
      ...candidate,
      changeType: candidate.removed
        ? (candidate.added ? "changed" : "removed")
        : "added",
    }))
    .filter((candidate) => candidate.changeType !== "added")
    .sort((a, b) => a.name.localeCompare(b.name));
}
