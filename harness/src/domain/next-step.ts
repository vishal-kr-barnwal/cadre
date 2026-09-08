import { z } from "zod/v4";
import { resolveApprovalMode, type ApprovalPolicyReference } from "./approval-policy.js";
import { requireCleanAutonomousReview, requireReviewProgress } from "./autonomous-review.js";
import type { TrackState } from "./state.js";

// Logical skill identities are resolved by the host, never by sibling file paths.
// A next step is routing guidance, not dispatch or additional mutation authority.
export const nextStepSchema = z.strictObject({
  action: z.enum(["invoke_skill", "await_approval", "blocked"]),
  plugin: z.literal("cadre"),
  skill: z.enum(["implement", "review"]).nullable(),
  projectRoot: z.string(),
  trackId: z.string(),
  executionId: z.string().nullable(),
  prerequisite: z.enum(["implementation_bookkeeping_commit", "review_bookkeeping_commit"]).nullable(),
  reason: z.string()
});
export type NextStep = z.infer<typeof nextStepSchema>;

export function deriveNextStep(projectRoot: string, state: TrackState | undefined,
  readiness: { errors?: string[]; upgradeRequired?: boolean; staleMemory?: boolean } = {}): NextStep | null {
  if (!state || ["completed", "archived"].includes(state.status)) return null;
  const active = state.operation?.action === "implement";
  const reference = (active ? state.operation : state.lastExecution) as ApprovalPolicyReference | undefined;
  const step = (action: NextStep["action"], skill: NextStep["skill"], reason: string,
    prerequisite: NextStep["prerequisite"] = null): NextStep => ({
    action, plugin: "cadre", skill, projectRoot, trackId: state.trackId,
    executionId: reference?.executionId ?? null, prerequisite, reason
  });
  const blocked = (reason: string) => step("blocked", null, reason);
  try {
    const mode = resolveApprovalMode(reference, active ? undefined : state.approvalModeMigration);
    if (mode !== "autonomous" && !state.autonomousReview) return null;
    if (readiness.errors?.length) return blocked(`Resolve validation errors: ${readiness.errors.join("; ")}`);
    if (readiness.upgradeRequired) return blocked("Complete the approved runtime/template refresh before continuing.");
    if (readiness.staleMemory) return blocked("Reassess stale track or dependency guidance before continuing.");
    if (mode !== "autonomous" || !state.autonomousReview) return blocked("Autonomous routing requires matching persisted mode and loop authority.");
    const loop = requireReviewProgress(state.autonomousReview);
    if (loop.specCommit !== state.commits?.spec) return blocked("Autonomous scope changed; obtain explicit authority through refresh/revise.");
    if (state.operation?.action === "review") {
      return step("invoke_skill", "review", "Reconcile the journaled review promotion and commits before starting another execution.");
    }
    if (state.operation && !active) return blocked(`Finish the pending ${state.operation.action} operation first.`);
    if (active && state.status === "in_progress" && loop.checkpoint === "implementing") {
      return step("invoke_skill", "implement", "Resume the existing execution; do not create a duplicate.");
    }
    if (!state.operation && state.status === "ready_for_review") {
      if (loop.checkpoint === "reviewing") {
        return step("invoke_skill", "review", "Review the complete accumulated implementation in the same task.", "implementation_bookkeeping_commit");
      }
      if (loop.checkpoint === "awaiting_approval") {
        requireCleanAutonomousReview(loop, state.lastExecution ?? {}, []);
        return step("await_approval", "review", "Revalidate completion evidence with review_complete prepare and obtain explicit approval of its exact proposal.");
      }
    }
    if (!state.operation && state.status === "in_progress" && loop.checkpoint === "remediating") {
      return step("invoke_skill", "implement", "Start a new execution for the approved remediation graph, preserving prior executions.", "review_bookkeeping_commit");
    }
    return blocked("Reconcile the Autonomous checkpoint, lifecycle, and operation before continuing.");
  } catch (error) {
    return blocked(error instanceof Error ? error.message : String(error));
  }
}
