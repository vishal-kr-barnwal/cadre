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

import { BeadsCommandPlanEntry, CoreResult, SpecContext } from "./contracts";
import { patchJsonFile, readJson, safeName } from "../../infrastructure/runtime/json-store";
import { trackLockName } from "../../infrastructure/runtime/locking";
import { trackSpecJsonPath } from "./plan-docs";
import { specItemsFromRaw } from "./spec-docs";
import { commandExists, gitIdentity, runCommand } from "../../infrastructure/runtime/system";
import { findTrack, priorityRank } from "./track-context";
import { metadataPatch } from "./track-mutations";
import { parsePlanFile, parsePlanJson } from "./track-schedule";
import { markdownPayloadError, normalizePlanJson, normalizeSpecJson } from "./workflow-response";

export function extractBeadsId(json: unknown, fallback: string | null = null): string | null {
  if (!isRecord(json)) return fallback;
  for (const key of ["id", "issue_id", "issueId"]) {
    const value = json[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const issue = json.issue;
  if (isRecord(issue) && typeof issue.id === "string" && issue.id.trim()) return issue.id.trim();
  return fallback;
}

export function extractAssignee(json: unknown): string | null {
  if (Array.isArray(json)) {
    for (const item of json) {
      const nested = extractAssignee(item);
      if (nested) return nested;
    }
    return null;
  }
  if (!isRecord(json)) return null;
  const direct = json.assignee || json.assigned_to || json.owner || json.claimed_by;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  for (const key of ["issue", "task", "epic", "data"]) {
    const nested = extractAssignee(json[key]);
    if (nested) return nested;
  }
  return null;
}

export function parseCommandJson(result: Pick<CommandResult, "stdout"> | CoreResult): unknown {
  try {
    return JSON.parse(asString(result.stdout) || "null") as unknown;
  } catch {
    return null;
  }
}

export function beadsCommandPlanEntry(args: string[]): BeadsCommandPlanEntry {
  return { command: ["bd", ...args].join(" "), args };
}

export function compactLines(value: unknown, limit = 1200): string {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, limit);
}

export function sectionText(markdown: unknown, headingPattern: RegExp): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] || "";
    if (/^#{1,4}\s+/.test(line) && out.length > 0) break;
    out.push(line);
  }
  return compactLines(out.join("\n"));
}

export function specContextFromText(text: string): SpecContext {
  const overview = [
    sectionText(text, /^#{1,4}\s+(description|overview|summary|goal|objective|technical approach|approach)\b/i),
    sectionText(text, /^#{1,4}\s+(functional requirements?|requirements?|user-facing behavior)\b/i),
    sectionText(text, /^#{1,4}\s+(non-functional requirements?|nonfunctional requirements?|constraints|quality attributes)\b/i),
  ].filter(Boolean).join("\n") || compactLines(text, 1400);
  const acceptance = sectionText(text, /^#{1,4}\s+(acceptance criteria|acceptance|success criteria|done|definition of done)\b/i) || compactLines(text, 1000);
  return { overview, acceptance };
}

export function specContextFromJson(raw: unknown): SpecContext {
  const spec = normalizeSpecJson(asOptionalString(asJsonObject(raw).track_id) || "track", raw);
  const overview = compactLines([
    asOptionalString(spec.description),
    ...specItemsFromRaw(spec.functional_requirements).map((item) => `${asOptionalString(item.heading)}: ${asOptionalString(item.body)}`),
    ...specItemsFromRaw(spec.non_functional_requirements).map((item) => `${asOptionalString(item.heading)}: ${asOptionalString(item.body)}`),
  ].filter(Boolean).join("\n"), 1400);
  const acceptance = compactLines(specItemsFromRaw(spec.acceptance_criteria)
    .map((item) => `${asOptionalString(item.heading)}: ${asOptionalString(item.body)}`)
    .filter(Boolean)
    .join("\n"), 1000);
  return { overview, acceptance };
}

export function trackSpecContext(track: CadreTrack): SpecContext {
  return specContextFromJson(readJson<JsonObject | null>(trackSpecJsonPath(track), null) || { track_id: track.track_id });
}

export function taskDesignText(track: CadreTrack, phase: PlanPhase, task: PlanTask, specContext: SpecContext): string {
  return compactLines([
    `Track: ${track.track_id}`,
    `Phase: ${phase.title}`,
    `Task: ${task.title}`,
    task.files && task.files.length ? `Files: ${task.files.join(", ")}` : null,
    task.depends && task.depends.length ? `Depends on: ${task.depends.join(", ")}` : null,
    task.repo ? `Repo: ${task.repo}` : null,
    specContext.overview ? `Spec context: ${specContext.overview}` : null,
  ].filter(Boolean).join("\n"), 1800);
}

export function taskAcceptanceText(task: PlanTask, specContext: SpecContext): string {
  return compactLines([
    `Complete when this task is implemented, tested, and committed.`,
    task.files && task.files.length ? `Owned files changed only as needed: ${task.files.join(", ")}` : null,
    specContext.acceptance ? `Track acceptance context: ${specContext.acceptance}` : null,
  ].filter(Boolean).join("\n"), 1600);
}

export function addCreateContext(args: string[], design: string | null | undefined, acceptance: string | null | undefined): string[] {
  if (design) args.push("--design", design);
  if (acceptance) args.push("--acceptance", acceptance);
  return args;
}

export function createBeadsTree(root: string, args: RuntimeArgs = {}): CoreResult {
  const markdownError = markdownPayloadError(args);
  if (markdownError) return markdownError;
  const trackId = args.trackId || args.track_id;
  if (!trackId) return { ok: false, error: "trackId is required" };
  const dryRun = args.dryRun === true;
  const diskTrack = findTrack(root, trackId);
  if (!diskTrack && !dryRun) return { ok: false, error: `Track not found: ${trackId}` };
  if (!diskTrack && dryRun && !args.plan) {
    return { ok: false, error: `Track not found: ${trackId}; dryRun without track files requires plan` };
  }
  const draftMetadata: TrackMetadata = {
    track_id: trackId,
    type: "feature",
    status: "new",
    priority: "medium",
    description: trackId,
    git_branch: `track/${trackId}`,
    ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
  };
  const track: CadreTrack = diskTrack || {
    track_id: trackId,
    dir: path.join(root, "cadre", "tracks", safeName(trackId)),
    metadata_path: path.join(root, "cadre", "tracks", safeName(trackId), "metadata.json"),
    plan_path: path.join(root, "cadre", "tracks", safeName(trackId), "plan.md"),
    spec_path: path.join(root, "cadre", "tracks", safeName(trackId), "spec.md"),
    plan_json_path: path.join(root, "cadre", "tracks", safeName(trackId), "plan.json"),
    spec_json_path: path.join(root, "cadre", "tracks", safeName(trackId), "spec.json"),
    learnings_jsonl_path: path.join(root, "cadre", "tracks", safeName(trackId), "learnings.jsonl"),
    handoff_json_path: path.join(root, "cadre", "tracks", safeName(trackId), "handoff.json"),
    metadata: draftMetadata,
  };
  if (!dryRun && !commandExists("bd", root)) {
    return { ok: false, available: false, reason: "Beads CLI (bd) is not installed or not on PATH" };
  }

  const identity = args.identity || gitIdentity(root);
  const specJson = args.spec ? normalizeSpecJson(String(trackId), args.spec) : readJson<JsonObject | null>(trackSpecJsonPath(track), null);
  const plan = args.plan
    ? parsePlanJson(normalizePlanJson(String(trackId), args.plan, specJson))
    : parsePlanFile(track.plan_path);
  const specContext = specContextFromJson(specJson);
  const epicId = args.epicId || track.metadata.beads_epic || `cadre-${track.track_id}`;
  const commands: BeadsCommandPlanEntry[] = [];
  const results: CommandResult[] = [];
  const beadsTasks: Record<string, string | null> = {};

  const runBd = (bdArgs: string[]): CommandResult => {
    commands.push(beadsCommandPlanEntry(bdArgs));
    if (dryRun) {
      const id = bdArgs[0] === "create" && bdArgs.includes("--id") ? epicId : `dry-${commands.length}`;
      return { ok: true, status: 0, stdout: JSON.stringify({ id }), stderr: "", command: "bd", args: bdArgs };
    }
    const result = runCommand("bd", bdArgs, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    results.push(result);
    return result;
  };

  const showEpic: CommandResult | CoreResult = dryRun ? { ok: false } : runCommand("bd", ["show", epicId, "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  if (showEpic.ok) {
    if (track.metadata.beads_epic === epicId && track.metadata.beads_tasks && Object.keys(track.metadata.beads_tasks).length > 0) {
      return {
        ok: true,
        available: true,
        existing: true,
        dry_run: false,
        track_id: track.track_id,
        beads_epic: epicId,
        beads_tasks: track.metadata.beads_tasks,
        commands,
        results,
        metadata_patch: {
          beads_epic: epicId,
          beads_tasks: track.metadata.beads_tasks,
        },
      };
    }
    return {
      ok: false,
      available: true,
      existing: true,
      reason: `Beads epic ${epicId} already exists but metadata.beads_tasks is missing; reconcile existing children before creating new ones`,
      commands,
      results,
    };
  } else {
    const epicArgs = addCreateContext([
      "create",
      `${track.track_id}: ${track.metadata.description || track.metadata.name || track.track_id}`,
      "--id",
      epicId,
      "-t",
      "epic",
      "-p",
      String(priorityRank(track.metadata.priority)),
    ], specContext.overview, specContext.acceptance);
    epicArgs.push("--json");
    if (identity) epicArgs.splice(epicArgs.length - 1, 0, "--assignee", identity);
    const epicResult = runBd(epicArgs);
    if (!epicResult.ok) return { ok: false, available: true, stage: "create_epic", commands, results };
  }

  const phaseIds: Record<string, string> = {};
  for (const phase of plan.phases) {
    const phaseKey = `phase${phase.phase_index}`;
    const phaseResult = runBd(addCreateContext(
      ["create", phase.title, "-t", "task", "--parent", epicId, "--labels", "cadre:phase"],
      `Phase for Cadre track ${track.track_id}: ${phase.title}`,
      `All tasks in this phase are complete or intentionally skipped.`
    ).concat("--json"));
    if (!phaseResult.ok) return { ok: false, available: true, stage: "create_phase", phase: phaseKey, commands, results };
    const phaseId = extractBeadsId(parseCommandJson(phaseResult), dryRun ? `dry-${phaseKey}` : null);
    if (!phaseId) return { ok: false, available: true, stage: "parse_phase_id", phase: phaseKey, commands, results };
    phaseIds[phaseKey] = phaseId;
    beadsTasks[phaseKey] = phaseId;

    for (const task of phase.tasks) {
      const taskKey = task.task_key || `phase${phase.phase_index}_task${task.task_index}`;
      const taskResult = runBd(addCreateContext([
        "create",
        task.title,
        "-t",
        "task",
        "--parent",
        phaseId,
        "--labels",
        "cadre:task",
      ], taskDesignText(track, phase, task, specContext), taskAcceptanceText(task, specContext)).concat("--json"));
      if (!taskResult.ok) return { ok: false, available: true, stage: "create_task", task: taskKey, commands, results };
      const taskId = extractBeadsId(parseCommandJson(taskResult), dryRun ? `dry-${taskKey}` : null);
      if (!taskId) return { ok: false, available: true, stage: "parse_task_id", task: taskKey, commands, results };
      beadsTasks[taskKey] = taskId;
    }
  }

  for (const phase of plan.phases) {
    const phaseKey = `phase${phase.phase_index}`;
    const hasExplicitPhaseDepends = Object.prototype.hasOwnProperty.call(phase.annotations || {}, "depends");
    if (!hasExplicitPhaseDepends && phase.phase_index > 1) {
      const previousPhaseId = phaseIds[`phase${phase.phase_index - 1}`];
      const currentPhaseId = phaseIds[phaseKey];
      if (currentPhaseId && previousPhaseId) runBd(["dep", "add", currentPhaseId, previousPhaseId, "--json"]);
    } else if (phase.annotations.depends) {
      for (const dep of asString(phase.annotations.depends).split(",").map((item) => item.trim()).filter(Boolean)) {
        const currentPhaseId = phaseIds[phaseKey];
        const dependencyPhaseId = phaseIds[dep];
        if (currentPhaseId && dependencyPhaseId) runBd(["dep", "add", currentPhaseId, dependencyPhaseId, "--json"]);
      }
    }

    const execution = phase.annotations.execution || "sequential";
    for (const task of phase.tasks) {
      const taskKey = task.task_key || `phase${phase.phase_index}_task${task.task_index}`;
      if (execution !== "parallel" && task.task_index > 1) {
        const taskId = beadsTasks[taskKey];
        const previousTask = phase.tasks.find((candidate) => candidate.task_index === task.task_index - 1);
        const previousTaskKey = previousTask?.task_key || `phase${phase.phase_index}_task${task.task_index - 1}`;
        const previousTaskId = beadsTasks[previousTaskKey];
        if (taskId && previousTaskId) runBd(["dep", "add", taskId, previousTaskId, "--json"]);
      }
      if (execution === "parallel") {
        for (const dep of task.depends || []) {
          const taskDep = dep.match(/^task(\d+)$/);
          const dependencyTask = taskDep
            ? phase.tasks.find((candidate) => candidate.task_index === Number(taskDep[1]))
            : null;
          const depKey = dependencyTask?.task_key || (taskDep ? `phase${phase.phase_index}_task${taskDep[1]}` : dep);
          const taskId = beadsTasks[taskKey];
          const dependencyTaskId = beadsTasks[depKey];
          if (taskId && dependencyTaskId) runBd(["dep", "add", taskId, dependencyTaskId, "--json"]);
        }
      }
    }
  }

  runBd([
    "note",
    epicId,
    [
      `TRACK INITIALIZED: ${track.track_id}`,
      `PHASES: ${plan.phases.length}`,
      `BRANCH: ${track.metadata.git_branch || `track/${track.track_id}`}`,
    ].join("\n"),
    "--json",
  ]);

  for (const phase of plan.phases) {
    if ((phase.annotations.execution || "sequential") !== "parallel") continue;
    for (const task of phase.tasks) {
      const taskKey = `phase${phase.phase_index}_task${task.task_index}`;
      const taskId = beadsTasks[taskKey];
      if (!taskId) continue;
      runBd([
        "note",
        taskId,
        [
          "PARALLEL_ENABLED: true",
          `FILES_OWNED: ${(task.files || []).join(", ")}`,
          `DEPENDS_ON: ${(task.depends || []).join(", ") || "none"}`,
          task.repo ? `REPO: ${task.repo}` : null,
        ].filter(Boolean).join("\n"),
        "--json",
      ]);
    }
  }

  let metadataPatch: CoreResult | null = null;
  if (!dryRun) {
    metadataPatch = patchJsonFile(track.metadata_path, (metadata) => ({
      ...metadata,
      beads_epic: epicId,
      beads_tasks: beadsTasks,
    }), {
      root,
      lockName: trackLockName(track.track_id),
    });
    if (!metadataPatch.ok) {
      return { ok: false, available: true, stage: "metadata_patch", commands, results, metadata_patch: metadataPatch };
    }
  }

  return {
    ok: true,
    available: true,
    dry_run: dryRun,
    track_id: track.track_id,
    beads_epic: epicId,
    beads_tasks: beadsTasks,
    commands,
    results,
    metadata_patch: {
      beads_epic: epicId,
      beads_tasks: beadsTasks,
    },
    metadata_write: metadataPatch,
  };
}
