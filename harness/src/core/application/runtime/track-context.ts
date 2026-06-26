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

import { CoreResult, RepoRuntimeInfo } from "./contracts";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { branchSetForTrack } from "./branch-set";
import { holdInfo, listTracks, parsePlanFile, taskCounts } from "./track-schedule";

export function findTrack(root: string, trackId: string | null | undefined): CadreTrack | null {
  return listTracks(root).find((item) => item.track_id === trackId) || null;
}

export function priorityRank(priority: unknown): number {
  const ranks: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return ranks[String(priority || "medium").toLowerCase()] ?? 2;
}

export function trackContext(root: string, trackId: string | null | undefined): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const topology = loadTopology(root);
  const plan = parsePlanFile(track.plan_path);
  const hold = holdInfo(track);
  const branchSet = branchSetForTrack(root, track);
  const worktrees: CoreResult[] = [];
  if (track.metadata.worktree_path) {
    const abs = path.resolve(root, track.metadata.worktree_path);
    worktrees.push({
      repo: ".",
      path: track.metadata.worktree_path,
      exists: fileExists(abs),
      git_branch: track.metadata.git_branch || `track/${track.track_id}`,
    });
  }
  const reposMetadata = isRecord(track.metadata.repos) ? track.metadata.repos : null;
  if (reposMetadata) {
    for (const [repo, rawInfo] of Object.entries(reposMetadata)) {
      const info = asJsonObject(rawInfo) as RepoRuntimeInfo;
      const submodulePath = info.submodule_path || "";
      const worktreePath = info.worktree_path || "";
      worktrees.push({
        repo,
        submodule_path: submodulePath,
        path: worktreePath,
        exists: worktreePath ? fileExists(path.resolve(root, worktreePath)) : false,
        git_branch: info.git_branch || `track/${track.track_id}`,
        base_branch: info.base_branch || "main",
      });
    }
  }
  return {
    ok: true,
    root,
    topology: {
      polyrepo: topology.polyrepo,
      default_repo: topology.defaultRepo,
      sync_mode: topology.config.sync_mode || "local",
    },
    track: {
      track_id: track.track_id,
      status: track.metadata.status || "new",
      name: track.metadata.name || track.metadata.description || track.track_id,
      priority: track.metadata.priority || "medium",
      owner: track.metadata.owner || null,
      reviewer: track.metadata.reviewer || null,
      git_branch: track.metadata.git_branch || `track/${track.track_id}`,
      metadata_path: path.relative(root, track.metadata_path || path.join(track.dir, "metadata.json")),
      plan_path: path.relative(root, track.plan_path),
      spec_path: path.relative(root, track.spec_path),
      tags: asStringArray(track.metadata.tags),
      review: track.metadata.review || null,
      last_coverage: track.metadata.last_coverage ?? null,
    },
    hold,
    task_counts: taskCounts(plan),
    plan,
    branch_set: branchSet,
    worktrees,
  };
}
