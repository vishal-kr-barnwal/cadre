import { promotionEvidence, type BeforeEvidence, type PromotionFile } from "./promotion-evidence.js";
import { requireReviewPlan, requireReviewState } from "./review-invariants.js";
import type { TrackState } from "./state.js";

/** The same review invariants run before promotion and on every pending-intent resume. */
export function requireReviewPreservation(root: string, files: PromotionFile[], saved?: BeforeEvidence[], base?: string | null): BeforeEvidence[] {
  const evidence = promotionEvidence(root, files, saved, base);
  for (const file of files) {
    if (!/^\.cadre\/tracks\/[^/]+\/state\.json$/.test(file.path) || file.content === null) continue;
    const proposed = JSON.parse(file.content) as TrackState;
    if (proposed.status === "completed" && proposed.reviewCycles?.at(-1)?.outcome === "clean") continue;
    const previous = JSON.parse(evidence.read(file.path)) as TrackState;
    requireReviewState(previous, proposed);
    const path = file.path.replace(/state\.json$/, "plan.md"), plan = files.find((item) => item.path === path);
    if (!plan?.content) throw new Error("Review remediation requires its appended plan");
    requireReviewPlan(evidence.read(path), plan.content);
  }
  return evidence.retained();
}
