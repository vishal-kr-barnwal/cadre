import { z } from "zod/v4";
import { isDeepStrictEqual } from "node:util";
import { autonomousReviewSchema, stalledReviewFindings } from "./autonomous-review.js";
import type { TrackState } from "./state.js";

export const reviewRetrySchema = z.strictObject({
  trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  refreshPath: z.string().regex(/^refreshes\/refresh-[a-z0-9-]+\.md$/),
  reason: z.string().trim().min(1)
});
export type ReviewRetry = z.infer<typeof reviewRetrySchema>;

/** Explicit refresh approval renews a bounded budget without deleting prior attempts. */
export function deriveReviewRetry(previous: TrackState, proposed: TrackState, retry: ReviewRetry,
  artifacts: Map<string, string>, reference: string): TrackState {
  const input = reviewRetrySchema.parse(retry), loop = autonomousReviewSchema.parse(previous.autonomousReview);
  if (previous.schemaVersion !== 2 || previous.trackId !== input.trackId || loop.specCommit !== previous.commits?.spec
    || (loop.checkpoint !== "blocked" && !stalledReviewFindings(loop).length)) {
    throw new Error("Explicit review retry requires a blocked or stalled current Autonomous loop");
  }
  const authored = artifacts.get(`tracks/${input.trackId}/state.json`);
  if (!authored || !isDeepStrictEqual(JSON.parse(authored), previous)) throw new Error("Review retry must stage the unchanged current track state");
  if (!artifacts.get(input.refreshPath)?.trim()) throw new Error("Review retry requires its staged human-instruction refresh record");
  if ([...artifacts.keys()].some((path) => path.startsWith(`tracks/${input.trackId}/`) && path !== `tracks/${input.trackId}/state.json`)) {
    throw new Error("Approve review retry separately from scope, plan, or execution changes");
  }
  const checkpoint = previous.operation?.action === "implement" ? "implementing"
    : !previous.operation && previous.status === "ready_for_review" ? "reviewing"
      : !previous.operation && ["planned", "in_progress"].includes(previous.status) ? "remediating" : null;
  if (!checkpoint) throw new Error("Reconcile the pending operation before retrying review");
  const {blocker: _blocker, ...retained} = loop;
  const state = {...proposed, autonomousReview: {...retained, checkpoint,
    retryAuthorization: {commit: reference, attemptBaseline: loop.findings.map(({id, attemptExecutionIds}) => ({id, attemptExecutionIds: [...attemptExecutionIds]}))}}} as TrackState;
  (state.history as Array<Record<string, unknown>>).at(-1)!.reviewRetry = {refreshPath: input.refreshPath, reason: input.reason, previousLoop: loop};
  return state;
}

export function validateReviewRetryEvidence(state: TrackState, errors: string[]): void {
  const parsed = autonomousReviewSchema.safeParse(state.autonomousReview);
  if (!parsed.success) return; // The policy validator reports the invalid loop schema.
  const loop = parsed.data, retry = loop.retryAuthorization;
  if (!retry) return;
  const entry = (Array.isArray(state.history) ? state.history : []).find((entry: unknown) => entry && typeof entry === "object"
    && (entry as Record<string, unknown>).action === "refresh" && (entry as Record<string, unknown>).commit === retry.commit) as
    {reviewRetry?: {refreshPath?: string; reason?: string; previousLoop?: unknown}} | undefined;
  const evidence = z.strictObject({refreshPath: reviewRetrySchema.shape.refreshPath, reason: reviewRetrySchema.shape.reason,
    previousLoop: autonomousReviewSchema}).safeParse(entry?.reviewRetry);
  if (!evidence.success
    || !isDeepStrictEqual(retry.attemptBaseline, evidence.data.previousLoop.findings.map(({id, attemptExecutionIds}) => ({id, attemptExecutionIds})))
    || ["originExecutionId", "authorizedAt", "initialBaseCommit"].some((key) => loop[key as keyof typeof loop] !== evidence.data.previousLoop[key as keyof typeof loop])) {
    errors.push(`${state.trackId}: retry authority requires its exact approved refresh history and prior loop evidence`);
  }
}
