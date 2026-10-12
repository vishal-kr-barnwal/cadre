import { isGitAncestor, requireReviewedProductUnchanged } from "./git.js";

/** Review intent retains its reviewed HEAD even before state is promoted. */
export function requireReviewFreshness(root: string, kind: string,
  files: Array<{ path: string; content: string | null }>): void {
  if (kind !== "review") return;
  for (const file of files) {
    const match = /^\.cadre\/tracks\/([a-z0-9]+(?:-[a-z0-9]+)*)\/state\.json$/.exec(file.path);
    if (!match || file.content === null) continue;
    const state = JSON.parse(file.content) as {
      trackId: string; lastExecution?: { headCommit?: string }; reviewCycles?: Array<{ reviewedHead?: string }>;
    };
    const head = state.reviewCycles?.at(-1)?.reviewedHead;
    if (state.trackId !== match[1] || !head || head !== state.lastExecution?.headCommit
      || !/^[0-9a-f]{7,40}$/.test(head) || !isGitAncestor(root, head)) {
      throw new Error("Review recovery requires reachable reviewed HEAD evidence matching its completed execution");
    }
    requireReviewedProductUnchanged(root, head, state.trackId);
  }
}
