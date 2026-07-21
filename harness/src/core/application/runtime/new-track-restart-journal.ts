import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { errorMessage } from "../../../guards";
import { safeName, utcNow } from "../../infrastructure/runtime/json-store";
import { withLock, withTrackLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import type { CoreResult } from "./contracts";
import { inspectNewTrackTarget } from "./new-track-target-state";
import { CADRE_EVENTS_LOCK } from "./native-state";

interface NewTrackRestartJournal {
  version: 1;
  transaction_id: string;
  track_id: string;
  state: "prepared" | "quarantined" | "indexed" | "committed";
  live_relative: string;
  tombstone_name: string;
  track_fingerprint: string;
  tracks_before: string;
  tracks_after: string;
}

interface RestartTrackIndex {
  version: 1;
  schema: "cadre.tracks_index.v1";
  generated_at: string;
  counts: Record<string, number>;
  tracks: Array<Record<string, unknown>>;
}

export interface NewTrackRestartRecovery {
  ok: boolean;
  pending: boolean;
  error?: string;
}

function directory(root: string): string {
  return path.join(root, "cadre", "local", "newtrack-restarts");
}

function journalFile(root: string, transactionId: string): string {
  return path.join(directory(root), `${transactionId}.json`);
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

function member(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? target : null;
}

function tombstone(root: string, name: string): string | null {
  if (path.basename(name) !== name || !/^[a-f0-9]{24}\.track$/.test(name)) return null;
  const target = path.join(directory(root), name);
  return path.dirname(target) === directory(root) ? target : null;
}

function trackCounts(tracks: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {
    new: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    skipped: 0,
  };
  for (const track of tracks) {
    const status = typeof track.status === "string" ? track.status : "new";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function parseTrackIndex(content: string): RestartTrackIndex | null {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!isDeepStrictEqual(Object.keys(value).sort(), ["counts", "generated_at", "schema", "tracks", "version"])) return null;
    if (value.version !== 1 || value.schema !== "cadre.tracks_index.v1" || typeof value.generated_at !== "string") return null;
    if (!Array.isArray(value.tracks) || !value.tracks.every((track) => track && typeof track === "object" && !Array.isArray(track))) return null;
    const tracks = value.tracks as Array<Record<string, unknown>>;
    const ids = tracks.map((track) => track.track_id);
    if (ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) return null;
    const counts = value.counts;
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
    if (!isDeepStrictEqual(counts, trackCounts(tracks))) return null;
    return value as unknown as RestartTrackIndex;
  } catch {
    return null;
  }
}

function validIndexTransition(beforeContent: string, afterContent: string, trackId: string): boolean {
  const before = parseTrackIndex(beforeContent);
  const after = parseTrackIndex(afterContent);
  if (!before || !after) return false;
  if (before.tracks.filter((track) => track.track_id === trackId).length !== 1) return false;
  const remaining = before.tracks.filter((track) => track.track_id !== trackId);
  return isDeepStrictEqual(after.tracks, remaining) && isDeepStrictEqual(after.counts, trackCounts(remaining));
}

function restartIndexAfter(beforeContent: string, trackId: string): string | null {
  const before = parseTrackIndex(beforeContent);
  if (!before || before.tracks.filter((track) => track.track_id === trackId).length !== 1) return null;
  const tracks = before.tracks.filter((track) => track.track_id !== trackId);
  return `${JSON.stringify({
    version: 1,
    schema: "cadre.tracks_index.v1",
    generated_at: utcNow(),
    counts: trackCounts(tracks),
    tracks,
  }, null, 2)}\n`;
}

function treeFingerprint(directoryPath: string): string | null {
  if (!fs.existsSync(directoryPath)) return null;
  const digest = crypto.createHash("sha256");
  const visit = (current: string, relative: string): boolean => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        digest.update(`D\0${childRelative}\0`);
        if (!visit(child, childRelative)) return false;
      } else if (entry.isFile()) {
        const content = fs.readFileSync(child);
        digest.update(`F\0${childRelative}\0${content.length}\0`);
        digest.update(content);
      } else {
        return false;
      }
    }
    return true;
  };
  return visit(directoryPath, "") ? digest.digest("hex") : null;
}

function readJournal(root: string, file: string): NewTrackRestartJournal | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as NewTrackRestartJournal;
    const valid = value.version === 1
      && /^[a-f0-9]{24}$/.test(value.transaction_id)
      && path.basename(file) === `${value.transaction_id}.json`
      && typeof value.track_id === "string"
      && value.track_id.length > 0
      && (value.state === "prepared" || value.state === "quarantined" || value.state === "indexed" || value.state === "committed")
      && value.live_relative === `cadre/tracks/${safeName(value.track_id)}`
      && value.tombstone_name === `${value.transaction_id}.track`
      && typeof value.track_fingerprint === "string"
      && /^[a-f0-9]{64}$/.test(value.track_fingerprint)
      && typeof value.tracks_before === "string"
      && typeof value.tracks_after === "string"
      && validIndexTransition(value.tracks_before, value.tracks_after, value.track_id);
    return valid && member(root, value.live_relative) && tombstone(root, value.tombstone_name) ? value : null;
  } catch {
    return null;
  }
}

function writeTracks(root: string, content: string): void {
  const result = writeArtifactFilesAtomic(root, [{ path: "cadre/tracks.json", content }], { lock: false });
  if (!result.ok) throw new Error(String(result.error || "Unable to restore track index"));
}

function reconcileOne(root: string, file: string): NewTrackRestartRecovery {
  const journal = readJournal(root, file);
  if (!journal) return { ok: false, pending: true, error: `Invalid newtrack restart journal: ${path.basename(file)}` };
  const live = member(root, journal.live_relative)!;
  const parked = tombstone(root, journal.tombstone_name)!;
  const liveExists = fs.existsSync(live);
  const parkedExists = fs.existsSync(parked);
  try {
    const tracksFile = path.join(root, "cadre", "tracks.json");
    const currentTracks = fs.existsSync(tracksFile) ? fs.readFileSync(tracksFile, "utf8") : null;
    const allowedIndex = journal.state === "prepared"
      ? currentTracks === journal.tracks_before
      : journal.state === "quarantined"
        ? currentTracks === journal.tracks_before || currentTracks === journal.tracks_after
        : currentTracks === journal.tracks_after;
    if (!allowedIndex) {
      return { ok: false, pending: true, error: `Track index changed during restart recovery: ${journal.track_id}` };
    }
    if (liveExists && treeFingerprint(live) !== journal.track_fingerprint) {
      return { ok: false, pending: true, error: `Live track changed during restart recovery: ${journal.track_id}` };
    }
    if (parkedExists && treeFingerprint(parked) !== journal.track_fingerprint) {
      return { ok: false, pending: true, error: `Quarantined track changed during restart recovery: ${journal.track_id}` };
    }
    if (journal.state === "indexed" || journal.state === "committed") {
      if (liveExists) return { ok: false, pending: true, error: `Restarted track unexpectedly reappeared: ${journal.track_id}` };
      if (journal.state === "indexed" && !parkedExists) {
        return { ok: false, pending: true, error: `Indexed restart lost its quarantined track proof: ${journal.track_id}` };
      }
      if (journal.state === "indexed") atomicJson(file, { ...journal, state: "committed" });
      if (parkedExists) fs.rmSync(parked, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      return { ok: true, pending: false };
    }
    if (liveExists && parkedExists) {
      return { ok: false, pending: true, error: `Newtrack restart has both live and quarantined state: ${journal.track_id}` };
    }
    if (!liveExists && parkedExists) {
      fs.mkdirSync(path.dirname(live), { recursive: true });
      fs.renameSync(parked, live);
    } else if (!liveExists) {
      return { ok: false, pending: true, error: `Newtrack restart lost both live and quarantined state: ${journal.track_id}` };
    }
    if (currentTracks !== journal.tracks_before) writeTracks(root, journal.tracks_before);
    fs.rmSync(file, { force: true });
    return { ok: true, pending: false };
  } catch (error) {
    return { ok: false, pending: true, error: errorMessage(error) };
  }
}

function journalFiles(root: string): string[] {
  try {
    return fs.readdirSync(directory(root))
      .filter((name) => /^[a-f0-9]{24}\.json$/.test(name))
      .map((name) => path.join(directory(root), name));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : [path.join(directory(root), "unreadable")];
  }
}

function reconcileWithOperationLocks(root: string, file: string): NewTrackRestartRecovery {
  const initial = readJournal(root, file);
  if (!initial) {
    return withLock(root, "newtrack-restart", () => (
      fs.existsSync(file) ? reconcileOne(root, file) : { ok: true, pending: false }
    )) as unknown as NewTrackRestartRecovery;
  }
  return withTrackLock(root, initial.track_id, () => (
    withLock(root, "approval-target-lifecycle", () => (
      withLock(root, "newtrack-restart", () => (
        withLock(root, "tracks-index", () => (
          withLock(root, CADRE_EVENTS_LOCK, () => {
            if (!fs.existsSync(file)) return { ok: true, pending: false };
            const current = readJournal(root, file);
            if (!current || current.track_id !== initial.track_id) {
              return { ok: false, pending: true, error: `Newtrack restart journal changed while acquiring recovery locks: ${path.basename(file)}` };
            }
            return reconcileOne(root, file);
          })
        ))
      ))
    ))
  )) as unknown as NewTrackRestartRecovery;
}

export function reconcileNewTrackRestarts(root: string): NewTrackRestartRecovery {
  for (let pass = 0; pass < 4; pass += 1) {
    const files = journalFiles(root);
    if (files.length === 0) return { ok: true, pending: false };
    for (const file of files) {
      const result = reconcileWithOperationLocks(root, file);
      if (!result.ok) return result;
    }
  }
  return {
    ok: false,
    pending: true,
    error: "Newtrack restart journals kept changing during recovery; retry after concurrent restarts finish",
  };
}

/** Quarantine and remove a proven pristine track while preserving its exact id. */
export function restartPristineTrack(root: string, trackId: string): CoreResult {
  const recovery = reconcileNewTrackRestarts(root);
  if (!recovery.ok) return { ok: false, recovery_required: true, error: recovery.error };
  return withTrackLock(root, trackId, () => withLock(root, "approval-target-lifecycle", () => (
    withLock(root, "newtrack-restart", () => withLock(root, "tracks-index", () => (
      withLock(root, CADRE_EVENTS_LOCK, () => {
    if (journalFiles(root).length > 0) {
      return {
        ok: false,
        recovery_required: true,
        error: "Another newtrack restart journal appeared while this restart acquired its locks; retry recovery first",
      };
    }
    const current = inspectNewTrackTarget(root, trackId, null, { lifecycleLocked: true });
    if (current.kind !== "pristine_track") {
      return {
        ok: false,
        stage: "newtrack_restart_conflict",
        target_ownership: current,
        error: current.reason || `Track ${trackId} is no longer a proven pristine track`,
      };
    }
    const liveRelative = `cadre/tracks/${safeName(trackId)}`;
    const live = member(root, liveRelative);
    if (!live || !fs.existsSync(live)) return { ok: false, error: `Track target is missing: ${trackId}` };
    const transactionId = crypto.randomBytes(12).toString("hex");
    const tombstoneName = `${transactionId}.track`;
    const parked = tombstone(root, tombstoneName)!;
    const tracksFile = path.join(root, "cadre", "tracks.json");
    if (!fs.existsSync(tracksFile)) {
      return { ok: false, stage: "newtrack_restart_index", error: "Track index is missing; regenerate it before restarting this track" };
    }
    const tracksBefore = fs.readFileSync(tracksFile, "utf8");
    const tracksAfter = restartIndexAfter(tracksBefore, trackId);
    if (!tracksAfter) {
      return { ok: false, stage: "newtrack_restart_index", error: "Track index cannot prove the exact restart transition" };
    }
    const trackFingerprint = treeFingerprint(live);
    if (!trackFingerprint) {
      return { ok: false, stage: "newtrack_restart_identity", error: "Track tree cannot be fingerprinted safely for restart" };
    }
    let journal: NewTrackRestartJournal = {
      version: 1,
      transaction_id: transactionId,
      track_id: trackId,
      state: "prepared",
      live_relative: liveRelative,
      tombstone_name: tombstoneName,
      track_fingerprint: trackFingerprint,
      tracks_before: tracksBefore,
      tracks_after: tracksAfter,
    };
    const file = journalFile(root, transactionId);
    try {
      atomicJson(file, journal);
      fs.mkdirSync(directory(root), { recursive: true });
      fs.renameSync(live, parked);
      journal = { ...journal, state: "quarantined" };
      atomicJson(file, journal);
      writeTracks(root, tracksAfter);
      journal = { ...journal, state: "indexed" };
      atomicJson(file, journal);
      journal = { ...journal, state: "committed" };
      atomicJson(file, journal);
      fs.rmSync(parked, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      return { ok: true, restarted: true, track_id: trackId, reused_id: true };
    } catch (error) {
      const reconciled = reconcileOne(root, file);
      return {
        ok: false,
        recovery_required: !reconciled.ok || reconciled.pending,
        error: [errorMessage(error), reconciled.error].filter(Boolean).join("; "),
      };
    }
      })
    )))
  ))) as CoreResult;
}
