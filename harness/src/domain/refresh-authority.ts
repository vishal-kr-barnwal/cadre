import { isDeepStrictEqual } from "node:util";
import { autonomousReviewSchema, requireUnchangedAutonomousReview } from "./autonomous-review.js";
import { approvalModeMigrationSchema } from "./approval-policy.js";
import { readSafeArtifact } from "./memory.js";
import type { ExecutionJournal } from "./execution.js";
import type { TrackState } from "./state.js";

/** Context refresh cannot replace delivery/review evidence with authored state. */
export function requireRefreshAuthority(root: string, previous: TrackState, proposed: TrackState, artifacts: Map<string, string>): void {
  if (!isDeepStrictEqual(previous.commits, proposed.commits)) throw new Error("Refresh must preserve authored commit references; the runtime binds changed artifacts");
  if (previous.autonomousReview) {
    requireUnchangedAutonomousReview(previous.autonomousReview, proposed.autonomousReview, "Refresh");
    const binding = (state: TrackState) => state.operation?.action === "implement" ? state.operation : state.lastExecution;
    const before = binding(previous), after = binding(proposed);
    if (!isDeepStrictEqual(previous.approvalModeMigration, proposed.approvalModeMigration)
      || before?.executionId !== after?.executionId || before?.approvalMode !== after?.approvalMode
      || before?.approvalPolicyVersion !== after?.approvalPolicyVersion) {
      throw new Error("Refresh must preserve existing Autonomous approval policy and execution authority");
    }
    return;
  }
  if (!proposed.autonomousReview) return;
  const binding = previous.operation?.action === "implement" ? previous.operation : previous.lastExecution;
  const migration = approvalModeMigrationSchema.safeParse(proposed.approvalModeMigration);
  if (!binding || binding.approvalMode !== "autonomous" || binding.approvalPolicyVersion === 2 || !migration.success
    || migration.data.executionId !== binding.executionId || migration.data.approvalMode !== "autonomous"
    || !artifacts.has(migration.data.refreshPath)) {
    throw new Error("Refresh cannot create Autonomous authority without an explicit legacy policy migration");
  }
  const journal = JSON.parse(readSafeArtifact(root, `.cadre/tracks/${previous.trackId}/${binding.journal}`)) as ExecutionJournal;
  const loop = autonomousReviewSchema.parse(proposed.autonomousReview);
  if (journal.executionId !== binding.executionId || journal.trackId !== previous.trackId
    || loop.originExecutionId !== binding.executionId || loop.authorizedAt !== migration.data.approvedAt
    || loop.initialBaseCommit !== journal.baseCommit || loop.specCommit !== previous.commits?.spec
    || loop.findings.length || loop.blocker || loop.reviewedExecutionId || loop.reviewedHead
    || loop.checkpoint !== (previous.operation?.action === "implement" ? "implementing" : "reviewing")) {
    throw new Error("Refresh migration must bind Autonomous authority to the original execution and explicit policy approval");
  }
}
