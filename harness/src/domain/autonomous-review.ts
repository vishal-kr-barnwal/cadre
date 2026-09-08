import { z } from "zod/v4";

const commit = z.string().regex(/^[0-9a-f]{7,40}$/);
const executionId = z.string().regex(/^[0-9A-Za-z-]+$/);
export const autonomousReviewSchema = z.strictObject({
  policyVersion: z.literal(2),
  originExecutionId: executionId,
  authorizedAt: z.iso.datetime(),
  initialBaseCommit: commit,
  specCommit: commit,
  checkpoint: z.enum(["implementing", "reviewing", "remediating", "awaiting_approval", "blocked", "completed"]),
  reviewedExecutionId: executionId.optional(),
  reviewedHead: commit.optional(),
  blocker: z.string().trim().min(1).optional(),
  findings: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    summary: z.string().trim().min(1),
    status: z.enum(["open", "resolved"]),
    attemptExecutionIds: z.array(executionId)
  }))
}).superRefine((loop, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (new Set(loop.findings.map((finding) => finding.id)).size !== loop.findings.length) issue("duplicate finding identity");
  for (const finding of loop.findings) {
    if (new Set(finding.attemptExecutionIds).size !== finding.attemptExecutionIds.length) issue("duplicate remediation attempt");
  }
  if (loop.checkpoint === "blocked" && !loop.blocker) issue("blocked review loop requires a blocker");
  if (["awaiting_approval", "completed"].includes(loop.checkpoint)) {
    if (!loop.reviewedExecutionId || !loop.reviewedHead) issue("clean review requires execution and HEAD evidence");
    if (loop.findings.some((finding) => finding.status === "open")) issue("clean review retains unresolved findings");
  }
});
export type AutonomousReview = z.infer<typeof autonomousReviewSchema>;

export function requireReviewProgress(value: AutonomousReview): AutonomousReview {
  const loop = autonomousReviewSchema.parse(value);
  if (loop.checkpoint === "blocked") throw new Error(`Autonomous review is blocked: ${loop.blocker}`);
  const stalled = loop.findings.filter((finding) => finding.status === "open" && finding.attemptExecutionIds.length >= 2);
  if (stalled.length) throw new Error(`Autonomous review stalled after two remediation attempts: ${stalled.map((finding) => finding.id).join(", ")}; ask the human how to continue`);
  return loop;
}

export function requireCleanAutonomousReview(value: AutonomousReview, execution: { executionId?: string; headCommit?: string }, acceptedRisks: string[]): void {
  const loop = autonomousReviewSchema.parse(value);
  if (!["awaiting_approval", "completed"].includes(loop.checkpoint)
    || loop.reviewedExecutionId !== execution.executionId || loop.reviewedHead !== execution.headCommit) {
    throw new Error("Autonomous completion requires a clean review bound to the current execution and HEAD");
  }
  if (acceptedRisks.length) throw new Error("Autonomous review cannot waive findings through acceptedRisks");
}

/** Candidate snapshots bind review evidence without embedding their own digest. */
export function validateAutonomousRemediation(previous: AutonomousReview, candidate: unknown,
  execution: { executionId?: string; headCommit?: string }): AutonomousReview {
  const next = requireReviewProgress(autonomousReviewSchema.parse(candidate));
  for (const field of ["originExecutionId", "authorizedAt", "initialBaseCommit", "specCommit"] as const) {
    if (next[field] !== previous[field]) throw new Error(`Autonomous remediation cannot change ${field}; obtain explicit scope authorization`);
  }
  if (next.checkpoint !== "remediating" || !next.findings.some((finding) => finding.status === "open")) {
    throw new Error("Autonomous remediation requires open findings and its remediating checkpoint");
  }
  if (next.reviewedExecutionId !== execution.executionId || next.reviewedHead !== execution.headCommit) {
    throw new Error("Autonomous remediation must review the current completed execution and HEAD");
  }
  for (const finding of previous.findings) {
    const updated = next.findings.find((item) => item.id === finding.id);
    if (!updated || finding.attemptExecutionIds.some((id) => !updated.attemptExecutionIds.includes(id))) {
      throw new Error(`Autonomous remediation must preserve finding identity and attempts: ${finding.id}`);
    }
  }
  for (const finding of next.findings) {
    const recorded = previous.findings.find((item) => item.id === finding.id)?.attemptExecutionIds ?? [];
    if (finding.attemptExecutionIds.some((id) => !recorded.includes(id)
      && (id !== execution.executionId || id === previous.originExecutionId))) {
      throw new Error(`Autonomous remediation contains an unverified attempt: ${finding.id}`);
    }
  }
  return next;
}
