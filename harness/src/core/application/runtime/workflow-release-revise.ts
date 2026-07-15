import fs from "node:fs";
import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { patchJsonFile, safeName, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { actionResultsOk, plannedGitAction, runPlannedGitActions } from "../../infrastructure/runtime/system";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult, ReleaseArtifactPlan, ReviewFile } from "./contracts";
import { withGeneratedMarker } from "./markdown-docs";
import { documentReviewPair, humanReviewState, jsonReviewFile, packetReviewArtifact, reviewArtifactsFromFiles, textReviewFile, workflowReviewBundle } from "./review-bundles";
import { applyStagedApprovalSessionPayload, releaseApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import { metadataTrackSummary } from "./status";
import { listTracks } from "./track-schedule";
import { meaningfulReleaseNotes, releaseIntentPrompts } from "./workflow-evidence";
import { workflowSummary } from "./workflow-response";

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
  const notesBody = asOptionalString(args.releaseNotes || args.release_notes)
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
    release_notes_markdown: notesBody.endsWith("\n") ? notesBody : `${notesBody}\n`,
  };
  const notes = withGeneratedMarker(
    path.relative(root, releaseJson),
    "cadre.release.v1",
    notesBody,
    {
      canonicalContent: `${JSON.stringify(metadata, null, 2)}\n`,
      projection: path.relative(root, releaseMd),
    }
  );
  const gitActions = rawArgs.createTag === true || rawArgs.create_tag === true || rawArgs.tag === true
    ? [plannedGitAction("release-tag", "tag_release", ".", root, ["tag", "-a", version, "-m", `Cadre release ${version}`], `Create release tag ${version}`)]
    : [];
  return { version, generatedAt, completed, releaseDir, releaseMd, releaseJson, notes, metadata, gitActions };
}

export function releaseReviewFiles(root: string, plan: ReleaseArtifactPlan): ReviewFile[] {
  return documentReviewPair("release_notes",
    jsonReviewFile(
      path.relative(root, plan.releaseJson),
      "Release metadata",
      "releaseMetadata",
      plan.metadata
    ),
    textReviewFile(
      path.relative(root, plan.releaseMd),
      "Release notes",
      "releaseNotes",
      plan.notes.endsWith("\n") ? plan.notes : `${plan.notes}\n`
    ));
}

export function workflowRelease(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "release");
  const summary = workflowSummary(root, "release", args);
  const plan = releaseArtifactPlan(root, args);
  if (plan.completed.length === 0 && !meaningfulReleaseNotes(args)) {
    const intentPrompts = releaseIntentPrompts(args);
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "intent_clarification",
      release_version: plan.version,
      completed_tracks: [],
      ...(intentPrompts.length > 0 ? { intent_prompts: intentPrompts } : {}),
      missing_payload: ["releaseNotes"],
      next_actions: [
        "Complete and review at least one Cadre track, or provide substantive releaseNotes.",
        "Call release again after release evidence is available; Cadre has not generated release artifacts.",
      ],
      error: "Release evidence is missing; Cadre will not generate an empty default release.",
    };
  }
  const reviewFiles = releaseReviewFiles(root, plan);
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  if (plan.gitActions.length > 0) {
    reviewArtifacts.push(packetReviewArtifact("Release git actions", "workflow:release", {
      git_actions: plan.gitActions,
    }));
  }
  const reviewBundle = workflowReviewBundle(root, "release", args, reviewFiles, { release_version: plan.version });
  const approval = stagedApprovalState(root, "release", args, releaseApprovalStages(plan.gitActions.length > 0), reviewFiles, { release_version: plan.version, final_only_files: ["cadre/setup_state.json", "cadre/events.jsonl"] });
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
  const reviewValidation = validateApprovedTargetReviewFiles(root, args);
  if (reviewValidation.ok === false) {
    return {
      ...base,
      ok: false,
      phase_state: "awaiting_staged_approval",
      stage: "staged_review_drift",
      dry_run: true,
      review_validation: reviewValidation,
      error: asOptionalString(reviewValidation.error) || "Approved review files changed after staged approval",
    };
  }
  const reusedReviewFiles = new Set(asStringArray(reviewValidation.files));
  const traceBefore = beginTrace(root);
  fs.mkdirSync(plan.releaseDir, { recursive: true });
  if (!reusedReviewFiles.has(path.relative(root, plan.releaseMd))) {
    fs.writeFileSync(plan.releaseMd, plan.notes.endsWith("\n") ? plan.notes : `${plan.notes}\n`);
  }
  if (!reusedReviewFiles.has(path.relative(root, plan.releaseJson))) writeJson(plan.releaseJson, plan.metadata);
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
  const approvalAudit = recordApprovalCompletionFromArgs(root, args);
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "release",
    subject: `prepare ${plan.version}`,
    before: traceBefore,
    allowDirty: true,
    includeDirtyFiles: asStringArray(reviewValidation.files),
    note: {
      release_version: plan.version,
      completed_tracks: plan.completed.map((track) => asOptionalString(track.track_id)).filter((trackId): trackId is string => Boolean(trackId)),
    },
  });
  const gitResults = runPlannedGitActions(plan.gitActions);
  const gitOk = actionResultsOk(gitResults);
  const approvalSessionClose = indexPatch.ok !== false && controlCommit.ok !== false && gitOk
    ? closeApprovalSessionFromArgs(root, args)
    : null;
  return {
    ...base,
    ok: indexPatch.ok !== false && controlCommit.ok !== false && gitOk,
    phase_state: gitOk && controlCommit.ok !== false ? "executed" : "recovery_required",
    dry_run: args.execute !== true,
    bump: args.bump || args.mode || "patch",
    setup_state: indexPatch,
    control_commit: controlCommit,
    git_results: gitResults,
    approval_audit: approvalAudit,
    approval_session_close: approvalSessionClose,
    review_validation: reviewValidation,
    reused_review_files: asStringArray(reviewValidation.files),
  };
}
