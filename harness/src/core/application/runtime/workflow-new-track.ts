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

import { CoreResult, ReviewFile } from "./contracts";
import { safeName, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { withGeneratedMarker } from "./markdown-docs";
import { appendCadreEvent } from "./native-state";
import { renderPlanMarkdown } from "./plan-docs";
import { planAssist, worktreePlan } from "./planning";
import { regenIndex } from "./project-maintenance";
import { jsonReviewFile, plainReviewFile, reviewArtifactsFromFiles, textReviewFile, trackLearningsText } from "./review-bundles";
import { renderSpecMarkdown } from "./spec-docs";
import { gitIdentity } from "../../infrastructure/runtime/system";
import { beginTrace, commitTrace } from "./commit-trace";
import { findTrack } from "./track-context";
import { newTrackIntentPrompts, newTrackSchemaIssues } from "./intent-prompts";
import { markdownPayloadError, normalizePlanJson, normalizeSpecJson, templateJson, workflowSummary } from "./workflow-response";
import { approvalComplete, newTrackApprovalStages, stagedApprovalState } from "./staged-approval";

export function newTrackReviewFiles(trackId: string, spec: JsonObject, plan: JsonObject, metadata: TrackMetadata): ReviewFile[] {
  const safeTrack = safeName(trackId);
  const specJson = normalizeSpecJson(trackId, spec);
  const planJson = normalizePlanJson(trackId, plan, specJson);
  const learningsEntry: JsonObject = {
    ...templateJson("learnings_seed.json", { id: "initial", kind: "learnings_seed" }),
    id: "initial",
    kind: "learnings_seed",
    track_id: trackId,
    recorded_at: utcNow(),
    text: trackLearningsText(trackId),
  };
  return [
    jsonReviewFile(
      `cadre/tracks/${safeTrack}/spec.json`,
      "Track spec canonical",
      "spec",
      specJson
    ),
    textReviewFile(
      `cadre/tracks/${safeTrack}/spec.md`,
      "Track spec",
      "spec.json",
      withGeneratedMarker(`cadre/tracks/${safeTrack}/spec.json`, "cadre.spec.v1", renderSpecMarkdown(specJson, `cadre/tracks/${safeTrack}/spec.json`))
    ),
    jsonReviewFile(
      `cadre/tracks/${safeTrack}/plan.json`,
      "Track plan canonical",
      "plan",
      planJson
    ),
    textReviewFile(
      `cadre/tracks/${safeTrack}/plan.md`,
      "Track plan",
      "plan.json",
      withGeneratedMarker(`cadre/tracks/${safeTrack}/plan.json`, "cadre.plan.v1", renderPlanMarkdown(planJson, `cadre/tracks/${safeTrack}/plan.json`))
    ),
    jsonReviewFile(
      `cadre/tracks/${safeTrack}/metadata.json`,
      "Track metadata",
      "metadata",
      metadata
    ),
    plainReviewFile(
      `cadre/tracks/${safeTrack}/learnings.jsonl`,
      "Track learnings canonical",
      "template:learnings_seed.json",
      `${JSON.stringify(learningsEntry)}\n`
    ),
    textReviewFile(
      `cadre/tracks/${safeTrack}/learnings.md`,
      "Track learnings",
      "learnings.jsonl",
      withGeneratedMarker(`cadre/tracks/${safeTrack}/learnings.jsonl`, "cadre.learnings.v1", trackLearningsText(trackId))
    ),
  ];
}

export function workflowNewTrack(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "newtrack", args);
  const markdownError = markdownPayloadError(args);
  if (markdownError) return { ...summary, ...markdownError };
  const schemaIssues = newTrackSchemaIssues(args);
  if (schemaIssues.length > 0) {
    const encodedRoot = encodeURIComponent(root);
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "schema_validation",
      schema_errors: schemaIssues,
      schema_resources: [
        `cadre://artifact-schema?root=${encodedRoot}&artifact=spec`,
        `cadre://artifact-schema?root=${encodedRoot}&artifact=plan`,
      ],
      next_actions: [
        "Load the Cadre spec and plan schemas before drafting newtrack payloads.",
        "Call newtrack again with canonical spec and plan JSON fields, not aliases or Markdown-derived shapes.",
      ],
      error: "New track spec or plan JSON does not match Cadre schema; Cadre will not generate review artifacts until the payload is schema-shaped.",
    };
  }
  const intentPrompts = newTrackIntentPrompts(args);
  if (intentPrompts.length > 0) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "intent_clarification",
      intent_prompts: intentPrompts,
      next_actions: [
        "Answer intent_prompts with the client native selector or concise chat fallback.",
        "Call newtrack again with trackId plus structured spec and plan JSON before review or mutation.",
      ],
      error: "New track intent is under-specified; Cadre will not generate spec or plan artifacts until goal, outcome, acceptance, and scope are clear.",
    };
  }
  const trackId = args.trackId || args.track_id;
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  if (!isRecord(args.plan)) return { ...summary, ok: false, error: "plan is required" };
  const specJson = normalizeSpecJson(String(trackId), args.spec || { title: `Spec: ${trackId}`, description: asOptionalString(args.description) || String(trackId) });
  const planJson = normalizePlanJson(String(trackId), args.plan, specJson);
  const metadata: TrackMetadata = {
    track_id: trackId,
    type: "feature",
    status: "new",
    priority: "medium",
    depends_on: [],
    description: asOptionalString(args.description) || trackId,
    owner: gitIdentity(root) || null,
    reviewer: null,
    git_branch: `track/${trackId}`,
    worktree_path: `.worktrees/${trackId}`,
    ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
  };
  const reviewFiles = newTrackReviewFiles(String(trackId), specJson, planJson, metadata);
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  const approval = stagedApprovalState(root, "newtrack", args, newTrackApprovalStages(), reviewFiles, { track_id: String(trackId) });
  const stageReviewBundle = asJsonObject(approval).current_review_bundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts;
  const warnings = asStringArray(asJsonObject(stageReviewBundle).warnings);
  const dryRun = args.execute !== true;
  const assist = planAssist(root, { ...args, plan: planJson, trackId });
  if (dryRun) {
    return {
      ...summary,
      ok: assist.ok !== false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      track_id: trackId,
      metadata,
      plan_assist: assist,
      approval,
      review_artifacts: stageReviewArtifacts || reviewArtifacts,
      review_bundle: stageReviewBundle,
      warnings,
      next_actions: [
        "Approve newtrack one stage at a time with approvedStages.",
        "After spec, plan, metadata, and learnings are approved, call newtrack with execute:true and approvalComplete:true using the same structured payload.",
      ],
    };
  }
  if (findTrack(root, trackId)) {
    return { ...summary, ok: false, track_id: trackId, error: "Track already exists" };
  }
  if (!approvalComplete(args)) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      track_id: trackId,
      metadata,
      plan_assist: assist,
      approval,
      review_artifacts: stageReviewArtifacts || reviewArtifacts,
      review_bundle: stageReviewBundle,
      warnings,
      next_actions: [
        "Review the current staged approval bundle.",
        "Call newtrack again with execute:true and approvalComplete:true only after every staged approval is complete.",
      ],
      error: "Staged approval is required before creating track artifacts",
    };
  }
  const traceBefore = beginTrace(root);
  const dir = path.join(root, "cadre", "tracks", safeName(trackId));
  const learningsEntry: JsonObject = {
    ...templateJson("learnings_seed.json", { id: "initial", kind: "learnings_seed" }),
    id: "initial",
    kind: "learnings_seed",
    track_id: String(trackId),
    recorded_at: utcNow(),
    text: trackLearningsText(String(trackId)),
  };
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "metadata.json"), metadata);
  writeJson(path.join(dir, "spec.json"), specJson);
  writeJson(path.join(dir, "plan.json"), planJson);
  fs.writeFileSync(path.join(dir, "spec.md"), withGeneratedMarker(`cadre/tracks/${safeName(trackId)}/spec.json`, "cadre.spec.v1", renderSpecMarkdown(specJson, `cadre/tracks/${safeName(trackId)}/spec.json`)));
  fs.writeFileSync(path.join(dir, "plan.md"), withGeneratedMarker(`cadre/tracks/${safeName(trackId)}/plan.json`, "cadre.plan.v1", renderPlanMarkdown(planJson, `cadre/tracks/${safeName(trackId)}/plan.json`)));
  fs.writeFileSync(path.join(dir, "learnings.jsonl"), `${JSON.stringify(learningsEntry)}\n`);
  fs.writeFileSync(path.join(dir, "learnings.md"), withGeneratedMarker(`cadre/tracks/${safeName(trackId)}/learnings.jsonl`, "cadre.learnings.v1", trackLearningsText(String(trackId))));
  const regen = regenIndex(root);
  const event = appendCadreEvent(root, {
    kind: "track_created",
    workflow: "newtrack",
    track_id: String(trackId),
    status: metadata.status,
    tags: metadata.tags || [],
  });
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "newtrack",
    subject: `create ${trackId}`,
    before: traceBefore,
    trackId: String(trackId),
    note: {
      event_id: asOptionalString(asJsonObject(event.event).id) || null,
      formula_id: asOptionalString(args.formulaId || args.formula_id) || null,
      wisp_id: asOptionalString(args.wispId || args.wisp_id) || null,
    },
  });
  return {
    ...summary,
    ok: regen.ok !== false && controlCommit.ok !== false,
    dry_run: false,
    track_id: trackId,
    metadata_path: path.relative(root, path.join(dir, "metadata.json")),
    regen,
    event,
    control_commit: controlCommit,
    phase_state: controlCommit.ok === false ? "recovery_required" : "executed",
    approval,
    worktree_plan: worktreePlan(root, { trackId }),
  };
}
