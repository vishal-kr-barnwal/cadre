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
import { fileExists, patchJsonFile, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { trackLockName, withTrackLock } from "../../infrastructure/runtime/locking";
import { withGeneratedMarker } from "./markdown-docs";
import { appendCadreEvent } from "./native-state";
import { renderPlanMarkdown, trackPlanJsonPath } from "./plan-docs";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { regenIndex } from "./project-maintenance";
import { asArray } from "./status";
import { gitIdentity } from "../../infrastructure/runtime/system";
import { findTrack } from "./track-context";
import { holdInfo, listTracks, parsePlanFile } from "./track-schedule";

export function reviewGate(root: string, trackId: string, options: RuntimeArgs = {}): CoreResult {
  const track = listTracks(root).find((item) => item.track_id === trackId);
  if (!track) {
    return { ok: false, track_id: trackId, reasons: [`Track not found: ${trackId}`] };
  }
  const config = loadTopology(root).config || {};
  const review = track.metadata.review || null;
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!review) {
    if (config.allow_unreviewed_ship === true) {
      warnings.push("No recorded review verdict; allowed by config.allow_unreviewed_ship");
    } else {
      reasons.push("No recorded review verdict");
    }
  } else {
    if (review.verdict !== "approved") {
      reasons.push(`Review verdict is ${review.verdict || "absent"}`);
    }
    if ((review.blocking_count || 0) > 0) {
      reasons.push(`Review has ${review.blocking_count} blocking finding(s)`);
    }
    if (config.require_second_reviewer === true && review.self_reviewed === true) {
      reasons.push("Self-review is not sufficient when require_second_reviewer is true");
    }
    const hasPinnedReview = Boolean(review.reviewed_sha)
      || Boolean(review.reviewed_shas && Object.values(review.reviewed_shas).some(Boolean));
    if (!hasPinnedReview) {
      if (config.allow_unpinned_review_ship === true) {
        warnings.push("Review does not record reviewed_sha/reviewed_shas; allowed by config.allow_unpinned_review_ship");
      } else {
        reasons.push("Review does not record reviewed_sha/reviewed_shas");
      }
    } else if (review.reviewed_sha && options.headSha && options.headSha !== review.reviewed_sha) {
      reasons.push(`Head ${options.headSha} differs from reviewed_sha ${review.reviewed_sha}; re-review required`);
    }
    if (review.reviewed_shas && options.headShas && typeof options.headShas === "object") {
      for (const [repo, reviewedSha] of Object.entries(review.reviewed_shas)) {
        const headSha = options.headShas[repo];
        if (typeof reviewedSha === "string" && typeof headSha === "string" && headSha !== reviewedSha) {
          reasons.push(`Repo ${repo} head ${headSha} differs from reviewed_shas.${repo} ${reviewedSha}; re-review required`);
        }
      }
    }
  }
  return {
    ok: reasons.length === 0,
    track_id: track.track_id,
    review,
    reasons,
    warnings,
  };
}

export function metadataPatch(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const patch = args.patch && typeof args.patch === "object" ? args.patch : null;
  if (!patch) return { ok: false, error: "patch object is required" };
  const result = patchJsonFile(track.metadata_path, (metadata) => ({ ...metadata, ...patch }), {
    root,
    lockName: trackLockName(track.track_id),
  });
  return {
    ok: result.ok,
    track_id: track.track_id,
    metadata_path: path.relative(root, track.metadata_path),
    patch_keys: Object.keys(patch).sort(),
    result,
    event: result.ok ? appendCadreEvent(root, {
      kind: "metadata_updated",
      workflow: "metadata_patch",
      track_id: track.track_id,
      patch_keys: Object.keys(patch).sort(),
      tags: asStringArray(asJsonObject(patch).tags),
      depends_on: asStringArray(asJsonObject(patch).depends_on),
    }) : null,
  };
}

export function heartbeatTrack(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  return withTrackLock(root, track.track_id, () => heartbeatTrackUnlocked(root, track, args));
}

export function heartbeatTrackUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const identity = args.identity || gitIdentity(root) || track.metadata.owner || null;
  const now = asOptionalString(args.now) || utcNow();
  const topology = loadTopology(root);
  const metadataResult = patchJsonFile(track.metadata_path, (metadata) => {
    if (topology.config.sync_mode === "shared") {
      const existingLease = asJsonObject(metadata.lease);
      metadata.lease = {
        ...existingLease,
        owner: identity,
        acquired_at: asOptionalString(existingLease.acquired_at) || now,
        heartbeat_at: now,
      };
    }
    metadata.owner = metadata.owner || identity;
    metadata.updated_at = now;
    return metadata;
  }, { lock: false });
  const statePath = path.join(track.dir, "implement_state.json");
  let stateResult = null;
  if (fileExists(statePath)) {
    stateResult = patchJsonFile(statePath, (state) => ({
      ...state,
      owner: state.owner || identity,
      last_updated: now,
    }), { lock: false });
  }
  return {
    ok: metadataResult.ok && (!stateResult || stateResult.ok),
    track_id: track.track_id,
    owner: identity,
    heartbeat_at: now,
    metadata: metadataResult,
    state: stateResult,
  };
}

export function claimTrack(root: string, trackId: string, options: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  return withTrackLock(root, track.track_id, () => claimTrackUnlocked(root, track, options));
}

export function claimTrackUnlocked(root: string, track: CadreTrack, options: RuntimeArgs = {}): CoreResult {
  const identity = options.identity || gitIdentity(root);
  if (!identity) return { ok: false, error: "No git identity found for claim" };
  const now = utcNow();
  const hold = holdInfo(track);
  const heldBy = hold.lease_owner || hold.owner;
  const stale = hold.lease_stale || hold.state_stale || !heldBy || heldBy === identity;
  if (heldBy && heldBy !== identity && !stale && options.takeover !== true) {
    return { ok: false, claimed: false, reason: "foreign-held", held_by: heldBy, hold };
  }

  const topology = loadTopology(root);
  const metadataResult = patchJsonFile(track.metadata_path, (metadata) => {
    metadata.owner = identity;
    metadata.updated_at = now;
    if (topology.config.sync_mode === "shared") {
      const existingLease = asJsonObject(metadata.lease);
      metadata.lease = {
        ...existingLease,
        owner: identity,
        acquired_at: existingLease.owner === identity ? asOptionalString(existingLease.acquired_at) || now : now,
        heartbeat_at: now,
      };
    }
    return metadata;
  }, { lock: false });
  if (!metadataResult.ok) return { ok: false, claimed: false, error: "Metadata claim patch failed", metadata: metadataResult };
  const statePath = path.join(track.dir, "implement_state.json");
  writeJson(statePath, {
    status: "starting",
    owner: identity,
    track_id: track.track_id,
    last_updated: now,
  });
  const event = appendCadreEvent(root, {
    kind: "track_claimed",
    workflow: "claim",
    track_id: track.track_id,
    owner: identity,
    previous_owner: heldBy || null,
  });
  return {
    ok: true,
    claimed: true,
    track_id: track.track_id,
    owner: identity,
    previous_hold: hold,
    metadata: metadataResult,
    event,
  };
}

export function setTrackStatus(root: string, trackId: string, status: string): CoreResult {
  if (!VALID_STATUSES.has(status)) {
    return {
      ok: false,
      error: `Invalid status: ${status}`,
      valid_statuses: Array.from(VALID_STATUSES),
    };
  }
  const track = listTracks(root).find((item) => item.track_id === trackId);
  if (!track) {
    return { ok: false, error: `Track not found: ${trackId}` };
  }
  return withTrackLock(root, trackId, () => {
    const metadata = patchJsonFile(track.metadata_path, (current) => ({
      ...current,
      status,
    }), { lock: false });
    if (!metadata.ok) {
      return { ok: false, track_id: trackId, status, stage: "metadata_patch", metadata };
    }
    const regen = regenIndex(root);
    const event = appendCadreEvent(root, {
      kind: "status_changed",
      workflow: "set_status",
      track_id: trackId,
      status,
    });
    return {
      ok: Boolean(regen.ok),
      track_id: trackId,
      status,
      metadata,
      regen,
      event,
    };
  });
}

export function recordTaskResultUnlocked(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const plan = parsePlanFile(track.plan_path);
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };

  const planJsonPath = trackPlanJsonPath(track);
  const commitSha = args.commitSha ? String(args.commitSha).trim() : "";
  const recordedAt = utcNow();
  const lastTaskResult = {
    phase_index: phaseIndex,
    task_index: taskIndex,
    task_key: task.task_key,
    status: args.status || "completed",
    commit_sha: commitSha || null,
    repo: args.repo || task.repo || null,
    working_root: args.workingRoot || null,
    recorded_at: recordedAt,
  };
  const metadata = patchJsonFile(track.metadata_path, (current) => {
    if (typeof args.coverage === "number") current.last_coverage = args.coverage;
    if (args.lastTestRun && typeof args.lastTestRun === "object") current.last_test_run = args.lastTestRun;
    if (isRecord(args.manualVerificationEvidence)) current.last_manual_verification_result = asJsonObject(args.manualVerificationEvidence);
    current.last_task_result = lastTaskResult;
    return current;
  });
  if (!metadata.ok) {
    return { ok: false, track_id: track.track_id, stage: "metadata_patch", metadata };
  }
  if (fileExists(planJsonPath)) {
    const planPatch = patchJsonFile(planJsonPath, (current) => {
      const phases = asArray(current.phases).map((rawPhase) => {
        const currentPhase = asJsonObject(rawPhase);
        if (Number(currentPhase.phase_index || currentPhase.index) !== phaseIndex) return currentPhase;
        return {
          ...currentPhase,
          tasks: asArray(currentPhase.tasks).map((rawTask) => {
            const currentTask = asJsonObject(rawTask);
            if (Number(currentTask.task_index || currentTask.index) !== taskIndex) return currentTask;
            const commitShas = Array.from(new Set([
              ...asStringArray(currentTask.commit_shas),
              ...(commitSha ? [commitSha.slice(0, 12)] : []),
            ]));
            return {
              ...currentTask,
              status: args.status || "completed",
              commit_shas: commitShas,
              completion_evidence: {
                ...asJsonObject(currentTask.completion_evidence),
                commit_sha: commitSha || null,
                repo: args.repo || task.repo || null,
                working_root: args.workingRoot || null,
                coverage: typeof args.coverage === "number" ? args.coverage : null,
                recorded_at: recordedAt,
                ...(isRecord(args.manualVerificationEvidence) ? { manual_verification: asJsonObject(args.manualVerificationEvidence) } : {}),
              },
            };
          }),
        };
      });
      return { ...current, phases, updated_at: recordedAt };
    });
    if (!planPatch.ok) {
      return { ok: false, track_id: track.track_id, stage: "plan_json_patch", metadata, plan_json: planPatch };
    }
    const nextPlan = asJsonObject(planPatch.value);
    fs.writeFileSync(
      track.plan_path,
      withGeneratedMarker(path.relative(root, planJsonPath), "cadre.plan.v1", renderPlanMarkdown(nextPlan))
    );
    return {
      ok: true,
      track_id: track.track_id,
      task_key: task.task_key,
      line: task.line,
      status: args.status || "completed",
      commit_sha: commitSha || null,
      event: appendCadreEvent(root, {
        kind: "task_result_recorded",
        workflow: "record_task_result",
        track_id: track.track_id,
        phase_index: phaseIndex,
        task_index: taskIndex,
        task_key: task.task_key,
        status: args.status || "completed",
        commit_sha: commitSha || null,
        repo: args.repo || task.repo || null,
      }),
      metadata,
      plan_json: planPatch,
    };
  }
  return {
    ok: false,
    track_id: track.track_id,
    stage: "missing_plan_json",
    error: `Missing canonical plan JSON: ${planJsonPath}`,
    metadata,
  };
}

export function recordTaskResult(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  if (args.lock === false) return recordTaskResultUnlocked(root, args);
  return withTrackLock(root, track.track_id, () => recordTaskResultUnlocked(root, { ...args, lock: false }));
}
