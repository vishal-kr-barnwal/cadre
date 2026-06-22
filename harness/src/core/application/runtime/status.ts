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
import { CoreResult, TrackSummary } from "./contracts";
import { fileExists, readJson, utcNow } from "../../infrastructure/runtime/json-store";
import { trackPlanJsonPath, trackSpecJsonPath } from "./plan-docs";
import { loadTopology, providerMcpAvailability } from "../../infrastructure/runtime/project-config";
import { commandExists, gitIdentity, runCommand } from "../../infrastructure/runtime/system";
import { holdInfo, listTracks, parsePlanFile, taskCounts } from "./track-schedule";

export const TRACKS_INDEX_SCHEMA = "cadre.tracks_index.v1";

export function liveStatus(root: string): CoreResult {
  const tracks = listTracks(root);
  const identity = gitIdentity(root);
  const byStatus = new Map<string, number>();
  const activeTracks: CoreResult[] = [];
  for (const track of tracks) {
    const status = track.metadata.status || "new";
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    if (status === "in_progress") {
      const plan = parsePlanFile(track.plan_path);
      activeTracks.push({
        track_id: track.track_id,
        name: track.metadata.name || track.metadata.description || track.track_id,
        owner: track.metadata.owner || null,
        git_branch: track.metadata.git_branch || `track/${track.track_id}`,
        task_counts: taskCounts(plan),
      });
    }
  }
  return {
    root,
    identity,
    total_tracks: tracks.length,
    by_status: Object.fromEntries(Array.from(byStatus.entries()).sort()),
    active_tracks: activeTracks,
  };
}

export function teamStatus(root: string): CoreResult {
  const tracks = listTracks(root);
  const byOwner = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const track of tracks) {
    const owner = track.metadata.owner || "(unowned)";
    const status = track.metadata.status || "new";
    byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }
  return {
    root,
    identity: gitIdentity(root),
    total_tracks: tracks.length,
    by_owner: Object.fromEntries(Array.from(byOwner.entries()).sort()),
    by_status: Object.fromEntries(Array.from(byStatus.entries()).sort()),
    tracks: tracks.map((track) => ({
      track_id: track.track_id,
      status: track.metadata.status || "new",
      name: track.metadata.name || track.metadata.description || track.track_id,
      priority: track.metadata.priority || "medium",
      owner: track.metadata.owner || null,
      reviewer: track.metadata.reviewer || null,
      review_verdict: track.metadata.review ? track.metadata.review.verdict : null,
    })),
  };
}

export function asArray(value: unknown): CoreResult[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.items)) return value.items.filter(isRecord).map(asJsonObject);
  if (isRecord(value) && Array.isArray(value.issues)) return value.issues.filter(isRecord).map(asJsonObject);
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord).map(asJsonObject);
  return [];
}

export function taskMarkerName(marker: string): string {
  const names: Record<string, string> = {
    "~": "in_progress",
    "!": "blocked",
    "x": "completed",
    "-": "skipped",
    " ": "pending",
  };
  return names[marker] || "pending";
}

export function metadataTrackSummary(track: CadreTrack): TrackSummary {
  return {
    track_id: track.track_id,
    name: track.metadata.name || track.metadata.description || track.track_id,
    status: track.metadata.status || "new",
    priority: track.metadata.priority || "medium",
    owner: track.metadata.owner || null,
    reviewer: track.metadata.reviewer || null,
    tags: asStringArray(track.metadata.tags),
    review: track.metadata.review ? asJsonObject(track.metadata.review) : null,
  };
}

export function lspRuntimeSummary(root: string): CoreResult {
  const configPath = path.join(root, "cadre", "lsp.json");
  const config = readJson<JsonObject | null>(configPath, null);
  const servers = isRecord(config) && Array.isArray(config.servers)
    ? config.servers.map((server) => asJsonObject(server))
    : [];
  const entries = servers.map((server) => {
    const command = asOptionalString(server.command);
    return {
      id: asOptionalString(server.id) || command || "unknown",
      command: command || null,
      available: command ? commandExists(command, root) : false,
    };
  });
  return {
    configured: Boolean(config),
    path: path.relative(root, configPath),
    server_count: entries.length,
    available_count: entries.filter((entry) => entry.available === true).length,
    missing_count: entries.filter((entry) => entry.available !== true).length,
    missing: entries.filter((entry) => entry.available !== true).map((entry) => entry.id),
    daemon: {
      status_packet: "cadre_intel action lsp_daemon_status",
      shutdown_packet: "cadre_intel action lsp_daemon_shutdown",
      max_clients_default: 8,
      idle_eviction_ms_default: 600000,
    },
  };
}

export function trackIndexPayload(root: string, tracks = listTracks(root)): JsonObject {
  const counts: Record<string, number> = {
    new: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    skipped: 0,
  };
  const entries = tracks
    .sort((a, b) => a.track_id.localeCompare(b.track_id))
    .map((track) => {
      const summary = metadataTrackSummary(track);
      const status = summary.status || "new";
      counts[status] = (counts[status] || 0) + 1;
      return {
        ...summary,
        metadata_path: path.relative(root, track.metadata_path),
        spec_path: path.relative(root, trackSpecJsonPath(track)),
        plan_path: path.relative(root, trackPlanJsonPath(track)),
      };
    });
  return {
    version: 1,
    schema: TRACKS_INDEX_SCHEMA,
    generated_at: utcNow(),
    counts,
    tracks: entries,
  };
}

export function teamBoard(root: string, args: RuntimeArgs = {}): CoreResult {
  const tracks = listTracks(root);
  const identity = gitIdentity(root);
  const scope = args.mine === true ? "mine" : "all";
  const byId = new Map<string, CadreTrack>(tracks.map((track) => [track.track_id, track]));
  const wip: CoreResult[] = [];
  const reviewQueue: CoreResult[] = [];
  const blockers: CoreResult[] = [];
  const handoffs: CoreResult[] = [];

  for (const track of tracks) {
    const summary = metadataTrackSummary(track);
    const hold = holdInfo(track);
    if (
      summary.status === "in_progress" ||
      summary.status === "blocked" ||
      hold.owner ||
      hold.lease_owner
    ) {
      if (scope !== "mine" || summary.owner === identity || hold.owner === identity || hold.lease_owner === identity) {
        wip.push({ ...summary, hold });
      }
    }

    if (summary.review && (summary.review.verdict === "changes_requested" || Number(summary.review.blocking_count || 0) > 0)) {
      reviewQueue.push({ ...summary, review_state: "changes_requested" });
    } else if (summary.review && summary.review.verdict === "approved") {
      reviewQueue.push({ ...summary, review_state: "ready_to_ship" });
    }

    const deps = Array.isArray(track.metadata.depends_on) ? track.metadata.depends_on.filter((dep): dep is string => typeof dep === "string") : [];
    for (const dep of deps) {
      const depTrack = byId.get(dep);
      if (!depTrack || depTrack.metadata.status !== "completed") {
        blockers.push({
          kind: "track_dependency",
          track_id: track.track_id,
          blocked_on: dep,
          blocked_on_status: depTrack ? depTrack.metadata.status || "new" : "missing",
        });
      }
    }
    const plan = parsePlanFile(track.plan_path);
    for (const phase of plan.phases || []) {
      for (const task of phase.tasks || []) {
        if (task.marker === "!" || task.marker === "~") {
          blockers.push({
            kind: taskMarkerName(task.marker),
            track_id: track.track_id,
            phase: phase.phase_index,
            task: task.task_index,
            task_key: task.task_key,
            title: task.title,
          });
        }
      }
    }
  }

  const dedupReview = new Map();
  for (const item of reviewQueue) {
    const key = `${item.track_id}:${item.review_state || ""}`;
    if (!dedupReview.has(key)) dedupReview.set(key, item);
  }

  return {
    ok: true,
    root,
    identity,
    scope,
    generated_at: utcNow(),
    summary: teamStatus(root),
    wip,
    incoming_handoffs: handoffs,
    review_queue: Array.from(dedupReview.values()),
    blockers,
    lsp: lspRuntimeSummary(root),
  };
}

export function gitSummary(root: string): CoreResult {
  if (!fileExists(root)) return { ok: false, exists: false };
  const branch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
  const head = runCommand("git", ["rev-parse", "--short", "HEAD"], { cwd: root });
  const status = runCommand("git", ["status", "--porcelain"], { cwd: root });
  return {
    ok: branch.ok || head.ok || status.ok,
    exists: true,
    branch: branch.ok ? branch.stdout.trim() : null,
    head: head.ok ? head.stdout.trim() : null,
    dirty_files: status.ok ? status.stdout.split(/\r?\n/).filter(Boolean).length : null,
    errors: [branch.stderr, head.stderr, status.stderr].filter(Boolean).join("\n").trim(),
  };
}

export function fleetStatus(root: string, args: RuntimeArgs = {}): CoreResult {
  const topology = loadTopology(root);
  const repos: CoreResult[] = [{
    name: ".",
    role: "control",
    path: ".",
    root,
    ...gitSummary(root),
  }];
  if (topology.polyrepo) {
    for (const raw of Array.isArray(topology.repos.repos) ? topology.repos.repos : []) {
      const repo = asJsonObject(raw);
      const name = asOptionalString(repo.name) || asOptionalString(repo.submodule_path) || "unknown";
      const rel = asOptionalString(repo.submodule_path) || "";
      const repoRoot = rel ? path.resolve(root, rel) : root;
      repos.push({
        name,
        role: "product",
        path: rel,
        root: repoRoot,
        enabled: repo.enabled !== false,
        ...gitSummary(repoRoot),
      });
    }
  }
  return {
    ok: true,
    root,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    repos,
    provider: providerMcpAvailability(root, args),
    lsp: lspRuntimeSummary(root),
    collisions: args.includeCollisions === false ? null : collisionScan(root),
  };
}

export function availableWork(root: string): CoreResult {
  const tracks = listTracks(root);
  const byId = new Map(tracks.map((track) => [track.track_id, track]));
  const available: CoreResult[] = [];
  const reclaimable: CoreResult[] = [];
  const now = Date.now();
  for (const track of tracks) {
    const status = track.metadata.status || "new";
    const owner = track.metadata.owner || null;
    const hold = holdInfo(track, now);
    const deps = Array.isArray(track.metadata.depends_on)
      ? track.metadata.depends_on.filter((dep): dep is string => typeof dep === "string")
      : [];
    const depsMet = deps.every((dep) => {
      const depTrack = byId.get(dep);
      return depTrack && depTrack.metadata.status === "completed";
    });
    if (status === "new" && !owner && depsMet) {
      available.push({
        track_id: track.track_id,
        priority: track.metadata.priority || "medium",
        description: track.metadata.description || track.metadata.name || track.track_id,
      });
    }
    const heldBy = hold.lease_owner || hold.owner;
    const stale = hold.lease_stale || hold.state_stale;
    if (depsMet && heldBy && stale && ["new", "in_progress", "blocked"].includes(status)) {
      reclaimable.push({
        track_id: track.track_id,
        status,
        priority: track.metadata.priority || "medium",
        description: track.metadata.description || track.metadata.name || track.track_id,
        held_by: heldBy,
        lease_age_minutes: hold.lease_age_minutes,
        state_age_minutes: hold.state_age_minutes,
      });
    }
  }
  return { root, available, reclaimable };
}

export function activeTrackId(root: string, identity: string | null = gitIdentity(root)): string | null {
  const tracks = listTracks(root);
  const topology = loadTopology(root);
  const active = tracks.filter((track) => (track.metadata.status || "new") === "in_progress");
  if (topology.config.sync_mode === "shared" && identity) {
    const mine = active.find((track) => track.metadata.owner === identity);
    if (mine) return mine.track_id;
  }
  return active[0]?.track_id || null;
}

export function selectedTrackId(root: string, args: RuntimeArgs = {}): string | null {
  return args.trackId || args.track_id || activeTrackId(root);
}
