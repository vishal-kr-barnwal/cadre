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

import { CoreResult, CoverageResult } from "./contracts";
import { coverageThreshold, runCoverage } from "../../infrastructure/runtime/coverage";
import { utcNow } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { completionJournalPath, patchCompletionJournal, prepareManualVerificationCompletion } from "./manual-verification";
import { appendCadreEvent } from "./native-state";
import { isManualVerificationTaskObject, trackPlanJsonPath } from "./plan-docs";
import { isWorkingRootError, resolveTaskWorkingRoot } from "./repo-resolution";
import { findTrack } from "./track-context";
import { recordTaskResultUnlocked } from "./track-mutations";
import { parsePlanFile } from "./track-schedule";
import { beginTrace, commitTrace } from "./commit-trace";
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

  let resolvedCommitSha = args.commitSha ? String(args.commitSha).trim() : "";
  let productCommit: CoreResult | null = null;
  if (!resolvedCommitSha && args.allowNoCommit !== true) {
    const productBefore = beginTrace(workingRoot.path);
    productCommit = commitTrace(root, args, {
      kind: "product",
      workflow: "complete_task",
      subject: task.title.replace(/^Task\s+\d+:\s*/i, ""),
      scope: asOptionalString(workingRoot.repo) && workingRoot.repo !== "." ? asOptionalString(workingRoot.repo) || "task" : "task",
      cwd: workingRoot.path,
      before: productBefore,
      files: asStringArray(args.filesChanged || args.files_changed || args.files).length > 0
        ? asStringArray(args.filesChanged || args.files_changed || args.files)
        : task.files,
      allowDirty: true,
      trackId: track.track_id,
      repo: workingRoot.repo,
      note: {
        phase_index: phaseIndex,
        task_index: taskIndex,
        task_key: task.task_key,
        coverage: coverage.coverage ?? null,
      },
    });
    if (productCommit.ok === false) return { ...productCommit, stage: "product_commit", working_root: workingRoot };
    resolvedCommitSha = asOptionalString(productCommit.commit_sha) || "";
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
  const sha = resolvedCommitSha ? resolvedCommitSha.slice(0, 12) : "unknown";
  const dedupKey = `key: ${track.track_id}:p${phaseIndex}:t${taskIndex}:${sha.slice(0, 7)}`;
  const journalKey = `${phaseIndex}:${taskIndex}:${sha}`;
  const controlBefore = beginTrace(root);
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
      commitSha: resolvedCommitSha || args.commitSha,
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
      return { ok: false, stage: "record_task_result", threshold, working_root: workingRoot, coverage, task_result: taskResult, journal: entry };
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
  if (!stateResult.ok) return { ...stateResult, threshold, working_root: workingRoot, coverage };
  const stateTaskResult = asJsonObject(stateResult.task_result);

  const markComplete = () => patchCompletionJournal(track, journalKey, (current) => ({
    ...current,
    stage: "completed",
    completed_at: current.completed_at || utcNow(),
  }));
  const completedJournal = args.lock === false
    ? markComplete()
    : withTrackLock(root, track.track_id, markComplete);
  const event = appendCadreEvent(root, {
    kind: "task_completed",
    workflow: "complete_task",
    track_id: track.track_id,
    phase_index: phaseIndex,
    task_index: taskIndex,
    task_key: stateTaskResult.task_key,
    status: args.status || "completed",
    commit_sha: sha,
    coverage: coverage.coverage ?? null,
    summary: args.summary || null,
    journal_key: journalKey,
  });
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "complete",
    subject: `record ${track.track_id} phase ${phaseIndex} task ${taskIndex}`,
    before: controlBefore,
    files: [
      path.relative(root, track.metadata_path),
      path.relative(root, track.plan_path),
      path.relative(root, trackPlanJsonPath(track)),
      path.relative(root, completionJournalPath(track)),
      path.relative(root, `${completionJournalPath(track)}l`),
      "cadre/events.jsonl",
    ],
    trackId: track.track_id,
    repo: ".",
    note: {
      event_id: asOptionalString(asJsonObject(event.event).id) || null,
      phase_index: phaseIndex,
      task_index: taskIndex,
      task_key: stateTaskResult.task_key,
      product_commit_sha: asOptionalString(productCommit?.commit_sha) || resolvedCommitSha || null,
      coverage: coverage.coverage ?? null,
    },
  });

  return {
    ok: controlCommit.ok !== false,
    track_id: track.track_id,
    task_key: stateTaskResult.task_key,
    working_root: workingRoot,
    threshold,
    coverage,
    product_commit: productCommit,
    control_commit: controlCommit,
    task_result: stateTaskResult,
    event,
    journal: completedJournal.ok === false ? completedJournal : completedJournal.value || completedJournal,
  };
}
