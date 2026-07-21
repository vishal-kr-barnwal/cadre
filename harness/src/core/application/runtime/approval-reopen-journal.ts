import fs from "node:fs";
import path from "node:path";

import { errorMessage } from "../../../guards";
import { withLock, withTrackLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { removeEmptyApprovalParents } from "./approval-session-ancillary";
import { approvalReopenJournalOwnershipError } from "./approval-reopen-ownership";
import { isApprovalSession, synchronizeApprovalSession, type ApprovalSession } from "./approval-session-model";
import { restoreReviewIntentToAdd } from "./review-output";
import { CADRE_EVENTS_LOCK } from "./native-state";

export interface ApprovalReopenTarget {
  path: string;
  before: string | null;
  preview: string;
}

export interface ApprovalReopenBundleTarget {
  path: string;
  before: string | null;
  after: string | null;
}

export interface ApprovalReopenSideEffectTarget {
  path: "cadre/tracks.json" | "cadre/events.jsonl";
  before: string | null;
  after: string;
}

export interface ApprovalReopenJournal {
  version: 1;
  session_id: string;
  state: "prepared" | "restoring" | "restored";
  original_session: ApprovalSession;
  updated_session: ApprovalSession;
  targets: ApprovalReopenTarget[];
  bundle_targets: ApprovalReopenBundleTarget[];
  restart_track_id: string | null;
  side_effect_targets: ApprovalReopenSideEffectTarget[];
  intent_to_add_paths: string[];
}

export interface ApprovalReopenReconcileResult {
  ok: boolean;
  pending: boolean;
  session?: ApprovalSession | null;
  error?: string;
}

function directory(root: string): string {
  return path.join(root, "cadre", "local", "approval-sessions");
}

function journalFile(root: string, sessionId: string): string {
  return path.join(directory(root), `${sessionId}.reopen-journal.json`);
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

function readJournal(root: string, sessionId: string): ApprovalReopenJournal | null {
  try {
    const value = JSON.parse(fs.readFileSync(journalFile(root, sessionId), "utf8")) as Partial<ApprovalReopenJournal>;
    if (value.bundle_targets === undefined) value.bundle_targets = [];
    if (value.restart_track_id === undefined) value.restart_track_id = null;
    if (value.side_effect_targets === undefined) value.side_effect_targets = [];
    if (value.version !== 1 || value.session_id !== sessionId || !/^[a-f0-9]{24}$/.test(sessionId)) return null;
    if (!isApprovalSession(value.original_session) || !isApprovalSession(value.updated_session)) return null;
    if (value.original_session.session_id !== sessionId || value.updated_session.session_id !== sessionId) return null;
    if (value.state !== "prepared" && value.state !== "restoring" && value.state !== "restored") return null;
    if (!Array.isArray(value.targets) || !value.targets.every((target) => (
      target && typeof target === "object" && !Array.isArray(target)
      && typeof target.path === "string"
      && (target.before === null || typeof target.before === "string")
      && typeof target.preview === "string"
    ))) return null;
    if (!Array.isArray(value.intent_to_add_paths) || !value.intent_to_add_paths.every((entry) => typeof entry === "string")) return null;
    if (!Array.isArray(value.bundle_targets) || !value.bundle_targets.every((target) => (
      target && typeof target === "object" && !Array.isArray(target)
      && typeof target.path === "string" && path.isAbsolute(target.path)
      && (target.before === null || typeof target.before === "string")
      && (target.after === null || typeof target.after === "string")
    ))) return null;
    if (value.restart_track_id !== null && typeof value.restart_track_id !== "string") return null;
    if (!Array.isArray(value.side_effect_targets) || !value.side_effect_targets.every((target) => (
      target && typeof target === "object" && !Array.isArray(target)
      && (target.path === "cadre/tracks.json" || target.path === "cadre/events.jsonl")
      && (target.before === null || typeof target.before === "string")
      && typeof target.after === "string"
    ))) return null;
    const targetPaths = value.targets.map((target) => target.path);
    if (new Set(targetPaths).size !== targetPaths.length) return null;
    const bundlePaths = value.bundle_targets.map((target) => path.resolve(target.path));
    if (new Set(bundlePaths).size !== bundlePaths.length) return null;
    const journal = value as ApprovalReopenJournal;
    return approvalReopenJournalOwnershipError(root, journal) ? null : journal;
  } catch {
    return null;
  }
}

function targetContent(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe reopen target: ${relativePath}`);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
}

function absoluteContent(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function writeAbsolute(file: string, content: string | null): void {
  if (content === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.reopen-bundle-tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function sameSession(left: ApprovalSession, right: ApprovalSession): boolean {
  return JSON.stringify(synchronizeApprovalSession(left)) === JSON.stringify(synchronizeApprovalSession(right));
}

function readLiveSession(root: string, expected: ApprovalSession): ApprovalSession | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(sessionFile(root, expected.session_id), "utf8"));
    if (!isApprovalSession(parsed)) throw new Error(`Invalid approval session during reopen recovery: ${expected.session_id}`);
    return parsed;
  } catch (error) {
    if (!fs.existsSync(sessionFile(root, expected.session_id))) return null;
    throw error;
  }
}

function targetDrift(root: string, journal: ApprovalReopenJournal): string | null {
  for (const target of journal.targets) {
    const current = targetContent(root, target.path);
    const allowed = journal.state === "prepared"
      ? current === target.preview
      : current === target.preview || current === target.before;
    if (!allowed) return `Reopen recovery target changed after interruption: ${target.path}`;
  }
  for (const target of journal.bundle_targets) {
    const current = absoluteContent(target.path);
    const allowed = journal.state === "prepared"
      ? current === target.before
      : current === target.before || current === target.after;
    if (!allowed) return `Reopen recovery bundle target changed after interruption: ${target.path}`;
  }
  for (const target of journal.side_effect_targets) {
    const current = targetContent(root, target.path);
    const allowed = journal.state === "prepared"
      ? current === target.before
      : current === target.before || current === target.after;
    if (!allowed) return `Reopen recovery side effect changed after interruption: ${target.path}`;
  }
  return null;
}

function writeSession(root: string, session: ApprovalSession): void {
  atomicJson(sessionFile(root, session.session_id), synchronizeApprovalSession(session));
}

function reconcileUnlocked(root: string, sessionId: string): ApprovalReopenReconcileResult {
  const exists = fs.existsSync(journalFile(root, sessionId));
  const journal = readJournal(root, sessionId);
  if (!journal) return exists
    ? { ok: false, pending: true, error: "Reopen journal is invalid or unreadable" }
    : { ok: true, pending: false, session: null };
  try {
    const drift = targetDrift(root, journal);
    if (drift) return { ok: false, pending: true, error: drift };
    const live = readLiveSession(root, journal.original_session);
    if (live && !sameSession(live, journal.original_session) && !sameSession(live, journal.updated_session)) {
      return { ok: false, pending: true, error: `Approval session changed during reopen recovery: ${sessionId}` };
    }
    if (journal.state === "restored") {
      const targetsReady = journal.targets.every((target) => targetContent(root, target.path) === target.before);
      const bundleReady = journal.bundle_targets.every((target) => absoluteContent(target.path) === target.after);
      const sideEffectsReady = journal.side_effect_targets.every((target) => targetContent(root, target.path) === target.after);
      if (!targetsReady || !bundleReady || !sideEffectsReady) return { ok: false, pending: true, error: "Reopen commit is missing restored target state" };
      for (const target of journal.targets) {
        if (target.before === null) removeEmptyApprovalParents(root, path.join(root, target.path));
      }
      writeSession(root, journal.updated_session);
      fs.rmSync(journalFile(root, sessionId), { force: true });
      return { ok: true, pending: false, session: journal.updated_session };
    }
    const restored = writeArtifactFilesAtomic(root, journal.targets.map((target) => ({
      path: target.path,
      content: target.preview,
    })), { lock: false });
    if (!restored.ok) return { ok: false, pending: true, error: String(restored.error || "Unable to roll back reopen targets") };
    for (const target of journal.bundle_targets) writeAbsolute(target.path, target.before);
    const sideEffects = writeArtifactFilesAtomic(root, journal.side_effect_targets.map((target) => ({
      path: target.path,
      content: target.before,
    })), { lock: false });
    if (!sideEffects.ok) return { ok: false, pending: true, error: String(sideEffects.error || "Unable to roll back reopen side effects") };
    const intent = restoreReviewIntentToAdd(root, journal.intent_to_add_paths);
    if (!intent.ok) return { ok: false, pending: true, error: intent.error || "Unable to restore reopen Git intent" };
    writeSession(root, journal.original_session);
    fs.rmSync(journalFile(root, sessionId), { force: true });
    return { ok: true, pending: false, session: journal.original_session };
  } catch (error) {
    return { ok: false, pending: true, error: errorMessage(error) };
  }
}

export function writeApprovalReopenJournal(root: string, journal: ApprovalReopenJournal): void {
  atomicJson(journalFile(root, journal.session_id), journal);
}

export function removeApprovalReopenJournal(root: string, sessionId: string): void {
  fs.rmSync(journalFile(root, sessionId), { force: true });
}

export function approvalReopenJournalIds(root: string): string[] {
  try {
    return fs.readdirSync(directory(root)).flatMap((name) => {
      const match = /^([a-f0-9]{24})\.reopen-journal\.json$/.exec(name);
      return match?.[1] ? [match[1]] : [];
    });
  } catch {
    return [];
  }
}

export function approvalReopenSessionSnapshot(root: string, sessionId: string): ApprovalSession | null {
  try {
    const value = JSON.parse(fs.readFileSync(journalFile(root, sessionId), "utf8")) as Partial<ApprovalReopenJournal>;
    return isApprovalSession(value.original_session) && value.original_session.session_id === sessionId
      ? value.original_session
      : null;
  } catch {
    return null;
  }
}

export function approvalReopenJournalError(root: string, sessionId: string): string | null {
  return fs.existsSync(journalFile(root, sessionId)) && !readJournal(root, sessionId)
    ? `Approval reopen journal is invalid or unreadable: ${sessionId}`
    : null;
}

export function reconcileApprovalReopen(
  root: string,
  sessionId: string,
  options: { lifecycleLocked?: boolean; restartTrackLockHeld?: string } = {},
): ApprovalReopenReconcileResult {
  if (!fs.existsSync(journalFile(root, sessionId))) return { ok: true, pending: false, session: null };
  const restartTrackId = readJournal(root, sessionId)?.restart_track_id || null;
  let result: ApprovalReopenReconcileResult;
  if (options.lifecycleLocked) {
    result = restartTrackId && options.restartTrackLockHeld !== restartTrackId
      ? {
        ok: false,
        pending: true,
        error: `Reopen recovery for ${restartTrackId} requires the track, index, and event locks`,
      }
      : reconcileUnlocked(root, sessionId);
  } else if (restartTrackId) {
    result = withTrackLock(root, restartTrackId, () => (
      withLock(root, "approval-target-lifecycle", () => (
        withLock(root, "tracks-index", () => (
          withLock(root, CADRE_EVENTS_LOCK, () => {
            const lockedTrackId = readJournal(root, sessionId)?.restart_track_id || null;
            return lockedTrackId === restartTrackId
              ? reconcileUnlocked(root, sessionId)
              : {
                ok: false,
                pending: true,
                error: "Reopen journal mode changed while acquiring restart recovery locks; retry recovery",
              };
          })
        ))
      ))
    )) as unknown as ApprovalReopenReconcileResult;
  } else {
    result = withLock(root, "approval-target-lifecycle", () => {
      const lockedTrackId = readJournal(root, sessionId)?.restart_track_id || null;
      return lockedTrackId
        ? {
          ok: false,
          pending: true,
          error: "Reopen journal became a track restart while acquiring its lifecycle lock; retry recovery",
        }
        : reconcileUnlocked(root, sessionId);
    }) as unknown as ApprovalReopenReconcileResult;
  }
  return result.ok ? result : { ...result, pending: true };
}
