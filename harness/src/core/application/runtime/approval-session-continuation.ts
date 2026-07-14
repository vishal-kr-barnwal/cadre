import type { JsonObject } from "../../../types";

import type { ReviewFile } from "./contracts";
import { captureApprovalBeforeFiles } from "./approval-session-store";
import {
  filesForApprovalStage,
  isStageLedgerSession,
  stageRecord,
  synchronizeApprovalSession,
  type ApprovalSession,
  type ApprovalStageRecord,
} from "./approval-session-model";
import type { ApprovalStage } from "./staged-approval-stages";
import { currentStagePayloadError, stageSnapshotError } from "./approval-session-integrity";

export interface ApprovalContinuationPlan {
  ok: boolean;
  error?: string;
  stage?: string;
  session: ApprovalSession;
  activeStage: ApprovalStage | null;
  activeFiles: ReviewFile[];
  previousRecord: ApprovalStageRecord | null;
}

export interface ApprovalContinuationOptions {
  allowEmptyActiveStage?: boolean;
}

function sameStageOrder(session: ApprovalSession, stages: ApprovalStage[]): boolean {
  const expected = stages.map((stage) => stage.id);
  return expected.length === session.stage_order?.length
    && expected.every((stageId, index) => session.stage_order?.[index] === stageId);
}

function samePaths(left: ReviewFile[], right: ReviewFile[]): boolean {
  const leftPaths = left.map((file) => file.path).sort();
  const rightPaths = right.map((file) => file.path).sort();
  return leftPaths.length === rightPaths.length && leftPaths.every((file, index) => file === rightPaths[index]);
}

function beforeFilesForReview(
  root: string,
  reviewFiles: ReviewFile[],
  known: ApprovalSession["before_files"],
): ApprovalSession["before_files"] {
  const knownByPath = new Map(known.map((file) => [file.path, file]));
  const missing = captureApprovalBeforeFiles(root, reviewFiles.filter((file) => !knownByPath.has(file.path)));
  const capturedByPath = new Map(missing.map((file) => [file.path, file]));
  return reviewFiles.map((file) => knownByPath.get(file.path) || capturedByPath.get(file.path)!).filter(Boolean);
}

export function prepareApprovalContinuation(
  root: string,
  session: ApprovalSession,
  stages: ApprovalStage[],
  payload: JsonObject,
  payloadHash: string,
  reviewFiles: ReviewFile[],
  options: ApprovalContinuationOptions = {},
): ApprovalContinuationPlan {
  const base = { session, activeStage: null, activeFiles: [], previousRecord: null };
  if (!isStageLedgerSession(session)) {
    return {
      ...base,
      ok: false,
      stage: "legacy_approval_session",
      error: session.approved_stages.length > 0
        ? "This approval session predates stage-owned reviews and has approved stages; cancel and restart it before continuing."
        : "This approval session predates stage-owned reviews; cancel and restart it before continuing.",
    };
  }
  if (!sameStageOrder(session, stages)) {
    return { ...base, ok: false, stage: "approval_stage_order", error: "Approval stages changed after the session started; cancel and restart the review." };
  }
  const activeStage = stages.find((stage) => !session.approved_stages.includes(stage.id)) || null;
  if (!activeStage) {
    return { ...base, ok: false, stage: "approval_complete", error: "Every approval stage is already approved; execute or cancel the session instead of changing its payload." };
  }
  const payloadError = currentStagePayloadError(session, activeStage, payload);
  if (payloadError) return { ...base, activeStage, ok: false, stage: "approval_payload_scope", error: payloadError };
  const approvedSnapshotError = stageSnapshotError(session, stages, reviewFiles, session.approved_stages);
  if (approvedSnapshotError) {
    return { ...base, activeStage, ok: false, stage: "approved_stage_changed", error: approvedSnapshotError };
  }
  const previousRecord = stageRecord(session, activeStage.id);
  if (!previousRecord) {
    return { ...base, ok: false, stage: "approval_stage_record", error: `Approval session is missing stage record: ${activeStage.id}` };
  }
  const activeFiles = filesForApprovalStage(reviewFiles, activeStage);
  if (activeFiles.length === 0 && (!options.allowEmptyActiveStage || previousRecord.preview_files.length > 0)) {
    return { ...base, activeStage, previousRecord, ok: false, stage: "approval_stage_files", error: `Current approval stage ${activeStage.id} has no review files.` };
  }
  if (previousRecord.preview_files.length > 0 && !samePaths(previousRecord.snapshot_files, activeFiles)) {
    return {
      ...base,
      activeStage,
      activeFiles,
      previousRecord,
      ok: false,
      stage: "approval_stage_paths",
      error: `Current stage ${activeStage.id} changed its review paths; cancel and restart before changing stage membership.`,
    };
  }
  const beforeFiles = beforeFilesForReview(root, activeFiles, previousRecord.before_files);
  const stageRecords = { ...session.stage_records };
  const ownedPaths = new Set<string>();
  for (const stage of stages) {
    const record = stageRecords[stage.id];
    if (!record) continue;
    const stageFiles = filesForApprovalStage(reviewFiles, stage);
    for (const file of stageFiles) ownedPaths.add(file.path);
    if (session.approved_stages.includes(stage.id)) continue;
    stageRecords[stage.id] = stage.id === activeStage.id
      ? {
        ...record,
        revision: record.revision + 1,
        snapshot_files: activeFiles,
        before_files: beforeFiles,
      }
      : {
        ...record,
        snapshot_files: stageFiles,
        before_files: beforeFilesForReview(root, stageFiles, record.before_files),
      };
  }
  const finalFiles = reviewFiles.filter((file) => !ownedPaths.has(file.path));
  const nextSession = synchronizeApprovalSession({
    ...session,
    payload,
    payload_hash: payloadHash,
    stage_records: stageRecords,
    final_snapshot_files: finalFiles,
    final_before_files: beforeFilesForReview(root, finalFiles, session.final_before_files || []),
  });
  const candidateRecord = stageRecord(nextSession, activeStage.id);
  return {
    ok: true,
    session: nextSession,
    activeStage,
    activeFiles,
    previousRecord: previousRecord.preview_files.length > 0 ? previousRecord : candidateRecord,
  };
}
