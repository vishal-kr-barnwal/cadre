import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { asOptionalString, errorMessage } from "../../../guards";
import { textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { withLock, withTrackLock } from "../../infrastructure/runtime/locking";
import { gitIdentity } from "../../infrastructure/runtime/system";
import type { CoreResult } from "./contracts";
import {
  isStageLedgerSession,
  synchronizeApprovalSession,
  type ApprovalBeforeFile,
  type ApprovalSession,
} from "./approval-session-model";
import {
  approvalHeadExpectation,
  readApprovalSessionResult,
  writeApprovalSession,
} from "./approval-session-store";
import {
  reconcileApprovalReopen,
  removeApprovalReopenJournal,
  writeApprovalReopenJournal,
  type ApprovalReopenBundleTarget,
  type ApprovalReopenJournal,
  type ApprovalReopenSideEffectTarget,
} from "./approval-reopen-journal";
import {
  inspectReviewGitState,
  removeReviewIntentToAddAtomic,
  type ReviewHeadExpectation,
} from "./review-output";
import { removeEmptyApprovalParents } from "./approval-session-ancillary";
import { CADRE_EVENTS_LOCK } from "./native-state";
import { trackIndexPayload } from "./status";
import { listTracks } from "./track-schedule";
import { inspectNewTrackTarget, newTrackRestartSafetyError } from "./new-track-target-state";

interface RestoreEntry {
  path: string;
  target: string;
  before: string | null;
  preview: string;
}

function safeTarget(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? target : null;
}

function fileContent(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function restoreFile(file: string, content: string | null): void {
  if (content === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.reopen-tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function beforeMap(session: ApprovalSession): Map<string, ApprovalBeforeFile> {
  return new Map(session.before_files.map((entry) => [entry.path, entry]));
}

function bundleDirectory(reviewPath: string, relativePath: string): string | null {
  const suffix = relativePath.split(/[\\/]+/).join(path.sep);
  const absolute = path.resolve(reviewPath);
  const ending = `${path.sep}${suffix}`;
  return absolute.endsWith(ending) ? absolute.slice(0, -ending.length) : null;
}

/** Rewind an approved stage and every dependent stage without changing session identity. */
export function reopenApprovalStage(
  root: string,
  sessionId: string,
  expectedWorkflow: string,
  stageId: string,
  options: { allowUnapproved?: boolean; restartTrackId?: string } = {},
): CoreResult {
  const reopen = (): CoreResult => {
    const read = readApprovalSessionResult(root, sessionId, {
      lifecycleLocked: true,
      ...(options.restartTrackId ? { restartTrackLockHeld: options.restartTrackId } : {}),
    });
    if (read.recovery_required) {
      return {
        ok: false,
        reopened: false,
        recovery_required: true,
        stage: "approval_reopen_recovery",
        error: read.error || "Approval recovery must complete before reopening a stage",
      };
    }
    const session = read.session;
    if (!session || session.workflow !== expectedWorkflow) {
      return { ok: false, reopened: false, error: `Approval session was not found for ${expectedWorkflow}.` };
    }
    if (!isStageLedgerSession(session)) {
      return { ok: false, reopened: false, error: "Legacy approval sessions cannot reopen stages; cancel and restart review." };
    }
    if (options.restartTrackId) {
      const targetState = inspectNewTrackTarget(root, options.restartTrackId, sessionId, { lifecycleLocked: true });
      const safety = newTrackRestartSafetyError(root, options.restartTrackId);
      if ((targetState.kind !== "vacant" && targetState.kind !== "owned_draft") || safety) {
        return {
          ok: false,
          reopened: false,
          stage: "newtrack_restart_conflict",
          error: safety || targetState.reason || "Newtrack target changed before restart could acquire its lifecycle lock.",
        };
      }
    }
    const stageOrder = session.stage_order || [];
    const stageIndex = stageOrder.indexOf(stageId);
    if (stageIndex < 0) return { ok: false, reopened: false, error: `Unknown approval stage: ${stageId}` };
    if (!session.approved_stages.includes(stageId) && options.allowUnapproved !== true) {
      return { ok: false, reopened: false, error: `Approval stage ${stageId} is not approved; amend the active stage instead.` };
    }

    const affectedIds = stageOrder.slice(stageIndex);
    const affectedRecords = affectedIds.flatMap((id) => {
      const record = session.stage_records?.[id];
      return record ? [record] : [];
    });
    const snapshots = new Map([
      ...affectedRecords.flatMap((record) => record.snapshot_files.map((file) => [file.path, file] as const)),
      ...(session.final_snapshot_files || []).map((file) => [file.path, file] as const),
    ]);
    const befores = beforeMap(session);
    const outputMode = asOptionalString(session.payload.reviewOutputMode || session.payload.review_output_mode);
    const explicitBundle = asOptionalString(session.payload.reviewBundleDir || session.payload.review_bundle_dir
      || session.payload.reviewDir || session.payload.review_dir);
    const targetMode = !explicitBundle && !["bundle", "temp", "temporary"].includes(outputMode || "");
    const previewPaths = new Set(
      (session.materialized_target_paths || []).filter((relativePath) => snapshots.has(relativePath)),
    );
    if (targetMode) {
      for (const record of affectedRecords) {
        for (const file of record.preview_files) {
          const value = asOptionalString(file.path);
          if (value && file.missing !== true) previewPaths.add(value);
        }
      }
    }
    const restoreEntries: RestoreEntry[] = [];
    const expectations: ReviewHeadExpectation[] = [];
    for (const relativePath of previewPaths) {
      const snapshot = snapshots.get(relativePath);
      const before = befores.get(relativePath);
      const target = safeTarget(root, relativePath);
      if (!snapshot || !before || !target) {
        return { ok: false, reopened: false, error: `Approval stage has an invalid restore record for ${relativePath}.` };
      }
      const current = fileContent(target);
      if (current !== snapshot.content) {
        return {
          ok: false,
          reopened: false,
          stage: "approval_reopen_drift",
          path: relativePath,
          error: `Review target changed after Cadre created it: ${relativePath}`,
        };
      }
      restoreEntries.push({ path: relativePath, target, before: before.existed ? before.content : null, preview: current });
      expectations.push(approvalHeadExpectation(before));
    }
    const bundleTargets = new Map<string, ApprovalReopenBundleTarget>();
    if (!targetMode) {
      const invalidatedByDirectory = new Map<string, Set<string>>();
      for (const record of affectedRecords) {
        for (const preview of record.preview_files) {
          const relativePath = asOptionalString(preview.path);
          const reviewPath = asOptionalString(preview.review_path);
          const snapshot = relativePath ? snapshots.get(relativePath) : null;
          const directory = relativePath && reviewPath ? bundleDirectory(reviewPath, relativePath) : null;
          if (!relativePath || !reviewPath || !snapshot || !directory) {
            return { ok: false, reopened: false, error: `Approval stage has an invalid bundle restore record for ${relativePath || "(missing path)"}.` };
          }
          const current = fileContent(reviewPath);
          if (current !== snapshot.content) {
            return {
              ok: false,
              reopened: false,
              stage: "approval_reopen_bundle_drift",
              path: reviewPath,
              error: `Review bundle changed after Cadre created it: ${relativePath}`,
            };
          }
          bundleTargets.set(path.resolve(reviewPath), { path: path.resolve(reviewPath), before: current, after: null });
          const paths = invalidatedByDirectory.get(directory) || new Set<string>();
          paths.add(relativePath);
          invalidatedByDirectory.set(directory, paths);
        }
      }
      for (const [directory, invalidated] of invalidatedByDirectory) {
        const manifestPath = path.join(directory, "manifest.json");
        const current = fileContent(manifestPath);
        if (current === null) return { ok: false, reopened: false, error: `Review bundle manifest is missing: ${manifestPath}` };
        let manifest: Record<string, unknown>;
        try {
          manifest = JSON.parse(current) as Record<string, unknown>;
        } catch {
          return { ok: false, reopened: false, error: `Review bundle manifest is invalid: ${manifestPath}` };
        }
        if (manifest.root !== root || manifest.workflow !== expectedWorkflow || !Array.isArray(manifest.files)) {
          return { ok: false, reopened: false, error: `Review bundle manifest does not belong to ${expectedWorkflow}: ${manifestPath}` };
        }
        manifest.files = manifest.files.filter((entry) => {
          const file = entry && typeof entry === "object" && !Array.isArray(entry)
            ? entry as Record<string, unknown>
            : {};
          return typeof file.path !== "string" || !invalidated.has(file.path);
        });
        bundleTargets.set(manifestPath, {
          path: manifestPath,
          before: current,
          after: `${JSON.stringify(manifest, null, 2)}\n`,
        });
      }
    }
    const sideEffectTargets: ApprovalReopenSideEffectTarget[] = [];
    if (options.restartTrackId) {
      const payloadTrackId = asOptionalString(session.payload.trackId || session.payload.track_id);
      if (expectedWorkflow !== "newtrack" || stageIndex !== 0 || payloadTrackId !== options.restartTrackId) {
        return { ok: false, reopened: false, error: "Newtrack restart identity does not match its approval session." };
      }
      const indexBefore = fileContent(path.join(root, "cadre", "tracks.json"));
      const remaining = listTracks(root).filter((track) => track.track_id !== options.restartTrackId);
      const indexAfter = `${JSON.stringify(trackIndexPayload(root, remaining), null, 2)}\n`;
      sideEffectTargets.push({ path: "cadre/tracks.json", before: indexBefore, after: indexAfter });

      const eventsBefore = fileContent(path.join(root, "cadre", "events.jsonl"));
      const retained = (eventsBefore || "").split(/\r?\n/).filter(Boolean).filter((line) => {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          return event.approval_session_id !== sessionId
            || !["track_created", "formula_poured", "approval.completed"].includes(String(event.kind || ""));
        } catch {
          return true;
        }
      });
      const recordedAt = utcNow();
      const audit = {
        version: 1,
        schema: "cadre.event.v1",
        id: `evt_restart_${textHash(`${sessionId}:${recordedAt}`).slice(0, 16)}`,
        kind: "track_restarted",
        workflow: "newtrack",
        track_id: options.restartTrackId,
        approval_session_id: sessionId,
        recorded_at: recordedAt,
        actor: gitIdentity(root) || null,
        nonce: crypto.randomBytes(6).toString("hex"),
      };
      const eventsAfter = `${[...retained, JSON.stringify(audit)].join("\n")}\n`;
      sideEffectTargets.push({ path: "cadre/events.jsonl", before: eventsBefore, after: eventsAfter });
    }

    const gitState = inspectReviewGitState(root, restoreEntries.map((entry) => entry.path), expectations);
    if (!gitState.ok) {
      return {
        ok: false,
        reopened: false,
        stage: "approval_reopen_git_drift",
        error: gitState.error || "A reopened review target has staged or committed changes",
        staged_paths: gitState.stagedPaths,
        baseline_paths: gitState.baselinePaths,
      };
    }

    const affectedIntent = targetMode
      ? Array.from(new Set([
        ...affectedRecords.flatMap((record) => record.intent_to_add_paths),
        ...(session.final_intent_to_add_paths || []),
      ]))
      : [];
    const stageRecords = { ...session.stage_records };
    for (const id of affectedIds) {
      const record = stageRecords[id];
      if (!record) continue;
      stageRecords[id] = {
        ...record,
        status: "pending",
        snapshot_files: [],
        before_files: [],
        preview_files: [],
        intent_to_add_paths: [],
      };
    }
    const updated = synchronizeApprovalSession({
      ...session,
      approved_stages: stageOrder.slice(0, stageIndex),
      stage_records: stageRecords,
      final_snapshot_files: [],
      final_before_files: [],
      final_preview_files: [],
      final_intent_to_add_paths: [],
      materialized_target_paths: (session.materialized_target_paths || [])
        .filter((relativePath) => !snapshots.has(relativePath)),
      updated_at: new Date().toISOString(),
    });
    let journal: ApprovalReopenJournal = {
      version: 1,
      session_id: sessionId,
      state: "prepared",
      original_session: session,
      updated_session: updated,
      targets: restoreEntries.map((entry) => ({ path: entry.path, before: entry.before, preview: entry.preview })),
      bundle_targets: Array.from(bundleTargets.values()),
      restart_track_id: options.restartTrackId || null,
      side_effect_targets: sideEffectTargets,
      intent_to_add_paths: affectedIntent,
    };
    try {
      writeApprovalReopenJournal(root, journal);
      journal = { ...journal, state: "restoring" };
      writeApprovalReopenJournal(root, journal);
      const intentRemoval = removeReviewIntentToAddAtomic(root, affectedIntent);
      if (!intentRemoval.ok) throw new Error(intentRemoval.error || "Unable to remove reopened Git intent-to-add paths");
      for (const entry of restoreEntries) {
        restoreFile(entry.target, entry.before);
        if (entry.before === null) removeEmptyApprovalParents(root, entry.target);
      }
      for (const target of bundleTargets.values()) restoreFile(target.path, target.after);
      for (const target of sideEffectTargets) restoreFile(path.join(root, target.path), target.after);
      journal = { ...journal, state: "restored" };
      writeApprovalReopenJournal(root, journal);
      writeApprovalSession(root, updated);
      removeApprovalReopenJournal(root, sessionId);
      return {
        ok: true,
        reopened: true,
        session_id: sessionId,
        reopened_stage: stageId,
        approved_stages: updated.approved_stages,
        invalidated_stages: affectedIds,
        restored: restoreEntries.filter((entry) => entry.before !== null).map((entry) => entry.path),
        removed: restoreEntries.filter((entry) => entry.before === null).map((entry) => entry.path),
        intent_to_add_removed: affectedIntent,
      };
    } catch (error) {
      const recovered = reconcileApprovalReopen(root, sessionId, {
        lifecycleLocked: true,
        ...(options.restartTrackId ? { restartTrackLockHeld: options.restartTrackId } : {}),
      });
      return {
        ok: false,
        reopened: false,
        recovery_required: !recovered.ok || recovered.pending,
        stage: "approval_reopen_transaction",
        error: [errorMessage(error), recovered.error].filter(Boolean).join("; "),
      };
    }
  };
  const lifecycle = (): CoreResult => withLock(root, "approval-target-lifecycle", () => (
    options.restartTrackId
      ? withLock(root, "tracks-index", () => withLock(root, CADRE_EVENTS_LOCK, reopen))
      : reopen()
  )) as CoreResult;
  return options.restartTrackId
    ? withTrackLock(root, options.restartTrackId, lifecycle) as CoreResult
    : lifecycle();
}
