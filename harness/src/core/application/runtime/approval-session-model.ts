import type { JsonObject } from "../../../types";
import { asOptionalString } from "../../../guards";

import type { ReviewFile } from "./contracts";
import type { ApprovalStage } from "./staged-approval-stages";

export interface ApprovalBeforeFile {
  path: string;
  existed: boolean;
  content: string | null;
  head_existed?: boolean;
  head_content?: string | null;
}

export type ApprovalStageStatus = "pending" | "previewed" | "approved";

export interface ApprovalStageRecord {
  stage_id: string;
  status: ApprovalStageStatus;
  revision: number;
  snapshot_files: ReviewFile[];
  before_files: ApprovalBeforeFile[];
  preview_files: JsonObject[];
  intent_to_add_paths: string[];
}

export interface ApprovalSession {
  schema_version?: 1 | 2;
  session_id: string;
  workflow: string;
  payload_hash: string;
  payload: JsonObject;
  approved_stages: string[];
  stage_order?: string[];
  stage_records?: Record<string, ApprovalStageRecord>;
  final_snapshot_files?: ReviewFile[];
  final_before_files?: ApprovalBeforeFile[];
  final_preview_files?: JsonObject[];
  final_intent_to_add_paths?: string[];
  ancillary_snapshot_files?: ReviewFile[];
  ancillary_before_files?: ApprovalBeforeFile[];
  snapshot_files: ReviewFile[];
  before_files: ApprovalBeforeFile[];
  preview_files: JsonObject[];
  intent_to_add_paths: string[];
  updated_at: string;
}

function uniqueByPath<T extends { path: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.path)) return false;
    seen.add(value.path);
    return true;
  });
}

function previewPath(value: JsonObject): string | null {
  return asOptionalString(value.path) || null;
}

function uniquePreviewFiles(values: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const file = previewPath(value);
    if (!file || seen.has(file)) return false;
    seen.add(file);
    return true;
  });
}

export function filesForApprovalStage(files: ReviewFile[], stage: ApprovalStage): ReviewFile[] {
  const documentIds = new Set(stage.documentIds);
  const matches = stage.fileMatches || [];
  if (matches.includes("*")) return files;
  return files.filter((file) => (
    (Boolean(file.documentId) && documentIds.has(file.documentId!))
    || matches.some((needle) => file.path.includes(needle))
  ));
}

function beforeFilesForSnapshots(beforeFiles: ApprovalBeforeFile[], snapshots: ReviewFile[]): ApprovalBeforeFile[] {
  const paths = new Set(snapshots.map((file) => file.path));
  return beforeFiles.filter((file) => paths.has(file.path));
}

export function createStageLedger(
  stages: ApprovalStage[],
  snapshots: ReviewFile[],
  beforeFiles: ApprovalBeforeFile[],
): Pick<ApprovalSession, "schema_version" | "stage_order" | "stage_records" | "final_snapshot_files" | "final_before_files"> {
  const ownedPaths = new Set<string>();
  const stageRecords = Object.fromEntries(stages.map((stage) => {
    const stageSnapshots = filesForApprovalStage(snapshots, stage);
    for (const file of stageSnapshots) ownedPaths.add(file.path);
    const record: ApprovalStageRecord = {
      stage_id: stage.id,
      status: "pending",
      revision: 0,
      snapshot_files: stageSnapshots,
      before_files: beforeFilesForSnapshots(beforeFiles, stageSnapshots),
      preview_files: [],
      intent_to_add_paths: [],
    };
    return [stage.id, record];
  }));
  const finalSnapshots = snapshots.filter((file) => !ownedPaths.has(file.path));
  return {
    schema_version: 2,
    stage_order: stages.map((stage) => stage.id),
    stage_records: stageRecords,
    final_snapshot_files: finalSnapshots,
    final_before_files: beforeFilesForSnapshots(beforeFiles, finalSnapshots),
  };
}

export function isStageLedgerSession(session: ApprovalSession): boolean {
  return session.schema_version === 2
    && Array.isArray(session.stage_order)
    && Boolean(session.stage_records);
}

export function stageRecord(session: ApprovalSession, stageId: string): ApprovalStageRecord | null {
  return isStageLedgerSession(session) ? session.stage_records?.[stageId] || null : null;
}

function synchronizedStageRecord(session: ApprovalSession, record: ApprovalStageRecord): ApprovalStageRecord {
  const approved = session.approved_stages.includes(record.stage_id);
  return {
    ...record,
    status: approved ? "approved" : record.preview_files.length > 0 ? "previewed" : "pending",
    snapshot_files: uniqueByPath(record.snapshot_files),
    before_files: uniqueByPath(record.before_files),
    preview_files: uniquePreviewFiles(record.preview_files),
    intent_to_add_paths: Array.from(new Set(record.intent_to_add_paths)),
  };
}

export function synchronizeApprovalSession(session: ApprovalSession): ApprovalSession {
  if (!isStageLedgerSession(session)) return session;
  const stageOrder = session.stage_order || [];
  const stageRecords = Object.fromEntries(stageOrder.flatMap((stageId) => {
    const record = session.stage_records?.[stageId];
    return record ? [[stageId, synchronizedStageRecord(session, record)]] : [];
  }));
  const orderedRecords = stageOrder
    .map((stageId) => stageRecords[stageId])
    .filter((record): record is ApprovalStageRecord => Boolean(record));
  return {
    ...session,
    schema_version: 2,
    stage_order: stageOrder,
    stage_records: stageRecords,
    final_snapshot_files: uniqueByPath(session.final_snapshot_files || []),
    final_before_files: uniqueByPath(session.final_before_files || []),
    final_preview_files: uniquePreviewFiles(session.final_preview_files || []),
    final_intent_to_add_paths: Array.from(new Set(session.final_intent_to_add_paths || [])),
    ancillary_snapshot_files: uniqueByPath(session.ancillary_snapshot_files || []),
    ancillary_before_files: uniqueByPath(session.ancillary_before_files || []),
    snapshot_files: uniqueByPath([
      ...orderedRecords.flatMap((record) => record.snapshot_files),
      ...(session.final_snapshot_files || []),
    ]),
    before_files: uniqueByPath([
      ...orderedRecords.flatMap((record) => record.before_files),
      ...(session.final_before_files || []),
    ]),
    preview_files: uniquePreviewFiles([
      ...orderedRecords.flatMap((record) => record.preview_files),
      ...(session.final_preview_files || []),
    ]),
    intent_to_add_paths: Array.from(new Set([
      ...orderedRecords.flatMap((record) => record.intent_to_add_paths),
      ...(session.final_intent_to_add_paths || []),
    ])),
  };
}

export function recordCompleteBundlePreview(
  session: ApprovalSession,
  previewFiles: JsonObject[],
  intentToAddPaths: string[],
): ApprovalSession {
  if (!isStageLedgerSession(session)) {
    return {
      ...session,
      preview_files: uniquePreviewFiles(previewFiles),
      intent_to_add_paths: Array.from(new Set([...session.intent_to_add_paths, ...intentToAddPaths])),
    };
  }
  const byPath = new Map(previewFiles.flatMap((file) => {
    const filePath = previewPath(file);
    return filePath ? [[filePath, file] as const] : [];
  }));
  const intent = new Set(intentToAddPaths);
  const claimedPreviewPaths = new Set<string>();
  const claimedIntentPaths = new Set<string>();
  const stageRecords = { ...session.stage_records };
  for (const stageId of session.stage_order || []) {
    const record = stageRecords[stageId];
    if (!record) continue;
    const paths = new Set(record.snapshot_files.map((file) => file.path));
    const recordPreview = Array.from(paths).flatMap((filePath) => {
      const file = byPath.get(filePath);
      if (file) claimedPreviewPaths.add(filePath);
      return file ? [file] : [];
    });
    const recordIntent = Array.from(paths).filter((filePath) => {
      if (!intent.has(filePath)) return false;
      claimedIntentPaths.add(filePath);
      return true;
    });
    stageRecords[stageId] = {
      ...record,
      preview_files: recordPreview,
      intent_to_add_paths: recordIntent,
    };
  }
  return synchronizeApprovalSession({
    ...session,
    stage_records: stageRecords,
    final_preview_files: previewFiles.filter((file) => {
      const filePath = previewPath(file);
      return Boolean(filePath) && !claimedPreviewPaths.has(filePath!);
    }),
    final_intent_to_add_paths: intentToAddPaths.filter((filePath) => !claimedIntentPaths.has(filePath)),
  });
}

export function recordStagePreview(
  session: ApprovalSession,
  stageId: string,
  previewFiles: JsonObject[],
  intentToAddPaths: string[],
): ApprovalSession {
  if (!isStageLedgerSession(session)) {
    return {
      ...session,
      preview_files: uniquePreviewFiles([...session.preview_files, ...previewFiles]),
      intent_to_add_paths: Array.from(new Set([...session.intent_to_add_paths, ...intentToAddPaths])),
    };
  }
  const record = session.stage_records?.[stageId];
  if (!record) throw new Error(`Approval session is missing stage record: ${stageId}`);
  const ownedPaths = new Set(record.snapshot_files.map((file) => file.path));
  const invalidPreview = previewFiles.find((file) => {
    const filePath = previewPath(file);
    return !filePath || !ownedPaths.has(filePath);
  });
  if (invalidPreview) {
    throw new Error(`Approval preview contains a file outside stage ${stageId}: ${previewPath(invalidPreview) || "(missing path)"}`);
  }
  const invalidIntent = intentToAddPaths.find((filePath) => !ownedPaths.has(filePath));
  if (invalidIntent) throw new Error(`Approval intent-to-add path belongs outside stage ${stageId}: ${invalidIntent}`);
  return synchronizeApprovalSession({
    ...session,
    stage_records: {
      ...session.stage_records,
      [stageId]: {
        ...record,
        preview_files: uniquePreviewFiles(previewFiles),
        intent_to_add_paths: Array.from(new Set(intentToAddPaths)),
      },
    },
  });
}

export function previewFilesForStages(session: ApprovalSession | null, stageIds?: string[]): JsonObject[] {
  if (!session) return [];
  if (!isStageLedgerSession(session) || !stageIds) return session.preview_files || [];
  return uniquePreviewFiles(stageIds.flatMap((stageId) => session.stage_records?.[stageId]?.preview_files || []));
}
