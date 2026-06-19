import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { beadsTaskWrite } from "./beads-task-write";
import { BeadsCompletionState, CoreResult, CoverageResult } from "./contracts";
import { coverageThreshold, runCoverage } from "../../infrastructure/runtime/coverage";
import { readJson, utcNow } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { patchCompletionJournal, prepareManualVerificationCompletion, readCompletionJournal } from "./manual-verification";
import { isManualVerificationTaskObject } from "./plan-docs";
import { isWorkingRootError, resolveTaskWorkingRoot } from "./repo-resolution";
import { commandExists } from "../../infrastructure/runtime/system";
import { findTrack } from "./track-context";
import { recordTaskResultUnlocked } from "./track-mutations";
import { parsePlanFile } from "./track-schedule";
import { withSharedControlPlaneSync } from "./workflow-response";

export function completeTask(root: string, args: RuntimeArgs = {}): CoreResult {
  return withSharedControlPlaneSync(root, args, "complete_task", () => completeTaskInner(root, { ...args, skipSync: true }));
}

export function completeTaskInner(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const plan = parsePlanFile(track.plan_path);
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };

  const workingRoot = resolveTaskWorkingRoot(root, track, task, args);
  if (isWorkingRootError(workingRoot)) {
    return {
      ok: false,
      stage: "polyrepo_repo_resolution",
      blocked: true,
      working_root: workingRoot,
      reason: workingRoot.error,
    };
  }
  const manualVerificationTask = isManualVerificationTaskObject(task);
  const manualVerificationCompletion = manualVerificationTask
    ? prepareManualVerificationCompletion(root, track, task, args, workingRoot)
    : null;
  if (manualVerificationCompletion && manualVerificationCompletion.ok === false) return manualVerificationCompletion;
  const manualVerificationEvidence = manualVerificationCompletion && isRecord(manualVerificationCompletion.evidence)
    ? asJsonObject(manualVerificationCompletion.evidence)
    : null;
  const coverage: CoverageResult = manualVerificationTask
    ? {
        ok: true,
        available: false,
        command: null,
        coverage: null,
        reason: "Manual verification task uses structured human-approved evidence instead of coverage.",
      }
    : runCoverage(root, args, workingRoot.path);
  const threshold = Number(args.coverageThreshold ?? coverageThreshold(root));
  const allowMissingCoverage = args.allowMissingCoverage === true;
  const allowLowCoverage = args.allowLowCoverage === true;
  if (!manualVerificationTask && !coverage.available && !allowMissingCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: coverage.reason || "Coverage command unavailable",
    };
  }
  if (!manualVerificationTask && coverage.available && !coverage.ok) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: "Coverage/test command failed; task was not marked complete",
    };
  }
  if (!manualVerificationTask && coverage.available && typeof coverage.coverage === "number" && coverage.coverage < threshold && !allowLowCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: `Coverage ${coverage.coverage}% is below required ${threshold}%; task was not marked complete`,
    };
  }

  const metadataBefore = readJson<TrackMetadata>(track.metadata_path, track.metadata) || track.metadata;
  const mappedBeadsTaskId = metadataBefore.beads_tasks ? asOptionalString(metadataBefore.beads_tasks[task.task_key]) || null : null;
  const explicitBeadsTaskId = args.beadsTaskId || args.taskId || null;
  const beadsTaskId = explicitBeadsTaskId || mappedBeadsTaskId;
  const beadsConfigured = Boolean(
    explicitBeadsTaskId ||
    metadataBefore.beads_epic ||
    (metadataBefore.beads_tasks && Object.keys(metadataBefore.beads_tasks).length > 0)
  );
  const beadsAvailable = commandExists("bd", root);
  const beads: BeadsCompletionState = {
    attempted: false,
    required: beadsConfigured,
    available: beadsAvailable,
    note: null,
    close: null,
    skipped_reason: null,
  };
  if (beadsConfigured && !beadsTaskId) {
    return {
      ok: false,
      stage: "beads_mapping",
      blocked: true,
      threshold,
      working_root: workingRoot,
      coverage,
      beads,
      reason: "Track has Beads metadata but this plan task has no mapped Beads task id; task was not marked complete",
    };
  }
  if (beadsTaskId && !beadsAvailable) {
    return {
      ok: false,
      stage: "beads_unavailable",
      blocked: true,
      threshold,
      working_root: workingRoot,
      coverage,
      beads,
      reason: "Beads CLI (bd) is required for this mapped task but is not installed or not on PATH; task was not marked complete",
    };
  }
  if (!beadsConfigured) {
    beads.skipped_reason = "Track has no Beads task mapping";
  } else {
    beads.attempted = true;
  }

  const lastTestRun = manualVerificationTask ? null : {
    command: coverage.command,
    cwd: coverage.cwd || workingRoot.path,
    ok: coverage.available ? coverage.ok : null,
    status: coverage.available ? coverage.status : null,
    signal: coverage.available ? coverage.signal : null,
    coverage: coverage.coverage,
    threshold,
    measured_at: utcNow(),
    allow_missing_coverage: allowMissingCoverage,
    allow_low_coverage: allowLowCoverage,
  };
  const sha = args.commitSha ? String(args.commitSha).slice(0, 12) : "unknown";
  const dedupKey = `key: ${track.track_id}:p${phaseIndex}:t${taskIndex}:${sha.slice(0, 7)}`;
  const journalKey = `${phaseIndex}:${taskIndex}:${sha}`;
  const recordState = (): CoreResult => {
    const entry = patchCompletionJournal(track, journalKey, (current) => ({
      ...current,
      stage: current.stage || "started",
      track_id: track.track_id,
      phase_index: phaseIndex,
      task_index: taskIndex,
      task_key: task.task_key,
      commit_sha: sha,
      dedup_key: dedupKey,
      started_at: current.started_at || utcNow(),
    }));
    const taskResult = recordTaskResultUnlocked(root, {
      trackId: args.trackId,
      phaseIndex,
      taskIndex,
      status: args.status || "completed",
      commitSha: args.commitSha,
      coverage: coverage.coverage,
      repo: workingRoot.repo,
      workingRoot: path.relative(root, workingRoot.path) || ".",
      ...(lastTestRun ? { lastTestRun } : {}),
      ...(manualVerificationEvidence ? { manualVerificationEvidence } : {}),
    });
    if (!taskResult.ok) {
      patchCompletionJournal(track, journalKey, (current) => ({
        ...current,
        stage: "record_task_result_failed",
        error: taskResult.error || asOptionalString(taskResult.stage) || "record task result failed",
      }));
      return { ok: false, stage: "record_task_result", threshold, working_root: workingRoot, coverage, task_result: taskResult, beads, journal: entry };
    }
    const taskResultJson = asJsonObject(taskResult);
    const recordedEntry = patchCompletionJournal(track, journalKey, (current) => ({
      ...current,
      stage: "state_recorded",
      state_recorded_at: utcNow(),
      task_result: {
        task_key: taskResultJson.task_key,
        commit_sha: taskResultJson.commit_sha,
        line: taskResultJson.line,
      },
    }));
    return { ok: true, task_result: taskResult, journal: recordedEntry };
  };
  const stateResult = args.lock === false
    ? recordState()
    : withTrackLock(root, track.track_id, recordState);
  if (!stateResult.ok) return { ...stateResult, threshold, working_root: workingRoot, coverage, beads };
  const stateTaskResult = asJsonObject(stateResult.task_result);

  if (beadsTaskId) {
    const latest = readCompletionJournal(track).entries[journalKey] || {};
    if (!latest.beads_note_written) {
      const note = [
        dedupKey,
        `COMPLETED: ${task.title}`,
        `COMMIT: ${sha}`,
        `COVERAGE: ${coverage.coverage == null ? "unmeasured" : `${coverage.coverage}%`}`,
        args.summary ? `SUMMARY: ${args.summary}` : null,
      ].filter(Boolean).join("\n");
      const noteResult = beadsTaskWrite(root, { operation: "note", id: beadsTaskId, note, dedupKey });
      beads.note = noteResult;
      if (!noteResult.ok) return { ok: false, stage: "beads_note", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads, journal: latest };
      const writeNote = () => patchCompletionJournal(track, journalKey, (current) => ({
        ...current,
        stage: "beads_note_written",
        beads_note_written: true,
        beads_note_at: utcNow(),
      }));
      if (args.lock === false) writeNote();
      else {
        const noteJournal = withTrackLock(root, track.track_id, writeNote);
        if (!noteJournal.ok) return { ...noteJournal, stage: "journal_note", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads };
      }
    } else {
      beads.note = { ok: true, skipped: true, reason: "completion journal already recorded Beads note" };
    }

    const afterNote = readCompletionJournal(track).entries[journalKey] || {};
    if (!afterNote.beads_close_written) {
      const closeResult = beadsTaskWrite(root, {
        operation: "close",
        id: beadsTaskId,
        continue: true,
        reason: args.reason || `commit: ${args.commitSha || "completed"}`,
      });
      beads.close = closeResult;
      if (!closeResult.ok) return { ok: false, stage: "beads_close", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads, journal: afterNote };
      const writeClose = () => patchCompletionJournal(track, journalKey, (current) => ({
        ...current,
        stage: "beads_closed",
        beads_close_written: true,
        beads_close_at: utcNow(),
      }));
      if (args.lock === false) writeClose();
      else {
        const closeJournal = withTrackLock(root, track.track_id, writeClose);
        if (!closeJournal.ok) return { ...closeJournal, stage: "journal_close", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads };
      }
    } else {
      beads.close = { ok: true, skipped: true, reason: "completion journal already recorded Beads close" };
    }
  }

  const markComplete = () => patchCompletionJournal(track, journalKey, (current) => ({
    ...current,
    stage: "completed",
    completed_at: current.completed_at || utcNow(),
  }));
  const completedJournal = args.lock === false
    ? markComplete()
    : withTrackLock(root, track.track_id, markComplete);

  return {
    ok: true,
    track_id: track.track_id,
    task_key: stateTaskResult.task_key,
    working_root: workingRoot,
    threshold,
    coverage,
    task_result: stateTaskResult,
    beads,
    journal: completedJournal.ok === false ? completedJournal : completedJournal.value || completedJournal,
  };
}
