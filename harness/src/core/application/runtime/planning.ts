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
import { branchSetForTrack, ensureIntegrationWorktree } from "./branch-set";
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

function taskSearchTokens(task: PlanTask): string[] {
  return Array.from(new Set(String(task.title || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 8)));
}

function suggestedRepoForFile(topology: Topology, file: string): string | null {
  if (!topology.polyrepo) return ".";
  const repos = Array.isArray(topology.repos.repos) ? topology.repos.repos : [];
  const match = repos.find((repo) => {
    const name = asOptionalString(repo.name);
    const submodule = asOptionalString(repo.submodule_path);
    return Boolean((submodule && file.startsWith(`${normalizeClaimPath(submodule)}/`)) || (name && file.startsWith(`${name}/`)));
  });
  return asOptionalString(match?.name) || asOptionalString(topology.repos.default_repo) || null;
}

function missingClaimSuggestions(root: string, topology: Topology, tasks: PlanTask[], limit: number): JsonObject[] {
  const workspaceFiles = listWorkspaceFiles(root)
    .filter((file) => languageForFile(file) !== "markdown")
    .slice(0, 5000);
  return tasks
    .filter((task) => asStringArray(task.files).length === 0 || (topology.polyrepo && !task.repo && !topology.repos.default_repo))
    .map((task) => {
      const tokens = taskSearchTokens(task);
      const proposedFiles = workspaceFiles
        .filter((file) => {
          const lower = file.toLowerCase();
          return tokens.some((token) => lower.includes(token));
        })
        .slice(0, limit);
      return {
        phase_index: task.phase_index,
        task_index: task.task_index,
        task_key: task.task_key,
        title: task.title,
        missing_files: asStringArray(task.files).length === 0,
        missing_repo: topology.polyrepo && !task.repo && !topology.repos.default_repo,
        proposed_repo: task.repo || (proposedFiles[0] ? suggestedRepoForFile(topology, proposedFiles[0]) : asOptionalString(topology.repos.default_repo) || null),
        proposed_files: proposedFiles,
        likely_tests: proposedFiles.flatMap((file) => likelyTestCandidatesForFile(root, file)).slice(0, limit),
        evidence: proposedFiles.length > 0 ? "workspace_file_name_match" : "no_workspace_filename_match",
      };
    });
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
  const limit = Number(args.limit || 50);
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
    missing_claim_suggestions: missingClaimSuggestions(root, topology, plan.tasks || [], Math.min(limit, 25)),
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
  const branchSet = branchSetForTrack(root, track, args);
  const execute = args.execute === true;
  const setup_results = execute ? branchSet.map((entry) => ensureIntegrationWorktree(entry)) : [];
  const plans = branchSet.map((entry, index) => {
    const result = setup_results[index];
    const resultEntry = isRecord(result?.entry) ? asJsonObject(result.entry) : entry;
    return {
      repo: entry.repo,
      source_root: entry.source_root,
      source_path: entry.source_path,
      worktree_path: entry.integration_worktree_path,
      integration_worktree: entry.integration_worktree,
      worker_root: entry.worker_root,
      branch: entry.track_branch,
      base: entry.base_branch,
      exists: result ? result.ok === true : entry.exists,
      current_branch: result ? asOptionalString(resultEntry.current_branch) : entry.current_branch,
      health: result ? asOptionalString(resultEntry.health) || entry.health : entry.health,
      branch_exists: entry.branch_exists,
      commands: entry.commands,
      setup_result: result || null,
    };
  });
  return {
    ok: setup_results.every((result) => result.ok !== false) && branchSet.every((entry) => entry.health === "ready" || entry.health === "missing"),
    root,
    track_id: track.track_id,
    execute,
    dry_run: !execute,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    branch_set: branchSet,
    plans,
    setup_results,
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
