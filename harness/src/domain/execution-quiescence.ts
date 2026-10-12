import { lstatSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { ExecutionJournal } from "./execution.js";
import { gitRoot } from "./git.js";
import { countGitProcess } from "./inspection.js";
import { managedWorktreeStatus } from "./worktrees.js";

/** Inspect Git/filesystem activity without erasing retained worker provenance. */
export function requireQuiescentExecution(projectRoot: string, journal: ExecutionJournal): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(journal.trackId) || !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(journal.executionId)) {
    throw new Error("Unsafe execution worktree identity");
  }
  const root = gitRoot(projectRoot);
  const trackOwned = join(root, ".cadre", ".worktrees", journal.trackId);
  const owned = join(trackOwned, journal.executionId);
  const present = (path: string): boolean => {
    const part = relative(root, path);
    if (!part || isAbsolute(part) || part.startsWith(`..${sep}`) || part === "..") throw new Error("Unsafe execution worktree path");
    let current = root;
    for (const segment of part.split(sep)) {
      current = join(current, segment);
      try {
        if (lstatSync(current).isSymbolicLink()) throw new Error("Unsafe symbolic-link execution worktree path");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    }
    return true;
  };
  // Do not let worktree inventory follow a replaced managed root.
  const ownedPresent = present(owned);
  const inventory = managedWorktreeStatus(root);
  const within = (path: string) => resolve(path) === owned || resolve(path).startsWith(`${owned}${sep}`);
  if (ownedPresent || inventory.worktrees.some((worktree) => within(worktree.path)) || inventory.orphanedDirectories.some(within)) {
    throw new Error("Requires a quiescent execution boundary; reconcile registered or orphaned worker worktrees first");
  }
  countGitProcess();
  const refs = spawnSync("git", ["for-each-ref", "--format=%(refname)", "refs/heads/"], { cwd: root, encoding: "utf8" });
  if (refs.status !== 0) throw new Error("Cannot verify execution worker branches");
  const branches = new Set(refs.stdout.trim().split(/\r?\n/));
  const ownedBranchPrefix = `refs/heads/cadre/${journal.trackId}/${journal.executionId}/`;
  if ([...branches].some((branch) => branch.startsWith(ownedBranchPrefix))) {
    throw new Error("Requires a quiescent execution boundary; reconcile retained worker branches first");
  }
  const live = Object.values(journal.nodes).filter((node) => {
    if (node.kind !== "phase" && !["pending", "completed", "blocked"].includes(node.status)) return true;
    if (node.workerId && node.status !== "completed") return true;
    if (node.branch && branches.has(`refs/heads/${node.branch}`)) return true;
    if (!node.worktreePath) return false;
    const path = resolve(node.worktreePath), provenance = relative(trackOwned, path).split(sep).join("/");
    // Carried completed nodes retain paths from earlier executions of this track.
    if (!/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*\/(?:tasks\/P\d+--t\d+-\d+|phases\/P\d+)$/.test(provenance)) {
      throw new Error("Unsafe execution worktree path outside its owned track");
    }
    return present(path) || inventory.worktrees.some((worktree) => resolve(worktree.path) === path);
  });
  if (live.length) throw new Error(`Requires a quiescent execution boundary; reconcile partial work/workers first: ${live.map((node) => node.id).join(", ")}`);
}
