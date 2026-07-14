import fs from "node:fs";
import path from "node:path";

import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { withLock } from "../../infrastructure/runtime/locking";
import type { CoreResult, ReviewFile } from "./contracts";
import { appendCadreEvent, ensureNativeState } from "./native-state";
import {
  inspectReviewGitState,
  removeReviewIntentToAdd,
  reviewHeadFiles,
  type ReviewHeadExpectation,
} from "./review-output";

export interface ApprovalBeforeFile {
  path: string;
  existed: boolean;
  content: string | null;
  head_existed?: boolean;
  head_content?: string | null;
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

function approvalSessions(root: string, workflow: string): ApprovalSession[] {
  let names: string[];
  try {
    names = fs.readdirSync(sessionDirectory(root));
  } catch {
    return [];
  }
  return names
    .filter((name) => /^[a-f0-9]{24}\.json$/.test(name))
    .map((name) => readApprovalSession(root, name.slice(0, -5)))
    .filter((session): session is ApprovalSession => Boolean(session && session.workflow === workflow));
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

export function supersedeUnapprovedApprovalSessions(
  root: string,
  workflow: string,
  activeSessionId: string,
): CoreResult {
  return withLock(root, `approval-supersede-${workflow}`, () => {
    const sessions = approvalSessions(root, workflow);
    const active = sessions.find((session) => session.session_id === activeSessionId);
    if (active && active.preview_files.length > 0) {
      return { ok: true, skipped: true, reason: "active approval preview already exists" };
    }
    const candidates = sessions.filter((session) => session.session_id !== activeSessionId || session.preview_files.length === 0);
    if (candidates.length === 0) return { ok: true, skipped: true, reason: "no superseded approval previews" };
    const approved = candidates.filter((session) => session.approved_stages.length > 0);
    if (approved.length > 0) {
      return {
        ok: false,
        stage: "superseded_approval",
        error: `Existing ${workflow} approval has reviewed stages and must be resumed or cancelled through Cadre before starting a new payload`,
        session_ids: approved.map((session) => session.session_id),
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
        const hasHeadSnapshot = typeof before.head_existed === "boolean";
        headExpectations.set(snapshot.path, {
          path: snapshot.path,
          existed: hasHeadSnapshot ? before.head_existed! : before.existed,
          content: hasHeadSnapshot ? (before.head_content ?? null) : beforeContent,
          ...(!hasHeadSnapshot && before.existed ? { allowMissing: true } : {}),
        });
        const current = virtual.has(snapshot.path) ? virtual.get(snapshot.path)! : fileContent(target);
        if (current !== snapshot.content && current !== beforeContent) {
          return {
            ok: false,
            stage: "superseded_approval_drift",
            error: `Superseded ${workflow} review target changed after Cadre created it: ${snapshot.path}`,
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
    try {
      for (const [relativePath, content] of virtual) {
        const target = targets.get(relativePath)!;
        diskBefore.set(relativePath, fileContent(target));
        restoreFile(target, content);
      }
    } catch (error) {
      for (const [relativePath, content] of diskBefore) {
        const target = targets.get(relativePath);
        if (target) restoreFile(target, content);
      }
      return {
        ok: false,
        stage: "superseded_approval_restore",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const intentToAddPaths = Array.from(new Set(ordered.flatMap((session) => session.intent_to_add_paths)));
    const intentRemoved = removeReviewIntentToAdd(root, intentToAddPaths);
    for (const session of ordered) removeApprovalSession(root, session.session_id);
    return {
      ok: true,
      superseded: ordered.map((session) => session.session_id),
      restored: Array.from(virtual.entries()).filter(([, content]) => content !== null).map(([relativePath]) => relativePath),
      removed: Array.from(virtual.entries()).filter(([, content]) => content === null).map(([relativePath]) => relativePath),
      intent_to_add_removed: intentRemoved,
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
