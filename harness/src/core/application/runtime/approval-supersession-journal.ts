import fs from "node:fs";
import path from "node:path";

import { errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { supersessionJournalOwnershipError } from "./approval-journal-ownership";
import { isApprovalSession, synchronizeApprovalSession, type ApprovalSession } from "./approval-session-model";
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
    const value = JSON.parse(fs.readFileSync(journalFile(root, transactionId), "utf8")) as Partial<ApprovalSupersessionJournal>;
    const validState = value.state === "prepared"
      || value.state === "quarantined"
      || value.state === "restoring"
      || value.state === "rolled_back"
      || value.state === "committed";
    const validSessions = Array.isArray(value.sessions) && value.sessions.length > 0 && value.sessions.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const sessionId = isApprovalSession(entry.session) ? entry.session.session_id : null;
      return typeof sessionId === "string"
        && SESSION_ID.test(sessionId)
        && typeof entry.quarantine_name === "string"
        && new RegExp(`^${sessionId}\\.json\\.\\d+\\.\\d+\\.\\d+\\.superseding$`).test(entry.quarantine_name);
    });
    const validTargets = Array.isArray(value.targets) && value.targets.every((target) => (
      Boolean(target)
      && typeof target === "object"
      && !Array.isArray(target)
      && typeof target.path === "string"
      && (target.before === null || typeof target.before === "string")
      && (target.preview === null || typeof target.preview === "string")
    ));
    const validIntent = Array.isArray(value.intent_to_add_paths)
      && value.intent_to_add_paths.every((entry) => typeof entry === "string");
    const sessionIds = validSessions ? value.sessions!.map((entry) => entry.session.session_id) : [];
    const quarantineNames = validSessions ? value.sessions!.map((entry) => entry.quarantine_name) : [];
    const targetPaths = validTargets ? value.targets!.map((target) => target.path) : [];
    const structurallyValid = value.version === 1
      && value.transaction_id === transactionId
      && SESSION_ID.test(transactionId)
      && validState
      && validSessions
      && new Set(sessionIds).size === sessionIds.length
      && new Set(quarantineNames).size === quarantineNames.length
      && validTargets
      && new Set(targetPaths).size === targetPaths.length
      && validIntent;
    if (!structurallyValid) return null;
    const journal = value as ApprovalSupersessionJournal;
    return supersessionJournalOwnershipError(
      journal.sessions.map((entry) => entry.session),
      journal.targets,
      journal.intent_to_add_paths,
    ) ? null : journal;
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

function readVerifiedSession(file: string, expected: ApprovalSession, context: string): ApprovalSession {
  const current: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isApprovalSession(current) || current.session_id !== expected.session_id) {
    throw new Error(`${context} approval session is invalid: ${expected.session_id}`);
  }
  if (!sameSession(current, expected)) {
    throw new Error(`${context} approval session changed during supersession recovery: ${expected.session_id}`);
  }
  return current;
}

function readValidLiveSession(file: string, sessionId: string): ApprovalSession {
  const current: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isApprovalSession(current) || current.session_id !== sessionId) {
    throw new Error(`Replacement approval session is invalid during supersession cleanup: ${sessionId}`);
  }
  return current;
}

function restoreSession(root: string, entry: ApprovalSupersessionSession): void {
  const sessionId = entry.session.session_id;
  if (!SESSION_ID.test(sessionId)) throw new Error(`Invalid superseded approval session id: ${sessionId}`);
  const live = sessionFile(root, sessionId);
  const quarantine = journalMember(root, entry.quarantine_name);
  if (!quarantine) throw new Error(`Unsafe superseded approval quarantine path: ${entry.quarantine_name}`);
  if (fs.existsSync(live)) {
    readVerifiedSession(live, entry.session, "Live");
    return;
  }
  if (fs.existsSync(quarantine)) {
    readVerifiedSession(quarantine, entry.session, "Quarantined");
    fs.renameSync(quarantine, live);
    return;
  }
  atomicJson(live, synchronizeApprovalSession(entry.session));
}

interface ApprovalSupersessionCleanupResult {
  errors: string[];
  recoveryRequired: boolean;
}

function rollbackSessionPreflight(root: string, journal: ApprovalSupersessionJournal): string[] {
  const errors: string[] = [];
  for (const entry of journal.sessions) {
    const live = sessionFile(root, entry.session.session_id);
    const quarantine = journalMember(root, entry.quarantine_name);
    if (!quarantine) {
      errors.push(`Unsafe superseded approval quarantine path: ${entry.quarantine_name}`);
      continue;
    }
    try {
      const liveExists = fs.existsSync(live);
      const quarantineExists = fs.existsSync(quarantine);
      if (liveExists && quarantineExists) {
        throw new Error(`Supersession recovery found both live and quarantined session state: ${entry.session.session_id}`);
      }
      if (liveExists) readVerifiedSession(live, entry.session, "Live");
      if (quarantineExists) readVerifiedSession(quarantine, entry.session, "Quarantined");
    } catch (error) { errors.push(errorMessage(error)); }
  }
  return errors;
}

function cleanupJournal(root: string, journal: ApprovalSupersessionJournal): ApprovalSupersessionCleanupResult {
  const validationErrors: string[] = [];
  const quarantines: string[] = [];
  for (const entry of journal.sessions) {
    const sessionId = entry.session.session_id;
    const live = sessionFile(root, sessionId);
    const quarantine = journalMember(root, entry.quarantine_name);
    if (!quarantine) {
      validationErrors.push(`Unsafe superseded approval quarantine path: ${entry.quarantine_name}`);
      continue;
    }
    quarantines.push(quarantine);
    try {
      const liveExists = fs.existsSync(live);
      if (journal.state === "rolled_back") {
        if (!liveExists) throw new Error(`Rolled-back approval session is not live: ${sessionId}`);
        readVerifiedSession(live, entry.session, "Rolled-back live");
      } else if (journal.state === "committed" && liveExists) {
        if (sessionId !== journal.transaction_id) {
          throw new Error(`Committed superseded approval session unexpectedly remains live: ${sessionId}`);
        }
        const replacement = readValidLiveSession(live, sessionId);
        if (sameSession(replacement, entry.session)) {
          throw new Error(`Committed superseded approval session unexpectedly reappeared: ${sessionId}`);
        }
      }
      if (fs.existsSync(quarantine)) readVerifiedSession(quarantine, entry.session, "Superseded tombstone");
    } catch (error) {
      validationErrors.push(errorMessage(error));
    }
  }
  if (validationErrors.length > 0) return { errors: validationErrors, recoveryRequired: true };

  const cleanupErrors: string[] = [];
  for (const quarantine of quarantines) {
    try { fs.rmSync(quarantine, { force: true }); } catch (error) { cleanupErrors.push(errorMessage(error)); }
  }
  if (cleanupErrors.length === 0) {
    try { fs.rmSync(journalFile(root, journal.transaction_id), { force: true }); } catch (error) { cleanupErrors.push(errorMessage(error)); }
  }
  return { errors: cleanupErrors, recoveryRequired: false };
}

function targetContent(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Supersession journal contains an unsafe target path: ${relativePath}`);
  }
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
}

function targetDriftError(root: string, journal: ApprovalSupersessionJournal): string | null {
  for (const target of journal.targets) {
    const current = targetContent(root, target.path);
    const allowed = journal.state === "restoring"
      ? current === target.preview || current === target.before
      : current === target.preview;
    if (!allowed) return `Supersession recovery target changed after the transaction was interrupted: ${target.path}`;
  }
  return null;
}

function rollbackJournal(root: string, journal: ApprovalSupersessionJournal): ApprovalSupersessionReconcileResult {
  const sessionErrors = rollbackSessionPreflight(root, journal);
  if (sessionErrors.length > 0) {
    return { ok: false, pending: true, sessions: [], error: sessionErrors.join("; ") };
  }
  let drift: string | null;
  try {
    drift = targetDriftError(root, journal);
  } catch (error) {
    return { ok: false, pending: true, sessions: [], error: errorMessage(error) };
  }
  if (drift) return { ok: false, pending: true, sessions: [], error: drift };
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
    const cleanup = cleanupJournal(root, rolledBack);
    if (cleanup.recoveryRequired) {
      return { ok: false, pending: true, sessions: [], error: cleanup.errors.join("; ") };
    }
    return {
      ok: true,
      pending: false,
      sessions: rolledBack.sessions.map((entry) => entry.session),
      cleanup_pending: cleanup.errors.length > 0,
      ...(cleanup.errors.length > 0 ? { error: cleanup.errors.join("; ") } : {}),
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
  const cleanup = cleanupJournal(root, journal);
  if (cleanup.recoveryRequired) {
    return { ok: false, pending: true, sessions: [], error: cleanup.errors.join("; ") };
  }
  return {
    ok: true,
    pending: false,
    sessions: journal.state === "rolled_back" ? journal.sessions.map((entry) => entry.session) : [],
    cleanup_pending: cleanup.errors.length > 0,
    ...(cleanup.errors.length > 0 ? { error: cleanup.errors.join("; ") } : {}),
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
  const reconcileAllUnlocked = (): ApprovalSupersessionReconcileResult => {
    const transactionIds = approvalSupersessionJournalIds(root);
    const journals: ApprovalSupersessionJournal[] = [];
    const validationErrors: string[] = [];
    for (const transactionId of transactionIds) {
      const invalid = journalError(root, transactionId);
      if (invalid) {
        validationErrors.push(`${transactionId}: ${invalid}`);
        continue;
      }
      const journal = readJournal(root, transactionId);
      if (journal) journals.push(journal);
    }
    const sessionOwners = new Map<string, string>();
    const targetOwners = new Map<string, string>();
    for (const journal of journals) {
      for (const entry of journal.sessions) {
        const prior = sessionOwners.get(entry.session.session_id);
        if (prior && prior !== journal.transaction_id) {
          validationErrors.push(`Approval session ${entry.session.session_id} is owned by multiple supersession journals`);
        }
        sessionOwners.set(entry.session.session_id, journal.transaction_id);
      }
      for (const target of journal.targets) {
        const prior = targetOwners.get(target.path);
        if (prior && prior !== journal.transaction_id) {
          validationErrors.push(`Approval target ${target.path} is owned by multiple supersession journals`);
        }
        targetOwners.set(target.path, journal.transaction_id);
      }
    }
    if (validationErrors.length > 0) {
      return {
        ok: false,
        pending: true,
        sessions: [],
        error: validationErrors.join("; "),
      };
    }

    const sessions: ApprovalSession[] = [];
    const errors: string[] = [];
    let cleanupPending = false;
    for (const transactionId of transactionIds) {
      const result = reconcileUnlocked(root, transactionId);
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
  };

  const reconciled = options.lifecycleLocked
    ? reconcileAllUnlocked()
    : withLock(root, "approval-target-lifecycle", reconcileAllUnlocked) as unknown as ApprovalSupersessionReconcileResult;
  if (reconciled.ok) return reconciled;
  return {
    ok: false,
    pending: true,
    sessions: [],
    error: reconciled.error || "Approval supersession recovery could not acquire the target lifecycle lock",
  };
}

export function reconcileApprovalSupersessionForSession(
  root: string,
  _sessionId: string,
  options: ApprovalSupersessionReconcileOptions = {},
): ApprovalSupersessionReconcileResult {
  // Membership is unknowable when any journal is corrupt, so reads reconcile all transactions.
  return reconcileApprovalSupersessions(root, options);
}
