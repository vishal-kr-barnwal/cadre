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

import { CoreResult, ReleaseArtifactPlan, ReviewFile } from "./contracts";
import { patchJsonFile, readJson, safeName, utcNow, writeJson, writeJsonEnsured } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { withGeneratedMarker } from "./markdown-docs";
import { renderPlanMarkdown, trackPlanJsonPath, trackSpecJsonPath } from "./plan-docs";
import { regenIndex } from "./project-maintenance";
import { humanReviewState, jsonReviewFile, packetReviewArtifact, reviewArtifactsFromFiles, textReviewFile, workflowReviewBundle } from "./review-bundles";
import { renderSpecMarkdown } from "./spec-docs";
import { metadataTrackSummary, selectedTrackId } from "./status";
import { actionResultsOk, plannedGitAction, runPlannedGitActions } from "../../infrastructure/runtime/system";
import { beginTrace, commitTrace } from "./commit-trace";
import { findTrack, trackContext } from "./track-context";
import { reviseIntentPrompts } from "./intent-prompts";
import { listTracks } from "./track-schedule";
import { markdownPayloadError, normalizePlanJson, normalizeSpecJson, workflowSummary } from "./workflow-response";
import { lspImpact } from "./workspace-intel";
import { applyStagedApprovalSessionPayload, releaseApprovalStages, reviseApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState } from "./staged-approval";
import { trackGenerationWarnings } from "./generation-quality";

export function releaseArtifactPlan(root: string, args: RuntimeArgs = {}): ReleaseArtifactPlan {
  const completed = listTracks(root)
    .filter((track) => (track.metadata.status || "new") === "completed")
    .map((track) => asJsonObject(metadataTrackSummary(track)));
  const rawArgs = args as UnknownRecord;
  const version = String(args.releaseVersion || args.release_version || args.bump || args.mode || `release-${utcNow().slice(0, 10)}`);
  const generatedAt = asOptionalString(rawArgs.generatedAt || rawArgs.generated_at) || utcNow();
  const releaseDir = path.join(root, "cadre", "releases");
  const releaseSlug = safeName(version);
  const releaseMd = path.join(releaseDir, `${releaseSlug}.md`);
  const releaseJson = path.join(releaseDir, `${releaseSlug}.json`);
  const notes = asOptionalString(args.releaseNotes || args.release_notes)
    || [
      `# Release - ${version}`,
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Completed Tracks",
      "",
      ...completed.map((track) => `- ${track.track_id}: ${track.name}`),
      "",
    ].join("\n");
  const metadata: JsonObject = {
    version,
    generated_at: generatedAt,
    completed_tracks: completed.map((track) => ({
      track_id: track.track_id,
      name: track.name,
      status: track.status,
      priority: track.priority,
      owner: track.owner,
      reviewer: track.reviewer,
      tags: track.tags || [],
      review: track.review,
    })),
  };
  const gitActions = rawArgs.createTag === true || rawArgs.create_tag === true || rawArgs.tag === true
    ? [plannedGitAction("release-tag", "tag_release", ".", root, ["tag", "-a", version, "-m", `Cadre release ${version}`], `Create release tag ${version}`)]
    : [];
  return { version, generatedAt, completed, releaseDir, releaseMd, releaseJson, notes, metadata, gitActions };
}

export function releaseReviewFiles(root: string, plan: ReleaseArtifactPlan): ReviewFile[] {
  return [
    textReviewFile(
      path.relative(root, plan.releaseMd),
      "Release notes",
      "releaseNotes",
      plan.notes.endsWith("\n") ? plan.notes : `${plan.notes}\n`
    ),
    jsonReviewFile(
      path.relative(root, plan.releaseJson),
      "Release metadata",
      "releaseMetadata",
      plan.metadata
    ),
  ];
}

export function workflowRelease(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(args, "release");
  const summary = workflowSummary(root, "release", args);
  const plan = releaseArtifactPlan(root, args);
  const reviewFiles = releaseReviewFiles(root, plan);
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  if (plan.gitActions.length > 0) {
    reviewArtifacts.push(packetReviewArtifact("Release git actions", "workflow:release", {
      git_actions: plan.gitActions,
    }));
  }
  const reviewBundle = workflowReviewBundle(root, "release", args, reviewFiles, { release_version: plan.version });
  const approval = stagedApprovalState(root, "release", args, releaseApprovalStages(plan.gitActions.length > 0), reviewFiles, { release_version: plan.version });
  const stageReviewBundle = asJsonObject(approval).current_review_bundle || reviewBundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts || reviewArtifacts;
  const humanReview = humanReviewState("release", args, reviewArtifacts, reviewBundle);
  const approvalError = stagedApprovalError(approval);
  const warnings = [
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  const base = {
    ...summary,
    release_version: plan.version,
    completed_tracks: plan.completed,
    release_artifacts: [path.relative(root, plan.releaseMd), path.relative(root, plan.releaseJson)],
    git_actions: plan.gitActions,
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
      phase_state: "dry_run",
      dry_run: true,
      ...(approvalError ? { error: approvalError, stage: "staged_approval" } : {}),
    };
  }
  if (!stagedApprovalReady(approval)) {
    return {
      ...base,
      ok: false,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      dry_run: true,
      error: approvalError || "Staged approval is required before writing release artifacts",
    };
  }
  const traceBefore = beginTrace(root);
  fs.mkdirSync(plan.releaseDir, { recursive: true });
  fs.writeFileSync(plan.releaseMd, plan.notes.endsWith("\n") ? plan.notes : `${plan.notes}\n`);
  writeJson(plan.releaseJson, plan.metadata);
  const indexPatch = patchJsonFile(path.join(root, "cadre", "setup_state.json"), (current) => {
    current.last_release = {
      version: plan.version,
      path: path.relative(root, plan.releaseMd),
      metadata: path.relative(root, plan.releaseJson),
      completed_tracks: plan.completed.length,
      released_at: plan.generatedAt,
    };
    current.updated_at = utcNow();
    return current;
  }, { lock: false });
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "release",
    subject: `prepare ${plan.version}`,
    before: traceBefore,
    note: {
      release_version: plan.version,
      completed_tracks: plan.completed.map((track) => asOptionalString(track.track_id)).filter((trackId): trackId is string => Boolean(trackId)),
    },
  });
  const gitResults = runPlannedGitActions(plan.gitActions);
  const gitOk = actionResultsOk(gitResults);
  return {
    ...base,
    ok: indexPatch.ok !== false && controlCommit.ok !== false && gitOk,
    phase_state: gitOk && controlCommit.ok !== false ? "executed" : "recovery_required",
    dry_run: args.execute !== true,
    bump: args.bump || args.mode || "patch",
    setup_state: indexPatch,
    control_commit: controlCommit,
    git_results: gitResults,
  };
}

export function workflowRevise(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(args, "revise");
  const approvalArgs = JSON.parse(JSON.stringify(args)) as RuntimeArgs;
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "revise", args);
  const markdownError = markdownPayloadError(args);
  if (markdownError) return { ...summary, ...markdownError };
  const hasStructuredRevision = isRecord(args.spec) || isRecord(args.plan);
  const initialPrompts = hasStructuredRevision ? [] : reviseIntentPrompts(args, trackId || null);
  if (initialPrompts.length > 0) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "intent_clarification",
      ...(trackId ? { track_id: trackId, track_context: trackContext(root, trackId) } : {}),
      intent_prompts: initialPrompts,
      next_actions: [
        "Answer revise intent_prompts before producing revised artifacts.",
        "Call revise again with reason plus structured spec and/or plan JSON.",
      ],
      error: "Revision intent is under-specified; Cadre needs a target, reason, and spec/plan scope before generating revision artifacts.",
    };
  }
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const track = findTrack(root, trackId);
  const context = trackContext(root, trackId);
  const impact = lspImpact(root, args);
  const reviewFiles: ReviewFile[] = [];
  const existingSpec = track ? readJson<JsonObject | null>(trackSpecJsonPath(track), null) : null;
  const revisedSpec = isRecord(args.spec) ? normalizeSpecJson(trackId, args.spec) : null;
  const revisedPlan = isRecord(args.plan) ? normalizePlanJson(trackId, args.plan, revisedSpec || existingSpec) : null;
  const revisionRequested = Boolean(revisedSpec || revisedPlan);
  if (revisionRequested && !track) {
    return {
      ...summary,
      ok: false,
      track_context: context,
      impact,
      error: `Track not found: ${trackId}`,
    };
  }
  if (track && revisedSpec) {
    reviewFiles.push(jsonReviewFile(path.relative(root, trackSpecJsonPath(track)), "Revised track spec canonical", "spec", revisedSpec));
    reviewFiles.push(textReviewFile(
      path.relative(root, track.spec_path),
      "Revised track spec",
      "spec.json",
      withGeneratedMarker(path.relative(root, trackSpecJsonPath(track)), "cadre.spec.v1", renderSpecMarkdown(revisedSpec, path.relative(root, trackSpecJsonPath(track))))
    ));
  }
  if (track && revisedPlan) {
    reviewFiles.push(jsonReviewFile(path.relative(root, trackPlanJsonPath(track)), "Revised track plan canonical", "plan", revisedPlan));
    reviewFiles.push(textReviewFile(
      path.relative(root, track.plan_path),
      "Revised track plan",
      "plan.json",
      withGeneratedMarker(path.relative(root, trackPlanJsonPath(track)), "cadre.plan.v1", renderPlanMarkdown(revisedPlan, path.relative(root, trackPlanJsonPath(track))))
    ));
  }
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  const reviewBundle = workflowReviewBundle(root, "revise", args, reviewFiles, { track_id: trackId });
  const approval = stagedApprovalState(root, "revise", approvalArgs, reviseApprovalStages(Boolean(revisedSpec), Boolean(revisedPlan)), reviewFiles, { track_id: trackId });
  const stageReviewBundle = asJsonObject(approval).current_review_bundle || reviewBundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts || reviewArtifacts;
  const humanReview = reviewFiles.length > 0 ? humanReviewState("revise", args, reviewArtifacts, reviewBundle) : null;
  const approvalError = stagedApprovalError(approval);
  const qualityWarnings = revisedPlan
    ? trackGenerationWarnings(revisedSpec || existingSpec || {}, revisedPlan || {})
    : revisedSpec
      ? trackGenerationWarnings(revisedSpec, { phases: [{ tasks: [{ title: "context-only", files: ["context"], manual_verification: { scope: "revision" } }] }] })
      : [];
  const warnings = [
    ...qualityWarnings,
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  if (reviewFiles.length === 0) {
    return {
      ...summary,
      ok: true,
      track_context: context,
      impact,
    };
  }
  if (!track) {
    return {
      ...summary,
      ok: false,
      track_context: context,
      impact,
      error: `Track not found: ${trackId}`,
    };
  }
  const base = {
    ...summary,
    track_id: trackId,
    track_context: context,
    impact,
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
      error: approvalError || "Staged approval is required before revising track artifacts",
    };
  }
  const traceBefore = beginTrace(root);
  const writeResult = withTrackLock(root, track.track_id, () => {
    const written: string[] = [];
    if (revisedSpec) {
      writeJsonEnsured(trackSpecJsonPath(track), revisedSpec);
      fs.writeFileSync(track.spec_path, withGeneratedMarker(path.relative(root, trackSpecJsonPath(track)), "cadre.spec.v1", renderSpecMarkdown(revisedSpec, path.relative(root, trackSpecJsonPath(track)))));
      written.push(path.relative(root, trackSpecJsonPath(track)));
      written.push(path.relative(root, track.spec_path));
    }
    if (revisedPlan) {
      writeJsonEnsured(trackPlanJsonPath(track), revisedPlan);
      fs.writeFileSync(track.plan_path, withGeneratedMarker(path.relative(root, trackPlanJsonPath(track)), "cadre.plan.v1", renderPlanMarkdown(revisedPlan, path.relative(root, trackPlanJsonPath(track)))));
      written.push(path.relative(root, trackPlanJsonPath(track)));
      written.push(path.relative(root, track.plan_path));
    }
    return { ok: true, written, revised_at: utcNow() };
  });
  const regen = writeResult.ok !== false ? regenIndex(root) : null;
  const controlCommit = writeResult.ok !== false && (!regen || regen.ok !== false)
    ? commitTrace(root, args, {
      kind: "control",
      workflow: "revise",
      subject: `update ${trackId}`,
      before: traceBefore,
      trackId,
      note: {
        revised_spec: Boolean(revisedSpec),
        revised_plan: Boolean(revisedPlan),
      },
    })
    : null;
  return {
    ...base,
    ok: writeResult.ok !== false && (!regen || regen.ok !== false) && (!controlCommit || controlCommit.ok !== false),
    dry_run: false,
    phase_state: writeResult.ok === false || (regen && regen.ok === false) || (controlCommit && controlCommit.ok === false) ? "recovery_required" : "executed",
    write: writeResult,
    regen,
    control_commit: controlCommit,
  };
}
