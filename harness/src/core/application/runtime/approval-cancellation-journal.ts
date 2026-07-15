import fs from "node:fs";
import path from "node:path";

import { errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { synchronizeApprovalSession, type ApprovalSession } from "./approval-session-model";
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
    const value = JSON.parse(fs.readFileSync(journalFile(root, sessionId), "utf8")) as ApprovalCancellationJournal;
    return value.version === 1 && value.session_id === sessionId ? value : null;
  } catch {
    return null;
  }
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

function restoreLiveSession(root: string, journal: ApprovalCancellationJournal): void {
  const live = sessionFile(root, journal.session_id);
  if (fs.existsSync(live)) return;
  const quarantine = journalMember(root, journal.quarantine_name);
  if (quarantine && fs.existsSync(quarantine)) {
    fs.renameSync(quarantine, live);
    return;
  }
  atomicJson(live, synchronizeApprovalSession(journal.session));
}

function reconcileUnlocked(root: string, sessionId: string): ApprovalCancellationReconcileResult {
  const journal = readJournal(root, sessionId);
  if (!journal) return { ok: true, pending: false, session: null };
  const quarantine = journalMember(root, journal.quarantine_name);
  const completed = journalMember(root, journal.completed_name);
  if (!quarantine || !completed) return { ok: false, pending: true, error: "Cancellation journal contains unsafe session paths" };
  try {
    if (journal.state === "restored") {
      fs.rmSync(quarantine, { force: true });
      fs.rmSync(completed, { force: true });
      removeApprovalCancellationJournal(root, sessionId);
      return { ok: true, pending: false, session: null };
    }
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
