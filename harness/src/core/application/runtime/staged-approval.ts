import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";

import type { ReviewFile } from "./contracts";
import { approvalStageReviewHash } from "./approval-stage-hash";
import { materializeApprovalPreview } from "./approval-preview-transaction";
import { reviewArtifactsFromFiles } from "./review-bundles";
import { filesForApprovalStage, previewFilesForStages, stageRecord } from "./approval-session-model";
import { prepareApprovalContinuation } from "./approval-session-continuation";
import { sessionTargetDriftError } from "./approval-session-integrity";
import { transitionApprovalSession } from "./approval-session-transition";
import {
  approvalCancelRequested,
  approvalComplete,
  approvalPayload,
  approvalPayloadHash,
  approvalReadOnlyRequested,
  applyApprovalSessionPayload,
  approvedStageIds,
  derivedApprovalSessionId,
  requestedApprovalSessionId,
} from "./approval-request";

import {
  readApprovalSession,
  readApprovalSessionResult,
  writeApprovalSession,
  type ApprovalSession,
} from "./approval-session-store";
import { cancelApprovalSession } from "./approval-session-cancellation";
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

function approvalSessionRecoveryState(
  workflow: string,
  sessionId: string,
  stages: ApprovalStage[],
  error: string,
): JsonObject {
  return {
    version: 1,
    kind: "cadre.staged_approval.v1",
    workflow,
    required: true,
    session_id: sessionId,
    session_resumable: false,
    explicit_user_approval_required: true,
    manual_approval_required: false,
    manual_approval_prompt: null,
    approval_complete: false,
    valid_for_execute: false,
    approval_error: `Interrupted approval transaction recovery failed: ${error}`,
    approval_recovery_required: true,
    approval_instruction: "Do not approve, resume, cancel, or execute this session automatically. Preserve its approval transaction journal and repair the reported recovery failure first.",
    current_stage: null,
    approved_stages: [],
    pending_stages: stages.map((stage) => stage.id),
    current_review_artifacts: [],
    current_review_bundle: null,
    review_bundle: null,
    intent_to_add_paths: [],
    next_actions: ["Stop automatic continuation and preserve the approval transaction journal for manual recovery."],
  };
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
  const requestedSessionRead = requestedSessionId
    ? readApprovalSessionResult(root, requestedSessionId)
    : null;
  if (requestedSessionId && requestedSessionRead?.recovery_required) {
    return approvalSessionRecoveryState(
      workflow,
      requestedSessionId,
      stages,
      requestedSessionRead.error || "Cancellation journal reconciliation failed",
    );
  }
  const requestedSession = requestedSessionRead?.session || null;
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
    const recoveryRequired = cancellation.recovery_required === true;
    return {
      version: 1,
      kind: "cadre.staged_approval.v1",
      workflow,
      required: true,
      session_id: requestedSessionId,
      cancelled: cancellation.cancelled === true,
      valid_for_execute: false,
      approval_recovery_required: recoveryRequired,
      session_resumable: false,
      manual_approval_required: false,
      manual_approval_prompt: null,
      approval_error: cancellation.ok === false
        ? asOptionalString(cancellation.error) || "Unable to cancel the staged approval session safely"
        : null,
      cancellation: asJsonObject(cancellation),
      current_stage: null,
      approved_stages: [],
      pending_stages: [],
      current_review_artifacts: [],
      current_review_bundle: null,
      next_actions: recoveryRequired
        ? ["Stop automatic continuation and preserve the approval transaction journal for manual recovery."]
        : [],
    };
  }
  const readOnly = approvalReadOnlyRequested(args);
  const transition = readOnly && requestedSession?.workflow === workflow
    ? { session: requestedSession, error: null, recoveryRequired: false }
    : transitionApprovalSession(root, args, workflow, sessionId, payloadHash, stages, approvedIds, reviewFiles, extras);
  let approvalError = transition.error;
  let session = transition.session?.workflow === workflow ? transition.session : null;
  let active = session ? stages.find((stage) => !session!.approved_stages.includes(stage.id)) || null : null;
  let activeFiles = active && session ? stageRecord(session, active.id)?.snapshot_files || [] : [];
  let previousRecord = active && session ? stageRecord(session, active.id) : null;
  let candidateSession: ApprovalSession | undefined;
  let recoveryRequired = transition.recoveryRequired === true;
  if (!readOnly && !approvalError && session && active) {
    const driftError = sessionTargetDriftError(root, args, session, [
      ...session.approved_stages,
      active.id,
    ]);
    const continuation = driftError ? null : prepareApprovalContinuation(
      root,
      session,
      stages,
      approvalPayload(args, workflow),
      payloadHash,
      reviewFiles,
      options,
    );
    approvalError = driftError || continuation?.error || null;
    recoveryRequired = recoveryRequired || Boolean(driftError);
    if (continuation?.ok) {
      candidateSession = continuation.session;
      active = continuation.activeStage;
      activeFiles = continuation.activeFiles;
      previousRecord = continuation.previousRecord;
    }
  }
  const approvedBeforeBundle = new Set(session?.approved_stages || approvedIds);
  const pendingBeforeBundle = stages.filter((stage) => !approvedBeforeBundle.has(stage.id));
  let stageBundle: JsonObject | null = null;
  if (active && activeFiles.length > 0 && !approvalError && candidateSession && session) {
    const preview = materializeApprovalPreview(root, workflow, args, activeFiles, {
      ...extras,
      approval_stage: active.id,
      approved_stages: Array.from(approvedBeforeBundle),
      pending_stages: pendingBeforeBundle.map((stage) => stage.id),
    }, previousRecord, session, candidateSession, active.id, payloadHash);
    stageBundle = preview.bundle;
    if (!preview.ok) approvalError = preview.error || "Approval preview transaction failed";
    recoveryRequired = recoveryRequired || preview.recovery_required === true;
  } else if (active && candidateSession && options.allowEmptyActiveStage && activeFiles.length === 0 && !approvalError) {
    try {
      writeApprovalSession(root, { ...candidateSession, updated_at: new Date().toISOString() });
    } catch (error) {
      approvalError = error instanceof Error ? error.message : String(error);
    }
  }
  const bundleError = active && activeFiles.length > 0 && !readOnly && !approvalError && !stageBundle
    ? "Approval preview could not be materialized; review output must remain enabled for staged approval."
    : asOptionalString(asJsonObject(stageBundle).error);
  if (!approvalError && bundleError) approvalError = bundleError;
  const persistedSession = readApprovalSession(root, sessionId);
  session = persistedSession?.workflow === workflow ? persistedSession : session;
  const responseSessionId = session?.session_id || (approvalError ? requestedSessionId : sessionId);
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
  const stageHashes = Object.fromEntries(stages.map((stage) => [
    stage.id,
    approvalStageReviewHash(workflow, stage, filesForStage(effectiveFiles, stage), extras),
  ]));
  const currentRecord = active && session ? stageRecord(session, active.id) : null;
  const validForExecute = !approvalError && complete && authoritativeApprovedIds.length === stages.length;
  const currentReviewArtifacts = reviewArtifactsFromFiles(activeFiles);
  const selectedComponents = active?.id === "technical"
    ? Array.from(new Set(activeFiles.flatMap((file) => {
      if (file.path === "cadre/lsp.json") return ["lsp"];
      if (file.documentId === "tech_stack") return ["tech_stack"];
      if (file.documentId === "styleguides") return ["style_guides"];
      if (file.documentId === "repos") return ["repository_topology"];
      return [];
    })))
    : [];
  const omittedComponents = active?.id === "technical"
    ? ["tech_stack", "style_guides", "repository_topology", "lsp"]
      .filter((component) => !selectedComponents.includes(component))
      .map((component) => ({ component, reason: "not selected or not applicable to this frozen technical stage" }))
    : [];
  const currentReviewSet = active ? {
    version: 1,
    schema: "cadre.review_set.v1",
    complete: true,
    truncated: false,
    workflow,
    session_id: responseSessionId,
    stage: active.id,
    stage_hash: stageHashes[active.id],
    stage_revision: currentRecord?.revision ?? null,
    file_count: currentReviewArtifacts.length,
    files: currentReviewArtifacts,
    primary_document: currentReviewArtifacts.find((file) => file.review_role === "human") || null,
    manifest_path: asOptionalString(asJsonObject(stageBundle).manifest_path) || null,
    selected_components: selectedComponents,
    omitted_components: omittedComponents,
  } : null;
  const manualPrompt = active && responseSessionId && !deferredForClarification && !approvalError && !recoveryRequired
    ? stageApprovalPrompt(workflow, active, responseSessionId, activeFiles)
    : null;
  return {
    version: 1,
    kind: "cadre.staged_approval.v1",
    workflow,
    required: true,
    session_id: responseSessionId,
    session_resumable: Boolean(session && active && !recoveryRequired),
    payload_hash: session?.payload_hash || payloadHash,
    approval_session_argument: "approvalSessionId",
    approval_argument: "approvalComplete",
    explicit_user_approval_required: true,
    manual_approval_required: !deferredForClarification && !recoveryRequired,
    manual_approval_prompt: manualPrompt,
    deferred_for_clarification: deferredForClarification,
    approval_instruction: recoveryRequired
      ? "Do not approve, resume, cancel, or execute this session automatically. Preserve the returned diagnostics and repair the reported target/session rollback failure first."
      : active
      ? deferredForClarification
        ? `Collect only the missing ${active.id} input, then use the returned public decision.resume without recording approval.`
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
    approval_recovery_required: recoveryRequired,
    current_stage: active?.id || null,
    current_stage_title: active?.title || null,
    current_stage_hash: active ? stageHashes[active.id] : null,
    current_stage_revision: currentRecord?.revision ?? null,
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
        input_keys: stage.inputKeys || [],
        revision: session ? stageRecord(session, stage.id)?.revision ?? 0 : 0,
        hash: stageHashes[stage.id],
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
      files: currentReviewArtifacts,
    } : null,
    current_review_artifacts: currentReviewArtifacts,
    current_review_set: currentReviewSet,
    current_review_bundle: stageBundle,
    review_bundle: stageBundle,
    intent_to_add_paths: session?.intent_to_add_paths || [],
    approved_review_files: approvedFiles,
    approved_review_paths: approvedPaths,
    next_actions: recoveryRequired
      ? ["Stop automatic continuation. Inspect and repair the approval target/session rollback diagnostics before any further workflow action."]
      : complete
      ? approvalError
        ? [approvalError, "Restart review from the returned current stage and packet-issued approvalSessionId."]
        : [`Call ${workflow} with execute:true, approvalComplete:true, and approvalSessionId:${sessionId} to apply the approved staged payload.`]
      : active && deferredForClarification
        ? [`Fill only the returned decision.writable_paths after collecting the missing ${active.id} input, then invoke decision.resume; this continuation is not approval.`]
        : active
        ? [
          `Ask the user to approve only the ${active.id} stage; do not approve it yourself after review.`,
          `Only after explicit user approval, call ${workflow} again with approvalSessionId:${sessionId}, approvalStage:${active.id}, the returned current_stage_hash/current_stage_revision, and approvedStages including exactly the next stage.`,
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
