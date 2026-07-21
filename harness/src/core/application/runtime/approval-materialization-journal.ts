import fs from "node:fs";
import path from "node:path";

import { errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import {
  isApprovalSession,
  synchronizeApprovalSession,
  type ApprovalSession,
} from "./approval-session-model";
import type { CoreResult } from "./contracts";

interface ApprovalMaterializationTarget {
  path: string;
  before: string | null;
  after: string;
}

interface ApprovalMaterializationJournal {
  version: 1;
  session_id: string;
  state: "prepared" | "written";
  original_session: ApprovalSession;
  updated_session: ApprovalSession;
  targets: ApprovalMaterializationTarget[];
}

export interface ApprovalMaterializationReconcileResult {
  ok: boolean;
  pending: boolean;
  session?: ApprovalSession | null;
  error?: string;
}

function directory(root: string): string {
  return path.join(root, "cadre", "local", "approval-sessions");
}

function journalFile(root: string, sessionId: string): string {
  return path.join(directory(root), `${sessionId}.materialize-journal.json`);
}

function sessionFile(root: string, sessionId: string): string {
  return path.join(directory(root), `${sessionId}.json`);
}

function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function safePath(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? target : null;
}

function fileContent(root: string, relativePath: string): string | null {
  const target = safePath(root, relativePath);
  if (!target) throw new Error(`Unsafe approval materialization target: ${relativePath}`);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
}

function sameSession(left: ApprovalSession, right: ApprovalSession): boolean {
  return JSON.stringify(synchronizeApprovalSession(left)) === JSON.stringify(synchronizeApprovalSession(right));
}

function readSession(root: string, sessionId: string): ApprovalSession | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(sessionFile(root, sessionId), "utf8"));
    return isApprovalSession(parsed) && parsed.session_id === sessionId ? parsed : null;
  } catch {
    return null;
  }
}

function journalOwnershipError(journal: ApprovalMaterializationJournal): string | null {
  const original = synchronizeApprovalSession(journal.original_session);
  const updated = synchronizeApprovalSession(journal.updated_session);
  const originalPaths = new Set(original.materialized_target_paths || []);
  const expectedPaths = Array.from(new Set([...originalPaths, ...journal.targets.map((target) => target.path)]));
  if (JSON.stringify(updated.materialized_target_paths || []) !== JSON.stringify(expectedPaths)) {
    return "Approval materialization journal has an invalid ownership update";
  }
  const comparableOriginal = { ...original, materialized_target_paths: expectedPaths, updated_at: updated.updated_at };
  if (!sameSession(comparableOriginal, updated)) {
    return "Approval materialization journal changes unrelated session state";
  }
  const snapshots = new Map(original.snapshot_files.map((file) => [file.path, file]));
  const befores = new Map(original.before_files.map((file) => [file.path, file]));
  for (const target of journal.targets) {
    const snapshot = snapshots.get(target.path);
    const before = befores.get(target.path);
    if (!snapshot || snapshot.missing === true || !before || originalPaths.has(target.path)) {
      return `Approval materialization journal does not own target: ${target.path}`;
    }
    const baseline = before.existed ? before.content : null;
    if (target.after !== snapshot.content || target.before !== baseline) {
      return `Approval materialization journal does not match its snapshot: ${target.path}`;
    }
  }
  return null;
}

function readJournal(root: string, sessionId: string): ApprovalMaterializationJournal | null {
  try {
    const value = JSON.parse(fs.readFileSync(journalFile(root, sessionId), "utf8")) as ApprovalMaterializationJournal;
    const valid = value.version === 1
      && value.session_id === sessionId
      && /^[a-f0-9]{24}$/.test(sessionId)
      && (value.state === "prepared" || value.state === "written")
      && isApprovalSession(value.original_session)
      && isApprovalSession(value.updated_session)
      && value.original_session.session_id === sessionId
      && value.updated_session.session_id === sessionId
      && Array.isArray(value.targets)
      && value.targets.length > 0
      && value.targets.every((target) => (
        target && typeof target.path === "string"
        && (target.before === null || typeof target.before === "string")
        && typeof target.after === "string"
      ))
      && new Set(value.targets.map((target) => target.path)).size === value.targets.length;
    return valid && !journalOwnershipError(value) ? value : null;
  } catch {
    return null;
  }
}

function reconcileUnlocked(root: string, sessionId: string): ApprovalMaterializationReconcileResult {
  const exists = fs.existsSync(journalFile(root, sessionId));
  const journal = readJournal(root, sessionId);
  if (!journal) return exists
    ? { ok: false, pending: true, error: "Approval materialization journal is invalid or unreadable" }
    : { ok: true, pending: false, session: null };
  try {
    const live = readSession(root, sessionId);
    if (!live || (!sameSession(live, journal.original_session) && !sameSession(live, journal.updated_session))) {
      return { ok: false, pending: true, error: `Approval session changed during materialization recovery: ${sessionId}` };
    }
    for (const target of journal.targets) {
      const current = fileContent(root, target.path);
      if (current !== target.before && current !== target.after) {
        return { ok: false, pending: true, error: `Approval materialization target changed during recovery: ${target.path}` };
      }
    }
    const commit = journal.state === "written";
    const mutation = writeArtifactFilesAtomic(root, journal.targets.map((target) => ({
      path: target.path,
      content: commit ? target.after : target.before,
    })), { lock: false });
    if (!mutation.ok) {
      return { ok: false, pending: true, error: String(mutation.error || "Unable to reconcile approval materialization targets") };
    }
    const session = commit ? journal.updated_session : journal.original_session;
    atomicJson(sessionFile(root, sessionId), synchronizeApprovalSession(session));
    fs.rmSync(journalFile(root, sessionId), { force: true });
    return { ok: true, pending: false, session };
  } catch (error) {
    return { ok: false, pending: true, error: errorMessage(error) };
  }
}

export function reconcileApprovalMaterialization(
  root: string,
  sessionId: string,
  options: { lifecycleLocked?: boolean } = {},
): ApprovalMaterializationReconcileResult {
  if (!fs.existsSync(journalFile(root, sessionId))) return { ok: true, pending: false, session: null };
  return options.lifecycleLocked
    ? reconcileUnlocked(root, sessionId)
    : withLock(root, "approval-target-lifecycle", () => reconcileUnlocked(root, sessionId)) as unknown as ApprovalMaterializationReconcileResult;
}

export function approvalMaterializationJournalIds(root: string): string[] {
  try {
    return fs.readdirSync(directory(root)).flatMap((name) => {
      const match = /^([a-f0-9]{24})\.materialize-journal\.json$/.exec(name);
      return match?.[1] ? [match[1]] : [];
    });
  } catch {
    return [];
  }
}

export function approvalMaterializationSessionSnapshot(root: string, sessionId: string): ApprovalSession | null {
  try {
    const value = JSON.parse(fs.readFileSync(journalFile(root, sessionId), "utf8")) as Partial<ApprovalMaterializationJournal>;
    return isApprovalSession(value.original_session) && value.original_session.session_id === sessionId
      ? value.original_session
      : null;
  } catch {
    return null;
  }
}

export function approvalMaterializationJournalError(root: string, sessionId: string): string | null {
  return fs.existsSync(journalFile(root, sessionId)) && !readJournal(root, sessionId)
    ? `Approval materialization journal is invalid or unreadable: ${sessionId}`
    : null;
}

/** Materialize approved snapshots and persist exact ownership as one recoverable transaction. */
export function materializeApprovalTargets(
  root: string,
  expectedSession: ApprovalSession,
  paths: string[],
): CoreResult {
  return withLock(root, "approval-target-lifecycle", () => {
    const recovery = reconcileUnlocked(root, expectedSession.session_id);
    if (!recovery.ok) {
      return { ok: false, recovery_required: true, stage: "approval_materialize_recovery", error: recovery.error };
    }
    const live = readSession(root, expectedSession.session_id);
    if (!live || !sameSession(live, expectedSession)) {
      return { ok: false, stage: "approval_materialize_session", error: "Approval session changed before approved files could be materialized" };
    }
    const snapshots = new Map(live.snapshot_files.map((file) => [file.path, file]));
    const befores = new Map(live.before_files.map((file) => [file.path, file]));
    const already = new Set(live.materialized_target_paths || []);
    const requested = Array.from(new Set(paths));
    for (const relativePath of requested.filter((entry) => already.has(entry))) {
      const snapshot = snapshots.get(relativePath);
      if (!snapshot || snapshot.missing === true || fileContent(root, relativePath) !== snapshot.content) {
        return { ok: false, stage: "approval_materialize_drift", error: `Previously materialized approval target changed: ${relativePath}` };
      }
    }
    const targets = requested.filter((entry) => !already.has(entry)).map((relativePath) => {
      const snapshot = snapshots.get(relativePath);
      const before = befores.get(relativePath);
      if (!snapshot || snapshot.missing === true || !before || !safePath(root, relativePath)) {
        throw new Error(`Approval session has no safe materialization record for ${relativePath}`);
      }
      const baseline = before.existed ? before.content : null;
      if (fileContent(root, relativePath) !== baseline) {
        throw new Error(`Approval target changed before materialization: ${relativePath}`);
      }
      return { path: relativePath, before: baseline, after: snapshot.content };
    });
    if (targets.length === 0) return { ok: true, files: requested, reused: true };
    const updated = synchronizeApprovalSession({
      ...live,
      materialized_target_paths: [...already, ...targets.map((target) => target.path)],
      updated_at: new Date().toISOString(),
    });
    let journal: ApprovalMaterializationJournal = {
      version: 1,
      session_id: live.session_id,
      state: "prepared",
      original_session: live,
      updated_session: updated,
      targets,
    };
    try {
      atomicJson(journalFile(root, live.session_id), journal);
      const mutation = writeArtifactFilesAtomic(root, targets.map((target) => ({
        path: target.path,
        content: target.after,
      })), { lock: false });
      if (!mutation.ok) throw new Error(String(mutation.error || "Unable to materialize approved files"));
      journal = { ...journal, state: "written" };
      atomicJson(journalFile(root, live.session_id), journal);
      atomicJson(sessionFile(root, live.session_id), updated);
      fs.rmSync(journalFile(root, live.session_id), { force: true });
      return { ok: true, files: requested, mutation };
    } catch (error) {
      const reconciled = reconcileUnlocked(root, live.session_id);
      return {
        ok: false,
        recovery_required: !reconciled.ok || reconciled.pending,
        stage: "approval_materialize_transaction",
        error: [errorMessage(error), reconciled.error].filter(Boolean).join("; "),
      };
    }
  }) as CoreResult;
}
