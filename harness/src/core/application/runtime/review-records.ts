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

import { CoreResult } from "./contracts";
import { appendJsonl, patchJsonFile, readJson, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { providerEvidenceRequirement, providerFromConfig } from "./quality-gates";
import { gitRevParse, reviewedShasForTrack } from "./repo-resolution";
import { asArray } from "./status";
import { controlPlaneSyncSafety, gitIdentity, runCommand } from "../../infrastructure/runtime/system";
import { beginTrace, commitTrace } from "./commit-trace";
import { findTrack } from "./track-context";
import { reviewGate } from "./track-mutations";

export function recordReview(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  return withTrackLock(root, track.track_id, () => recordReviewUnlocked(root, track, args));
}

export function recordReviewUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const traceBefore = beginTrace(root);
  const verdict = args.verdict || "";
  if (!["approved", "changes_requested"].includes(verdict)) {
    return { ok: false, error: `Invalid review verdict: ${verdict}` };
  }
  const reviewer = args.reviewer || gitIdentity(root);
  const pins = reviewedShasForTrack(root, track, args);
  if (pins.ok === false) return pins;
  const metadata = patchJsonFile(track.metadata_path, (current) => {
    const existing = asJsonObject(current.review);
    const existingReviewer = asOptionalString(existing.reviewer);
    const existingVerdict = asOptionalString(existing.verdict);
    const existingBlockingCount = Number(existing.blocking_count || 0);
    if (
      verdict === "approved" &&
      args.allowOverride !== true &&
      existingReviewer &&
      existingReviewer !== reviewer &&
      (existingVerdict === "changes_requested" || existingBlockingCount > 0)
    ) {
      throw new Error("Approval would override another reviewer's open changes_requested verdict");
    }
    current.review = {
      verdict,
      blocking_count: Number(args.blockingCount || 0),
      date: args.date || utcNow(),
      reviewer: reviewer || null,
      coverage: args.coverage ?? current.last_coverage ?? null,
      self_reviewed: Boolean(reviewer && current.owner && reviewer === current.owner),
      reviewed_sha: asOptionalString(pins.reviewed_sha) || null,
      reviewed_shas: asJsonObject(pins.reviewed_shas),
      review_seq: Number(existing.review_seq || 0) + 1,
    };
    return current;
  }, { lock: false });
  if (!metadata.ok) {
    return {
      ok: false,
      track_id: track.track_id,
      stage: "metadata_patch",
      error: metadata.error,
      requires_override: /override another reviewer/.test(metadata.error || ""),
      metadata,
    };
  }
  const gate = reviewGate(root, track.track_id, args);
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "review",
    subject: `record ${track.track_id} review`,
    before: traceBefore,
    files: [
      path.relative(root, track.metadata_path),
    ],
    trackId: track.track_id,
    note: {
      verdict,
      blocking_count: Number(args.blockingCount || 0),
    },
  });
  return { ok: controlCommit.ok !== false, track_id: track.track_id, review: asJsonObject(metadata.value).review, metadata, gate, control_commit: controlCommit };
}

export function reviewEvidencePath(track: CadreTrack): string {
  return path.join(track.dir, "review-evidence.json");
}

export function reviewEvidence(root: string, trackId: string | null | undefined): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const evidencePath = reviewEvidencePath(track);
  const evidence = readJson<JsonObject>(evidencePath, {
    track_id: track.track_id,
    entries: [],
  });
  return {
    ok: true,
    track_id: track.track_id,
    path: path.relative(root, evidencePath),
    evidence,
  };
}

export function providerEvidence(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  return withTrackLock(root, track.track_id, () => providerEvidenceUnlocked(root, track, args));
}

export function providerEvidenceUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const traceBefore = beginTrace(root);
  const evidencePath = reviewEvidencePath(track);
  const existing = readJson<JsonObject>(evidencePath, {
    track_id: track.track_id,
    entries: [],
  });
  const entries = Array.isArray(existing.entries) ? existing.entries.map(asJsonObject) : [];
  const findings = Array.isArray(args.findings) ? args.findings.map(asJsonObject) : [];
  const blockingCount = findings.filter((finding) =>
    finding.blocking === true || asString(finding.severity) === "blocking"
  ).length;
  const provider = args.provider || providerFromConfig(root, args);
  const fetched = args.evidence || args.providerEvidence || args.provider_evidence || null;
  const providerStatus = fetched ? asJsonObject(fetched) : null;
  if (!providerStatus && args.fetch !== false) {
    return {
      ok: false,
      track_id: track.track_id,
      stage: "provider_mcp_evidence_required",
      provider,
      requirement: providerEvidenceRequirement(root, { ...args, trackId: track.track_id }),
    };
  }
  const entry: JsonObject = {
    id: `review-${entries.length + 1}`,
    recorded_at: utcNow(),
    provider,
    reviewer: args.reviewer || gitIdentity(root) || null,
    reviewed_sha: args.reviewedSha || args.reviewed_sha || gitRevParse(root, "HEAD"),
    blocking_count: Number(args.blockingCount ?? blockingCount),
    verdict: args.verdict || null,
    findings,
    evidence: providerStatus,
    notes: asOptionalString(args.notes) || null,
  };
  const next = {
    ...existing,
    track_id: track.track_id,
    entries: [...entries, entry],
    updated_at: entry.recorded_at,
  };
  writeJson(evidencePath, next);
  appendJsonl(path.join(track.dir, "review-evidence.jsonl"), entry);
  const metadata = patchJsonFile(track.metadata_path, (current) => {
    current.review_evidence = {
      path: path.relative(root, evidencePath),
      entries: asArray(next.entries).length || entries.length + 1,
      latest_id: entry.id,
      latest_recorded_at: entry.recorded_at,
      provider,
      blocking_count: entry.blocking_count,
    };
    return current;
  }, { lock: false });
  if (!metadata.ok) return { ok: false, track_id: track.track_id, stage: "metadata_patch", metadata };
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "review",
    action: "provider_evidence",
    subject: `record ${track.track_id} evidence`,
    before: traceBefore,
    files: [
      path.relative(root, evidencePath),
      path.relative(root, path.join(track.dir, "review-evidence.jsonl")),
      path.relative(root, track.metadata_path),
    ],
    trackId: track.track_id,
    note: {
      provider,
      evidence_id: entry.id,
      blocking_count: entry.blocking_count,
      reviewed_sha: entry.reviewed_sha,
    },
  });
  return {
    ok: controlCommit.ok !== false,
    track_id: track.track_id,
    path: path.relative(root, evidencePath),
    entry,
    metadata,
    control_commit: controlCommit,
  };
}

export function syncControlPlane(root: string, args: RuntimeArgs = {}): CoreResult {
  const topology = loadTopology(root);
  if (topology.config.sync_mode !== "shared") {
    return { ok: true, skipped: true, reason: "sync_mode is not shared", commands: [] };
  }
  const mode = args.mode || "pre";
  const remote = asOptionalString(topology.config.control_remote) || "origin";
  const branch = asOptionalString(topology.config.control_branch) || "main";
  const commands: CommandResult[] = [];
  commands.push(runCommand("git", ["config", "merge.ours.driver", "true"], { cwd: root }));
  const safety = controlPlaneSyncSafety(root, mode, remote, branch);
  if (!safety.ok) {
    return { ok: false, mode, remote, branch, safety, commands };
  }
  if (mode === "pre") {
    commands.push(runCommand("git", ["pull", "--rebase", remote, branch], { cwd: root }));
  } else if (mode === "post") {
    commands.push(runCommand("git", ["push", remote, branch], { cwd: root }));
  } else {
    return { ok: false, error: `Invalid sync mode: ${mode}`, commands };
  }
  return { ok: commands.every((cmd) => cmd.ok), mode, remote, branch, safety, commands };
}
