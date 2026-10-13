import { resolveApprovalMode } from "./approval-policy.js";
import { autonomousReviewSchema, validateAutonomousRemediation } from "./autonomous-review.js";
import { isGitAncestor, requireReviewedProductUnchanged } from "./git.js";
import { validateExecutionJournal } from "./execution.js";
import { readSafeArtifact } from "./memory.js";
import { parsePlanContent, validatePlanGraph } from "./plan.js";
import { requireReviewPlan } from "./review-invariants.js";
import type { TrackState } from "./state.js";
import { join } from "node:path";

/** Derive the v5 review transition without a self-referential staged state/digest. */
export function deriveAutonomousReviewCandidate(root: string, previous: TrackState,
  artifacts: Map<string, string>, reference: string): TrackState {
  const parent = `tracks/${previous.trackId}`;
  if (previous.status !== "ready_for_review") throw new Error("Review remediation requires canonical ready_for_review state");
  if (previous.operation) throw new Error("Reconcile the existing review operation before preparing v5 remediation");
  if (resolveApprovalMode(previous.lastExecution, previous.approvalModeMigration) !== "autonomous" || !previous.autonomousReview) {
    throw new Error("Automatic remediation requires persisted Autonomous authority");
  }
  if (previous.autonomousReview.specCommit !== previous.commits?.spec) throw new Error("Autonomous scope changed; obtain explicit authorization before remediation");
  if (artifacts.has(`${parent}/state.json`)) throw new Error("Autonomous review derives state.json from the loop snapshot; omit staged state.json");
  const cycle = (previous.reviewCycles?.length ?? 0) + 1;
  const snapshot = `${parent}/reviews/loop-${cycle}.json`;
  const snapshots = [...artifacts.keys()].filter((path) => path.startsWith(`${parent}/reviews/`));
  if (snapshots.length !== 1 || snapshots[0] !== snapshot) throw new Error(`Autonomous remediation requires exactly reviews/loop-${cycle}.json`);
  for (const file of ["plan.md", "learning.md", "dependency-context.json"]) {
    if (!artifacts.has(`${parent}/${file}`)) throw new Error(`Review remediation requires reassessed ${file}`);
  }
  const bugs = [...artifacts.keys()].filter((path) => path.startsWith(`${parent}/bugs/`));
  if (!bugs.length) throw new Error("Review remediation requires evidence-backed bug artifacts");
  const loop = validateAutonomousRemediation(autonomousReviewSchema.parse(previous.autonomousReview),
    JSON.parse(artifacts.get(snapshot)!), previous.lastExecution ?? {});
  const head = previous.lastExecution?.headCommit;
  const execution = previous.lastExecution;
  if (!head || !execution?.executionId || !execution.planRevision || !execution.graphDigest
    || !isGitAncestor(root, head)) throw new Error("Review requires completed execution evidence at an ancestor of canonical HEAD");
  requireReviewedProductUnchanged(root, head, previous.trackId);
  const errors: string[] = [];
  const original = parsePlanContent(readSafeArtifact(root, `.cadre/${parent}/plan.md`), `${parent}/plan.md`, errors);
  validatePlanGraph(`${parent}/plan.md`, original, previous.status, errors);
  validateExecutionJournal(join(root, ".cadre", parent), previous, original, errors);
  const proposed = parsePlanContent(artifacts.get(`${parent}/plan.md`)!, `${parent}/plan.md`, errors);
  validatePlanGraph(`${parent}/plan.md`, proposed, "in_progress", errors);
  if (errors.length) throw new Error(errors.join("; "));
  requireReviewPlan(readSafeArtifact(root, `.cadre/${parent}/plan.md`), artifacts.get(`${parent}/plan.md`)!);
  return { ...previous, status: "in_progress", checkpoint: "ready", operation: null, autonomousReview: loop,
    reviewCycles: [...(previous.reviewCycles ?? []), {
      cycle, outcome: "changes_requested", executionId: execution.executionId,
      planRevision: execution.planRevision, graphDigest: execution.graphDigest,
      reviewedHead: head, commitRange: `${loop.initialBaseCommit}..${head}`, bugs,
      attemptedFindingIds: loop.findings.filter((finding) => finding.status === "open").map((finding) => finding.id),
      authorization: { kind: "persisted-mode", originExecutionId: loop.originExecutionId, operation: reference }
    }] };
}
