import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod/v4";
import { gitRoot, isGitAncestor, resolveGitCommit, requireReviewedProductUnchanged } from "./git.js";
import { countGitProcess } from "./inspection.js";
import type { OperationState } from "./state.js";
import { requireRevertScope, type RevertDelivery } from "./revert-scope.js";
import { isolatedReverseResult } from "./revert-result.js";
import { requireRevertBaseline } from "./revert-baseline.js";
import type { RepositoryBasis } from "./repository-basis.js";

const sha = z.string().regex(/^[0-9a-f]{7,40}$/);
const choices = z.strictObject({
  commits: z.array(sha).min(1), revertCommits: z.array(sha).min(1), baseCommit: sha,
  mainlineParents: z.record(sha, z.number().int().positive()).optional(),
  conflictResolutionTrees: z.record(sha, z.string().regex(/^[0-9a-f]{40}$/)).optional()
});

/** Compute the approved reverse result without touching the user's index or objects. */
export function requireRevertGitProof(projectRoot: string, operation: OperationState,
  delivery: RevertDelivery, baseline?: RepositoryBasis): Set<string> {
  const proof = choices.parse({commits: operation.commits, revertCommits: operation.revertCommits, baseCommit: operation.baseCommit,
    ...(operation.mainlineParents !== undefined ? {mainlineParents: operation.mainlineParents} : {}),
    ...(operation.conflictResolutionTrees !== undefined ? {conflictResolutionTrees: operation.conflictResolutionTrees} : {})});
  if (proof.commits.length !== proof.revertCommits.length || new Set(proof.commits).size !== proof.commits.length
    || new Set(proof.revertCommits).size !== proof.revertCommits.length) throw new Error("Revert requires one distinct actual reversal per approved target, in order");
  if ([...Object.keys(proof.mainlineParents ?? {}), ...Object.keys(proof.conflictResolutionTrees ?? {})].some((key) => !proof.commits.includes(key))) {
    throw new Error("Revert Git choices must name approved target commits");
  }
  const root = gitRoot(projectRoot);
  const run = (args: string[], options: {env?: NodeJS.ProcessEnv; input?: Buffer} = {}) => {
    countGitProcess(); return spawnSync("git", args, {cwd: root, maxBuffer: 64 * 1024 * 1024, ...options});
  };
  const text = (args: string[]) => {const result = run(args); if (result.status !== 0) throw new Error("Cannot verify approved reversal Git evidence"); return result.stdout.toString("utf8").trim();};
  const commits = proof.commits.map((commit) => resolveGitCommit(root, commit));
  const reversals = proof.revertCommits.map((commit) => resolveGitCommit(root, commit));
  if (new Set(commits).size !== commits.length || new Set(reversals).size !== reversals.length) throw new Error("Revert cannot alias target or reversal commits");
  const selected = requireRevertScope(root, operation, delivery, commits);
  const objects = resolve(root, text(["rev-parse", "--git-path", "objects"]));
    for (let i = 0; i < commits.length; i++) {
      const target = commits[i]!, reversal = reversals[i]!, named = proof.commits[i]!;
      const parents = text(["show", "-s", "--format=%P", target]).split(" ").filter(Boolean);
      const actualParents = text(["show", "-s", "--format=%P", reversal]).split(" ").filter(Boolean);
      const mainline = proof.mainlineParents?.[named];
      if (!parents.length || parents.length > 1 && mainline === undefined || mainline !== undefined && (parents.length < 2 || mainline > parents.length)) {
        throw new Error("Revert merge targets require an explicitly approved valid mainline parent; root commits are not reversible here");
      }
      if (actualParents.length !== 1 || !isGitAncestor(root, target, proof.baseCommit) || !isGitAncestor(root, reversal)
        || !isGitAncestor(root, proof.baseCommit, actualParents[0]) || target === reversal
        || i > 0 && !isGitAncestor(root, reversals[i - 1]!, actualParents[0])) {
        throw new Error("Revert requires reachable ordered additive reversals after the approved base");
      }
      const parent = parents[(mainline ?? 1) - 1]!;
      const computed = isolatedReverseResult(root, objects, target, parent, actualParents[0]!, mainline);
      let expected: string;
      if (computed.tree === null) {
        expected = proof.conflictResolutionTrees?.[named] ?? "";
        if (!expected || text(["cat-file", "-t", expected]) !== "tree") {
          throw new Error("Reverse patch conflicts; obtain exact approval for conflictResolutionTrees before reconciliation");
        }
        const names = (from: string, to: string) => {
          const result = run(["diff", "--name-only", "--no-renames", "-z", from, to, "--"]);
          if (result.status !== 0) throw new Error("Cannot verify approved conflict scope");
          return result.stdout.toString("utf8").split("\0").filter(Boolean);
        };
        if (names(actualParents[0]!, expected).some((path) => !computed.allowedPaths.has(path))) throw new Error("Approved conflict result cannot change paths outside the reversal target");
      } else {
        expected = computed.tree;
      }
      const actualTree = text(["rev-parse", `${reversal}^{tree}`]);
      if (actualTree !== expected || text(["rev-parse", `${actualParents[0]}^{tree}`]) === actualTree) {
        throw new Error("Actual reversal does not match the approved reverse patch/result");
      }
    }
    if (baseline) requireRevertBaseline(root, baseline, proof.baseCommit, reversals.at(-1)!, delivery.trackId);
    else requireReviewedProductUnchanged(root, reversals.at(-1)!, delivery.trackId);
    return selected;
}
