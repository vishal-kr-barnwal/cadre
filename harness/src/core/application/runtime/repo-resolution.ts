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

import { collisionScan } from "./collision";
import { CoreResult, RepoExecutionEntry, RepoRuntimeInfo, TopologyWithConfig, WorkingRootError, WorkingRootResolution } from "./contracts";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { planIntegrity } from "./planning";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { implementationStyleGuides } from "./review-bundles";
import { asArray, availableWork, teamStatus } from "./status";
import { gitIdentity, runCommand } from "../../infrastructure/runtime/system";
import { branchSetEntryForRepo, branchSetForTrack, MONOREPO_REPO_KEY, taskRepo } from "./branch-set";
import { trackContext } from "./track-context";
import { claimTrack } from "./track-mutations";
import { parsePlanFile } from "./track-schedule";

export function topologyRepoEntries(topology: TopologyWithConfig): Record<string, RepoRuntimeInfo> {
  const entries: Record<string, RepoRuntimeInfo> = {};
  for (const raw of Array.isArray(topology.repos.repos) ? topology.repos.repos : []) {
    const repo = asJsonObject(raw);
    const name = asOptionalString(repo.name);
    if (!name) continue;
    entries[name] = {
      submodule_path: asOptionalString(repo.submodule_path) || "",
      base_branch: asOptionalString(repo.default_branch) || asOptionalString(repo.base_branch) || "main",
    };
  }
  return entries;
}

export function trackRepoEntries(root: string, track: CadreTrack): Record<string, RepoRuntimeInfo> {
  const topology = loadTopology(root);
  const entries = topologyRepoEntries(topology);
  const reposMetadata = isRecord(track.metadata.repos) ? track.metadata.repos : null;
  if (reposMetadata) {
    for (const [repo, rawInfo] of Object.entries(reposMetadata)) {
      entries[repo] = { ...entries[repo], ...(asJsonObject(rawInfo) as RepoRuntimeInfo) };
    }
  }
  return entries;
}

export function availableRepoNames(root: string, track: CadreTrack): string[] {
  return Object.keys(trackRepoEntries(root, track)).sort();
}

export function unresolvedWorkingRoot(root: string, track: CadreTrack, repo: string, task: PlanTask | null = null): WorkingRootError {
  return {
    ok: false,
    repo,
    path: "",
    source: "polyrepo-unresolved-repo",
    error: `Unknown polyrepo task repo "${repo}" for track ${track.track_id}`,
    unresolved_repo: repo,
    available_repos: availableRepoNames(root, track),
    track_id: track.track_id,
    task_key: task?.task_key,
  };
}

export function isWorkingRootError(value: WorkingRootResolution): value is WorkingRootError {
  return value.ok === false;
}

export function unresolvedPlanRepos(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult[] {
  const topology = loadTopology(root);
  if (!topology.polyrepo) return [];
  const entries = trackRepoEntries(root, track);
  const known = new Set(Object.keys(entries));
  const plan = parsePlanFile(track.plan_path);
  const errors: CoreResult[] = [];
  const seen = new Set<string>();
  for (const task of plan.tasks || []) {
    const repo = asOptionalString(args.repo) || task.repo || topology.defaultRepo;
    if (repo && known.has(repo)) continue;
    const key = `${repo || ""}:${task.task_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push({
      track_id: track.track_id,
      task_key: task.task_key,
      line: task.line,
      repo: repo || null,
      message: repo
        ? `Unknown polyrepo task repo "${repo}"`
        : "Task has no repo annotation and repos.json has no default_repo",
      available_repos: Array.from(known).sort(),
    });
  }
  return errors;
}

export function repoEntriesError(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult | null {
  const topology = loadTopology(root);
  if (!topology.polyrepo) return null;
  const entries = trackRepoEntries(root, track);
  const requested = asOptionalString(args.repo);
  const missing = requested
    ? (entries[requested] ? [] : [{ repo: requested, message: `Unknown polyrepo repo "${requested}"` }])
    : unresolvedPlanRepos(root, track, args);
  if (missing.length === 0) return null;
  return {
    ok: false,
    stage: "polyrepo_repo_resolution",
    track_id: track.track_id,
    errors: missing,
    available_repos: Object.keys(entries).sort(),
  };
}

export function resolveTaskWorkingRoot(root: string, track: CadreTrack, task: PlanTask | null = null, args: RuntimeArgs = {}): WorkingRootResolution {
  const explicitWorkingRoot = asOptionalString(args.workingRoot || args.workerRoot || args.worker_root || args.worktree);
  if (explicitWorkingRoot) {
    const candidate = path.isAbsolute(explicitWorkingRoot)
      ? explicitWorkingRoot
      : path.resolve(root, explicitWorkingRoot);
    return { repo: taskRepo(root, task, args), path: candidate, source: "argument.workingRoot" };
  }
  const repo = taskRepo(root, task, args);
  const branchEntry = branchSetEntryForRepo(root, track, repo, args);
  if (branchEntry && branchEntry.exists && branchEntry.health === "ready") {
    return {
      repo: branchEntry.repo,
      path: branchEntry.integration_worktree,
      source: "branch-set.integration_worktree",
      branch_set: branchEntry,
    };
  }
  const topology = loadTopology(root);
  if (topology.polyrepo) {
    const info = typeof repo === "string" ? trackRepoEntries(root, track)[repo] || {} : {};
    if (Object.keys(info).length > 0) {
      const rel = info.worktree_path || info.submodule_path || "";
      return {
        ok: true,
        repo,
        path: rel ? path.resolve(root, rel) : root,
        source: branchEntry ? "branch-set.integration_missing_fallback" : (info.worktree_path ? "metadata.repos.worktree_path" : "metadata.repos.submodule_path"),
        ...(branchEntry ? { branch_set: branchEntry } : {}),
      };
    }
    return unresolvedWorkingRoot(root, track, String(repo || ""), task);
  }
  if (track.metadata.worktree_path && !branchEntry) {
    const candidate = path.resolve(root, track.metadata.worktree_path);
    if (fileExists(candidate)) {
      return { repo: ".", path: candidate, source: "metadata.worktree_path" };
    }
  }
  return {
    ok: true,
    repo: MONOREPO_REPO_KEY,
    path: root,
    source: branchEntry ? "branch-set.integration_missing_fallback" : "project-root",
    ...(branchEntry ? { branch_set: branchEntry } : {}),
  };
}

export function repoEntriesForTrack(root: string, track: CadreTrack, args: RuntimeArgs = {}): RepoExecutionEntry[] {
  return branchSetForTrack(root, track, args).map((entry) => ({
    repo: entry.repo,
    root: entry.exists && entry.health === "ready" ? entry.integration_worktree : entry.source_root,
    path: entry.exists && entry.health === "ready" ? entry.integration_worktree_path : entry.source_path,
    base: entry.base_branch,
    head: entry.track_branch,
    source: entry.exists && entry.health === "ready" ? "branch-set.integration_worktree" : "branch-set.source_root",
    branch_set: entry,
  }));
}

export function gitRevParse(root: string, ref: string | null | undefined): string | null {
  if (!ref) return null;
  const result = runCommand("git", ["rev-parse", ref], { cwd: root });
  return result.ok ? result.stdout.trim() || null : null;
}

export function reviewedShasForTrack(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
  const supplied = args.reviewedShas || args.reviewed_shas || null;
  const entries = repoEntriesForTrack(root, track, args);
  const reviewedShas: Record<string, string | null> = {};
  const controlHead = (supplied && asOptionalString(supplied["."]))
    || args.reviewedSha
    || args.reviewed_sha
    || gitRevParse(root, track.metadata.git_branch || `track/${track.track_id}`)
    || gitRevParse(root, "HEAD");
  if (controlHead) reviewedShas["."] = controlHead;
  for (const entry of entries) {
    const repo = asString(entry.repo, ".");
    reviewedShas[repo] = (supplied && asOptionalString(supplied[repo]))
      || gitRevParse(asString(entry.root, root), asString(entry.head, "HEAD"))
      || gitRevParse(asString(entry.root, root), "HEAD");
  }
  return {
    reviewed_sha: controlHead || null,
    reviewed_shas: reviewedShas,
  };
}

export function implementationPrep(root: string, args: RuntimeArgs = {}): CoreResult {
  const identity = args.identity || gitIdentity(root);
  const team = teamStatus(root);
  const available = availableWork(root);
  let trackId = args.trackId || args.track_id || null;
  const warnings: string[] = [];
  const availableTracks = asArray(available.available);

  if (!trackId && availableTracks.length > 0) {
    trackId = asOptionalString(availableTracks[0]?.track_id) || null;
  }
  if (!trackId) {
    const teamTracks = asArray(team.tracks);
    const mine = teamTracks.find((track) => track.status === "in_progress" && (!track.owner || track.owner === identity));
    const anyOpen = teamTracks.find((track) => ["new", "in_progress", "blocked"].includes(asString(track.status)));
    trackId = asOptionalString((mine || anyOpen || {}).track_id) || null;
  }
  if (!trackId) {
    return {
      ok: false,
      root,
      identity,
      reason: "No available or incomplete track found",
      team,
      available,
    };
  }

  let claim = null;
  if (args.claim === true) {
    claim = claimTrack(root, trackId, { identity, takeover: args.takeover === true });
    if (!claim.ok) {
      return { ok: false, root, identity, selected_track: trackId, claim, team, available };
    }
  }

  const context = trackContext(root, trackId);
  const styleGuides = implementationStyleGuides(root, trackId, args);
  const collisions = collisionScan(root);
  const selectedCollisions = asArray(collisions.collisions).filter((collision) =>
    asStringArray(collision.track_ids).includes(trackId)
  );
  const integrity = planIntegrity(root, trackId);
  const foreignCollisions = selectedCollisions.filter((collision) =>
    asStringArray(collision.owners).some((owner) => owner && owner !== identity)
  );
  if (foreignCollisions.length > 0) {
    warnings.push(`${foreignCollisions.length} cross-owner file collision(s) involve the selected track`);
  }
  const contextHold = asJsonObject(context.hold);
  if (context.ok && contextHold.owner && identity && contextHold.owner !== identity) {
    warnings.push(`Selected track is held by ${contextHold.owner}`);
  }

  return {
    ok: context.ok && integrity.ok,
    root,
    identity,
    selected_track: trackId,
    claim,
    context,
    styleGuides,
    team_summary: {
      total_tracks: team.total_tracks,
      by_status: team.by_status,
      by_owner: team.by_owner,
    },
    available,
    collisions: selectedCollisions,
    integrity,
    warnings,
  };
}
