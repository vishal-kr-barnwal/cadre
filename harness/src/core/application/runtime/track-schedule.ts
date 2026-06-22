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
import { Claim, ClaimConflict, CoreResult, HoldInfo, PhaseScheduleNode, TaskCounts, WorkState } from "./contracts";
import { staleInfo } from "../../infrastructure/runtime/coverage";
import { fileExists, readJson } from "../../infrastructure/runtime/json-store";
import { planJsonPathForPlanPath, planJsonToParsedPlan } from "./plan-docs";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { unresolvedPlanRepos } from "./repo-resolution";
import { findTrack } from "./track-context";

export function workStateForTrack(track: CadreTrack): WorkState | null {
  const statePath = path.join(track.dir, "implement_state.json");
  return readJson<WorkState | null>(statePath, null);
}

export function holdInfo(track: CadreTrack, now = Date.now()): HoldInfo {
  const state = workStateForTrack(track);
  const lease = track.metadata.lease || null;
  const stateOwner = state?.owner || null;
  const owner = stateOwner || track.metadata.owner || null;
  const leaseOwner = lease?.owner || null;
  const leaseTime = lease && (asOptionalString(lease.heartbeat_at) || lease.acquired_at);
  const stateTime = state && (state.last_updated || state.last_handoff);
  const leaseStale = staleInfo(leaseTime, now);
  const stateStale = staleInfo(stateTime, now);
  return {
    owner,
    metadata_owner: track.metadata.owner || null,
    state_owner: stateOwner,
    lease_owner: leaseOwner,
    lease_heartbeat_at: leaseTime || null,
    lease_stale: lease ? leaseStale.stale : false,
    lease_age_minutes: leaseStale.age_minutes,
    state_last_updated: stateTime || null,
    state_stale: state ? stateStale.stale : false,
    state_age_minutes: stateStale.age_minutes,
  };
}

export function taskCounts(plan: Pick<ParsedPlan, "phases">): TaskCounts {
  const counts: TaskCounts = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, skipped: 0, percent: 0 };
  for (const phase of plan.phases || []) {
    for (const task of phase.tasks || []) {
      counts.total += 1;
      if (task.marker === "x") counts.completed += 1;
      else if (task.marker === "~") counts.in_progress += 1;
      else if (task.marker === "!") counts.blocked += 1;
      else if (task.marker === "-") counts.skipped += 1;
      else counts.pending += 1;
    }
  }
  counts.percent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100);
  return counts;
}

export function listTrackDirs(root: string): string[] {
  const tracksDir = path.join(root, "cadre", "tracks");
  if (!fileExists(tracksDir)) return [];
  return fs
    .readdirSync(tracksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tracksDir, entry.name))
    .sort();
}

export function listTracks(root: string): CadreTrack[] {
  const tracks: CadreTrack[] = [];
  for (const dir of listTrackDirs(root)) {
      const metadataPath = path.join(dir, "metadata.json");
      const metadata = readJson<TrackMetadata | null>(metadataPath, null);
      if (!metadata) continue;
      const trackId = metadata.track_id || path.basename(dir);
      tracks.push({
        track_id: trackId,
        dir,
        metadata_path: metadataPath,
        plan_path: path.join(dir, "plan.md"),
        spec_path: path.join(dir, "spec.md"),
        plan_json_path: path.join(dir, "plan.json"),
        spec_json_path: path.join(dir, "spec.json"),
        learnings_jsonl_path: path.join(dir, "learnings.jsonl"),
        handoff_json_path: path.join(dir, "handoff.json"),
        metadata,
      });
  }
  return tracks;
}

export function parsePlanJson(raw: unknown): ParsedPlan {
  return planJsonToParsedPlan(asJsonObject(raw));
}

export function parsePlanFile(file: string): ParsedPlan {
  const planJsonPath = planJsonPathForPlanPath(file);
  if (fileExists(planJsonPath)) {
    const raw = readJson<JsonObject | null>(planJsonPath, null);
    if (raw) return parsePlanJson(raw);
  }
  return {
    ok: false,
    phases: [],
    tasks: [],
    warnings: [],
    errors: [`Missing canonical plan JSON: ${planJsonPath}`],
  };
}

export function planClaims(root: string, track: CadreTrack, topology = loadTopology(root)): Claim[] {
  const plan = parsePlanFile(track.plan_path);
  const claims: Claim[] = [];
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      const repo = topology.polyrepo
        ? task.repo || topology.defaultRepo
        : ".";
      for (const file of task.files) {
        claims.push({
          track_id: track.track_id,
          owner: track.metadata.owner || null,
          repo,
          file,
          phase: phase.title,
          task: task.title,
          task_line: task.line,
        });
      }
    }
  }
  return claims;
}

export function phaseAliases(phase: PlanPhase): string[] {
  const title = String(phase.title || "").trim().toLowerCase();
  const simpleTitle = title.replace(/^phase\s+\d+\s*:\s*/, "").trim();
  return Array.from(new Set([
    `phase${phase.phase_index}`,
    `phase ${phase.phase_index}`,
    String(phase.phase_index),
    title,
    simpleTitle,
  ].filter(Boolean)));
}

export function resolvePhaseDependency(value: unknown, aliasMap: Map<string, PlanPhase>): PlanPhase | null {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return null;
  if (aliasMap.has(key)) return aliasMap.get(key) ?? null;
  const compact = key.replace(/\s+/g, "");
  if (aliasMap.has(compact)) return aliasMap.get(compact) ?? null;
  const phaseNumber = key.match(/^phase\s*(\d+)$/i) || key.match(/^(\d+)$/);
  if (phaseNumber?.[1] && aliasMap.has(`phase${phaseNumber[1]}`)) return aliasMap.get(`phase${phaseNumber[1]}`) ?? null;
  return null;
}

export function phaseDependencyIds(phase: PlanPhase, previousPhase: PlanPhase | undefined, aliasMap: Map<string, PlanPhase>): string[] {
  if (!Object.prototype.hasOwnProperty.call(phase.annotations || {}, "depends")) {
    return previousPhase ? [`phase${previousPhase.phase_index ?? ""}`] : [];
  }
  const raw = String((phase.annotations || {}).depends || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => resolvePhaseDependency(item, aliasMap))
    .filter((item): item is PlanPhase => item !== null)
    .map((item) => `phase${item.phase_index ?? ""}`);
}

export function phaseStatus(phase: PlanPhase): string {
  const tasks = phase.tasks || [];
  if (tasks.length === 0) return "completed";
  if (tasks.every((task) => task.marker === "x" || task.marker === "-")) return "completed";
  if (tasks.some((task) => task.marker === "!")) return "blocked";
  if (tasks.some((task) => task.marker === "~" || task.marker === "x" || task.marker === "-")) return "in_progress";
  return "pending";
}

export function claimsForPhase(root: string, phase: PlanPhase, topology = loadTopology(root)): Claim[] {
  const claims: Claim[] = [];
  for (const task of phase.tasks || []) {
    const repo = topology.polyrepo ? task.repo || topology.defaultRepo : ".";
    for (const file of task.files || []) {
      claims.push({
        phase_id: `phase${phase.phase_index}`,
        phase_index: phase.phase_index ?? 0,
        phase_title: phase.title,
        task_key: task.task_key ?? "",
        task_title: task.title,
        repo,
        file: normalizeClaimPath(file),
      });
    }
  }
  return claims;
}

export function phaseConflict(left: PhaseScheduleNode, right: PhaseScheduleNode): ClaimConflict[] {
  const conflicts: ClaimConflict[] = [];
  for (const leftClaim of left.claims || []) {
    for (const rightClaim of right.claims || []) {
      if (leftClaim.repo !== rightClaim.repo) continue;
      if (!claimsOverlap(leftClaim.file, rightClaim.file)) continue;
      conflicts.push({ left: leftClaim, right: rightClaim });
    }
  }
  return conflicts;
}

export function groupReadyPhases(readyPhases: PhaseScheduleNode[]): { groups: PhaseScheduleNode[][]; conflicts: ClaimConflict[] } {
  const groups: PhaseScheduleNode[][] = [];
  const conflicts: ClaimConflict[] = [];
  for (const phase of readyPhases) {
    let placed = false;
    for (const group of groups) {
      const groupConflicts = group.flatMap((existing) => phaseConflict(existing, phase));
      if (groupConflicts.length === 0) {
        group.push(phase);
        placed = true;
        break;
      }
      conflicts.push(...groupConflicts);
    }
    if (!placed) groups.push([phase]);
  }
  return { groups, conflicts };
}

export function detectPhaseCycles(phaseNodes: PhaseScheduleNode[]): string[][] {
  const byId = new Map(phaseNodes.map((phase) => [phase.phase_id, phase]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push(stack.slice(start).concat(id));
      return;
    }
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id);
    for (const dep of (node && node.depends_on) || []) visit(dep);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const phase of phaseNodes) visit(phase.phase_id);
  return cycles;
}

export function topologicalPhaseWaves(phaseNodes: PhaseScheduleNode[]): string[][] {
  const remaining = new Map(phaseNodes.map((phase) => [phase.phase_id, { ...phase }]));
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const wave = Array.from(remaining.values())
      .filter((phase) => phase.depends_on.every((dep) => completed.has(dep)))
      .sort((a, b) => a.phase_index - b.phase_index);
    if (wave.length === 0) break;
    waves.push(wave.map((phase) => phase.phase_id));
    for (const phase of wave) {
      completed.add(phase.phase_id);
      remaining.delete(phase.phase_id);
    }
  }
  return waves;
}

export function phaseSchedule(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const plan = parsePlanFile(track.plan_path);
  const topology = loadTopology(root);
  const aliasMap = new Map<string, PlanPhase>();
  for (const phase of plan.phases || []) {
    for (const alias of phaseAliases(phase)) aliasMap.set(alias, phase);
  }

  const errors: CoreResult[] = [];
  const phases: PhaseScheduleNode[] = (plan.phases || []).map((phase, index, all) => {
    const rawDepends = Object.prototype.hasOwnProperty.call(phase.annotations || {}, "depends")
      ? String((phase.annotations || {}).depends || "").trim()
      : null;
    const unknownDepends = rawDepends == null || rawDepends === ""
      ? []
      : rawDepends
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !resolvePhaseDependency(item, aliasMap));
    for (const dep of unknownDepends) {
      errors.push({ phase_id: `phase${phase.phase_index}`, message: `Unknown phase dependency: ${dep}` });
    }
    const dependsOn = phaseDependencyIds(phase, all[index - 1], aliasMap);
    const claims = claimsForPhase(root, phase, topology);
    return {
      phase_id: `phase${phase.phase_index}`,
      phase_index: phase.phase_index ?? index + 1,
      title: phase.title,
      execution: asString(phase.annotations?.execution, "sequential"),
      depends_on: dependsOn,
      status: phaseStatus(phase),
      task_counts: taskCounts({ phases: [phase] }),
      claims,
      tasks: (phase.tasks || []).map((task) => ({
        task_key: task.task_key ?? "",
        task_index: task.task_index ?? 0,
        title: task.title,
        marker: task.marker,
        repo: task.repo || (topology.polyrepo ? topology.defaultRepo : "."),
        files: task.files || [],
        depends: task.depends || [],
        labels: task.labels || [],
      })),
    };
  });
  const cycles = detectPhaseCycles(phases);
  for (const cycle of cycles) {
    errors.push({ phase_id: cycle[0] || null, message: `Phase dependency cycle: ${cycle.join(" -> ")}` });
  }
  errors.push(...unresolvedPlanRepos(root, track, args));
  const completed = new Set(phases.filter((phase) => phase.status === "completed").map((phase) => phase.phase_id));
  const ready = errors.length === 0
    ? phases
      .filter((phase) => !["completed", "blocked"].includes(phase.status))
      .filter((phase) => phase.depends_on.every((dep) => completed.has(dep)))
    : [];
  const { groups, conflicts } = groupReadyPhases(ready);
  return {
    ok: errors.length === 0,
    track_id: track.track_id,
    phases,
    topological_waves: topologicalPhaseWaves(phases),
    ready_phases: ready.map((phase) => phase.phase_id),
    ready_groups: groups.map((group) => group.map((phase) => phase.phase_id)),
    conflict_splits: conflicts.map((conflict) => ({
      repo: conflict.left.repo,
      file: conflict.left.file === conflict.right.file ? conflict.left.file : `${conflict.left.file} <-> ${conflict.right.file}`,
      left_phase: conflict.left.phase_id,
      right_phase: conflict.right.phase_id,
      left_task: conflict.left.task_key,
      right_task: conflict.right.task_key,
    })),
    errors,
  };
}
