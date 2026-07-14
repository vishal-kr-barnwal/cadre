import fs from "node:fs";
import path from "node:path";

import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { withLock } from "../../infrastructure/runtime/locking";
import type { CoreResult, ReviewFile } from "./contracts";
import {
  recordCompleteBundlePreview,
  recordStagePreview,
  synchronizeApprovalSession,
  type ApprovalBeforeFile,
  type ApprovalSession,
} from "./approval-session-model";
import { appendCadreEvent, ensureNativeState } from "./native-state";
import {
  inspectReviewGitState,
  removeReviewIntentToAddAtomic,
  restoreReviewIntentToAdd,
  reviewHeadFiles,
  type ReviewHeadExpectation,
} from "./review-output";

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
  fs.writeFileSync(temporary, `${JSON.stringify(synchronizeApprovalSession(session), null, 2)}\n`);
  fs.renameSync(temporary, target);
}

export function removeApprovalSession(root: string, sessionId: string): void {
  fs.rmSync(sessionFile(root, sessionId), { force: true });
}

function approvalSessions(root: string): ApprovalSession[] {
  let names: string[];
  try {
    names = fs.readdirSync(sessionDirectory(root));
  } catch {
    return [];
  }
  return names
    .filter((name) => /^[a-f0-9]{24}\.json$/.test(name))
    .map((name) => readApprovalSession(root, name.slice(0, -5)))
    .filter((session): session is ApprovalSession => Boolean(session));
}

export function unapprovedSkillTargetApproval(root: string, skillId: string): UnapprovedSkillTargetApproval | null {
  const prefix = `cadre/skills/${skillId}/`;
  const session = approvalSessions(root)
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
  const owner = approvalSessions(root)
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
    const sessions = approvalSessions(root);
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
      const beforeByPath = new Map(session.before_files.map((entry) => [entry.path, entry]));
      for (const snapshot of session.snapshot_files) {
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
): void {
  const session = candidateSession || readApprovalSession(root, sessionId);
  if (!session || session.workflow !== workflow || session.payload_hash !== payloadHash) return;
  const previewFiles = bundle && Array.isArray(bundle.files) ? bundle.files.map(asJsonObject) : [];
  if (!bundle || bundle.ok === false || previewFiles.length === 0) {
    if (session.approved_stages.length === 0 && session.preview_files.length === 0) removeApprovalSession(root, sessionId);
    return;
  }
  writeApprovalSession(root, {
    ...(session.schema_version === 2
      ? recordStagePreview(session, stageId, previewFiles, asStringArray(bundle.intent_to_add_paths))
      : recordCompleteBundlePreview(session, previewFiles, asStringArray(bundle.intent_to_add_paths))),
    updated_at: utcNow(),
  });
}

export function cancelApprovalSession(root: string, sessionId: string, expectedWorkflow?: string): CoreResult {
  if (!readApprovalSession(root, sessionId)) return { ok: false, cancelled: false, error: "Approval session was not found" };
  return withLock(root, "approval-target-lifecycle", () => {
    const session = readApprovalSession(root, sessionId);
    if (!session) return { ok: false, cancelled: false, error: "Approval session was not found" };
    if (expectedWorkflow && session.workflow !== expectedWorkflow) {
      return { ok: false, cancelled: false, session_retained: true, error: `Approval session belongs to ${session.workflow}, not ${expectedWorkflow}` };
    }
    const outputMode = asOptionalString(session.payload.reviewOutputMode || session.payload.review_output_mode);
    const explicitBundleDirectory = asOptionalString(session.payload.reviewBundleDir || session.payload.review_bundle_dir || session.payload.reviewDir || session.payload.review_dir);
    const targetMode = !explicitBundleDirectory && !["bundle", "temp", "temporary"].includes(outputMode || "");
    const previewPaths = new Set((targetMode ? session.preview_files : [])
      .filter((file) => file.missing !== true)
      .map((file) => asOptionalString(file.path))
      .filter((file): file is string => Boolean(file)));
    const beforeByPath = new Map(session.before_files.map((before) => [before.path, before]));
    const nativeIgnore = session.snapshot_files.find((file) => file.path === "cadre/.gitignore" && file.missing !== true);
    const nativeIgnoreBefore = beforeByPath.get("cadre/.gitignore");
    const nativeIgnoreBaseline = nativeIgnoreBefore?.existed ? nativeIgnoreBefore.content : null;
    const nativeIgnoreCurrent = nativeIgnore ? fileContent(path.join(root, nativeIgnore.path)) : null;
    if (nativeIgnore && nativeIgnoreBefore && nativeIgnoreCurrent === nativeIgnore.content && nativeIgnoreCurrent !== nativeIgnoreBaseline) {
      previewPaths.add(nativeIgnore.path);
    }
    const restorePlan = new Map<string, { target: string; before: string | null; preview: string }>();
    const expectations: ReviewHeadExpectation[] = [];
    for (const snapshot of session.snapshot_files) {
      if (!previewPaths.has(snapshot.path) || snapshot.missing === true) continue;
      const before = beforeByPath.get(snapshot.path);
      const target = safeSessionTarget(root, snapshot.path);
      if (!before || !target) {
        return { ok: false, cancelled: false, session_retained: true, stage: "approval_cancel_restore", error: `Approval session has an invalid restore record for ${snapshot.path}` };
      }
      const current = fileContent(target);
      if (current !== snapshot.content) {
        return { ok: false, cancelled: false, session_retained: true, stage: "approval_cancel_drift", error: `Review target changed after Cadre created it: ${snapshot.path}`, path: snapshot.path };
      }
      restorePlan.set(snapshot.path, { target, before: before.existed ? before.content : null, preview: current });
      expectations.push(approvalHeadExpectation(before));
    }
    const gitState = inspectReviewGitState(root, Array.from(restorePlan.keys()), expectations);
    if (!gitState.ok) {
      return {
        ok: false,
        cancelled: false,
        session_retained: true,
        stage: "approval_cancel_git_drift",
        error: gitState.error || "A review target has staged or committed Git changes",
        staged_paths: gitState.stagedPaths,
        baseline_paths: gitState.baselinePaths,
      };
    }

    const intentRemoval = removeReviewIntentToAddAtomic(root, session.intent_to_add_paths);
    if (!intentRemoval.ok) return { ok: false, cancelled: false, session_retained: true, stage: "approval_cancel_index", error: intentRemoval.error };
    try {
      for (const { target, before } of restorePlan.values()) restoreFile(target, before);
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const { target, preview } of restorePlan.values()) {
        try { restoreFile(target, preview); } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      const indexRollback = restoreReviewIntentToAdd(root, intentRemoval.paths);
      const cause = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        cancelled: false,
        session_retained: true,
        stage: "approval_cancel_restore",
        error: [cause, ...rollbackErrors, ...(indexRollback.ok ? [] : [indexRollback.error || "Git intent-to-add rollback failed"])]
          .join("; "),
      };
    }
    removeApprovalSession(root, sessionId);
    return {
      ok: true,
      cancelled: true,
      session_id: sessionId,
      restored: Array.from(restorePlan.entries()).filter(([, entry]) => entry.before !== null).map(([relativePath]) => relativePath),
      removed: Array.from(restorePlan.entries()).filter(([, entry]) => entry.before === null).map(([relativePath]) => relativePath),
      intent_to_add_removed: intentRemoval.paths,
    };
  });
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
