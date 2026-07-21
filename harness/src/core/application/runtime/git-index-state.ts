import fs from "node:fs";
import path from "node:path";

import { asOptionalString, asJsonObject } from "../../../guards";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { runCommand } from "../../infrastructure/runtime/system";
import type { CoreResult } from "./contracts";

export interface GitIndexSnapshot {
  path: string;
  existed: boolean;
  content: Buffer | null;
}

export function captureGitIndex(cwd: string): GitIndexSnapshot | null {
  const located = runCommand("git", ["rev-parse", "--git-path", "index"], { cwd });
  if (!located.ok || !located.stdout.trim()) return null;
  const indexPath = path.resolve(cwd, located.stdout.trim());
  try {
    return { path: indexPath, existed: true, content: fs.readFileSync(indexPath) };
  } catch (error) {
    const code = asOptionalString(asJsonObject(error).code);
    return code === "ENOENT" ? { path: indexPath, existed: false, content: null } : null;
  }
}

export function restoreGitIndex(snapshot: GitIndexSnapshot): CoreResult {
  const lockPath = `${snapshot.path}.lock`;
  if (fileExists(lockPath)) return { ok: false, stage: "git_index_restore_lock", error: `Git index lock still exists: ${lockPath}` };
  const temporary = `${snapshot.path}.cadre-restore-${process.pid}`;
  try {
    if (!snapshot.existed) {
      fs.rmSync(snapshot.path, { force: true });
      return { ok: true, restored: true, removed_new_index: true };
    }
    fs.writeFileSync(temporary, snapshot.content!);
    fs.renameSync(temporary, snapshot.path);
    return { ok: true, restored: true, bytes: snapshot.content!.length };
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    return { ok: false, stage: "git_index_restore", error: error instanceof Error ? error.message : String(error) };
  }
}

export function rollbackGitCommit(
  cwd: string,
  commitSha: string,
  expectedParent: string,
  indexBefore: GitIndexSnapshot,
): CoreResult {
  const head = runCommand("git", ["rev-parse", "HEAD"], { cwd });
  if (!head.ok || head.stdout.trim() !== commitSha) {
    return { ok: false, rolled_back: false, error: "HEAD no longer equals the exact Cadre commit selected for rollback." };
  }
  const reset = expectedParent
    ? runCommand("git", ["reset", "--mixed", expectedParent], { cwd })
    : (() => {
        const symbolic = runCommand("git", ["symbolic-ref", "-q", "HEAD"], { cwd });
        return symbolic.ok
          ? runCommand("git", ["update-ref", "-d", symbolic.stdout.trim(), commitSha], { cwd })
          : symbolic;
      })();
  if (!reset.ok) return { ok: false, rolled_back: false, reset, error: "Unable to roll back the invalid Cadre commit." };
  const indexRestore = restoreGitIndex(indexBefore);
  return indexRestore.ok === false
    ? { ok: false, rolled_back: true, reset, index_restore: indexRestore, error: "The invalid commit was rolled back, but the caller's index could not be restored." }
    : { ok: true, rolled_back: true, reset, index_restore: indexRestore, head_sha: expectedParent || null };
}
