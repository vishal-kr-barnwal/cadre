import { asOptionalString } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";

import type { ReviewFile } from "./contracts";
import { approvalStageReviewHash } from "./approval-stage-hash";
import { initializeApprovalSessionAncillary } from "./approval-session-ancillary";
import {
  createStageLedger,
  isStageLedgerSession,
  stageRecord,
  type ApprovalSession,
} from "./approval-session-model";
import {
  captureApprovalBeforeFiles,
  readApprovalSession,
  supersedeUnapprovedApprovalSessions,
  writeApprovalSession,
} from "./approval-session-store";
import { sessionTargetDriftError, stagePreviewError } from "./approval-session-integrity";
import {
  APPROVAL_INPUT_ERROR,
  approvalComplete,
  approvalPayload,
  hasApprovalIntent,
  requestedApprovalSessionId,
  requestedApprovalStage,
  requestedApprovalStageHash,
  requestedApprovalStageRevision,
} from "./approval-request";
import type { ApprovalStage } from "./staged-approval-stages";

export interface ApprovalTransitionResult {
  session: ApprovalSession | null;
  error: string | null;
}

function approvalOrderError(stageIds: string[], approved: string[]): string | null {
  const known = new Set(stageIds);
  const unknown = approved.find((stage) => !known.has(stage));
  if (unknown) return `Unknown approval stage: ${unknown}`;
  for (let index = 0; index < approved.length; index += 1) {
    if (approved[index] !== stageIds[index]) {
      return `Approval stages must be approved in order; expected ${stageIds[index]} before ${approved[index]}.`;
    }
  }
  return null;
}

function createSession(
  root: string,
  sessionId: string,
  workflow: string,
  payloadHash: string,
  payload: JsonObject,
  stages: ApprovalStage[],
  snapshotFiles: ReviewFile[],
): ApprovalSession {
  const beforeFiles = captureApprovalBeforeFiles(root, snapshotFiles);
  const ancillary = initializeApprovalSessionAncillary(root, snapshotFiles);
  const session: ApprovalSession = {
    session_id: sessionId,
    workflow,
    payload_hash: payloadHash,
    payload,
    approved_stages: [],
    ...createStageLedger(stages, snapshotFiles, beforeFiles),
    snapshot_files: snapshotFiles,
    before_files: beforeFiles,
    preview_files: [],
    intent_to_add_paths: [],
    ancillary_snapshot_files: ancillary.snapshots,
    ancillary_before_files: ancillary.beforeFiles,
    updated_at: new Date().toISOString(),
  };
  writeApprovalSession(root, session);
  return readApprovalSession(root, sessionId) || session;
}

export function transitionApprovalSession(
  root: string,
  args: RuntimeArgs,
  workflow: string,
  sessionId: string,
  payloadHash: string,
  stages: ApprovalStage[],
  approved: string[],
  snapshotFiles: ReviewFile[],
  extras: JsonObject = {},
): ApprovalTransitionResult {
  const stageIds = stages.map((stage) => stage.id);
  if (stageIds.length === 0) return { session: null, error: null };
  const orderError = approvalOrderError(stageIds, approved);
  if (orderError) return { session: readApprovalSession(root, sessionId), error: orderError };
  const requestedSession = requestedApprovalSessionId(args);
  const payload = approvalPayload(args);
  const approvalIntent = hasApprovalIntent(args);
  const inputError = asOptionalString((args as JsonObject)[APPROVAL_INPUT_ERROR]);
  if (inputError) return { session: requestedSession ? readApprovalSession(root, requestedSession) : null, error: inputError };

  if (!approvalIntent) {
    if (requestedSession) {
      const existing = readApprovalSession(root, requestedSession);
      if (!existing || existing.workflow !== workflow) {
        return { session: existing, error: `Approval session was not found for ${workflow}.` };
      }
      return { session: existing, error: null };
    }
    const existing = readApprovalSession(root, sessionId);
    if (existing && existing.workflow === workflow && existing.payload_hash === payloadHash && existing.preview_files.length > 0) {
      return { session: existing, error: null };
    }
    const superseded = supersedeUnapprovedApprovalSessions(root, workflow, sessionId, snapshotFiles);
    if (superseded.ok === false) {
      return {
        session: existing,
        error: asOptionalString(superseded.error) || `Unable to supersede the previous ${workflow} review preview`,
      };
    }
    return { session: createSession(root, sessionId, workflow, payloadHash, payload, stages, snapshotFiles), error: null };
  }

  if (!requestedSession) return { session: null, error: "approvalSessionId is required when approving staged workflow output." };
  const session = readApprovalSession(root, requestedSession);
  if (!session || session.workflow !== workflow) {
    return { session, error: "Approval session was not found for this workflow; restart staged review." };
  }
  if (requestedSession !== sessionId) {
    return { session, error: "Approval session is stale for the current generated payload; restart staged review from the current stage." };
  }
  if (!isStageLedgerSession(session)) {
    return { session, error: "This approval session predates stage-owned reviews; cancel and restart it before approving." };
  }
  if (session.payload_hash !== payloadHash) {
    return { session, error: "Approval payload changed while recording approval; amend the current stage in a separate call first." };
  }
  if (session.stage_order?.length !== stageIds.length || session.stage_order.some((stage, index) => stage !== stageIds[index])) {
    return { session, error: "Approval stages changed after the session started; cancel and restart the review." };
  }
  const previous = session.approved_stages || [];
  const previousOrderError = approvalOrderError(stageIds, previous);
  if (previousOrderError) return { session, error: previousOrderError };
  if (approved.length < previous.length || previous.some((stage, index) => approved[index] !== stage)) {
    return { session, error: "Approved stages must preserve the current approval session history." };
  }
  const delta = approved.slice(previous.length);
  if (approvalComplete(args)) {
    if (approved.length !== stageIds.length) {
      return { session, error: "approvalComplete requires every staged approval to be recorded first." };
    }
    if (delta.length > 0) {
      return { session, error: "Record the final stage approval in a dry-run call before using approvalComplete." };
    }
    return { session, error: null };
  }
  if (delta.length !== 1) return { session, error: "Approve exactly one new stage per packet call." };
  const nextExpected = stageIds[previous.length];
  if (delta[0] !== nextExpected) return { session, error: `Next approval stage must be ${nextExpected}.` };
  if (requestedApprovalStage(args) !== nextExpected) {
    return { session, error: `approvalStage is required and must match the newly approved stage ${nextExpected}.` };
  }
  const record = stageRecord(session, nextExpected);
  if (!record) return { session, error: `Approval session is missing stage record: ${nextExpected}` };
  const expectedStageHash = approvalStageReviewHash(workflow, stages[previous.length]!, record.snapshot_files, extras);
  if (requestedApprovalStageHash(args) !== expectedStageHash) {
    return { session, error: `approvalStageHash is required and must match the reviewed ${nextExpected} stage.` };
  }
  if (requestedApprovalStageRevision(args) !== record.revision) {
    return { session, error: `approvalStageRevision is required and must match reviewed revision ${record.revision} for ${nextExpected}.` };
  }
  const previewError = stagePreviewError(record);
  if (previewError) return { session, error: previewError };
  const driftError = sessionTargetDriftError(root, args, session, [...previous, nextExpected]);
  if (driftError) return { session, error: driftError };
  const updated: ApprovalSession = {
    ...session,
    approved_stages: approved,
    updated_at: new Date().toISOString(),
  };
  writeApprovalSession(root, updated);
  return { session: readApprovalSession(root, sessionId) || updated, error: null };
}
