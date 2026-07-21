import { asJsonArray, asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";

export interface ImplementationTarget {
  trackId: string;
  phase: JsonObject;
  task: JsonObject | null;
  readyGroups: string[][];
}

function actionCall(root: string, action: string, input: JsonObject, execute = false): JsonObject {
  return {
    tool: "cadre_action",
    arguments: { root, action, input, ...(execute ? { execute: true } : {}) },
  };
}

export function implementationTarget(value: unknown): ImplementationTarget | null {
  const result = asJsonObject(value);
  const prep = asJsonObject(result.prepare_implementation);
  const trackId = asOptionalString(prep.selected_track) || asOptionalString(result.track_id);
  if (!trackId || prep.ok === false) return null;
  const schedule = asJsonObject(result.phase_schedule);
  if (schedule.ok === false) return null;
  const readyPhaseIds = new Set(asStringArray(schedule.ready_phases));
  const phase = asJsonArray(schedule.phases)
    .map(asJsonObject)
    .find((entry) => readyPhaseIds.has(String(entry.phase_id || "")));
  if (!phase) return null;
  const readyTaskKeys = new Set(asStringArray(phase.ready_tasks));
  const task = asJsonArray(phase.tasks)
    .map(asJsonObject)
    .find((entry) => entry.ready === true || readyTaskKeys.has(String(entry.task_key || ""))) || null;
  return {
    trackId,
    phase,
    task,
    readyGroups: asJsonArray(schedule.ready_groups).map(asStringArray),
  };
}

export function parallelImplementation(target: ImplementationTarget): boolean {
  return target.phase.execution === "parallel" || (target.readyGroups[0]?.length || 0) > 1;
}

function affectedWorktrees(plan: unknown): JsonObject[] {
  const value = asJsonObject(plan);
  return asJsonArray(value.branch_set).map(asJsonObject).filter((entry) => entry.affected !== false);
}

export function worktreeSetupContinuation(
  root: string,
  trackId: string,
  rawPlan: unknown,
  args: RuntimeArgs = {},
): JsonObject | null {
  const plan = asJsonObject(rawPlan);
  const branchSet = affectedWorktrees(plan);
  const missing = branchSet.filter((entry) => entry.health === "missing" || entry.exists === false);
  const unhealthy = branchSet.filter((entry) => !["missing", "ready"].includes(String(entry.health || "")));
  if (missing.length === 0 || unhealthy.length > 0) return null;
  const input: JsonObject = { trackId };
  if (plan.topology !== "polyrepo") input.repo = "root";
  for (const key of ["base", "head", "branch", "agentIdentifier", "maxWorkers"] as const) {
    if (args[key] != null) input[key] = args[key] as JsonObject[string];
  }
  return actionCall(root, "track.worktree_plan", input, true);
}

export function worktreesReady(plan: unknown): boolean {
  const branchSet = affectedWorktrees(plan);
  return branchSet.length > 0 && branchSet.every((entry) => entry.exists === true && entry.health === "ready");
}

function taskWorktree(task: JsonObject, rawPlan: unknown): JsonObject | null {
  const plan = asJsonObject(rawPlan);
  const requestedRepo = asOptionalString(task.repo);
  const canonicalRepo = plan.topology === "polyrepo" ? requestedRepo : "root";
  return affectedWorktrees(plan).find((entry) => (
    asOptionalString(entry.repo) === canonicalRepo
    || (canonicalRepo === "root" && asOptionalString(entry.repo) === ".")
  )) || null;
}

export function deferredTaskPacket(
  root: string,
  target: ImplementationTarget,
  worktreePlan: unknown,
): JsonObject | null {
  if (parallelImplementation(target) || !target.task || !worktreesReady(worktreePlan)) return null;
  const phaseIndex = Number(target.phase.phase_index || 0);
  const taskIndex = Number(target.task.task_index || 0);
  const worktree = taskWorktree(target.task, worktreePlan);
  const workingRoot = asOptionalString(worktree?.integration_worktree);
  if (phaseIndex <= 0 || taskIndex <= 0 || !workingRoot) return null;
  return {
    ...target.task,
    phase_index: phaseIndex,
    working_root: workingRoot,
    complete_packet: actionCall(root, "task.complete", {
      trackId: target.trackId,
      phaseIndex,
      taskIndex,
      workingRoot,
    }, true),
  };
}

export function implementationNext(root: string, result: unknown, args: RuntimeArgs): JsonObject | null {
  const packet = asJsonObject(result);
  const target = implementationTarget(result);
  if (
    !target
    || !parallelImplementation(target)
    || !target.task
    || !args.agentIdentifier
    || !worktreesReady(packet.integration_worktrees)
  ) return null;
  const input: JsonObject = { trackId: target.trackId, groupIndex: 0, agentIdentifier: args.agentIdentifier };
  if (args.maxWorkers != null) input.maxWorkers = args.maxWorkers;
  return actionCall(root, "parallel.next_wave", input);
}

export function implementationRequired(value: unknown, args: RuntimeArgs): string[] {
  const result = asJsonObject(value);
  const target = implementationTarget(result);
  const task = asJsonObject(result.task);
  return [
    ...(target && parallelImplementation(target) && !args.agentIdentifier ? ["agentIdentifier"] : []),
    ...(Object.keys(asJsonObject(task.complete_packet)).length > 0 ? ["data.task.complete_packet"] : []),
  ];
}
