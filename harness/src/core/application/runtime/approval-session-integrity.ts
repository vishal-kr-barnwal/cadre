import crypto from "node:crypto";

import { asOptionalString } from "../../../guards";
import type { JsonObject } from "../../../types";
import type { RuntimeArgs } from "../../../types";

import type { ReviewFile } from "./contracts";
import {
  filesForApprovalStage,
  stageRecord,
  type ApprovalSession,
  type ApprovalStageRecord,
} from "./approval-session-model";
import type { ApprovalStage } from "./staged-approval-stages";
import { reviewOutputMode, stageReviewDriftError } from "./review-output";

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (stableJson(before) === stableJson(after)) return [];
  const left = plainObject(before);
  const right = plainObject(after);
  if (left || right) {
    const keys = Array.from(new Set([...Object.keys(left || {}), ...Object.keys(right || {})])).sort();
    return keys.flatMap((key) => changedPaths(left?.[key], right?.[key], prefix ? `${prefix}.${key}` : key));
  }
  return prefix ? [prefix] : ["(payload)"];
}

function pathAllowed(changedPath: string, inputKey: string): boolean {
  return changedPath === inputKey || changedPath.startsWith(`${inputKey}.`);
}

export function currentStagePayloadError(
  session: ApprovalSession,
  activeStage: ApprovalStage,
  payload: JsonObject,
): string | null {
  const changes = changedPaths(session.payload, payload);
  const allowed = activeStage.inputKeys || [];
  const disallowed = changes.find((changedPath) => !allowed.some((inputKey) => pathAllowed(changedPath, inputKey)));
  return disallowed
    ? `Only current stage ${activeStage.id} input may change; ${disallowed} belongs to another stage or to the frozen session contract.`
    : null;
}

function reviewFileIdentity(file: ReviewFile): JsonObject {
  const stableContent = file.content
    .replace(/canonical_hash="[a-f0-9]+"/g, "canonical_hash=\"<session-time>\"")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<session-time>");
  return {
    path: file.path,
    title: file.title,
    content: stableContent,
    kind: file.kind,
    source: file.source,
    missing: file.missing === true,
    document_id: file.documentId || null,
    review_role: file.reviewRole || null,
    canonical_path: file.canonicalPath || null,
    projection_path: file.projectionPath || null,
    approval_group: file.approvalGroup || null,
  };
}

export function sameReviewFiles(left: ReviewFile[], right: ReviewFile[]): boolean {
  const normalize = (files: ReviewFile[]): JsonObject[] => [...files]
    .sort((first, second) => first.path.localeCompare(second.path))
    .map(reviewFileIdentity);
  return stableJson(normalize(left)) === stableJson(normalize(right));
}

export function stageSnapshotError(
  session: ApprovalSession,
  stages: ApprovalStage[],
  reviewFiles: ReviewFile[],
  stageIds: string[],
): string | null {
  for (const stageId of stageIds) {
    const stage = stages.find((candidate) => candidate.id === stageId);
    const record = stageRecord(session, stageId);
    if (!stage || !record) return `Approval session is missing stage ownership for ${stageId}.`;
    if (!sameReviewFiles(record.snapshot_files, filesForApprovalStage(reviewFiles, stage))) {
      return `Generated files for ${stageId} changed after its stage snapshot was created; cancel and restart or explicitly reopen that stage.`;
    }
  }
  return null;
}

function normalizedHash(content: string): string {
  return crypto.createHash("sha256").update(content.replace(/\n*$/, "\n")).digest("hex");
}

export function stagePreviewError(record: ApprovalStageRecord): string | null {
  const previews = new Map(record.preview_files.flatMap((file) => {
    const filePath = asOptionalString(file.path);
    return filePath ? [[filePath, file] as const] : [];
  }));
  for (const snapshot of record.snapshot_files.filter((file) => file.missing !== true)) {
    const preview = previews.get(snapshot.path);
    if (!preview) return `Approval stage ${record.stage_id} has no materialized preview for ${snapshot.path}.`;
    if (asOptionalString(preview.sha256) !== normalizedHash(snapshot.content)) {
      return `Approval stage ${record.stage_id} preview hash does not match its snapshot: ${snapshot.path}.`;
    }
  }
  return null;
}

export function sessionTargetDriftError(
  root: string,
  args: RuntimeArgs,
  session: ApprovalSession,
  stageIds: string[],
): string | null {
  if (reviewOutputMode(args) !== "target") return null;
  for (const stageId of stageIds) {
    const record = stageRecord(session, stageId);
    if (!record) return `Approval session is missing stage ownership for ${stageId}.`;
    const error = stageReviewDriftError(root, record);
    if (error) return error;
  }
  return null;
}
