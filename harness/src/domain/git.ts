import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { safeProjectRoot } from "./paths.js";

export function gitRoot(projectRoot: string): string {
  const root = realpathSync(safeProjectRoot(projectRoot));
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "project is not a Git worktree").trim());
  const detected = realpathSync(resolve(result.stdout.trim()));
  if (detected !== root) throw new Error(`project root ${root} is not the Git worktree root ${detected}`);
  return root;
}

export function resolveGitCommit(projectRoot: string, revision = "HEAD"): string {
  const root = gitRoot(projectRoot);
  const result = spawnSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git commit is not reachable: ${revision}`);
  return result.stdout.trim();
}

export function isGitAncestor(projectRoot: string, ancestor: string, descendant = "HEAD"): boolean {
  const root = gitRoot(projectRoot);
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    encoding: "utf8"
  }).status === 0;
}

export function reachableGitCommits(projectRoot: string, revisions: Iterable<string>): Map<string, boolean> | null {
  let root: string;
  try {
    root = gitRoot(projectRoot);
  } catch {
    return null;
  }
  const unique = [...new Set(revisions)].filter(Boolean);
  const listed = spawnSync("git", ["rev-list", "--all"], { cwd: root, encoding: "utf8" });
  if (listed.status !== 0) throw new Error((listed.stderr || listed.stdout || "cannot enumerate Git history").trim());
  const history = new Set(listed.stdout.split(/\r?\n/).filter(Boolean));
  const reachable = new Map<string, boolean>();
  for (const revision of unique) {
    const result = spawnSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], { cwd: root, encoding: "utf8" });
    reachable.set(revision, result.status === 0 && history.has(result.stdout.trim()));
  }
  return reachable;
}
