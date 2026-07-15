import fs from "node:fs";
import path from "node:path";
import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import type { CoreResult, ReviewFile } from "./contracts";
import {
  recordCompleteBundlePreview,
  recordStagePreview,
  synchronizeApprovalSession,
  type ApprovalBeforeFile,
  type ApprovalSession,
} from "./approval-session-model";
import { appendCadreEvent, ensureNativeState, readCadreEvents } from "./native-state";
import {
  removeReviewIntentToAddAtomic,
  reviewHeadFiles,
  type ReviewHeadExpectation,
} from "./review-output";
import {
  approvalCancellationJournalIds,
  approvalCancellationSessionSnapshot,
  reconcileApprovalCancellation,
} from "./approval-cancellation-journal";
import {
  approvalSupersessionSessionSnapshots,
  reconcileApprovalSupersessionForSession,
  reconcileApprovalSupersessions,
} from "./approval-supersession-journal";

export type { ApprovalBeforeFile, ApprovalSession } from "./approval-session-model";

export interface UnapprovedSkillTargetApproval {
  sessionId: string;
  payload: JsonObject;
  sourceManifest: JsonObject | null;
  sourceSnapshot: string | null;
  baselineFiles: ApprovalBeforeFile[];
}

function sessionDirectory(root: string): string {
  return path.join(root, "cadre", "local", "approval-sessions");
}

export function isApprovalSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
}

function sessionFile(root: string, sessionId: string): string {
  if (!isApprovalSessionId(sessionId)) throw new Error("Invalid approval session id");
  return path.join(sessionDirectory(root), `${sessionId}.json`);
}

export function readApprovalSession(root: string, sessionId: string): ApprovalSession | null {
  return readApprovalSessionResult(root, sessionId).session;
}

export interface ApprovalSessionReadResult {
  session: ApprovalSession | null;
  recovery_required: boolean;
  error?: string;
}

export interface ApprovalSessionReadOptions {
  lifecycleLocked?: boolean;
}

export function readApprovalSessionResult(
  root: string,
  sessionId: string,
  options: ApprovalSessionReadOptions = {},
): ApprovalSessionReadResult {
  if (!isApprovalSessionId(sessionId)) {
    return { session: null, recovery_required: false, error: "Invalid approval session id" };
  }
  const supersession = reconcileApprovalSupersessionForSession(root, sessionId, options);
  if (!supersession.ok && supersession.pending) {
    return {
      session: null,
      recovery_required: true,
      error: supersession.error || "Interrupted approval supersession could not be reconciled",
    };
  }
  try {
    return {
      session: JSON.parse(fs.readFileSync(sessionFile(root, sessionId), "utf8")) as ApprovalSession,
      recovery_required: false,
    };
  } catch {
    const reconciled = reconcileApprovalCancellation(root, sessionId, options);
    return {
      session: reconciled.session || null,
      recovery_required: !reconciled.ok && reconciled.pending,
      ...(reconciled.error ? { error: reconciled.error } : {}),
    };
  }
}

export function writeApprovalSession(root: string, session: ApprovalSession): void {
  if (!isApprovalSessionId(session.session_id)) throw new Error("Invalid approval session id");
  ensureNativeState(root);
  fs.mkdirSync(sessionDirectory(root), { recursive: true });
  const target = sessionFile(root, session.session_id);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(synchronizeApprovalSession(session), null, 2)}\n`);
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function removeApprovalSession(root: string, sessionId: string): void {
  if (!isApprovalSessionId(sessionId)) throw new Error("Invalid approval session id");
  fs.rmSync(sessionFile(root, sessionId), { force: true });
}

export interface ApprovalSessionListOptions extends ApprovalSessionReadOptions {
  includeRecoveryPending?: boolean;
}

export function listApprovalSessions(root: string, options: ApprovalSessionListOptions = {}): ApprovalSession[] {
  const supersession = reconcileApprovalSupersessions(root, options);
  let names: string[];
  try {
    names = fs.readdirSync(sessionDirectory(root));
  } catch {
    return [];
  }
  const sessionIds = new Set([
    ...names.filter((name) => /^[a-f0-9]{24}\.json$/.test(name)).map((name) => name.slice(0, -5)),
    ...approvalCancellationJournalIds(root),
  ]);
  const sessions = Array.from(sessionIds).flatMap((sessionId) => {
    const result = readApprovalSessionResult(root, sessionId, options);
    if (result.session) return [result.session];
    if (!options.includeRecoveryPending || !result.recovery_required) return [];
    const pending = approvalCancellationSessionSnapshot(root, sessionId);
    return pending ? [{ ...pending, cancellation_recovery_required: true }] : [];
  });
  if (!options.includeRecoveryPending || supersession.ok) return sessions;
  const known = new Set(sessions.map((session) => session.session_id));
  return [
    ...sessions,
    ...approvalSupersessionSessionSnapshots(root)
      .filter((session) => !known.has(session.session_id))
      .map((session) => ({ ...session, supersession_recovery_required: true })),
  ];
}

export function approvalSessionForTarget(root: string, relativePath: string): ApprovalSession | null {
  return listApprovalSessions(root)
    .filter((session) => session.snapshot_files.some((file) => file.missing !== true && file.path === relativePath))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] || null;
}

export function unapprovedSkillTargetApproval(root: string, skillId: string): UnapprovedSkillTargetApproval | null {
  const prefix = `cadre/skills/${skillId}/`;
  const session = listApprovalSessions(root)
    .filter((candidate) => candidate.workflow === "skill" && candidate.approved_stages.length === 0)
    .filter((candidate) => candidate.snapshot_files.some((file) => file.missing !== true && file.path.startsWith(prefix)))
    .filter((candidate) => candidate.preview_files.some((file) => file.missing !== true && asOptionalString(file.path)?.startsWith(prefix)))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  if (!session) return null;
  const manifest = session.payload.source_manifest;
  return {
    sessionId: session.session_id,
    payload: { ...session.payload },
    sourceManifest: manifest && typeof manifest === "object" && !Array.isArray(manifest) ? asJsonObject(manifest) : null,
    sourceSnapshot: asOptionalString(session.payload.source_snapshot) || null,
    baselineFiles: session.before_files.map((file) => ({ ...file })),
  };
}

export function unapprovedTargetBaselineContent(root: string, relativePath: string): string | null | undefined {
  const owner = listApprovalSessions(root)
    .filter((session) => session.approved_stages.length === 0)
    .filter((session) => session.snapshot_files.some((file) => file.missing !== true && file.path === relativePath))
    .filter((session) => session.preview_files.some((file) => file.missing !== true && asOptionalString(file.path) === relativePath))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  if (!owner) return undefined;
  const baseline = owner.before_files.find((file) => file.path === relativePath);
  if (!baseline) return undefined;
  return baseline.existed ? baseline.content : null;
}

export function approvalHeadExpectation(before: ApprovalBeforeFile): ReviewHeadExpectation {
  const beforeContent = before.existed ? before.content : null;
  const hasHeadSnapshot = typeof before.head_existed === "boolean";
  return {
    path: before.path,
    existed: hasHeadSnapshot ? before.head_existed! : before.existed,
    content: hasHeadSnapshot ? (before.head_content ?? null) : beforeContent,
    ...(!hasHeadSnapshot && before.existed ? { allowMissing: true } : {}),
  };
}

export function captureApprovalBeforeFiles(root: string, files: ReviewFile[]): ApprovalBeforeFile[] {
  const head = reviewHeadFiles(root, files.map((file) => file.path));
  const headByPath = new Map(head.files.map((file) => [file.path, file]));
  return files.map((file) => {
    const target = path.join(root, file.path);
    const existed = fileExists(target);
    const headFile = head.ok && head.available ? headByPath.get(file.path) : null;
    return {
      path: file.path,
      existed,
      content: existed ? fs.readFileSync(target, "utf8") : null,
      ...(headFile ? { head_existed: headFile.existed, head_content: headFile.content } : {}),
    };
  });
}

export function frozenReviewFiles(root: string, sessionId: string, fallback: ReviewFile[]): ReviewFile[] {
  const session = readApprovalSession(root, sessionId);
  return session?.snapshot_files?.length ? session.snapshot_files : fallback;
}

export function recordApprovalPreview(
  root: string,
  sessionId: string,
  workflow: string,
  payloadHash: string,
  stageId: string,
  bundle: JsonObject | null,
  candidateSession?: ApprovalSession,
): CoreResult {
  const session = candidateSession || readApprovalSession(root, sessionId);
  if (!session || session.workflow !== workflow || session.payload_hash !== payloadHash) {
    return { ok: false, stage: "approval_preview_session", error: "Approval preview no longer matches its persisted workflow session" };
  }
  const previewFiles = bundle && Array.isArray(bundle.files) ? bundle.files.map(asJsonObject) : [];
  if (!bundle || bundle.ok === false || previewFiles.length === 0) {
    return { ok: false, stage: "approval_preview_bundle", error: "Approval preview bundle is empty or invalid" };
  }
  const nextSession = {
    ...(session.schema_version === 2
      ? recordStagePreview(session, stageId, previewFiles, asStringArray(bundle.intent_to_add_paths))
      : recordCompleteBundlePreview(session, previewFiles, asStringArray(bundle.intent_to_add_paths))),
    updated_at: utcNow(),
  };
  writeApprovalSession(root, nextSession);
  return { ok: true, session_id: sessionId };
}

export function recordApprovalCompletion(root: string, sessionId: string): CoreResult {
  const session = readApprovalSession(root, sessionId);
  if (!session) return { ok: false, error: "Approval session was not found for completion audit" };
  const existing = readCadreEvents(root, 0).find((event) => (
    event.kind === "approval.completed" && event.approval_session_id === sessionId
  ));
  if (existing) {
    return { ok: true, reused: true, path: "cadre/events.jsonl", event: existing };
  }
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
  const intentRemoval = removeReviewIntentToAddAtomic(root, session.intent_to_add_paths);
  if (!intentRemoval.ok) return { ok: false, session_retained: true, error: intentRemoval.error };
  removeApprovalSession(root, sessionId);
  return { ok: true, session_id: sessionId, intent_to_add_removed: intentRemoval.paths };
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
