import type { JsonObject } from "../../../types";

import type { CoreResult } from "./contracts";

interface DirtySnapshot {
  dirty_files: string[];
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter(Boolean))).sort();
}

export function traceFileKind(file: string): "ignored" | "control" | "product" {
  const normalized = file.replace(/^\.\//, "");
  if (normalized.startsWith("cadre/local/")) return "ignored";
  if (normalized.startsWith("cadre/.locks/")) return "ignored";
  const control = normalized.startsWith("cadre/")
    || normalized === ".gitattributes"
    || normalized === ".gitmodules"
    || normalized === ".gitlab-ci.yml"
    || normalized === "cadre-merge-train.gitlab-ci.yml"
    || normalized.startsWith(".github/workflows/cadre-");
  return control ? "control" : "product";
}

export function traceDirtyFiles(snapshot: DirtySnapshot, kind: "product" | "control"): string[] {
  return snapshot.dirty_files.filter((file) => traceFileKind(file) === kind);
}

export function traceNonIgnoredFiles(snapshot: DirtySnapshot): string[] {
  return snapshot.dirty_files.filter((file) => traceFileKind(file) !== "ignored");
}

function dirtyUniverse(entries: JsonObject, kind: "product" | "nonignored"): string[] {
  return Object.keys(entries)
    .filter((file) => kind === "product" ? traceFileKind(file) === "product" : traceFileKind(file) !== "ignored")
    .sort();
}

export function dirtyUniverseError(
  entries: JsonObject,
  expectedFiles: string[],
  kind: "product" | "nonignored",
): CoreResult | null {
  const expected = uniqueFiles(expectedFiles);
  const actual = dirtyUniverse(entries, kind);
  const appeared = actual.filter((file) => !expected.includes(file));
  const disappeared = expected.filter((file) => !actual.includes(file));
  if (appeared.length === 0 && disappeared.length === 0) return null;
  return {
    ok: false,
    stage: "implementation_baseline",
    error: "The complete dirty-file set changed after Cadre validated task ownership.",
    expected_dirty_files: expected,
    actual_dirty_files: actual,
    appeared_files: appeared,
    disappeared_files: disappeared,
  };
}
