import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { asJsonObject, asOptionalString } from "../../../guards";
import type { JsonObject } from "../../../types";
import { textHash } from "../../infrastructure/runtime/json-store";
import { runCommand } from "../../infrastructure/runtime/system";
import { concreteGitPathError } from "./claim-paths";
import type { CoreResult } from "./contracts";

interface FingerprintSnapshot {
  ok: boolean;
  cwd: string;
  git_root?: string;
  entries: JsonObject;
  dirty_files: string[];
  skipped?: boolean;
  reason?: string;
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter(Boolean))).sort();
}

function worktreeObject(cwd: string, file: string): { ok: boolean; value?: string; error?: string } {
  const absolute = path.resolve(cwd, file);
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return { ok: true, value: `symlink:${fs.readlinkSync(absolute)}` };
    if (stat.isFile()) {
      const hashed = runCommand("git", ["hash-object", "--no-filters", "--", file], { cwd });
      return hashed.ok
        ? { ok: true, value: `blob:${hashed.stdout.trim()}:${stat.mode & 0o111}` }
        : { ok: false, error: hashed.stderr.trim() || `Unable to hash ${file}` };
    }
    if (stat.isDirectory()) {
      const nestedHead = runCommand("git", ["-C", absolute, "rev-parse", "HEAD"], { cwd });
      return { ok: true, value: `directory:${nestedHead.ok ? nestedHead.stdout.trim() : "unversioned"}` };
    }
    return { ok: true, value: `other:${stat.mode}:${stat.size}` };
  } catch (error) {
    const code = asOptionalString(asJsonObject(error).code);
    return code === "ENOENT"
      ? { ok: true, value: "missing" }
      : { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function traceFingerprint(snapshot: FingerprintSnapshot, files: string[]): CoreResult {
  if (!snapshot.ok || snapshot.skipped) {
    return { ok: false, stage: "git_status", error: snapshot.reason || "Unable to fingerprint Git changes" };
  }
  const cwd = asOptionalString(snapshot.git_root) || snapshot.cwd;
  const entries = asJsonObject(snapshot.entries);
  const rows: JsonObject[] = [];
  for (const file of uniqueFiles(files)) {
    const pathError = concreteGitPathError(file);
    if (pathError) return { ok: false, stage: "git_claim_scope", error: pathError };
    if (!Object.prototype.hasOwnProperty.call(entries, file)) {
      return { ok: false, stage: "git_status", error: `Git path is no longer dirty: ${file}` };
    }
    const worktree = worktreeObject(cwd, file);
    if (!worktree.ok) return { ok: false, stage: "git_fingerprint", error: worktree.error || `Unable to fingerprint ${file}` };
    const index = runCommand("git", ["--literal-pathspecs", "ls-files", "--stage", "--", file], { cwd });
    if (!index.ok) return { ok: false, stage: "git_fingerprint", error: index.stderr.trim() || `Unable to inspect the index for ${file}` };
    rows.push({ file, status: String(entries[file] || ""), index: index.stdout, worktree: worktree.value || "" });
  }
  return { ok: true, files: uniqueFiles(files), fingerprint: textHash(JSON.stringify(rows)) };
}

function committedTreeValue(cwd: string, ref: string, file: string): CoreResult {
  const result = runCommand("git", ["--literal-pathspecs", "ls-tree", "-z", ref, "--", file], { cwd });
  if (!result.ok) return { ok: false, stage: "git_fingerprint", error: result.stderr.trim() || `Unable to inspect ${file} at ${ref}` };
  const record = result.stdout.split("\0").find(Boolean) || "";
  if (!record) return { ok: true, value: "missing" };
  const tab = record.indexOf("\t");
  return { ok: true, value: tab >= 0 ? record.slice(0, tab) : record };
}

function futureTreeValue(cwd: string, file: string): CoreResult {
  const absolute = path.resolve(cwd, file);
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      const head = runCommand("git", ["-C", absolute, "rev-parse", "HEAD"], { cwd });
      return head.ok
        ? { ok: true, value: `160000 commit ${head.stdout.trim()}` }
        : { ok: false, stage: "git_fingerprint", error: `Unable to fingerprint directory claim ${file}` };
    }
    if (stat.isSymbolicLink()) {
      const target = Buffer.from(fs.readlinkSync(absolute));
      const format = runCommand("git", ["rev-parse", "--show-object-format"], { cwd });
      const algorithm = format.ok && format.stdout.trim() === "sha256" ? "sha256" : "sha1";
      const oid = createHash(algorithm).update(`blob ${target.length}\0`).update(target).digest("hex");
      return { ok: true, value: `120000 blob ${oid}` };
    }
    const hashed = runCommand("git", ["hash-object", "--path", file, "--", file], { cwd });
    if (!hashed.ok) return { ok: false, stage: "git_fingerprint", error: hashed.stderr.trim() || `Unable to hash ${file}` };
    let mode = (stat.mode & 0o111) ? "100755" : "100644";
    const fileMode = runCommand("git", ["config", "--bool", "core.filemode"], { cwd });
    if (fileMode.ok && fileMode.stdout.trim() === "false") {
      const indexed = runCommand("git", ["--literal-pathspecs", "ls-files", "--stage", "--", file], { cwd });
      const indexedMode = indexed.ok ? indexed.stdout.trim().match(/^(100644|100755)\s/)?.[1] : null;
      if (indexedMode) mode = indexedMode;
    }
    return { ok: true, value: `${mode} blob ${hashed.stdout.trim()}` };
  } catch (error) {
    return asOptionalString(asJsonObject(error).code) === "ENOENT"
      ? { ok: true, value: "missing" }
      : { ok: false, stage: "git_fingerprint", error: error instanceof Error ? error.message : String(error) };
  }
}

export function traceResultFingerprint(cwd: string, files: string[], ref?: string): CoreResult {
  const rows: JsonObject[] = [];
  for (const file of uniqueFiles(files)) {
    const pathError = concreteGitPathError(file);
    if (pathError) return { ok: false, stage: "git_claim_scope", error: pathError };
    const value = ref ? committedTreeValue(cwd, ref, file) : futureTreeValue(cwd, file);
    if (value.ok === false) return value;
    rows.push({ file, value: asOptionalString(value.value) || "missing" });
  }
  return { ok: true, files: uniqueFiles(files), fingerprint: textHash(JSON.stringify(rows)) };
}
