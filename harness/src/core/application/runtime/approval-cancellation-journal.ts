import fs from "node:fs";
import path from "node:path";

import { errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { cancellationJournalOwnershipError } from "./approval-journal-ownership";
import { isApprovalSession, synchronizeApprovalSession, type ApprovalSession } from "./approval-session-model";
import { restoreReviewIntentToAdd } from "./review-output";

export interface ApprovalCancellationTarget {
  path: string;
  before: string | null;
  preview: string;
}

export interface ApprovalCancellationJournal {
  version: 1;
  session_id: string;
  state: "prepared" | "restoring" | "restored";
  session: ApprovalSession;
  targets: ApprovalCancellationTarget[];
  intent_to_add_paths: string[];
  quarantine_name: string;
  completed_name: string;
}

export interface ApprovalCancellationReconcileResult {
  ok: boolean;
  pending: boolean;
  session?: ApprovalSession | null;
  error?: string;
}

export interface ApprovalCancellationReconcileOptions {
  lifecycleLocked?: boolean;
}

const SESSION_ID = /^[a-f0-9]{24}$/;

function directory(root: string): string {
  return path.join(root, "cadre", "local", "approval-sessions");
}

function journalFile(root: string, sessionId: string): string {
  return path.join(directory(root), `${sessionId}.cancel-journal.json`);
}

function sessionFile(root: string, sessionId: string): string {
  return path.join(directory(root), `${sessionId}.json`);
}

function journalMember(root: string, name: string): string | null {
  if (path.basename(name) !== name) return null;
  const target = path.join(directory(root), name);
  return path.dirname(target) === directory(root) ? target : null;
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

function readJournal(root: string, sessionId: string): ApprovalCancellationJournal | null {
  try {
    const value = JSON.parse(fs.readFileSync(journalFile(root, sessionId), "utf8")) as Partial<ApprovalCancellationJournal>;
    const validState = value.state === "prepared" || value.state === "restoring" || value.state === "restored";
    const validSession = isApprovalSession(value.session) && value.session.session_id === sessionId;
    const validTargets = Array.isArray(value.targets) && value.targets.every((target) => (
      Boolean(target)
      && typeof target === "object"
      && !Array.isArray(target)
      && typeof target.path === "string"
      && (target.before === null || typeof target.before === "string")
      && typeof target.preview === "string"
    ));
    const validIntent = Array.isArray(value.intent_to_add_paths)
      && value.intent_to_add_paths.every((entry) => typeof entry === "string");
    const quarantinePattern = new RegExp(`^${sessionId}\\.json\\.\\d+\\.\\d+\\.canceling$`);
    const validQuarantine = typeof value.quarantine_name === "string" && quarantinePattern.test(value.quarantine_name);
    const validCompleted = validQuarantine
      && typeof value.completed_name === "string"
      && value.completed_name === value.quarantine_name!.replace(/\.canceling$/, ".cancelled");
    const targetPaths = validTargets ? value.targets!.map((target) => target.path) : [];
    const structurallyValid = value.version === 1
      && value.session_id === sessionId
      && SESSION_ID.test(sessionId)
      && validState
      && validSession
      && validTargets
      && new Set(targetPaths).size === targetPaths.length
      && validIntent
      && validQuarantine
      && validCompleted;
    if (!structurallyValid) return null;
    const journal = value as ApprovalCancellationJournal;
    return cancellationJournalOwnershipError(
      journal.session,
      journal.targets,
      journal.intent_to_add_paths,
    ) ? null : journal;
  } catch {
    return null;
  }
}

function journalError(root: string, sessionId: string): string | null {
  if (!fs.existsSync(journalFile(root, sessionId))) return null;
  return readJournal(root, sessionId) ? null : "Cancellation journal is invalid or unreadable";
}

export function writeApprovalCancellationJournal(root: string, journal: ApprovalCancellationJournal): void {
  atomicJson(journalFile(root, journal.session_id), journal);
}

export function removeApprovalCancellationJournal(root: string, sessionId: string): void {
  fs.rmSync(journalFile(root, sessionId), { force: true });
}

export function approvalCancellationJournalIds(root: string): string[] {
  try {
    return fs.readdirSync(directory(root)).flatMap((name) => {
      const match = /^([a-f0-9]{24})\.cancel-journal\.json$/.exec(name);
      return match?.[1] ? [match[1]] : [];
    });
  } catch {
    return [];
  }
}

export function approvalCancellationSessionSnapshot(root: string, sessionId: string): ApprovalSession | null {
  return readJournal(root, sessionId)?.session || null;
}

function sameSession(left: ApprovalSession, right: ApprovalSession): boolean {
  return JSON.stringify(synchronizeApprovalSession(left)) === JSON.stringify(synchronizeApprovalSession(right));
}

function verifiedSession(file: string, expected: ApprovalSession): void {
  const current: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isApprovalSession(current)) {
    throw new Error(`Approval session is invalid during cancellation recovery: ${expected.session_id}`);
  }
  if (!sameSession(current, expected)) {
    throw new Error(`Approval session changed during cancellation recovery: ${expected.session_id}`);
  }
}

function recoverableSessionError(
  root: string,
  journal: ApprovalCancellationJournal,
  quarantine: string,
  completed: string,
): string | null {
  const live = sessionFile(root, journal.session_id);
  const liveExists = fs.existsSync(live);
  const quarantineExists = fs.existsSync(quarantine);
  const completedExists = fs.existsSync(completed);
  if (completedExists) {
    return `Cancellation recovery found an unexpected completed session tombstone: ${journal.session_id}`;
  }
  if (liveExists && quarantineExists) {
    return `Cancellation recovery found both live and quarantined session state: ${journal.session_id}`;
  }
  try {
    if (liveExists) verifiedSession(live, journal.session);
    if (quarantineExists) verifiedSession(quarantine, journal.session);
  } catch (error) {
    return errorMessage(error);
  }
  return null;
}

function targetContent(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Cancellation journal contains an unsafe target path: ${relativePath}`);
  }
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
}

function targetDriftError(root: string, journal: ApprovalCancellationJournal): string | null {
  if (journal.state === "restored") return null;
  for (const target of journal.targets) {
    const current = targetContent(root, target.path);
    const allowed = journal.state === "restoring"
      ? current === target.preview || current === target.before
      : current === target.preview;
    if (!allowed) return `Cancellation recovery target changed after the transaction was interrupted: ${target.path}`;
  }
  return null;
}

function restoreLiveSession(root: string, journal: ApprovalCancellationJournal): void {
  const live = sessionFile(root, journal.session_id);
  if (fs.existsSync(live)) {
    verifiedSession(live, journal.session);
    return;
  }
  const quarantine = journalMember(root, journal.quarantine_name);
  if (quarantine && fs.existsSync(quarantine)) {
    verifiedSession(quarantine, journal.session);
    fs.renameSync(quarantine, live);
    return;
  }
  atomicJson(live, synchronizeApprovalSession(journal.session));
}

function reconcileUnlocked(root: string, sessionId: string): ApprovalCancellationReconcileResult {
  const invalid = journalError(root, sessionId);
  if (invalid) return { ok: false, pending: true, error: invalid };
  const journal = readJournal(root, sessionId);
  if (!journal) return { ok: true, pending: false, session: null };
  const quarantine = journalMember(root, journal.quarantine_name);
  const completed = journalMember(root, journal.completed_name);
  if (!quarantine || !completed) return { ok: false, pending: true, error: "Cancellation journal contains unsafe session paths" };
  try {
    if (journal.state === "restored") {
      if (fs.existsSync(sessionFile(root, sessionId))) {
        return { ok: false, pending: true, error: `Cancelled approval session unexpectedly remains live: ${sessionId}` };
      }
      if (fs.existsSync(quarantine) && fs.existsSync(completed)) {
        return { ok: false, pending: true, error: `Cancelled approval session has duplicate tombstones: ${sessionId}` };
      }
      if (fs.existsSync(quarantine)) verifiedSession(quarantine, journal.session);
      if (fs.existsSync(completed)) verifiedSession(completed, journal.session);
      fs.rmSync(quarantine, { force: true });
      fs.rmSync(completed, { force: true });
      removeApprovalCancellationJournal(root, sessionId);
      return { ok: true, pending: false, session: null };
    }
    const sessionError = recoverableSessionError(root, journal, quarantine, completed);
    if (sessionError) return { ok: false, pending: true, error: sessionError };
    const drift = targetDriftError(root, journal);
    if (drift) return { ok: false, pending: true, error: drift };
    if (journal.state === "restoring") {
      const targets = writeArtifactFilesAtomic(root, journal.targets.map((target) => ({
        path: target.path,
        content: target.preview,
      })), { lock: false });
      if (!targets.ok) return { ok: false, pending: true, error: String(targets.error || "Unable to recover cancellation targets") };
      const intent = restoreReviewIntentToAdd(root, journal.intent_to_add_paths);
      if (!intent.ok) return { ok: false, pending: true, error: intent.error || "Unable to recover cancellation Git intent" };
    }
    restoreLiveSession(root, journal);
    removeApprovalCancellationJournal(root, sessionId);
    return { ok: true, pending: false, session: journal.session };
  } catch (error) {
    return { ok: false, pending: true, error: errorMessage(error) };
  }
}

export function reconcileApprovalCancellation(
  root: string,
  sessionId: string,
  options: ApprovalCancellationReconcileOptions = {},
): ApprovalCancellationReconcileResult {
  if (!fs.existsSync(journalFile(root, sessionId))) return { ok: true, pending: false, session: null };
  const reconciled = options.lifecycleLocked
    ? reconcileUnlocked(root, sessionId)
    : withLock(root, "approval-target-lifecycle", () => reconcileUnlocked(root, sessionId)) as unknown as ApprovalCancellationReconcileResult;
  if (reconciled.ok) return { ok: true, pending: false, session: reconciled.session || null };
  return {
    ok: false,
    pending: true,
    session: null,
    error: reconciled.error || "Interrupted approval cancellation could not be reconciled",
  };
}

export function reconcileApprovalCancellations(
  root: string,
  options: ApprovalCancellationReconcileOptions = {},
): ApprovalCancellationReconcileResult {
  const errors: string[] = [];
  for (const sessionId of approvalCancellationJournalIds(root)) {
    const result = reconcileApprovalCancellation(root, sessionId, options);
    if (!result.ok && result.pending) errors.push(result.error || `Unable to reconcile cancellation ${sessionId}`);
  }
  return {
    ok: errors.length === 0,
    pending: errors.length > 0,
    session: null,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}
