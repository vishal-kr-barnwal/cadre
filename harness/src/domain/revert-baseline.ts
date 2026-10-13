import { isDeepStrictEqual } from "node:util";
import { captureRepositoryBasis, repositoryBasisSchema, reversalScopes, type RepositoryBasis } from "./repository-basis.js";
import { gitRoot, resolveGitCommit } from "./git.js";
import { spawnSync } from "node:child_process";
import { countGitProcess } from "./inspection.js";

/** Pre-existing edits are authorized inputs, never a blanket exemption from freshness. */
export function requireRevertBaseline(rootInput: string, baseline: RepositoryBasis, base: string, reversal: string, trackId: string): void {
  const root = gitRoot(rootInput), before = repositoryBasisSchema.parse(baseline);
  if (before.head !== resolveGitCommit(root, base)) throw new Error("Reversal baseline must bind the approved base commit");
  const current = captureRepositoryBasis(root, true, trackId);
  if (!isDeepStrictEqual({...current, head: before.head}, before)) throw new Error("Product content changed from its approved reversal baseline; retain user files and obtain a corrected approval");
  for (const scope of reversalScopes(trackId)) {
    countGitProcess();
    const result = spawnSync("git", ["diff", "--name-only", "-z", reversal, "HEAD", "--", ...scope], {cwd: root, encoding: "utf8"});
    if (result.status !== 0 || result.stdout) throw new Error("Product content changed after the last reversal");
  }
}
