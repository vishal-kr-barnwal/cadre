import { asOptionalString } from "../../../guards";

import { runCommand } from "../../infrastructure/runtime/system";
import type { CoreResult } from "./contracts";

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function gitCommitMembership(cwd: string, commitSha: string): CoreResult {
  const ancestry = runCommand("git", ["rev-list", "--parents", "-n", "1", commitSha], { cwd });
  if (!ancestry.ok) {
    return {
      ok: false,
      stage: "git_commit_membership",
      error: ancestry.stderr.trim() || "Unable to resolve the product commit ancestry",
    };
  }
  const [, ...parentShas] = ancestry.stdout.trim().split(/\s+/);
  const changed = runCommand("git", [
    "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "--no-renames", "-z", commitSha,
  ], { cwd });
  if (!changed.ok) {
    return {
      ok: false,
      stage: "git_commit_membership",
      error: changed.stderr.trim() || "Unable to inspect the product commit paths",
    };
  }
  return {
    ok: true,
    parent_sha: parentShas[0] || null,
    parent_shas: parentShas,
    files: unique(changed.stdout.split("\0")),
    commit_sha: asOptionalString(commitSha) || null,
  };
}
