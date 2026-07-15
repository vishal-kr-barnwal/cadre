import fs from "node:fs";
import path from "node:path";

import { errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { synchronizeApprovalSession, type ApprovalSession } from "./approval-session-model";
import { restoreReviewIntentToAdd } from "./review-output";

export type ApprovalSupersessionState =
  | "prepared"
  | "quarantined"
  | "restoring"
  | "rolled_back"
  | "committed";

export interface ApprovalSupersessionSession {
  session: ApprovalSession;
  quarantine_name: string;
}

export interface ApprovalSupersessionTarget {
  path: string;
  before: string | null;
  preview: string | null;
}

export interface ApprovalSupersessionJournal {
  version: 1;
  transaction_id: string;
  state: ApprovalSupersessionState;
  sessions: ApprovalSupersessionSession[];
  targets: ApprovalSupersessionTarget[];
  intent_to_add_paths: string[];
}

export interface ApprovalSupersessionReconcileResult {
  ok: boolean;
  pending: boolean;
  sessions: ApprovalSession[];
  cleanup_pending?: boolean;
  error?: string;
}

export interface ApprovalSupersessionReconcileOptions {
  lifecycleLocked?: boolean;
}

const SESSION_ID = /^[a-f0-9]{24}$/;

function directory(root: string): string {
  return path.join(root, "cadre", "local", "approval-sessions");
}

function journalFile(root: string, transactionId: string): string {
  return path.join(directory(root), `${transactionId}.supersede-journal.json`);
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
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function readJournal(root: string, transactionId: string): ApprovalSupersessionJournal | null {
  try {
    const value = JSON.parse(fs.readFileSync(journalFile(root, transactionId), "utf8")) as ApprovalSupersessionJournal;
    if (value.version !== 1 || value.transaction_id !== transactionId || !Array.isArray(value.sessions)) return null;
    return value;
  } catch {
    return null;
  }
}

function journalError(root: string, transactionId: string): string | null {
  if (!fs.existsSync(journalFile(root, transactionId))) return null;
  return readJournal(root, transactionId) ? null : "Supersession journal is invalid or unreadable";
}

function sameSession(left: ApprovalSession, right: ApprovalSession): boolean {
  return JSON.stringify(synchronizeApprovalSession(left)) === JSON.stringify(synchronizeApprovalSession(right));
}

function restoreSession(root: string, entry: ApprovalSupersessionSession): void {
  const sessionId = entry.session.session_id;
  if (!SESSION_ID.test(sessionId)) throw new Error(`Invalid superseded approval session id: ${sessionId}`);
  const live = sessionFile(root, sessionId);
  const quarantine = journalMember(root, entry.quarantine_name);
  if (!quarantine) throw new Error(`Unsafe superseded approval quarantine path: ${entry.quarantine_name}`);
  if (fs.existsSync(live)) {
    const current = JSON.parse(fs.readFileSync(live, "utf8")) as ApprovalSession;
    if (!sameSession(current, entry.session)) {
      throw new Error(`Approval session changed during supersession recovery: ${sessionId}`);
    }
    return;
  }
  if (fs.existsSync(quarantine)) {
    fs.renameSync(quarantine, live);
    return;
  }
  atomicJson(live, synchronizeApprovalSession(entry.session));
}

function cleanupJournal(root: string, journal: ApprovalSupersessionJournal): string[] {
  const errors: string[] = [];
  for (const entry of journal.sessions) {
    const quarantine = journalMember(root, entry.quarantine_name);
    if (!quarantine) {
      errors.push(`Unsafe superseded approval quarantine path: ${entry.quarantine_name}`);
      continue;
    }
    try { fs.rmSync(quarantine, { force: true }); } catch (error) { errors.push(errorMessage(error)); }
  }
  if (errors.length === 0) {
    try { fs.rmSync(journalFile(root, journal.transaction_id), { force: true }); } catch (error) { errors.push(errorMessage(error)); }
  }
  return errors;
}

function rollbackJournal(root: string, journal: ApprovalSupersessionJournal): ApprovalSupersessionReconcileResult {
  const targets = writeArtifactFilesAtomic(root, journal.targets.map((target) => ({
    path: target.path,
    content: target.preview,
  })), { lock: false });
  if (!targets.ok) {
    return { ok: false, pending: true, sessions: [], error: String(targets.error || "Unable to recover superseded approval targets") };
  }
  const intent = restoreReviewIntentToAdd(root, journal.intent_to_add_paths);
  if (!intent.ok) {
    return { ok: false, pending: true, sessions: [], error: intent.error || "Unable to recover superseded approval Git intent" };
  }
  try {
    for (const entry of journal.sessions) restoreSession(root, entry);
    const rolledBack = { ...journal, state: "rolled_back" as const };
    writeApprovalSupersessionJournal(root, rolledBack);
    const cleanupErrors = cleanupJournal(root, rolledBack);
    return {
      ok: true,
      pending: false,
      sessions: rolledBack.sessions.map((entry) => entry.session),
      cleanup_pending: cleanupErrors.length > 0,
      ...(cleanupErrors.length > 0 ? { error: cleanupErrors.join("; ") } : {}),
    };
  } catch (error) {
    return { ok: false, pending: true, sessions: [], error: errorMessage(error) };
  }
}

function reconcileUnlocked(root: string, transactionId: string): ApprovalSupersessionReconcileResult {
  const invalid = journalError(root, transactionId);
  if (invalid) return { ok: false, pending: true, sessions: [], error: invalid };
  const journal = readJournal(root, transactionId);
  if (!journal) return { ok: true, pending: false, sessions: [] };
  if (journal.state !== "committed" && journal.state !== "rolled_back") return rollbackJournal(root, journal);
  const cleanupErrors = cleanupJournal(root, journal);
  return {
    ok: true,
    pending: false,
    sessions: journal.state === "rolled_back" ? journal.sessions.map((entry) => entry.session) : [],
    cleanup_pending: cleanupErrors.length > 0,
    ...(cleanupErrors.length > 0 ? { error: cleanupErrors.join("; ") } : {}),
  };
}

export function writeApprovalSupersessionJournal(root: string, journal: ApprovalSupersessionJournal): void {
  if (!SESSION_ID.test(journal.transaction_id)) throw new Error("Invalid approval supersession transaction id");
  atomicJson(journalFile(root, journal.transaction_id), journal);
}

export function approvalSupersessionJournalIds(root: string): string[] {
  try {
    return fs.readdirSync(directory(root)).flatMap((name) => {
      const match = /^([a-f0-9]{24})\.supersede-journal\.json$/.exec(name);
      return match?.[1] ? [match[1]] : [];
    });
  } catch {
    return [];
  }
}

export function approvalSupersessionSessionSnapshots(root: string): ApprovalSession[] {
  return approvalSupersessionJournalIds(root).flatMap((transactionId) => (
    readJournal(root, transactionId)?.sessions.map((entry) => entry.session) || []
  ));
}

export function reconcileApprovalSupersession(
  root: string,
  transactionId: string,
  options: ApprovalSupersessionReconcileOptions = {},
): ApprovalSupersessionReconcileResult {
  if (!fs.existsSync(journalFile(root, transactionId))) return { ok: true, pending: false, sessions: [] };
  const reconciled = options.lifecycleLocked
    ? reconcileUnlocked(root, transactionId)
    : withLock(root, "approval-target-lifecycle", () => reconcileUnlocked(root, transactionId)) as unknown as ApprovalSupersessionReconcileResult;
  if (reconciled.ok) return reconciled;
  return {
    ok: false,
    pending: true,
    sessions: [],
    error: reconciled.error || "Interrupted approval supersession could not be reconciled",
  };
}

export function reconcileApprovalSupersessions(
  root: string,
  options: ApprovalSupersessionReconcileOptions = {},
): ApprovalSupersessionReconcileResult {
  const sessions: ApprovalSession[] = [];
  const errors: string[] = [];
  let cleanupPending = false;
  for (const transactionId of approvalSupersessionJournalIds(root)) {
    const result = reconcileApprovalSupersession(root, transactionId, options);
    sessions.push(...result.sessions);
    cleanupPending = cleanupPending || result.cleanup_pending === true;
    if (!result.ok && result.pending) errors.push(result.error || `Unable to reconcile supersession ${transactionId}`);
  }
  return {
    ok: errors.length === 0,
    pending: errors.length > 0,
    sessions,
    cleanup_pending: cleanupPending,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

export function reconcileApprovalSupersessionForSession(
  root: string,
  sessionId: string,
  options: ApprovalSupersessionReconcileOptions = {},
): ApprovalSupersessionReconcileResult {
  for (const transactionId of approvalSupersessionJournalIds(root)) {
    const journal = readJournal(root, transactionId);
    if (journal?.sessions.some((entry) => entry.session.session_id === sessionId)) {
      return reconcileApprovalSupersession(root, transactionId, options);
    }
  }
  return { ok: true, pending: false, sessions: [] };
}
