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

import { claimsOverlap, normalizeClaimPath } from "./collision";
import { CoreResult, ParallelWorker } from "./contracts";
import { safeName } from "../../infrastructure/runtime/json-store";
import { readParallelState, recordParallelWorker } from "./parallel-state";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { repoEntriesError, repoEntriesForTrack } from "./repo-resolution";
import { asArray } from "./status";
import { runCommand } from "../../infrastructure/runtime/system";
import { findTrack } from "./track-context";
import { parsePlanFile, phaseSchedule } from "./track-schedule";
import { withSharedControlPlaneSync } from "./workflow-response";

export function parallelWorkersForWave(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const schedule = phaseSchedule(root, { ...args, trackId: track.track_id });
  if (schedule.ok === false) return schedule;
  const readyGroups = Array.isArray(schedule.ready_groups) ? schedule.ready_groups : [];
  const groupIndex = Number(args.groupIndex || 0);
  const phaseIds = asStringArray(readyGroups[groupIndex]);
  const plan = parsePlanFile(track.plan_path);
  const state = readParallelState(track);
  const activeWorkers = state.workers.filter((worker) =>
    ["in_progress", "awaiting_merge", "merged"].includes(worker.status)
  );
  const activeTaskKeys = new Set(activeWorkers.map((worker) => asOptionalString(worker.task_key)).filter(Boolean));
  const completeTaskKeys = new Set(
    plan.tasks
      .filter((task) => ["x", "-"].includes(task.marker))
      .map((task) => task.task_key)
      .concat(activeWorkers
        .filter((worker) => ["awaiting_merge", "merged"].includes(worker.status))
        .map((worker) => asString(worker.task_key))
        .filter(Boolean))
  );
  const activeClaims = activeWorkers.flatMap((worker) => {
    const phase = plan.phases.find((item) => item.phase_index === worker.phase_index);
    const task = phase?.tasks.find((item) => item.task_index === worker.task_index || item.task_key === worker.task_key);
    return (task?.files || []).map((file) => ({
      repo: asOptionalString(worker.repo) || task?.repo || ".",
      file: normalizeClaimPath(file),
      worker_id: worker.worker_id,
      task_key: worker.task_key,
    }));
  });
  const normalizeTaskDependency = (phase: PlanPhase, dep: string): string => {
    const taskMatch = dep.match(/^task(\d+)$/i);
    if (taskMatch?.[1]) return `phase${phase.phase_index}_task${taskMatch[1]}`;
    const phaseTaskMatch = dep.match(/^phase(\d+)_task(\d+)$/i);
    if (phaseTaskMatch?.[1] && phaseTaskMatch[2]) return `phase${phaseTaskMatch[1]}_task${phaseTaskMatch[2]}`;
    return dep;
  };
  const taskIsReady = (phase: PlanPhase, task: PlanTask): boolean => {
    if (["x", "-", "!", "~"].includes(task.marker)) return false;
    if (activeTaskKeys.has(task.task_key)) return false;
    const dependencies = (task.depends || []).map((dep) => normalizeTaskDependency(phase, dep));
    if (dependencies.some((dep) => !completeTaskKeys.has(dep))) return false;
    const taskClaims = (task.files || []).map((file) => ({
      repo: task.repo || loadTopology(root).defaultRepo || ".",
      file: normalizeClaimPath(file),
    }));
    return taskClaims.every((claim) =>
      activeClaims.every((active) => claim.repo !== active.repo || !claimsOverlap(claim.file, active.file))
    );
  };
  const readyTasksForPhase = (phase: PlanPhase): PlanTask[] => {
    const execution = asString(phase.annotations.execution, "sequential");
    if (execution === "parallel") return phase.tasks.filter((task) => taskIsReady(phase, task));
    const firstOpen = phase.tasks.find((task) => !["x", "-"].includes(task.marker));
    return firstOpen && taskIsReady(phase, firstOpen) ? [firstOpen] : [];
  };
  const phases = plan.phases.filter((phase) => phaseIds.includes(`phase${phase.phase_index}`));
  const workers = phases
    .flatMap((phase) => readyTasksForPhase(phase).map((task) => ({
      worker_id: `${track.track_id}_${asString(task.task_key)}`,
      phase_id: `phase${phase.phase_index}`,
      phase_index: phase.phase_index,
      task_index: task.task_index,
      task_key: asString(task.task_key),
      title: asString(task.title),
      marker: asString(task.marker),
      repo: asString(task.repo, loadTopology(root).defaultRepo || "."),
      files: asStringArray(task.files),
      branch: `${track.metadata.git_branch || `track/${track.track_id}`}-${safeName(task.task_key)}`,
    })))
    .filter((worker) => !["x", "-"].includes(worker.marker));
  return {
    ok: true,
    track_id: track.track_id,
    schedule,
    state,
    group_index: groupIndex,
    phase_ids: phaseIds,
    workers,
  };
}

export function plannedCommand(command: string, args: string[], cwd: string): CoreResult {
  return { command, args, cwd };
}

export function runPlannedCommands(commands: CoreResult[]): CommandResult[] {
  return commands.map((entry) => runCommand(asString(entry.command), asStringArray(entry.args), { cwd: asString(entry.cwd) }));
}

export function workerDispatchPayload(root: string, track: CadreTrack, worker: JsonObject, worktree: string, sourceRoot: string): JsonObject {
  const workerId = asString(worker.worker_id);
  const taskKey = asString(worker.task_key);
  const repo = asString(worker.repo, ".");
  const ownedFiles = asStringArray(worker.files);
  const prompt = [
    `You are a Cadre parallel worker for track ${track.track_id}.`,
    `Worker: ${workerId}`,
    `Task: ${taskKey} - ${asString(worker.title)}`,
    `Repo: ${repo}`,
    `Source root: ${sourceRoot}`,
    `Worker worktree: ${worktree}`,
    ownedFiles.length > 0 ? `Owned files: ${ownedFiles.join(", ")}` : "Owned files: none declared; inspect the task plan before editing.",
    "Use only Cadre packets for Cadre, Beads, provider, index, and worker-state mutations.",
    "Change only the assigned product files unless the task requires a narrowly related test or manifest update.",
    "Run the smallest relevant tests first, then the configured project gate when practical.",
    "Commit the worker worktree changes and return the structured result JSON.",
  ].join("\n");
  return {
    prompt,
    repo,
    worktree,
    source_root: sourceRoot,
    owned_files: ownedFiles,
    expected_result_schema: {
      type: "object",
      required: ["worker_id", "task_key", "repo", "status", "summary", "files_changed", "tests", "commit_sha"],
      properties: {
        worker_id: { type: "string" },
        task_key: { type: "string" },
        repo: { type: "string" },
        status: { type: "string", enum: ["awaiting_merge", "blocked"] },
        summary: { type: "string" },
        files_changed: { type: "array", items: { type: "string" } },
        tests: { type: "array", items: { type: "object" } },
        coverage: { type: ["number", "null"] },
        commit_sha: { type: ["string", "null"] },
        blockers: { type: "array", items: { type: "string" } },
      },
    },
    evidence_requirements: {
      commit: "Required unless blocked before code changes; record the commit SHA in record_finish.",
      tests: "Include every command run, cwd, exit status, and relevant stdout/stderr tail.",
      coverage: "Include parsed coverage when available or a reason coverage was not produced.",
    },
    record_finish_packet: {
      tool: "cadre_parallel",
      arguments: {
        root,
        action: "record_finish",
        trackId: track.track_id,
        workerId,
        status: "awaiting_merge",
        phaseIndex: worker.phase_index,
        taskIndex: worker.task_index,
        repo,
        commitSha: "<commit-sha>",
        coverage: "<coverage-number-or-null>",
      },
    },
  };
}

export function parallelSetupWorkers(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const wave = parallelWorkersForWave(root, track, args);
  if (wave.ok === false) return wave;
  const topology = loadTopology(root);
  const entries = new Map(repoEntriesForTrack(root, track, args).map((entry) => [entry.repo, entry]));
  const commands: CoreResult[] = [];
  const workers: JsonObject[] = asArray(wave.workers).map((rawWorker): JsonObject => {
    const worker = asJsonObject(rawWorker);
    const repo = asString(worker.repo, ".");
    const entry = entries.get(repo) || { root, base: args.base || "main" };
    const worktree = path.resolve(root, ".worktrees", track.track_id, safeName(repo), safeName(worker.task_key));
    const sourceRoot = asString(entry.root || root);
    commands.push(plannedCommand(
      "git",
      ["worktree", "add", "-B", asString(worker.branch), worktree, asString(entry.base || args.base || "main")],
      sourceRoot
    ));
    return {
      ...worker,
      worktree,
      source_root: sourceRoot,
      dispatch: workerDispatchPayload(root, track, worker, worktree, sourceRoot),
    };
  });
  const execute = args.execute === true;
  const results = execute ? runPlannedCommands(commands) : [];
  const stateRecords: CoreResult[] = [];
  if (execute) {
    workers.forEach((worker, index) => {
      const commandResult = results[index];
      if (commandResult && commandResult.ok) {
        stateRecords.push(recordParallelWorker(root, {
          ...args,
          skipSync: true,
          trackId: track.track_id,
          workerId: asString(worker.worker_id),
          status: "in_progress",
          phaseIndex: asNumber(worker.phase_index),
          taskIndex: asNumber(worker.task_index),
          repo: asString(worker.repo, "."),
          worktree: asString(worker.worktree),
          branch: asString(worker.branch),
        }));
      }
    });
  }
  return {
    ok: results.every((result) => result.ok) && stateRecords.every((record) => record.ok !== false),
    track_id: track.track_id,
    action: "setup_workers",
    execute,
    dry_run: !execute,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    workers,
    commands,
    results,
    state_records: stateRecords,
  };
}

export function workerRepoRoot(root: string, track: CadreTrack, worker: ParallelWorker, args: RuntimeArgs = {}): string {
  const repo = asOptionalString(worker.repo) || asOptionalString(args.repo) || ".";
  const entry = repoEntriesForTrack(root, track, { ...args, repo }).find((item) => item.repo === repo);
  return asString(entry?.root, root);
}

export function parallelMergeBack(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const state = readParallelState(track);
  const force = args.force === true;
  const workers = state.workers
    .filter((worker) => !args.workerId || worker.worker_id === args.workerId)
    .filter((worker) => force || worker.status === "awaiting_merge");
  const skipped = state.workers
    .filter((worker) => !args.workerId || worker.worker_id === args.workerId)
    .filter((worker) => !workers.includes(worker))
    .map((worker) => ({ worker_id: worker.worker_id, status: worker.status, reason: "worker is not awaiting_merge" }));
  const commands = workers
    .filter((worker) => worker.branch || worker.commit_sha)
    .map((worker) => plannedCommand("git", ["merge", "--no-ff", asString(worker.commit_sha || worker.branch)], workerRepoRoot(root, track, worker, args)));
  const execute = args.execute === true;
  const results = execute ? runPlannedCommands(commands) : [];
  const stateRecords: CoreResult[] = [];
  if (execute) {
    workers.forEach((worker, index) => {
      const result = results[index];
      if (result && result.ok) {
        const recordArgs: RuntimeArgs = {
          ...args,
          skipSync: true,
          trackId: track.track_id,
          workerId: worker.worker_id,
          status: "merged",
        };
        if (worker.phase_index != null) recordArgs.phaseIndex = worker.phase_index;
        if (worker.task_index != null) recordArgs.taskIndex = worker.task_index;
        if (worker.repo) recordArgs.repo = worker.repo;
        if (worker.worktree) recordArgs.worktree = worker.worktree;
        if (worker.branch) recordArgs.branch = worker.branch;
        if (worker.commit_sha) recordArgs.commitSha = worker.commit_sha;
        stateRecords.push(recordParallelWorker(root, recordArgs));
      }
    });
  }
  return {
    ok: results.every((result) => result.ok) && stateRecords.every((record) => record.ok !== false),
    track_id: track.track_id,
    action: "merge_back",
    execute,
    dry_run: !execute,
    workers,
    skipped,
    commands,
    results,
    state_records: stateRecords,
  };
}

export function parallelCleanup(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const state = readParallelState(track);
  const force = args.force === true;
  const workers = state.workers.filter((worker) => worker.worktree && (force || worker.status === "merged"));
  const skipped = state.workers
    .filter((worker) => worker.worktree && !workers.includes(worker))
    .map((worker) => ({ worker_id: worker.worker_id, status: worker.status, reason: "worker is not merged" }));
  const commands = workers.map((worker) => plannedCommand("git", ["worktree", "remove", asString(worker.worktree)], workerRepoRoot(root, track, worker, args)));
  const execute = args.execute === true;
  const results = execute ? runPlannedCommands(commands) : [];
  return {
    ok: results.every((result) => result.ok),
    track_id: track.track_id,
    action: "cleanup",
    execute,
    dry_run: !execute,
    workers,
    skipped,
    commands,
    results,
  };
}

export function parallelWorkflow(root: string, args: RuntimeArgs = {}): CoreResult {
  const action = args.action || "plan";
  const mutating = ["setup_workers", "record_finish", "merge_back", "cleanup"].includes(action);
  if (mutating && args.execute === true && (args as UnknownRecord).skipSync !== true) {
    return withSharedControlPlaneSync(root, args, `parallel:${action}`, () =>
      parallelWorkflow(root, { ...args, skipSync: true })
    );
  }
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
  if (action === "plan") {
    const schedule = phaseSchedule(root, { ...args, trackId: track.track_id });
    return { ok: schedule.ok !== false, track_id: track.track_id, schedule, state: readParallelState(track) };
  }
  if (action === "next_wave") return parallelWorkersForWave(root, track, args);
  if (action === "setup_workers") return parallelSetupWorkers(root, track, args);
  if (action === "record_finish") {
    if (args.execute !== true) {
      return {
        ok: true,
        track_id: track.track_id,
        action,
        dry_run: true,
        planned_record: {
          worker_id: args.workerId || args.worker_id,
          status: args.status || "awaiting_merge",
          phase_index: args.phaseIndex ?? null,
          task_index: args.taskIndex ?? null,
          commit_sha: args.commitSha || null,
        },
      };
    }
    return recordParallelWorker(root, { ...args, trackId: track.track_id, status: args.status || "awaiting_merge" });
  }
  if (action === "merge_back") return parallelMergeBack(root, track, args);
  if (action === "cleanup") return parallelCleanup(root, track, args);
  return { ok: false, error: `Unknown parallel action: ${action}` };
}
