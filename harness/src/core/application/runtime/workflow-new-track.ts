import fs from "node:fs";
import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, TrackMetadata } from "../../../types";

import { safeName, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { gitIdentity } from "../../infrastructure/runtime/system";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult, ReviewFile } from "./contracts";
import { trackGenerationWarnings } from "./generation-quality";
import { newTrackIntentPrompts, newTrackSchemaIssues } from "./intent-prompts";
import { withGeneratedMarker } from "./markdown-docs";
import { appendCadreEvent } from "./native-state";
import { renderPlanMarkdown } from "./plan-docs";
import { planAssist, worktreePlan } from "./planning";
import { regenIndex } from "./project-maintenance";
import { documentReviewPair, jsonReviewFile, plainReviewFile, reviewArtifactsFromFiles, textReviewFile, trackLearningsText } from "./review-bundles";
import { renderSpecMarkdown } from "./spec-docs";
import { applyStagedApprovalSessionPayload, newTrackApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import { findTrack } from "./track-context";
import { markdownPayloadError, normalizePlanJson, normalizeSpecJson, templateJson, workflowSummary } from "./workflow-response";

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
  const specCanonical = `cadre/tracks/${safeTrack}/spec.json`;
  const specProjection = `cadre/tracks/${safeTrack}/spec.md`;
  const planCanonical = `cadre/tracks/${safeTrack}/plan.json`;
  const planProjection = `cadre/tracks/${safeTrack}/plan.md`;
  const learningsCanonical = `${JSON.stringify(learningsEntry)}\n`;
  return [
    ...documentReviewPair("spec", jsonReviewFile(
      specCanonical,
      "Track spec canonical",
      "spec",
      specJson
    ),
    textReviewFile(
      specProjection,
      "Track spec",
      "spec.json",
      withGeneratedMarker(specCanonical, "cadre.spec.v1", renderSpecMarkdown(specJson, specCanonical), { canonicalContent: `${JSON.stringify(specJson, null, 2)}\n`, projection: specProjection })
    )),
    ...documentReviewPair("plan", jsonReviewFile(
      planCanonical,
      "Track plan canonical",
      "plan",
      planJson
    ),
    textReviewFile(
      planProjection,
      "Track plan",
      "plan.json",
      withGeneratedMarker(planCanonical, "cadre.plan.v1", renderPlanMarkdown(planJson, planCanonical), { canonicalContent: `${JSON.stringify(planJson, null, 2)}\n`, projection: planProjection })
    )),
    { ...jsonReviewFile(
      `cadre/tracks/${safeTrack}/metadata.json`,
      "Track metadata",
      "metadata",
      metadata
    ), documentId: "metadata", reviewRole: "machine" },
    ...documentReviewPair("learnings", plainReviewFile(
      `cadre/tracks/${safeTrack}/learnings.jsonl`,
      "Track learnings canonical",
      "template:learnings_seed.json",
      learningsCanonical
    ),
    textReviewFile(
      `cadre/tracks/${safeTrack}/learnings.md`,
      "Track learnings",
      "learnings.jsonl",
      withGeneratedMarker(`cadre/tracks/${safeTrack}/learnings.jsonl`, "cadre.learnings.v1", trackLearningsText(trackId), { canonicalContent: learningsCanonical, projection: `cadre/tracks/${safeTrack}/learnings.md` })
    ), undefined, "generated"),
  ];
}

export function workflowNewTrack(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "newtrack");
  const approvalArgs = JSON.parse(JSON.stringify(args)) as RuntimeArgs;
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
  const hasStructuredSpecAndPlan = isRecord(args.spec) && isRecord(args.plan);
  const intentPrompts = hasStructuredSpecAndPlan ? [] : newTrackIntentPrompts(args);
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
    worktree_path: `.worktrees/cadre/tracks/${safeName(trackId)}/integrate/root`,
    ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
  };
  const reviewFiles = newTrackReviewFiles(String(trackId), specJson, planJson, metadata);
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  const approval = stagedApprovalState(root, "newtrack", approvalArgs, newTrackApprovalStages(), reviewFiles, { track_id: String(trackId), final_only_files: ["cadre/tracks.json", "cadre/events.jsonl"] });
  const stageReviewBundle = asJsonObject(approval).current_review_bundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts;
  const approvalError = stagedApprovalError(approval);
  const warnings = [
    ...trackGenerationWarnings(specJson, planJson),
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  const dryRun = args.execute !== true;
  const assist = planAssist(root, { ...args, plan: planJson, trackId });
  if (dryRun) {
    return {
      ...summary,
      ok: assist.ok !== false && !approvalError,
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
      error: approvalError || undefined,
      next_actions: approvalError ? asStringArray(asJsonObject(approval).next_actions) : [
        "Approve newtrack one stage at a time with approvedStages.",
        "After spec and plan are approved, call newtrack with execute:true and approvalComplete:true using the same approval session.",
      ],
    };
  }
  if (!stagedApprovalReady(approval)) {
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
      error: approvalError || "Staged approval is required before creating track artifacts",
    };
  }
  const reviewValidation = validateApprovedTargetReviewFiles(root, args);
  if (reviewValidation.ok === false) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_review_drift",
      track_id: trackId,
      metadata,
      plan_assist: assist,
      approval,
      review_artifacts: stageReviewArtifacts || reviewArtifacts,
      review_bundle: stageReviewBundle,
      review_validation: reviewValidation,
      warnings,
      error: asOptionalString(reviewValidation.error) || "Approved review files changed after staged approval",
    };
  }
  const existingTrack = findTrack(root, trackId);
  if (existingTrack && asStringArray(reviewValidation.files).length === 0) {
    return { ...summary, ok: false, track_id: trackId, error: "Track already exists" };
  }
  const reusedReviewFiles = new Set(asStringArray(reviewValidation.files));
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
  const writeReviewedJson = (relativePath: string, value: JsonObject): void => {
    if (reusedReviewFiles.has(relativePath)) return;
    writeJson(path.join(root, relativePath), value);
  };
  const writeReviewedText = (relativePath: string, text: string): void => {
    if (reusedReviewFiles.has(relativePath)) return;
    fs.writeFileSync(path.join(root, relativePath), text);
  };
  fs.mkdirSync(dir, { recursive: true });
  writeReviewedJson(`cadre/tracks/${safeName(trackId)}/metadata.json`, metadata);
  writeReviewedJson(`cadre/tracks/${safeName(trackId)}/spec.json`, specJson);
  writeReviewedJson(`cadre/tracks/${safeName(trackId)}/plan.json`, planJson);
  writeReviewedText(`cadre/tracks/${safeName(trackId)}/spec.md`, withGeneratedMarker(`cadre/tracks/${safeName(trackId)}/spec.json`, "cadre.spec.v1", renderSpecMarkdown(specJson, `cadre/tracks/${safeName(trackId)}/spec.json`)));
  writeReviewedText(`cadre/tracks/${safeName(trackId)}/plan.md`, withGeneratedMarker(`cadre/tracks/${safeName(trackId)}/plan.json`, "cadre.plan.v1", renderPlanMarkdown(planJson, `cadre/tracks/${safeName(trackId)}/plan.json`)));
  writeReviewedText(`cadre/tracks/${safeName(trackId)}/learnings.jsonl`, `${JSON.stringify(learningsEntry)}\n`);
  writeReviewedText(`cadre/tracks/${safeName(trackId)}/learnings.md`, withGeneratedMarker(`cadre/tracks/${safeName(trackId)}/learnings.jsonl`, "cadre.learnings.v1", trackLearningsText(String(trackId))));
  const regen = regenIndex(root);
  const event = appendCadreEvent(root, {
    kind: "track_created",
    workflow: "newtrack",
    track_id: String(trackId),
    status: metadata.status,
    tags: metadata.tags || [],
  });
  const approvalAudit = recordApprovalCompletionFromArgs(root, args);
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "newtrack",
      subject: `create ${trackId}`,
      before: traceBefore,
      trackId: String(trackId),
      allowDirty: true,
      includeDirtyFiles: asStringArray(reviewValidation.files),
      note: {
        event_id: asOptionalString(asJsonObject(event.event).id) || null,
        formula_id: asOptionalString(args.formulaId || args.formula_id) || null,
      wisp_id: asOptionalString(args.wispId || args.wisp_id) || null,
    },
  });
  const approvalSessionClose = controlCommit.ok !== false ? closeApprovalSessionFromArgs(root, args) : null;
  return {
    ...summary,
    ok: regen.ok !== false && controlCommit.ok !== false,
    dry_run: false,
    track_id: trackId,
    metadata_path: path.relative(root, path.join(dir, "metadata.json")),
    regen,
    event,
    approval_audit: approvalAudit,
    approval_session_close: approvalSessionClose,
    control_commit: controlCommit,
    review_validation: reviewValidation,
    reused_review_files: asStringArray(reviewValidation.files),
    phase_state: controlCommit.ok === false ? "recovery_required" : "executed",
    approval,
    worktree_plan: worktreePlan(root, { trackId }),
  };
}
