import path from "node:path";

import { asOptionalString } from "../../../guards";
import { acquireLock, releaseLock } from "../../infrastructure/runtime/locking";
import { textHash } from "../../infrastructure/runtime/json-store";
import { runCommand } from "../../infrastructure/runtime/system";
import type { CoreResult } from "./contracts";

function gitIndexLockName(cwd: string): string {
  const located = runCommand("git", ["rev-parse", "--git-path", "index"], { cwd });
  const rawPath = located.ok ? located.stdout.trim() : "";
  const indexPath = rawPath
    ? path.resolve(cwd, rawPath)
    : path.resolve(cwd, ".git", "index");
  return `git-index:${textHash(indexPath).slice(0, 24)}`;
}

export function withGitIndexLock(root: string, cwd: string, operation: () => CoreResult): CoreResult {
  const lock = acquireLock(root, gitIndexLockName(cwd), {
    retries: 120,
    retryDelayMs: 50,
    timeoutMs: 10 * 60 * 1000,
  });
  if (!lock.ok) {
    return {
      ok: false,
      stage: "git_index_lock",
      error: asOptionalString(lock.error) || "Unable to serialize access to the Git index",
      lock,
    };
  }
  let result: CoreResult;
  try {
    result = operation();
  } catch (error) {
    const released = releaseLock(lock);
    if (released.ok === false) throw new Error(`${String(error)}; Git index lock release also failed: ${released.error}`);
    throw error;
  }
  const released = releaseLock(lock);
  return released.ok === false
    ? { ok: false, stage: "git_index_lock_release", error: released.error, operation_result: result }
    : result;
}
