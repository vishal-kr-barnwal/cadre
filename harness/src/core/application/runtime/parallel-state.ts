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

import { CoreResult, ParallelState, ParallelWorker } from "./contracts";
import { coverageThreshold } from "../../infrastructure/runtime/coverage";
import { readJson, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { completeTask } from "./task-completion";
import { findTrack } from "./track-context";
import { withSharedControlPlaneSync } from "./workflow-response";

export function recordParallelWorker(root: string, args: RuntimeArgs = {}): CoreResult {
  return withSharedControlPlaneSync(root, args, "record_parallel_worker", () => recordParallelWorkerInner(root, args));
}

export function recordParallelWorkerInner(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  return withTrackLock(root, track.track_id, () => recordParallelWorkerUnlocked(root, track, args));
}

export function recordParallelWorkerUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const workerId = args.workerId || args.worker_id;
  if (!workerId) return { ok: false, error: "workerId is required" };
  const status = args.status || "awaiting_merge";
  const valid = new Set(["in_progress", "awaiting_merge", "merged", "conflict", "failed"]);
  if (!valid.has(status)) return { ok: false, error: `Invalid parallel worker status: ${status}` };
  if (status === "awaiting_merge" && !args.commitSha && !args.commit && args.allowNoCommit !== true) {
    return { ok: false, error: "commitSha is required before a parallel worker can move to awaiting_merge" };
  }

  const statePath = path.join(track.dir, "parallel_state.json");
  const existing = readJson<unknown>(statePath, {
    track_id: track.track_id,
    execution_mode: "parallel",
    started_at: utcNow(),
    workers: [],
  });
  const existingObject = isRecord(existing) ? asJsonObject(existing) : {};
  const state: ParallelState = {
    ...existingObject,
    track_id: asOptionalString(existingObject.track_id) || track.track_id,
    execution_mode: asOptionalString(existingObject.execution_mode) || "parallel",
    started_at: asOptionalString(existingObject.started_at) || utcNow(),
    workers: Array.isArray(existingObject.workers)
      ? existingObject.workers.map((worker) => asJsonObject(worker) as unknown as ParallelWorker)
      : [],
  };
  const now = utcNow();
  const index = state.workers.findIndex((worker) => worker.worker_id === workerId);
  const existingWorker = index >= 0 ? state.workers[index] : undefined;
  const nextWorker: ParallelWorker = {
    ...(existingWorker || {}),
    worker_id: workerId,
    status,
    phase_index: args.phaseIndex ?? existingWorker?.phase_index ?? null,
    task_index: args.taskIndex ?? existingWorker?.task_index ?? null,
    task_key: args.phaseIndex && args.taskIndex ? `phase${args.phaseIndex}_task${args.taskIndex}` : existingWorker?.task_key ?? null,
    beads_task_id: args.beadsTaskId || args.taskId || existingWorker?.beads_task_id || null,
    repo: args.repo || existingWorker?.repo || null,
    worktree: args.worktree || existingWorker?.worktree || null,
    branch: args.branch || existingWorker?.branch || null,
    commit_sha: args.commitSha || existingWorker?.commit_sha || null,
    coverage: typeof args.coverage === "number" ? args.coverage : existingWorker?.coverage ?? null,
    evidence: args.evidence || existingWorker?.evidence || null,
    updated_at: now,
  };
  if (status === "awaiting_merge" && !nextWorker.completed_at) nextWorker.completed_at = now;
  if (status === "merged") nextWorker.merged_at = now;
  if (status === "conflict") nextWorker.conflict_at = now;
  if (index >= 0) state.workers[index] = nextWorker;
  else state.workers.push(nextWorker);
  state.completed_workers = state.workers.filter((worker) => ["awaiting_merge", "merged"].includes(worker.status)).length;
  state.merged_workers = state.workers.filter((worker) => worker.status === "merged").length;
  state.conflict_workers = state.workers.filter((worker) => worker.status === "conflict").length;
  state.updated_at = now;

  let completion: CoreResult | null = null;
  if (args.completeTask === true) {
    completion = completeTask(root, {
      trackId: track.track_id,
      phaseIndex: args.phaseIndex,
      taskIndex: args.taskIndex,
      commitSha: args.commitSha,
      command: args.command,
      timeoutMs: args.timeoutMs,
      coverageThreshold: args.coverageThreshold,
      allowMissingCoverage: args.allowMissingCoverage,
      allowLowCoverage: args.allowLowCoverage,
      summary: args.summary || `parallel worker ${workerId}`,
      reason: args.reason || `merged ${workerId}`,
      beadsTaskId: nextWorker.beads_task_id,
      repo: nextWorker.repo || args.repo,
      workingRoot: args.workingRoot || nextWorker.worktree || args.worktree,
      lock: false,
    });
    if (!completion.ok) return { ok: false, stage: "complete_task", state_path: statePath, worker: nextWorker, completion };
  }

  writeJson(statePath, state as JsonObject);
  return {
    ok: true,
    track_id: track.track_id,
    state_path: path.relative(root, statePath),
    worker: nextWorker,
    completion,
    summary: {
      total_workers: state.workers.length,
      completed_workers: state.completed_workers,
      merged_workers: state.merged_workers,
      conflict_workers: state.conflict_workers,
    },
  };
}

export function parallelStatePath(track: CadreTrack): string {
  return path.join(track.dir, "parallel_state.json");
}

export function readParallelState(track: CadreTrack): ParallelState {
  const existing = readJson<unknown>(parallelStatePath(track), {
    track_id: track.track_id,
    execution_mode: "parallel",
    started_at: utcNow(),
    workers: [],
  });
  const existingObject = isRecord(existing) ? asJsonObject(existing) : {};
  return {
    ...existingObject,
    track_id: asOptionalString(existingObject.track_id) || track.track_id,
    execution_mode: asOptionalString(existingObject.execution_mode) || "parallel",
    started_at: asOptionalString(existingObject.started_at) || utcNow(),
    workers: Array.isArray(existingObject.workers)
      ? existingObject.workers.map((worker) => asJsonObject(worker) as unknown as ParallelWorker)
      : [],
  };
}
