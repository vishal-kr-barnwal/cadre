import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { gitRoot, isGitAncestor, resolveGitCommit, requireReviewedProductUnchanged } from "./git.js";
import { countGitProcess } from "./inspection.js";
import type { OperationState } from "./state.js";
import type { ExecutionNode } from "./execution.js";

const sha = z.string().regex(/^[0-9a-f]{7,40}$/);
const choices = z.strictObject({
  commits: z.array(sha).min(1), revertCommits: z.array(sha).min(1), baseCommit: sha,
  mainlineParents: z.record(sha, z.number().int().positive()).optional(),
  conflictResolutionTrees: z.record(sha, z.string().regex(/^[0-9a-f]{40}$/)).optional()
});

/** Compute the approved reverse result without touching the user's index or objects. */
export function requireRevertGitProof(projectRoot: string, operation: OperationState,
  delivery: {trackId: string; nodes: Record<string, Pick<ExecutionNode, "id" | "kind" | "workerCommit" | "mergeCommit">>}): void {
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
  const target = delivery.nodes[String(operation.targetId)];
  if (operation.targetKind === "track" ? operation.targetId !== delivery.trackId
    : !target || target.kind !== operation.targetKind) throw new Error("Revert target must exist in its retained execution");
  const delivered = new Set(Object.values(delivery.nodes).flatMap((node) => [node.workerCommit, node.mergeCommit])
    .filter((commit): commit is string => Boolean(commit)).map((commit) => resolveGitCommit(root, commit)));
  if (commits.some((commit) => !delivered.has(commit))) throw new Error("Revert targets require retained execution commit provenance");
  const objects = resolve(root, text(["rev-parse", "--git-path", "objects"]));
  const temporary = mkdtempSync(join(tmpdir(), "cadre-revert-proof-"));
  try {
    const temporaryObjects = join(temporary, "objects"); mkdirSync(temporaryObjects);
    const env = {...process.env, GIT_INDEX_FILE: join(temporary, "index"), GIT_OBJECT_DIRECTORY: temporaryObjects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(objects), GIT_OPTIONAL_LOCKS: "0"};
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
      const patch = run(["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", target, parent, "--"]);
      if (patch.status !== 0 || !patch.stdout.length) throw new Error("Approved reversal target has no reverse patch");
      const seeded = run(["read-tree", "--reset", actualParents[0]!], {env});
      if (seeded.status !== 0) throw new Error("Cannot compute isolated reversal result");
      const applied = run(["apply", "--cached", "--3way", "--whitespace=nowarn"], {env, input: patch.stdout});
      let expected: string;
      if (applied.status !== 0) {
        const unmerged = run(["ls-files", "--unmerged", "-z"], {env});
        expected = proof.conflictResolutionTrees?.[named] ?? "";
        if (!unmerged.stdout.length || !expected || text(["cat-file", "-t", expected]) !== "tree") {
          throw new Error("Reverse patch conflicts; obtain exact approval for conflictResolutionTrees before reconciliation");
        }
        const names = (from: string, to: string) => {
          const result = run(["diff", "--name-only", "--no-renames", "-z", from, to, "--"]);
          if (result.status !== 0) throw new Error("Cannot verify approved conflict scope");
          return result.stdout.toString("utf8").split("\0").filter(Boolean);
        };
        const allowed = new Set(names(target, parent));
        if (names(actualParents[0]!, expected).some((path) => !allowed.has(path))) throw new Error("Approved conflict result cannot change paths outside the reversal target");
      } else {
        const tree = run(["write-tree"], {env});
        if (tree.status !== 0) throw new Error("Cannot compute isolated reversal tree");
        expected = tree.stdout.toString("utf8").trim();
      }
      const actualTree = text(["rev-parse", `${reversal}^{tree}`]);
      if (actualTree !== expected || text(["rev-parse", `${actualParents[0]}^{tree}`]) === actualTree) {
        throw new Error("Actual reversal does not match the approved reverse patch/result");
      }
    }
    requireReviewedProductUnchanged(root, reversals.at(-1)!, delivery.trackId);
  } finally {rmSync(temporary, {recursive: true, force: true});}
}
