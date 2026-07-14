import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";

import type { ReviewFile } from "./contracts";
import { reviewArtifactsFromFiles, workflowReviewBundle } from "./review-bundles";
import { filesForApprovalStage, previewFilesForStages, stageRecord } from "./approval-session-model";
import { prepareApprovalContinuation } from "./approval-session-continuation";
import { sessionTargetDriftError } from "./approval-session-integrity";
import { transitionApprovalSession } from "./approval-session-transition";
import {
  approvalCancelRequested,
  approvalComplete,
  approvalPayload,
  approvalPayloadHash,
  approvalStageHash,
  applyApprovalSessionPayload,
  approvedStageIds,
  derivedApprovalSessionId,
  requestedApprovalSessionId,
} from "./approval-request";

import {
  cancelApprovalSession,
  readApprovalSession,
  recordApprovalPreview,
  writeApprovalSession,
  type ApprovalSession,
} from "./approval-session-store";
import type { ApprovalStage } from "./staged-approval-stages";
export { approvedTargetReviewPaths, validateApprovedTargetReviewFiles } from "./approval-review-validation";
export {
  artifactApprovalStages,
  handoffApprovalStages,
  newTrackApprovalStages,
  refreshApprovalStages,
  releaseApprovalStages,
  reviseApprovalStages,
  setupApprovalStages
} from "./staged-approval-stages";

function stageApprovalPrompt(workflow: string, stage: ApprovalStage, sessionId: string, files: ReviewFile[]): string {
  const paths = files.map((file) => file.path).join(", ") || stage.title;
  return `Approve Cadre ${workflow} stage "${stage.id}" as one atomic review set after reviewing: ${paths}? Reply "approve ${stage.id}" to approve this exact ${files.length}-file set for session ${sessionId}.`;
}

export { approvalComplete, approvedStageIds, requestedApprovalSessionId, requestedApprovalStage } from "./approval-request";

export interface StagedApprovalOptions {
  allowEmptyActiveStage?: boolean;
}

function filesForStage(files: ReviewFile[], stage: ApprovalStage): ReviewFile[] {
  return filesForApprovalStage(files, stage);
}

export function applyStagedApprovalSessionPayload(root: string, args: RuntimeArgs = {}, workflow: string): RuntimeArgs {
  return applyApprovalSessionPayload(root, args, workflow);
}

function stageHash(workflow: string, stage: ApprovalStage, files: ReviewFile[], extras: JsonObject): string {
  return approvalStageHash(workflow, stage, filesForStage(files, stage).map((file) => ({
      path: file.path,
      source: file.source,
      kind: file.kind,
      missing: file.missing === true,
      content: file.content,
    })), extras);
}

function approvedPreviewFiles(session: ApprovalSession | null, approvedIds: string[]): JsonObject[] {
  return previewFilesForStages(session, approvedIds).filter((file) => file.missing !== true);
}

export function stagedApprovalState(
  root: string,
  workflow: string,
  args: RuntimeArgs,
  stages: ApprovalStage[],
  reviewFiles: ReviewFile[],
  extras: JsonObject = {},
  options: StagedApprovalOptions = {},
): JsonObject {
  const approvedIds = approvedStageIds(args);
  const payloadHash = approvalPayloadHash(workflow, stages, args, extras);
  const requestedSessionId = requestedApprovalSessionId(args);
  const requestedSession = requestedSessionId ? readApprovalSession(root, requestedSessionId) : null;
  const sessionId = requestedSession?.workflow === workflow
    ? requestedSessionId!
    : derivedApprovalSessionId(workflow, root, payloadHash);
  if (approvalCancelRequested(args)) {
    if (!requestedSessionId) {
      return {
        version: 1,
        kind: "cadre.staged_approval.v1",
        workflow,
        required: true,
        cancelled: false,
        valid_for_execute: false,
        approval_error: "approvalSessionId is required to cancel staged review",
      };
    }
    const cancellation = cancelApprovalSession(root, requestedSessionId, workflow);
    return {
      version: 1,
      kind: "cadre.staged_approval.v1",
      workflow,
      required: true,
      session_id: requestedSessionId,
      cancelled: cancellation.cancelled === true,
      valid_for_execute: false,
      approval_error: cancellation.ok === false
        ? asOptionalString(cancellation.error) || "Unable to cancel the staged approval session safely"
        : null,
      cancellation: asJsonObject(cancellation),
      current_stage: null,
      approved_stages: [],
      pending_stages: [],
      current_review_artifacts: [],
      current_review_bundle: null,
    };
  }
  const transition = transitionApprovalSession(root, args, workflow, sessionId, payloadHash, stages, approvedIds, reviewFiles);
  let approvalError = transition.error;
  let session = transition.session;
  let active = session ? stages.find((stage) => !session!.approved_stages.includes(stage.id)) || null : null;
  let activeFiles = active && session ? stageRecord(session, active.id)?.snapshot_files || [] : [];
  let previousRecord = active && session ? stageRecord(session, active.id) : null;
  let candidateSession: ApprovalSession | undefined;
  if (!approvalError && session && active) {
    const driftError = sessionTargetDriftError(root, args, session, session.approved_stages);
    const continuation = driftError ? null : prepareApprovalContinuation(
      root,
      session,
      stages,
      approvalPayload(args),
      payloadHash,
      reviewFiles,
      options,
    );
    approvalError = driftError || continuation?.error || null;
    if (continuation?.ok) {
      candidateSession = continuation.session;
      active = continuation.activeStage;
      activeFiles = continuation.activeFiles;
      previousRecord = continuation.previousRecord;
    }
  }
  const approvedBeforeBundle = new Set(session?.approved_stages || approvedIds);
  const pendingBeforeBundle = stages.filter((stage) => !approvedBeforeBundle.has(stage.id));
  const stageBundle = active && activeFiles.length > 0 && !approvalError && candidateSession
    ? workflowReviewBundle(root, workflow, args, activeFiles, {
      ...extras,
      approval_stage: active.id,
      approved_stages: Array.from(approvedBeforeBundle),
      pending_stages: pendingBeforeBundle.map((stage) => stage.id),
    }, previousRecord)
    : null;
  if (active && candidateSession && stageBundle) {
    recordApprovalPreview(root, sessionId, workflow, payloadHash, active.id, asJsonObject(stageBundle), candidateSession);
  } else if (active && candidateSession && options.allowEmptyActiveStage && activeFiles.length === 0 && !approvalError) {
    writeApprovalSession(root, { ...candidateSession, updated_at: new Date().toISOString() });
  }
  const bundleError = active && activeFiles.length > 0 && !approvalError && !stageBundle
    ? "Approval preview could not be materialized; review output must remain enabled for staged approval."
    : asOptionalString(asJsonObject(stageBundle).error);
  if (!approvalError && bundleError) approvalError = bundleError;
  session = readApprovalSession(root, sessionId) || session;
  const authoritativeApprovedIds = session?.approved_stages || approvedIds;
  const approved = new Set(authoritativeApprovedIds);
  const pending = stages.filter((stage) => !approved.has(stage.id));
  active = stages.find((stage) => !approved.has(stage.id)) || null;
  const effectiveFiles = session?.snapshot_files || reviewFiles;
  activeFiles = active
    ? (session ? stageRecord(session, active.id)?.snapshot_files : null) || filesForStage(effectiveFiles, active)
    : [];
  const approvedFiles = approvedPreviewFiles(session, authoritativeApprovedIds);
  const approvedPaths = Array.from(new Set(approvedFiles.map((file) => asOptionalString(file.path)).filter((file): file is string => Boolean(file)))).sort();
  const complete = approvalComplete(args);
  const deferredForClarification = Boolean(active && activeFiles.length === 0 && options.allowEmptyActiveStage && !approvalError);
  const stageHashes = Object.fromEntries(stages.map((stage) => [stage.id, stageHash(workflow, stage, effectiveFiles, extras)]));
  const validForExecute = !approvalError && complete && authoritativeApprovedIds.length === stages.length;
  const manualPrompt = active && !deferredForClarification ? stageApprovalPrompt(workflow, active, sessionId, activeFiles) : null;
  return {
    version: 1,
    kind: "cadre.staged_approval.v1",
    workflow,
    required: true,
    session_id: sessionId,
    payload_hash: session?.payload_hash || payloadHash,
    approval_session_argument: "approvalSessionId",
    approval_argument: "approvalComplete",
    explicit_user_approval_required: true,
    manual_approval_required: !deferredForClarification,
    manual_approval_prompt: manualPrompt,
    deferred_for_clarification: deferredForClarification,
    resume_without_approval: deferredForClarification ? { approval: { session_id: sessionId } } : null,
    approval_instruction: active
      ? deferredForClarification
        ? `Collect only the missing ${active.id} input, then resume session ${sessionId} without recording approval.`
        : `Ask the user for explicit approval of only ${active.id}; if no native prompt exists, ask manually and wait.`
      : "Ask the user for explicit staged approval before sending any staged approval packet.",
    not_approval: [
      "Agent review is not approval.",
      "No warnings is not approval.",
      "Recommended setup choices are not approval.",
      "Different session/payload approval is stale.",
    ],
    approval_complete: complete,
    valid_for_execute: validForExecute,
    approval_error: approvalError,
    current_stage: active?.id || null,
    current_stage_title: active?.title || null,
    current_stage_hash: active ? stageHashes[active.id] : null,
    stage_hashes: stageHashes,
    approved_stages: Array.from(approved),
    pending_stages: pending.map((stage) => stage.id),
    stages: stages.map((stage) => {
      const stageFiles = filesForStage(effectiveFiles, stage);
      return {
        id: stage.id,
        title: stage.title,
        description: stage.description,
        approved: approved.has(stage.id),
        file_count: stageFiles.length,
        canonical_paths: Array.from(new Set(stageFiles.map((file) => file.canonicalPath).filter((value): value is string => Boolean(value)))),
        projection_paths: Array.from(new Set(stageFiles.map((file) => file.projectionPath).filter((value): value is string => Boolean(value)))),
      };
    }),
    review_documents: stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      approved: approved.has(stage.id),
      files: reviewArtifactsFromFiles(filesForStage(effectiveFiles, stage)),
    })),
    review_files: reviewArtifactsFromFiles(effectiveFiles),
    final_only_files: asStringArray(extras.final_only_files),
    current_document: active ? {
      id: active.id,
      title: active.title,
      files: reviewArtifactsFromFiles(activeFiles),
    } : null,
    current_review_artifacts: reviewArtifactsFromFiles(activeFiles),
    current_review_bundle: stageBundle,
    review_bundle: stageBundle,
    intent_to_add_paths: session?.intent_to_add_paths || [],
    approved_review_files: approvedFiles,
    approved_review_paths: approvedPaths,
    next_actions: complete
      ? approvalError
        ? [approvalError, "Restart review from the returned current stage and packet-issued approvalSessionId."]
        : [`Call ${workflow} with execute:true, approvalComplete:true, and approvalSessionId:${sessionId} to apply the approved staged payload.`]
      : active && deferredForClarification
        ? [`Resume ${workflow} with approval.session_id:${sessionId} after collecting only the missing ${active.id} input; this continuation is not approval.`]
        : active
        ? [
          `Ask the user to approve only the ${active.id} stage; do not approve it yourself after review.`,
          `Only after explicit user approval, call ${workflow} again with approvalSessionId:${sessionId}, approvalStage:${active.id}, and approvedStages including exactly the next stage.`,
          "After all stages are approved in dry-run calls, call the mutating packet with execute:true, approvalComplete:true, and the same approvalSessionId.",
        ]
        : [],
  };
}

export function stagedApprovalReady(approval: unknown): boolean {
  const state = asJsonObject(approval);
  return state.valid_for_execute === true;
}

export function stagedApprovalError(approval: unknown): string | null {
  return asOptionalString(asJsonObject(approval).approval_error) || null;
}
