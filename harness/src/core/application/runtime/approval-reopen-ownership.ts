import path from "node:path";

import { asOptionalString } from "../../../guards";
import {
  isStageLedgerSession,
  synchronizeApprovalSession,
  type ApprovalSession,
  type ApprovalStageRecord,
} from "./approval-session-model";
import type { ApprovalReopenJournal } from "./approval-reopen-journal";

function targetMode(session: ApprovalSession): boolean {
  const outputMode = asOptionalString(session.payload.reviewOutputMode || session.payload.review_output_mode);
  const directory = asOptionalString(
    session.payload.reviewBundleDir || session.payload.review_bundle_dir
      || session.payload.reviewDir || session.payload.review_dir,
  );
  return !directory && !["bundle", "temp", "temporary"].includes(outputMode || "");
}

function resetRecord(record: ApprovalStageRecord): ApprovalStageRecord {
  return {
    ...record,
    status: "pending",
    snapshot_files: [],
    before_files: [],
    preview_files: [],
    intent_to_add_paths: [],
  };
}

function exactSet(left: string[], right: string[]): boolean {
  return left.length === new Set(left).size
    && right.length === new Set(right).size
    && left.length === right.length
    && left.every((entry) => right.includes(entry));
}

function expectedManifestContent(before: string, invalidatedPaths: Set<string>): string | null {
  try {
    const manifest = JSON.parse(before) as Record<string, unknown>;
    if (!Array.isArray(manifest.files)) return null;
    manifest.files = manifest.files.filter((entry) => {
      const file = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      return typeof file.path !== "string" || !invalidatedPaths.has(file.path);
    });
    return `${JSON.stringify(manifest, null, 2)}\n`;
  } catch {
    return null;
  }
}

function bundleDirectory(reviewPath: string, relativePath: string): string | null {
  const suffix = relativePath.split(/[\\/]+/).join(path.sep);
  const absolute = path.resolve(reviewPath);
  const ending = `${path.sep}${suffix}`;
  return absolute.endsWith(ending) ? absolute.slice(0, -ending.length) : null;
}

function validRestartIndex(before: string | null, after: string, trackId: string): boolean {
  try {
    const prior = before ? JSON.parse(before) as Record<string, unknown> : {};
    const next = JSON.parse(after) as Record<string, unknown>;
    const priorTracks = Array.isArray(prior.tracks) ? prior.tracks : [];
    const nextTracks = Array.isArray(next.tracks) ? next.tracks : [];
    const expected = priorTracks.filter((entry) => {
      const row = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      return row.track_id !== trackId;
    });
    if (JSON.stringify(nextTracks) !== JSON.stringify(expected)) return false;
    if (next.schema !== "cadre.tracks_index.v1") return false;
    const counts: Record<string, number> = { new: 0, in_progress: 0, completed: 0, blocked: 0, skipped: 0 };
    for (const entry of nextTracks) {
      const row = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      const status = typeof row.status === "string" ? row.status : "new";
      counts[status] = (counts[status] || 0) + 1;
    }
    return JSON.stringify(next.counts) === JSON.stringify(counts);
  } catch {
    return false;
  }
}

function validRestartEvents(before: string | null, after: string, sessionId: string, trackId: string): boolean {
  const priorLines = (before || "").split(/\r?\n/).filter(Boolean);
  const retained = priorLines.filter((line) => {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      return event.approval_session_id !== sessionId
        || !["track_created", "formula_poured", "approval.completed"].includes(String(event.kind || ""));
    } catch {
      return true;
    }
  });
  const nextLines = after.split(/\r?\n/).filter(Boolean);
  if (nextLines.length !== retained.length + 1
    || JSON.stringify(nextLines.slice(0, -1)) !== JSON.stringify(retained)) return false;
  try {
    const audit = JSON.parse(nextLines.at(-1) || "{}") as Record<string, unknown>;
    return audit.schema === "cadre.event.v1"
      && audit.kind === "track_restarted"
      && audit.track_id === trackId
      && audit.approval_session_id === sessionId
      && typeof audit.id === "string"
      && typeof audit.recorded_at === "string";
  } catch {
    return false;
  }
}

function sameSession(left: ApprovalSession, right: ApprovalSession): boolean {
  return JSON.stringify(synchronizeApprovalSession(left)) === JSON.stringify(synchronizeApprovalSession(right));
}

export function approvalReopenJournalOwnershipError(root: string, journal: ApprovalReopenJournal): string | null {
  const original = synchronizeApprovalSession(journal.original_session);
  const updated = synchronizeApprovalSession(journal.updated_session);
  if (!isStageLedgerSession(original) || !isStageLedgerSession(updated)) {
    return "Reopen journal requires stage-ledger sessions";
  }
  if (original.workflow !== updated.workflow
    || original.payload_hash !== updated.payload_hash
    || JSON.stringify(original.payload) !== JSON.stringify(updated.payload)
    || JSON.stringify(original.stage_order) !== JSON.stringify(updated.stage_order)) {
    return "Reopen journal changes immutable approval identity";
  }
  const order = original.stage_order || [];
  const cutoff = order.findIndex((stageId) => (
    JSON.stringify(original.stage_records?.[stageId]) !== JSON.stringify(updated.stage_records?.[stageId])
  ));
  if (cutoff < 0) return "Reopen journal does not invalidate an approval stage";
  if (!original.approved_stages.includes(order[cutoff]!) && !(original.workflow === "newtrack" && cutoff === 0)) {
    return "Reopen journal invalidates an unapproved stage";
  }
  const expectedRecords = { ...original.stage_records };
  for (const stageId of order.slice(cutoff)) {
    const record = expectedRecords[stageId];
    if (!record) return `Reopen journal is missing stage record: ${stageId}`;
    expectedRecords[stageId] = resetRecord(record);
  }
  const affectedSnapshots = [
    ...order.slice(cutoff).flatMap((stageId) => original.stage_records?.[stageId]?.snapshot_files || []),
    ...(original.final_snapshot_files || []),
  ];
  const affectedPaths = new Set(affectedSnapshots.map((file) => file.path));
  const expected = synchronizeApprovalSession({
    ...original,
    approved_stages: order.slice(0, cutoff),
    stage_records: expectedRecords,
    final_snapshot_files: [],
    final_before_files: [],
    final_preview_files: [],
    final_intent_to_add_paths: [],
    materialized_target_paths: (original.materialized_target_paths || [])
      .filter((relativePath) => !affectedPaths.has(relativePath)),
    updated_at: updated.updated_at,
  });
  if (!sameSession(expected, updated)) return "Reopen journal has an invalid approval-state transition";

  const snapshotByPath = new Map(affectedSnapshots.map((file) => [file.path, file]));
  const beforeByPath = new Map(original.before_files.map((file) => [file.path, file]));
  const expectedTargetPaths = new Set(
    (original.materialized_target_paths || []).filter((relativePath) => affectedPaths.has(relativePath)),
  );
  const expectedIntent = targetMode(original)
    ? Array.from(new Set([
      ...order.slice(cutoff).flatMap((stageId) => original.stage_records?.[stageId]?.intent_to_add_paths || []),
      ...(original.final_intent_to_add_paths || []),
    ]))
    : [];
  if (targetMode(original)) {
    for (const stageId of order.slice(cutoff)) {
      for (const preview of original.stage_records?.[stageId]?.preview_files || []) {
        const relativePath = asOptionalString(preview.path);
        if (relativePath && preview.missing !== true) expectedTargetPaths.add(relativePath);
      }
    }
  }
  if (!exactSet(journal.intent_to_add_paths, expectedIntent)) {
    return "Reopen journal Git intent does not match the invalidated stages";
  }
  if (!exactSet(journal.targets.map((target) => target.path), Array.from(expectedTargetPaths))) {
    return "Reopen journal targets do not match the invalidated materialized files";
  }
  for (const target of journal.targets) {
    const snapshot = snapshotByPath.get(target.path);
    const before = beforeByPath.get(target.path);
    if (!snapshot || snapshot.missing === true || !before) {
      return `Reopen journal does not own target: ${target.path}`;
    }
    if (target.preview !== snapshot.content || target.before !== (before.existed ? before.content : null)) {
      return `Reopen journal target does not match its approval snapshot: ${target.path}`;
    }
  }

  const expectedBundleFiles = new Map<string, { before: string; relativePath: string; directory: string }>();
  if (!targetMode(original)) {
    for (const stageId of order.slice(cutoff)) {
      for (const preview of original.stage_records?.[stageId]?.preview_files || []) {
        const relativePath = asOptionalString(preview.path);
        const reviewPath = asOptionalString(preview.review_path);
        const snapshot = relativePath ? snapshotByPath.get(relativePath) : null;
        const directory = relativePath && reviewPath ? bundleDirectory(reviewPath, relativePath) : null;
        if (!relativePath || !reviewPath || !snapshot || !directory) {
          return `Reopen journal cannot prove bundle ownership for ${relativePath || "(missing path)"}`;
        }
        expectedBundleFiles.set(path.resolve(reviewPath), { before: snapshot.content, relativePath, directory });
      }
    }
  }
  const bundleTargets = new Map(journal.bundle_targets.map((target) => [path.resolve(target.path), target]));
  const bundleDirectories = new Map<string, Set<string>>();
  for (const [file, expectedFile] of expectedBundleFiles) {
    const candidate = bundleTargets.get(file);
    if (!candidate || candidate.before !== expectedFile.before || candidate.after !== null) {
      return `Reopen bundle target does not match its approval preview: ${file}`;
    }
    const paths = bundleDirectories.get(expectedFile.directory) || new Set<string>();
    paths.add(expectedFile.relativePath);
    bundleDirectories.set(expectedFile.directory, paths);
  }
  for (const [directory, invalidated] of bundleDirectories) {
    const manifestPath = path.join(directory, "manifest.json");
    const manifest = bundleTargets.get(manifestPath);
    if (!manifest || manifest.before === null || manifest.after === null) {
      return `Reopen bundle journal is missing its manifest: ${manifestPath}`;
    }
    const parsed = JSON.parse(manifest.before) as Record<string, unknown>;
    if (parsed.root !== root || parsed.workflow !== original.workflow) {
      return `Reopen bundle manifest does not belong to ${original.workflow}`;
    }
    if (manifest.after !== expectedManifestContent(manifest.before, invalidated)) {
      return `Reopen bundle manifest transition is invalid: ${manifestPath}`;
    }
  }
  const expectedBundlePaths = new Set([
    ...expectedBundleFiles.keys(),
    ...Array.from(bundleDirectories.keys()).map((directory) => path.join(directory, "manifest.json")),
  ]);
  if (!exactSet(Array.from(bundleTargets.keys()), Array.from(expectedBundlePaths))) {
    return "Reopen bundle targets do not exactly match invalidated review files";
  }

  if (journal.restart_track_id === null) {
    if (journal.side_effect_targets.length > 0) return "Non-restart reopen journal contains side effects";
  } else {
    const trackId = asOptionalString(original.payload.trackId || original.payload.track_id);
    if (original.workflow !== "newtrack" || cutoff !== 0 || trackId !== journal.restart_track_id) {
      return "Reopen journal has an invalid newtrack restart identity";
    }
    const sideEffects = new Map(journal.side_effect_targets.map((target) => [target.path, target]));
    if (!exactSet(Array.from(sideEffects.keys()), ["cadre/tracks.json", "cadre/events.jsonl"])) {
      return "Newtrack restart journal has an invalid side-effect set";
    }
    const index = sideEffects.get("cadre/tracks.json")!;
    const events = sideEffects.get("cadre/events.jsonl")!;
    if (!validRestartIndex(index.before, index.after, trackId)
      || !validRestartEvents(events.before, events.after, original.session_id, trackId)) {
      return "Newtrack restart journal has invalid index or event compensation";
    }
  }
  return null;
}
