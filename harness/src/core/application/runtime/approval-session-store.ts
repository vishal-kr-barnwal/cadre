import fs from "node:fs";
import path from "node:path";

import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import type { CoreResult, ReviewFile } from "./contracts";
import { appendCadreEvent, ensureNativeState } from "./native-state";
import { removeReviewIntentToAdd } from "./review-output";

export interface ApprovalBeforeFile {
  path: string;
  existed: boolean;
  content: string | null;
}

export interface ApprovalSession {
  session_id: string;
  workflow: string;
  payload_hash: string;
  payload: JsonObject;
  approved_stages: string[];
  snapshot_files: ReviewFile[];
  before_files: ApprovalBeforeFile[];
  preview_files: JsonObject[];
  intent_to_add_paths: string[];
  updated_at: string;
}

function sessionDirectory(root: string): string {
  return path.join(root, "cadre", "local", "approval-sessions");
}

function sessionFile(root: string, sessionId: string): string {
  return path.join(sessionDirectory(root), `${sessionId}.json`);
}

export function readApprovalSession(root: string, sessionId: string): ApprovalSession | null {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(root, sessionId), "utf8")) as ApprovalSession;
  } catch {
    return null;
  }
}

export function writeApprovalSession(root: string, session: ApprovalSession): void {
  ensureNativeState(root);
  fs.mkdirSync(sessionDirectory(root), { recursive: true });
  const target = sessionFile(root, session.session_id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

export function removeApprovalSession(root: string, sessionId: string): void {
  fs.rmSync(sessionFile(root, sessionId), { force: true });
}

export function captureApprovalBeforeFiles(root: string, files: ReviewFile[]): ApprovalBeforeFile[] {
  return files.map((file) => {
    const target = path.join(root, file.path);
    const existed = fileExists(target);
    return { path: file.path, existed, content: existed ? fs.readFileSync(target, "utf8") : null };
  });
}

export function frozenReviewFiles(root: string, sessionId: string, fallback: ReviewFile[]): ReviewFile[] {
  const session = readApprovalSession(root, sessionId);
  return session?.snapshot_files?.length ? session.snapshot_files : fallback;
}

export function recordApprovalPreview(root: string, sessionId: string, workflow: string, payloadHash: string, bundle: JsonObject | null): void {
  if (!bundle || bundle.ok === false) return;
  const session = readApprovalSession(root, sessionId);
  if (!session || session.workflow !== workflow || session.payload_hash !== payloadHash) return;
  const previewFiles = Array.isArray(bundle.files) ? bundle.files.map(asJsonObject) : [];
  writeApprovalSession(root, {
    ...session,
    preview_files: previewFiles,
    intent_to_add_paths: Array.from(new Set([
      ...session.intent_to_add_paths,
      ...asStringArray(bundle.intent_to_add_paths),
    ])),
    updated_at: utcNow(),
  });
}

export function cancelApprovalSession(root: string, sessionId: string): CoreResult {
  const session = readApprovalSession(root, sessionId);
  if (!session) return { ok: false, cancelled: false, error: "Approval session was not found" };
  const outputMode = asOptionalString(session.payload.reviewOutputMode || session.payload.review_output_mode);
  const explicitBundleDirectory = asOptionalString(session.payload.reviewBundleDir || session.payload.review_bundle_dir || session.payload.reviewDir || session.payload.review_dir);
  if (explicitBundleDirectory || outputMode === "bundle" || outputMode === "temp" || outputMode === "temporary") {
    const intentRemoved = removeReviewIntentToAdd(root, session.intent_to_add_paths);
    removeApprovalSession(root, sessionId);
    return { ok: true, cancelled: true, session_id: sessionId, restored: [], removed: [], preserved: [], intent_to_add_removed: intentRemoved };
  }
  const snapshots = new Map(session.snapshot_files.map((file) => [file.path, file.content]));
  const placeholders = new Set(session.snapshot_files.filter((file) => file.missing === true).map((file) => file.path));
  const restored: string[] = [];
  const removed: string[] = [];
  const preserved: string[] = [];
  for (const before of session.before_files) {
    if (placeholders.has(before.path)) continue;
    const target = path.join(root, before.path);
    const current = fileExists(target) ? fs.readFileSync(target, "utf8") : null;
    if (current !== (snapshots.get(before.path) ?? null)) {
      preserved.push(before.path);
      continue;
    }
    if (before.existed && before.content !== null) {
      const temporary = `${target}.${process.pid}.cancel-tmp`;
      fs.writeFileSync(temporary, before.content);
      fs.renameSync(temporary, target);
      restored.push(before.path);
    } else {
      fs.rmSync(target, { force: true });
      removed.push(before.path);
    }
  }
  const intentRemoved = removeReviewIntentToAdd(root, session.intent_to_add_paths);
  removeApprovalSession(root, sessionId);
  return {
    ok: preserved.length === 0,
    cancelled: true,
    session_id: sessionId,
    restored,
    removed,
    preserved,
    intent_to_add_removed: intentRemoved,
    ...(preserved.length ? { warning: "Files edited after preview were preserved" } : {}),
  };
}

export function recordApprovalCompletion(root: string, sessionId: string): CoreResult {
  const session = readApprovalSession(root, sessionId);
  if (!session) return { ok: false, error: "Approval session was not found for completion audit" };
  return appendCadreEvent(root, {
    kind: "approval.completed",
    workflow: session.workflow,
    approval_session_id: sessionId,
    approved_documents: session.approved_stages,
    documents: session.snapshot_files
      .filter((file) => file.reviewRole === "human")
      .map((file) => ({
        document_id: file.documentId || null,
        projection_path: file.projectionPath || file.path,
        sha256: textHash(file.content),
      })),
  });
}

export function closeApprovalSession(root: string, sessionId: string): CoreResult {
  const session = readApprovalSession(root, sessionId);
  if (!session) return { ok: true, skipped: true, reason: "approval session already closed" };
  const intentRemoved = removeReviewIntentToAdd(root, session.intent_to_add_paths);
  removeApprovalSession(root, sessionId);
  return { ok: true, session_id: sessionId, intent_to_add_removed: intentRemoved };
}

function sessionIdFromArgs(args: RuntimeArgs): string | null {
  return asOptionalString(args.approvalSessionId || args.approval_session_id) || null;
}

export function recordApprovalCompletionFromArgs(root: string, args: RuntimeArgs): CoreResult {
  const sessionId = sessionIdFromArgs(args);
  return sessionId ? recordApprovalCompletion(root, sessionId) : { ok: true, skipped: true, reason: "no staged approval session" };
}

export function closeApprovalSessionFromArgs(root: string, args: RuntimeArgs): CoreResult {
  const sessionId = sessionIdFromArgs(args);
  return sessionId ? closeApprovalSession(root, sessionId) : { ok: true, skipped: true, reason: "no staged approval session" };
}

export function previewFileRecords(session: ApprovalSession | null): JsonObject[] {
  return session?.preview_files?.map(asJsonObject).filter((file) => file.missing !== true) || [];
}

export function sessionPreviewHash(file: JsonObject): string | null {
  return asOptionalString(file.sha256) || null;
}
