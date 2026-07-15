import fs from "node:fs";
import path from "node:path";
import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { withLock } from "../../infrastructure/runtime/locking";
import type { CoreResult, ReviewFile } from "./contracts";
import { approvalRestoreBeforeFiles, approvalRestoreSnapshots, removeEmptyApprovalParents } from "./approval-session-ancillary";
import {
  recordCompleteBundlePreview,
  recordStagePreview,
  synchronizeApprovalSession,
  type ApprovalBeforeFile,
  type ApprovalSession,
} from "./approval-session-model";
import { appendCadreEvent, ensureNativeState, readCadreEvents } from "./native-state";
import {
  inspectReviewGitState,
  removeReviewIntentToAddAtomic,
  restoreReviewIntentToAdd,
  reviewHeadFiles,
  type ReviewHeadExpectation,
} from "./review-output";
import {
  approvalCancellationJournalIds,
  approvalCancellationSessionSnapshot,
  reconcileApprovalCancellation,
} from "./approval-cancellation-journal";

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
  return Array.from(sessionIds).flatMap((sessionId) => {
    const result = readApprovalSessionResult(root, sessionId, options);
    if (result.session) return [result.session];
    if (!options.includeRecoveryPending || !result.recovery_required) return [];
    const pending = approvalCancellationSessionSnapshot(root, sessionId);
    return pending ? [{ ...pending, cancellation_recovery_required: true }] : [];
  });
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

function safeSessionTarget(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function fileContent(file: string): string | null {
  return fileExists(file) ? fs.readFileSync(file, "utf8") : null;
}

function restoreFile(file: string, content: string | null): void {
  if (content === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.supersede-tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

function supersessionOrder(sessions: ApprovalSession[], activeSessionId: string): ApprovalSession[] {
  return [...sessions].sort((left, right) => {
    if (left.session_id === activeSessionId) return -1;
    if (right.session_id === activeSessionId) return 1;
    const leftHasPreview = left.preview_files.length > 0 ? 1 : 0;
    const rightHasPreview = right.preview_files.length > 0 ? 1 : 0;
    if (leftHasPreview !== rightHasPreview) return leftHasPreview - rightHasPreview;
    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  });
}

function materializedSessionPaths(session: ApprovalSession): Set<string> {
  return new Set(session.snapshot_files.filter((file) => file.missing !== true).map((file) => file.path));
}

function overlappingApprovalSessions(
  sessions: ApprovalSession[],
  activeSessionId: string,
  activeFiles: ReviewFile[],
): ApprovalSession[] {
  const paths = new Set(activeFiles.filter((file) => file.missing !== true).map((file) => file.path));
  const remaining = new Map(sessions.map((session) => [session.session_id, session]));
  const selected: ApprovalSession[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [sessionId, session] of remaining) {
      const sessionPaths = materializedSessionPaths(session);
      if (sessionId !== activeSessionId && !Array.from(sessionPaths).some((entry) => paths.has(entry))) continue;
      selected.push(session);
      remaining.delete(sessionId);
      for (const entry of sessionPaths) paths.add(entry);
      changed = true;
    }
  }
  return selected;
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

export function supersedeUnapprovedApprovalSessions(
  root: string,
  workflow: string,
  activeSessionId: string,
  activeFiles: ReviewFile[],
): CoreResult {
  return withLock(root, "approval-target-lifecycle", () => {
    const sessions = listApprovalSessions(root, { lifecycleLocked: true, includeRecoveryPending: true });
    const recoveryPending = sessions.filter((session) => session.cancellation_recovery_required === true);
    if (recoveryPending.length > 0) {
      return {
        ok: false,
        stage: "approval_cancellation_recovery",
        recovery_required: true,
        error: "An interrupted approval cancellation must be reconciled before starting or superseding another review session",
        session_ids: recoveryPending.map((session) => session.session_id),
      };
    }
    const active = sessions.find((session) => session.session_id === activeSessionId);
    if (active && active.preview_files.length > 0) {
      return { ok: true, skipped: true, reason: "active approval preview already exists" };
    }
    const candidates = overlappingApprovalSessions(sessions, activeSessionId, activeFiles)
      .filter((session) => session.session_id !== activeSessionId || session.preview_files.length === 0);
    if (candidates.length === 0) return { ok: true, skipped: true, reason: "no superseded approval previews" };
    const approved = candidates.filter((session) => session.approved_stages.length > 0);
    if (approved.length > 0) {
      return {
        ok: false,
        stage: "superseded_approval",
        error: "An approval for one or more overlapping review targets has reviewed stages and must be resumed or cancelled through Cadre before starting a new payload",
        session_ids: approved.map((session) => session.session_id),
        workflows: Array.from(new Set(approved.map((session) => session.workflow))),
      };
    }

    const ordered = supersessionOrder(candidates, activeSessionId);
    const virtual = new Map<string, string | null>();
    const targets = new Map<string, string>();
    const headExpectations = new Map<string, ReviewHeadExpectation>();
    for (const session of ordered) {
      const beforeByPath = new Map(approvalRestoreBeforeFiles(session).map((entry) => [entry.path, entry]));
      for (const snapshot of approvalRestoreSnapshots(session)) {
        if (snapshot.missing === true) continue;
        const before = beforeByPath.get(snapshot.path);
        const target = safeSessionTarget(root, snapshot.path);
        if (!before || !target) {
          return {
            ok: false,
            stage: "superseded_approval",
            error: `Superseded ${workflow} approval has an invalid restore record for ${snapshot.path}`,
            session_id: session.session_id,
          };
        }
        const beforeContent = before.existed ? before.content : null;
        headExpectations.set(snapshot.path, approvalHeadExpectation(before));
        const current = virtual.has(snapshot.path) ? virtual.get(snapshot.path)! : fileContent(target);
        if (current !== snapshot.content && current !== beforeContent) {
          return {
            ok: false,
            stage: "superseded_approval_drift",
            error: `Superseded ${session.workflow} review target changed after Cadre created it: ${snapshot.path}`,
            session_id: session.session_id,
            path: snapshot.path,
          };
        }
        targets.set(snapshot.path, target);
        virtual.set(snapshot.path, beforeContent);
      }
    }

    const gitState = inspectReviewGitState(root, Array.from(virtual.keys()), Array.from(headExpectations.values()));
    if (!gitState.ok) {
      const changed = [...gitState.stagedPaths, ...gitState.baselinePaths];
      const reason = gitState.error
        || (gitState.stagedPaths.length > 0
          ? `Superseded ${workflow} review target has staged Git content: ${gitState.stagedPaths.join(", ")}`
          : `Superseded ${workflow} review target was committed or changed in Git after Cadre created it: ${gitState.baselinePaths.join(", ")}`);
      return {
        ok: false,
        stage: "superseded_approval_git_drift",
        error: reason,
        paths: changed,
        staged_paths: gitState.stagedPaths,
        baseline_paths: gitState.baselinePaths,
      };
    }

    const diskBefore = new Map<string, string | null>();
    for (const [relativePath] of virtual) diskBefore.set(relativePath, fileContent(targets.get(relativePath)!));
    const intentToAddPaths = Array.from(new Set(ordered.flatMap((session) => session.intent_to_add_paths)));
    const intentRemoval = removeReviewIntentToAddAtomic(root, intentToAddPaths);
    if (!intentRemoval.ok) {
      return {
        ok: false,
        stage: "superseded_approval_index_restore",
        error: intentRemoval.error || "Unable to remove review intent-to-add entries",
      };
    }
    try {
      for (const [relativePath, content] of virtual) {
        const target = targets.get(relativePath)!;
        restoreFile(target, content);
      }
      for (const [relativePath, content] of virtual) if (content === null) removeEmptyApprovalParents(root, targets.get(relativePath)!);
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const [relativePath, content] of diskBefore) {
        const target = targets.get(relativePath);
        try { if (target) restoreFile(target, content); } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      const indexRollback = restoreReviewIntentToAdd(root, intentRemoval.paths);
      const cause = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        stage: "superseded_approval_restore",
        error: [cause, ...rollbackErrors, ...(indexRollback.ok ? [] : [indexRollback.error || "Git intent-to-add rollback failed"])]
          .join("; "),
      };
    }

    for (const session of ordered) removeApprovalSession(root, session.session_id);
    return {
      ok: true,
      superseded: ordered.map((session) => session.session_id),
      restored: Array.from(virtual.entries()).filter(([, content]) => content !== null).map(([relativePath]) => relativePath),
      removed: Array.from(virtual.entries()).filter(([, content]) => content === null).map(([relativePath]) => relativePath),
      intent_to_add_removed: intentRemoval.paths,
    };
  });
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
