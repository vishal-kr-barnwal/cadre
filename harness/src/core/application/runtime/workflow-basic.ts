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
import { CoreResult } from "./contracts";
import { fileExists, utcNow, writeJsonEnsured } from "../../infrastructure/runtime/json-store";
import { markdownDocJson, renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import { appendCadreEvent, appendCadreMessage, nativeStateSummary } from "./native-state";
import { trackHandoffJsonPath } from "./plan-docs";
import { planIntegrity } from "./planning";
import { regenIndex } from "./project-maintenance";
import { prCiStatus, reviewAssist } from "./quality-gates";
import { implementationPrep } from "./repo-resolution";
import { humanReviewState, jsonReviewFile, packetReviewArtifact, reviewArtifactsFromFiles, textReviewFile, workflowReviewBundle } from "./review-bundles";
import { syncControlPlane } from "./review-records";
import { availableWork, fleetStatus, liveStatus, metadataTrackSummary, selectedTrackId, teamBoard, teamStatus } from "./status";
import { humanReviewConfirmed } from "./tech-stack";
import { beginTrace, commitTrace } from "./commit-trace";
import { findTrack, trackContext } from "./track-context";
import { reviewGate } from "./track-mutations";
import { listTracks, phaseSchedule } from "./track-schedule";
import { workflowSummary } from "./workflow-response";
import { doctor } from "./workspace-health";
import { handoffApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState } from "./staged-approval";

export function workflowImplement(root: string, args: RuntimeArgs = {}): CoreResult {
  const prep = implementationPrep(root, {
    ...args,
    claim: args.claim === true || args.execute === true,
  });
  const trackId = asOptionalString(prep.selected_track) || args.trackId || args.track_id || null;
  return {
    ...workflowSummary(root, "implement", args),
    ok: prep.ok !== false,
    prepare_implementation: prep,
    phase_schedule: trackId ? phaseSchedule(root, { ...args, trackId }) : null,
  };
}

export function workflowStatus(root: string, args: RuntimeArgs = {}): CoreResult {
  const mode = args.mode || args.view || args.status || "live";
  const summary = workflowSummary(root, "status", args);
  if (mode === "team" || args.mine === true) return { ...summary, ok: true, status: teamBoard(root, { ...args, mine: args.mine === true }) };
  if (mode === "fleet" || mode === "repos") return { ...summary, ok: true, status: fleetStatus(root, args) };
  if (mode === "available") return { ...summary, ok: true, status: availableWork(root) };
  if (mode === "collisions") return { ...summary, ok: true, status: collisionScan(root) };
  if (mode === "doctor") return { ...summary, ok: true, status: doctor(root, { hasCadreProject: true }) };
  return { ...summary, ok: true, status: liveStatus(root) };
}

export function workflowReview(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "review", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  const review = reviewAssist(root, { ...args, trackId });
  const gate = reviewGate(root, trackId, args);
  const provider = args.includeProvider === false ? null : prCiStatus(root, { ...args, trackId });
  const pendingProvider = Boolean(provider && provider.ok === false);
  return {
    ...summary,
    ok: review.ok !== false,
    phase_state: pendingProvider ? "pending_provider" : summary.phase_state,
    track_context: context,
    review_assist: review,
    gate,
    provider,
    required_provider_mcp: provider && provider.ok === false ? provider.required_provider_mcp || null : null,
    required_evidence: provider && provider.ok === false ? provider.required_evidence || null : null,
    unsupported_reason: provider && provider.ok === false ? provider.unsupported_reason || provider.reason || null : null,
    next_actions: provider && Array.isArray(provider.next_actions) ? provider.next_actions : [],
  };
}

export function workflowValidate(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "validate", args);
  return {
    ...summary,
    ok: true,
    doctor: doctor(root, { hasCadreProject: true }),
    team: teamStatus(root),
    integrity: planIntegrity(root, args.trackId || args.track_id || null),
    collisions: collisionScan(root),
    fleet: fleetStatus(root, { includeCollisions: false }),
    native_state: nativeStateSummary(root),
  };
}

export function workflowArchive(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "archive", args);
  const tracks = listTracks(root).filter((track) =>
    args.trackId || args.track_id
      ? track.track_id === (args.trackId || args.track_id)
      : (track.metadata.status || "new") === "completed"
  );
  if (tracks.length === 0) return { ...summary, ok: false, error: "No completed or selected track found" };
  const reviewArtifacts = [
    packetReviewArtifact("Archive scope", "workflow:archive", {
      track_count: tracks.length,
      tracks: tracks.map((track) => asJsonObject(metadataTrackSummary(track))),
    }),
  ];
  const humanReview = humanReviewState("archive", args, reviewArtifacts);
  if (args.execute !== true) {
    return {
      ...summary,
      ok: true,
      dry_run: true,
      tracks: tracks.map((track) => asJsonObject(metadataTrackSummary(track))),
      human_review: humanReview,
      review_artifacts: reviewArtifacts,
    };
  }
  if (!humanReviewConfirmed(args)) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "human_review",
      tracks: tracks.map((track) => asJsonObject(metadataTrackSummary(track))),
      human_review: humanReview,
      review_artifacts: reviewArtifacts,
      error: "Staged approval is required before archiving tracks",
    };
  }
  const syncPre = syncControlPlane(root, { mode: "pre" });
  if (syncPre.ok === false) return { ...summary, ok: false, phase_state: "blocked", stage: "sync_pre", sync_pre: syncPre };
  const traceBefore = beginTrace(root);
  const archived: CoreResult[] = [];
  const archiveRoot = path.join(root, "cadre", "archive");
  fs.mkdirSync(archiveRoot, { recursive: true });
  for (const track of tracks) {
    const target = path.join(archiveRoot, track.track_id);
    if (fileExists(target)) {
      archived.push({ track_id: track.track_id, ok: false, error: "Archive target already exists" });
      continue;
    }
    fs.renameSync(track.dir, target);
    archived.push({ track_id: track.track_id, ok: true, path: path.relative(root, target) });
  }
  const regen = regenIndex(root);
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "archive",
    subject: tracks.length === 1 ? `archive ${tracks[0]?.track_id || "track"}` : `archive ${tracks.length} tracks`,
    before: traceBefore,
    trackId: tracks.length === 1 ? tracks[0]?.track_id || null : null,
    note: {
      tracks: tracks.map((track) => track.track_id),
      archived: archived.map(asJsonObject),
    },
  });
  const syncPost = syncControlPlane(root, { mode: "post" });
  return {
    ...summary,
    ok: archived.every((item) => item.ok !== false) && regen.ok !== false && controlCommit.ok !== false && syncPost.ok !== false,
    phase_state: syncPost.ok === false || controlCommit.ok === false ? "recovery_required" : "executed",
    dry_run: false,
    archived,
    regen,
    control_commit: controlCommit,
    sync_pre: syncPre,
    sync_post: syncPost,
  };
}

export function workflowHandoff(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "handoff", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  if (context.ok === false) return { ...summary, ok: false, track_context: context };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, track_context: context, error: `Track not found: ${trackId}` };
  const text = asOptionalString(args.handoffText)
    || [
      `# Handoff: ${trackId}`,
      "",
      `Updated: ${utcNow()}`,
      "",
      "Resume from the packet context returned by Cadre MCP.",
    ].join("\n");
  const handoffPath = path.join(track.dir, "HANDOFF.md");
  const handoffJsonPath = trackHandoffJsonPath(track);
  const handoffJson = markdownDocJson("handoff", text, { track_id: trackId });
  const reviewFiles = [
    jsonReviewFile(path.relative(root, handoffJsonPath), "Track handoff canonical", "handoffText", handoffJson),
    textReviewFile(
      path.relative(root, handoffPath),
      "Track handoff",
      "handoff.json",
      withGeneratedMarker(path.relative(root, handoffJsonPath), "cadre.handoff.v1", renderMarkdownDoc(handoffJson, `Handoff: ${trackId}`, path.relative(root, handoffJsonPath)))
    ),
  ];
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  const reviewBundle = workflowReviewBundle(root, "handoff", args, reviewFiles, { track_id: trackId });
  const approval = stagedApprovalState(root, "handoff", args, handoffApprovalStages(), reviewFiles, { track_id: trackId });
  const stageReviewBundle = asJsonObject(approval).current_review_bundle || reviewBundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts || reviewArtifacts;
  const humanReview = humanReviewState("handoff", args, reviewArtifacts, reviewBundle);
  const approvalError = stagedApprovalError(approval);
  const warnings = [
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  const base = {
    ...summary,
    track_id: trackId,
    track_context: context,
    handoff_path: path.relative(root, handoffPath),
    approval,
    human_review: humanReview,
    review_artifacts: stageReviewArtifacts,
    review_bundle: stageReviewBundle,
    warnings,
  };
  if (args.execute !== true) {
    return {
      ...base,
      ok: !approvalError,
      dry_run: true,
      phase_state: "dry_run",
      ...(approvalError ? { error: approvalError, stage: "staged_approval" } : {}),
    };
  }
  if (!stagedApprovalReady(approval)) {
    return {
      ...base,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      error: approvalError || "Staged approval is required before writing handoff artifacts",
    };
  }
  const traceBefore = beginTrace(root);
  if (args.execute === true) {
    writeJsonEnsured(handoffJsonPath, handoffJson);
    fs.writeFileSync(handoffPath, withGeneratedMarker(path.relative(root, handoffJsonPath), "cadre.handoff.v1", renderMarkdownDoc(handoffJson, `Handoff: ${trackId}`, path.relative(root, handoffJsonPath))));
  }
  const recipient = asOptionalString(args.to || args.assignee || track.metadata.reviewer) || null;
  const subject = asOptionalString(args.subject) || `Handoff: ${trackId}`;
  const message = appendCadreMessage(root, "outbox", {
    kind: "handoff",
    workflow: "handoff",
    track_id: trackId,
    to: recipient,
    subject,
    body: asOptionalString(args.body) || text,
    handoff_path: path.relative(root, handoffPath),
    handoff_json_path: path.relative(root, handoffJsonPath),
  });
  const event = appendCadreEvent(root, {
    kind: "handoff_created",
    workflow: "handoff",
    track_id: trackId,
    to: recipient,
    subject,
    handoff_path: path.relative(root, handoffPath),
  });
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "handoff",
    subject: `record ${trackId} handoff`,
    before: traceBefore,
    trackId,
    note: {
      event_id: asOptionalString(asJsonObject(event.event).id) || null,
      message_id: asOptionalString(asJsonObject(message.message).id) || null,
      to: recipient,
    },
  });
  return {
    ...base,
    ok: controlCommit.ok !== false,
    dry_run: args.execute !== true,
    phase_state: controlCommit.ok === false ? "recovery_required" : "executed",
    message,
    event,
    control_commit: controlCommit,
  };
}
