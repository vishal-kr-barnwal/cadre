import type { TrackState } from "./state.js";
import { autonomousReviewSchema, requireReviewProgress, type AutonomousReview } from "./autonomous-review.js";
import { z } from "zod/v4";
import { CadreError } from "./errors.js";

export const EXECUTION_APPROVAL_MODES = ["governed", "phase", "track", "autonomous"] as const;
export type ExecutionApprovalMode = typeof EXECUTION_APPROVAL_MODES[number];
export const APPROVAL_POLICY_VERSION = 2;

export interface ApprovalPolicyReference {
  executionId?: string;
  approvalMode?: string;
  approvalPolicyVersion?: number;
}

// Completed journals stay historical. Refresh records an explicit choice here;
// active journals and their operation are upgraded together in that envelope.
export const approvalModeMigrationSchema = z.strictObject({
  executionId: z.string().regex(/^[0-9A-Za-z-]+$/),
  approvalMode: z.enum(["track", "autonomous"]),
  approvedAt: z.iso.datetime(),
  refreshPath: z.string().regex(/^refreshes\/refresh-[0-9A-Za-z-]+\.md$/)
});
export type ApprovalModeMigration = z.infer<typeof approvalModeMigrationSchema>;

export function migrationRequired(reference?: ApprovalPolicyReference | null, migration?: ApprovalModeMigration | null): boolean {
  return reference?.approvalMode === "autonomous" && reference.approvalPolicyVersion !== APPROVAL_POLICY_VERSION
    && (!migration || !approvalModeMigrationSchema.safeParse(migration).success || migration.executionId !== reference.executionId);
}

export function resolveApprovalMode(reference?: ApprovalPolicyReference | null, migration?: ApprovalModeMigration | null): ExecutionApprovalMode {
  if (migrationRequired(reference, migration)) {
    throw new CadreError("APPROVAL_MODE_MIGRATION_REQUIRED",
      "Legacy Autonomous requires an explicit Track or Autonomous choice in a digest-bound refresh before continuing or inheriting this execution.");
  }
  if (reference?.approvalPolicyVersion != null && ![1, APPROVAL_POLICY_VERSION].includes(reference.approvalPolicyVersion)) {
    throw new Error("unsupported approvalPolicyVersion");
  }
  const mode = reference?.approvalMode === "autonomous" && reference.approvalPolicyVersion !== APPROVAL_POLICY_VERSION
    ? migration!.approvalMode : reference?.approvalMode ?? "governed";
  if (!(EXECUTION_APPROVAL_MODES as readonly string[]).includes(mode)) {
    throw new Error("approvalMode must be governed, phase, track, or autonomous");
  }
  return mode as ExecutionApprovalMode;
}

export function validateTrackApprovalPolicy(state: TrackState, errors: string[], warnings: string[] = []): void {
  if (state.approvalModeMigration && !approvalModeMigrationSchema.safeParse(state.approvalModeMigration).success) {
    errors.push(`${state.trackId}: invalid approvalModeMigration`);
  }
  const policyReference = (state.operation?.action === "implement" ? state.operation : state.lastExecution) as ApprovalPolicyReference | undefined;
  if (!["completed", "archived"].includes(state.status)
    && migrationRequired(policyReference, state.operation?.action === "implement" ? undefined : state.approvalModeMigration)) {
    warnings.push(`APPROVAL_MODE_MIGRATION_REQUIRED: ${state.trackId}: choose Track or Autonomous through an approved refresh before continuing or inheriting ${policyReference?.executionId}`);
  }
  if (state.autonomousReview) {
    const loop = autonomousReviewSchema.safeParse(state.autonomousReview);
    if (!loop.success) errors.push(`${state.trackId}: invalid autonomousReview: ${loop.error.message}`);
    else {
      if (state.operation?.kind === "review" && state.operation.action !== "review") {
        errors.push(`${state.trackId}: review operation must use action: "review", not a finding disposition`);
      }
      if (["completed", "archived"].includes(state.status) && loop.data.checkpoint !== "completed") errors.push(`${state.trackId}: terminal track requires completed autonomous review`);
      if (loop.data.checkpoint === "completed" && !["completed", "archived"].includes(state.status)) errors.push(`${state.trackId}: completed autonomous review requires a terminal track`);
      if (state.operation?.action === "review") {
        const authority = (state.operation.authorization ?? {}) as Record<string, unknown>;
        if (authority.kind !== "persisted-mode" || authority.originExecutionId !== loop.data.originExecutionId
          || authority.proposalDigest !== state.operation.approvalDigest) errors.push(`${state.trackId}: review authorization must bind originating Autonomous mode and exact proposal digest`);
      }
    }
  }
  if (policyReference?.approvalMode === "autonomous" && !state.autonomousReview
    && (policyReference.approvalPolicyVersion === 2
      || state.approvalModeMigration?.executionId === policyReference.executionId && state.approvalModeMigration?.approvalMode === "autonomous")) {
    errors.push(`${state.trackId}: Autonomous policy requires persisted review loop authority`);
  }
}


/** Used before new execution work; cleanup and blocking use their recovery paths. */
export function requireExecutionAuthority(reference: ApprovalPolicyReference, state: {
  autonomousReview?: AutonomousReview; commits?: { spec?: string | null };
}): ExecutionApprovalMode {
  const mode = resolveApprovalMode(reference);
  if (mode === "autonomous") {
    if (!state.autonomousReview) throw new Error("Autonomous execution requires persisted review loop authority");
    const loop = requireReviewProgress(state.autonomousReview);
    if (loop.specCommit !== state.commits?.spec) throw new Error("Autonomous scope changed; obtain explicit authorization through refresh");
    if (loop.checkpoint !== "implementing") throw new Error("Autonomous execution requires its implementing checkpoint");
  }
  return mode;
}
