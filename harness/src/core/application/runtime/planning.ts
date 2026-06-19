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

import { normalizeClaimPath } from "./collision";
import { CoreResult } from "./contracts";
import { fileExists, safeName } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { repoEntriesError, repoEntriesForTrack, unresolvedPlanRepos } from "./repo-resolution";
import { findTrack } from "./track-context";
import { listTracks, parsePlanFile, parsePlanJson, phaseSchedule } from "./track-schedule";
import { markdownPayloadError, normalizePlanJson } from "./workflow-response";
import { lspImpact } from "./workspace-intel";

export function likelyTestCandidatesForFile(root: string, file: string): string[] {
  const normalized = normalizeClaimPath(file);
  if (!normalized) return [];
  const parsed = path.parse(normalized);
  const candidates = [
    path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
    path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`),
    path.join(parsed.dir, `${parsed.name}_test${parsed.ext}`),
    path.join("test", normalized),
    path.join("tests", normalized),
  ].map((candidate) => normalizeClaimPath(candidate));
  return Array.from(new Set(candidates.filter((candidate) => fileExists(path.join(root, candidate)))));
}

export function planAssist(root: string, args: RuntimeArgs = {}): CoreResult {
  const markdownError = markdownPayloadError(args);
  if (markdownError) return markdownError;
  const trackId = args.trackId || args.track_id || null;
  const track = trackId ? findTrack(root, trackId) : null;
  if (trackId && !track && !args.plan) return { ok: false, error: `Track not found: ${trackId}` };
  const topology = loadTopology(root);
  const plan = args.plan
    ? parsePlanJson(normalizePlanJson(String(trackId || asOptionalString(args.plan.track_id) || "draft"), args.plan))
    : track
      ? parsePlanFile(track.plan_path)
      : null;
  if (!plan) return { ok: false, error: "trackId or plan is required" };

  const repoErrors = track ? unresolvedPlanRepos(root, track, args) : [];
  const claims = (plan.tasks || []).map((task) => {
    const repo = topology.polyrepo ? task.repo || topology.defaultRepo : ".";
    return {
      phase_index: task.phase_index,
      task_index: task.task_index,
      task_key: task.task_key,
      title: task.title,
      repo,
      files: task.files || [],
      depends: task.depends || [],
      likely_tests: (task.files || []).flatMap((file) => likelyTestCandidatesForFile(root, file)),
    };
  });
  const fileClaims: Record<string, string[]> = {};
  for (const claim of claims) {
    const repo = asString(claim.repo, ".");
    if (!fileClaims[repo]) fileClaims[repo] = [];
    fileClaims[repo].push(...asStringArray(claim.files));
  }
  const rawFileClaims = Object.fromEntries(Object.entries(fileClaims).map(([repo, files]) => [repo, [...files]]));
  for (const repo of Object.keys(fileClaims)) {
    const files = fileClaims[repo] || [];
    fileClaims[repo] = Array.from(new Set(files.map(normalizeClaimPath).filter(Boolean))).sort();
  }
  const duplicateClaims = Object.entries(rawFileClaims).flatMap(([repo, files]) => {
    const counts = new Map<string, number>();
    for (const file of files) counts.set(file, (counts.get(file) || 0) + 1);
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([file, count]) => ({ repo, file, count }));
  });
  const phases = (plan.phases || []).map((phase) => {
    const phaseClaims = claims.filter((claim) => claim.phase_index === phase.phase_index);
    const phaseFiles = phaseClaims.flatMap((claim) => asStringArray(claim.files).map((file) => `${claim.repo}:${normalizeClaimPath(file)}`));
    return {
      phase_index: phase.phase_index,
      title: phase.title,
      execution: phase.annotations.execution || "sequential",
      tasks: phase.tasks.length,
      parallel_candidate: phaseClaims.length > 1 && new Set(phaseFiles).size === phaseFiles.length,
    };
  });
  const files = Array.from(new Set(Object.values(fileClaims).flat())).slice(0, Number(args.limit || 50));
  const semanticImpact = files.length > 0 ? lspImpact(root, { files, limit: args.limit || 50 }) : null;
  const schedule = track ? phaseSchedule(root, { ...args, trackId: track.track_id }) : null;
  return {
    ok: repoErrors.length === 0 && plan.ok !== false,
    root,
    track_id: track?.track_id || trackId,
    topology: {
      polyrepo: topology.polyrepo,
      default_repo: topology.defaultRepo,
    },
    claims,
    file_claims: fileClaims,
    duplicate_claims: duplicateClaims,
    likely_tests: Array.from(new Set(claims.flatMap((claim) => asStringArray(claim.likely_tests)))).sort(),
    phases,
    schedule,
    semantic_impact: semanticImpact,
    errors: [...(plan.errors || []), ...repoErrors],
    warnings: plan.warnings || [],
  };
}

export function worktreePlan(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
  const topology = loadTopology(root);
  const branch = args.branch || track.metadata.git_branch || `track/${track.track_id}`;
  const entries = topology.polyrepo
    ? repoEntriesForTrack(root, track, args)
    : [{
      repo: ".",
      root,
      path: ".",
      source: "project-root",
      base: args.base || "main",
      head: branch,
    }];
  const plans = entries.map((entry) => {
    const repo = asString(entry.repo, ".");
    const repoBranch = args.branch || entry.head || branch;
    const base = args.base || entry.base || "main";
    const relWorktree = topology.polyrepo
      ? `.worktrees/${track.track_id}/${safeName(repo)}`
      : asOptionalString(track.metadata.worktree_path) || `.worktrees/${track.track_id}`;
    const absWorktree = path.resolve(root, relWorktree);
    return {
      repo,
      source_root: entry.root,
      source_path: entry.path,
      worktree_path: relWorktree,
      branch: repoBranch,
      base,
      exists: fileExists(absWorktree),
      commands: [
        {
          command: "git",
          args: ["worktree", "add", "-B", repoBranch, absWorktree, base],
          cwd: entry.root,
        },
      ],
    };
  });
  return {
    ok: true,
    root,
    track_id: track.track_id,
    execute: false,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    plans,
  };
}

export function planIntegrity(root: string, trackId: string | null = null): CoreResult {
  const topology = loadTopology(root);
  const foundTrack = trackId ? findTrack(root, trackId) : null;
  const tracks: CadreTrack[] = trackId ? (foundTrack ? [foundTrack] : []) : listTracks(root);
  if (trackId && tracks.length === 0) return { ok: false, error: `Track not found: ${trackId}` };
  const errors: CoreResult[] = [];
  const warnings: JsonObject[] = [];
  for (const track of tracks) {
    const plan = parsePlanFile(track.plan_path);
    const seenKeys = new Set<string>();
    for (const phase of plan.phases) {
      const execution = phase.annotations.execution || "sequential";
      const claimedFiles = new Set<string>();
      for (const task of phase.tasks) {
        if (seenKeys.has(task.task_key)) {
          errors.push({ track_id: track.track_id, line: task.line, message: `Duplicate task key ${task.task_key}` });
        }
        seenKeys.add(task.task_key);
        if (!task.files || task.files.length === 0) {
          warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: "Missing <!-- files: ... --> annotation" });
        }
        if (topology.polyrepo && !task.repo && !topology.defaultRepo) {
          errors.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: "Task has no repo annotation and repos.json has no default_repo" });
        }
        for (const dep of task.depends || []) {
          if (!/^task\d+$|^phase\d+_task\d+$/.test(dep)) {
            warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: `Unrecognized dependency reference ${dep}` });
          }
        }
        if (execution === "parallel") {
          for (const file of task.files || []) {
            const normalized = `${task.repo || topology.defaultRepo || "."}:${normalizeClaimPath(file)}`;
            if (claimedFiles.has(normalized)) {
              warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: `Parallel phase repeats file claim ${normalized}` });
            }
            claimedFiles.add(normalized);
          }
        }
      }
    }
    errors.push(...unresolvedPlanRepos(root, track));
  }
  return { ok: errors.length === 0, root, checked_tracks: tracks.length, errors, warnings };
}
