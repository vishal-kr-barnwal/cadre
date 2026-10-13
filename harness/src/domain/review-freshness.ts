import { isGitAncestor, requireReviewedProductUnchanged, readGitFileAtCommit } from "./git.js";
import { readSafeArtifact } from "./memory.js";
import { validateAutonomousRemediation, type AutonomousReview } from "./autonomous-review.js";
import { createHash } from "node:crypto";

/** Review intent retains its reviewed HEAD even before state is promoted. */
export function requireReviewFreshness(root: string, kind: string,
  files: Array<{ path: string; content: string | null; before?: string | null }>, savedBefore?: string, baseCommit?: string | null): string | undefined {
  if (kind !== "review") return;
  let retained: string | undefined;
  for (const file of files) {
    const match = /^\.cadre\/tracks\/([a-z0-9]+(?:-[a-z0-9]+)*)\/state\.json$/.exec(file.path);
    if (!match || file.content === null) continue;
    const state = JSON.parse(file.content) as {
      trackId: string; autonomousReview?: AutonomousReview; lastExecution?: { headCommit?: string; executionId?: string };
      reviewCycles?: Array<{ reviewedHead?: string; outcome?: string }>;
    };
    const head = state.reviewCycles?.at(-1)?.reviewedHead;
    if (state.trackId !== match[1] || !head || head !== state.lastExecution?.headCommit
      || !/^[0-9a-f]{7,40}$/.test(head) || !isGitAncestor(root, head)) {
      throw new Error("Review recovery requires reachable reviewed HEAD evidence matching its completed execution");
    }
    requireReviewedProductUnchanged(root, head, state.trackId);
    if (state.autonomousReview && state.reviewCycles?.at(-1)?.outcome === "changes_requested") {
      if (retained) throw new Error("Autonomous review recovery requires exactly one owned track");
      let before = savedBefore ?? readSafeArtifact(root, file.path);
      const hash = (body: string) => createHash("sha256").update(body).digest("hex");
      if (file.before !== undefined && hash(before) !== file.before && !savedBefore && baseCommit) {
        before = readGitFileAtCommit(root, baseCommit, file.path);
      }
      if (file.before !== undefined && hash(before) !== file.before) {
        throw new Error("Legacy partial remediation lacks original review authority; preserve intent and recover its exact pre-promotion evidence");
      }
      const previous = JSON.parse(before) as {trackId: string; autonomousReview?: AutonomousReview};
      if (previous.trackId !== state.trackId || !previous.autonomousReview) throw new Error("Review recovery requires original Autonomous authority");
      validateAutonomousRemediation(previous.autonomousReview, state.autonomousReview, state.lastExecution ?? {});
      retained = before;
    }
  }
  return retained;
}
