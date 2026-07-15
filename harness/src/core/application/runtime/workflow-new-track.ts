import fs from "node:fs";
import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { RuntimeArgs, TrackMetadata } from "../../../types";

import { safeName } from "../../infrastructure/runtime/json-store";
import { gitIdentity } from "../../infrastructure/runtime/system";
import { approvalSessionForTarget, closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult } from "./contracts";
import { trackGenerationWarnings } from "./generation-quality";
import { newTrackIntentPrompts } from "./intent-prompts";
import { appendCadreEvent, readCadreEvents } from "./native-state";
import { newTrackStageCollection } from "./new-track-stage-lifecycle";
import { planAssist, worktreePlan } from "./planning";
import { regenIndex } from "./project-maintenance";
import {
  applyStagedApprovalSessionPayload,
  newTrackApprovalStages,
  stagedApprovalError,
  stagedApprovalReady,
  stagedApprovalState,
  validateApprovedTargetReviewFiles,
} from "./staged-approval";
import { markdownPayloadError, workflowSummary } from "./workflow-response";

function trackMetadata(root: string, trackId: string, args: RuntimeArgs): TrackMetadata {
  const supplied = asJsonObject(args.metadata);
  return {
    type: "feature",
    status: "new",
    priority: "medium",
    depends_on: [],
    description: asOptionalString(args.description) || trackId,
    owner: gitIdentity(root) || null,
    reviewer: null,
    git_branch: `track/${trackId}`,
    worktree_path: `.worktrees/cadre/tracks/${safeName(trackId)}/integrate/root`,
    ...supplied,
    track_id: trackId,
  };
}

function clarificationWithoutTarget(summary: CoreResult, prompts: ReturnType<typeof newTrackIntentPrompts>): CoreResult {
  return {
    ...summary,
    ok: false,
    dry_run: true,
    phase_state: "awaiting_clarification",
    stage: "intent_clarification",
    intent_prompts: prompts,
    next_actions: ["Choose a stable track id before Cadre starts the spec-to-plan approval session."],
    error: "New track intent is under-specified; trackId is required before staged artifact collection can begin.",
  };
}

function occupiedTrackTargets(root: string, trackId: string, allowedSessionId: string | null): string[] {
  const relativeDirectory = `cadre/tracks/${safeName(trackId)}`;
  try {
    return fs.readdirSync(path.join(root, relativeDirectory), { withFileTypes: true })
      .map((entry) => `${relativeDirectory}/${entry.name}`)
      .filter((relativePath) => {
        const owner = approvalSessionForTarget(root, relativePath);
        return !owner || owner.workflow !== "newtrack" || owner.session_id !== allowedSessionId;
      });
  } catch {
    return [];
  }
}

export function workflowNewTrack(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "newtrack");
  const summary = workflowSummary(root, "newtrack", args);
  const markdownError = markdownPayloadError(args);
  if (markdownError) return { ...summary, ...markdownError };
  const intentPrompts = newTrackIntentPrompts(args);
  const trackId = asOptionalString(args.trackId || args.track_id);
  if (!trackId) return clarificationWithoutTarget(summary, intentPrompts);

  const metadata = trackMetadata(root, trackId, args);
  const stages = newTrackApprovalStages();
  const collection = newTrackStageCollection(root, args, trackId, stages, metadata);
  const metadataPath = `cadre/tracks/${safeName(trackId)}/metadata.json`;
  const occupiedTargets = occupiedTrackTargets(root, trackId, collection.cursor.session?.session_id || null);
  if (occupiedTargets.length > 0) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      track_id: trackId,
      occupied_targets: occupiedTargets,
      error: `Track target already exists or collides after path normalization: cadre/tracks/${safeName(trackId)}`,
    };
  }
  const approval = stagedApprovalState(root, "newtrack", args, stages, collection.files, {
    track_id: trackId,
    final_only_files: ["cadre/tracks.json", "cadre/events.jsonl"],
  }, { allowEmptyActiveStage: true });
  const approvalState = asJsonObject(approval);
  const stageReviewBundle = asJsonObject(approvalState.current_review_bundle);
  const stageReviewArtifacts = Array.isArray(approvalState.current_review_artifacts)
    ? approvalState.current_review_artifacts.map(asJsonObject)
    : [];
  const approvalError = stagedApprovalError(approval);
  const cancelled = approvalState.cancelled === true;
  const specJson = collection.specJson;
  const planJson = collection.planJson;
  const finalMetadata = collection.metadata || metadata;
  const assist = planJson ? planAssist(root, { ...args, plan: planJson, trackId }) : null;
  const warnings = [
    ...(specJson && planJson ? trackGenerationWarnings(specJson, planJson) : []),
    ...asStringArray(stageReviewBundle.warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  const base = {
    ...summary,
    track_id: trackId,
    approval,
    human_review: null,
    review_artifacts: stageReviewArtifacts,
    review_bundle: Object.keys(stageReviewBundle).length > 0 ? stageReviewBundle : null,
    warnings,
    ...(collection.metadata ? { metadata: collection.metadata } : {}),
    ...(assist ? { plan_assist: assist } : {}),
  };
  if (cancelled) return { ...base, ok: true, dry_run: true, phase_state: "cancelled" };
  if (collection.schemaIssues.length > 0 && !approvalError) {
    const encodedRoot = encodeURIComponent(root);
    const artifact = collection.activeKind || "spec";
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "schema_validation",
      track_id: trackId,
      approval,
      schema_errors: collection.schemaIssues,
      schema_resources: [`cadre://artifact-schema?root=${encodedRoot}&artifact=${artifact}`],
      missing_payload: collection.missingEvidence,
      required_payload: collection.missingEvidence,
      warnings,
      next_actions: [
        `Load the Cadre ${artifact} schema, correct only the current ${artifact} input, and resume this approval session without recording approval.`,
      ],
      error: `Current newtrack ${artifact} JSON does not match the Cadre schema.`,
    };
  }
  if ((intentPrompts.length > 0 || collection.missingEvidence.length > 0) && !approvalError) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: intentPrompts.length > 0 ? "intent_clarification" : "track_evidence",
      track_id: trackId,
      approval,
      intent_prompts: intentPrompts,
      missing_payload: collection.missingEvidence,
      required_payload: collection.missingEvidence,
      warnings,
      next_actions: [
        `Supply only the current ${collection.activeKind || "spec"} evidence and resume with approval.session_id; session resume is not approval.`,
      ],
      error: intentPrompts.length > 0
        ? "New track intent needs clearer goal, outcome, acceptance, or scope evidence before spec review."
        : `Current newtrack stage requires evidence-backed ${collection.missingEvidence.join(" and ")} JSON.`,
    };
  }
  if (args.execute !== true) {
    return {
      ...base,
      ok: !approvalError && (!assist || assist.ok !== false),
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      ...(approvalError ? { error: approvalError } : {}),
      next_actions: approvalError ? asStringArray(approvalState.next_actions) : [
        "Approve only the current newtrack stage after review.",
        "Use the exact returned continuation after both spec and plan stages are approved.",
      ],
    };
  }
  if (!stagedApprovalReady(approval)) {
    return {
      ...base,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      error: approvalError || "Staged approval is required before creating track artifacts",
    };
  }
  if (!specJson || !planJson || !collection.metadata || !collection.learningsEntry) {
    return {
      ...base,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "approval_session_integrity",
      error: "Approved newtrack session is missing frozen spec, plan, metadata, or learnings snapshots.",
    };
  }
  const reviewValidation = validateApprovedTargetReviewFiles(root, args);
  if (reviewValidation.ok === false) {
    return {
      ...base,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_review_drift",
      review_validation: reviewValidation,
      error: asOptionalString(reviewValidation.error) || "Approved review files changed after staged approval",
    };
  }

  const traceBefore = beginTrace(root);
  const regen = regenIndex(root);
  const approvalSessionId = asOptionalString(approvalState.session_id);
  const formulaId = asOptionalString(args.formulaId || args.formula_id);
  const recordedEvents = approvalSessionId ? readCadreEvents(root, 0) : [];
  const existingEvent = approvalSessionId
    ? recordedEvents.find((candidate) => (
      candidate.kind === "track_created" && candidate.approval_session_id === approvalSessionId
    ))
    : null;
  const event = existingEvent
    ? { ok: true, reused: true, path: "cadre/events.jsonl", event: existingEvent }
    : appendCadreEvent(root, {
      kind: "track_created",
      workflow: "newtrack",
      track_id: trackId,
      approval_session_id: approvalSessionId || null,
      status: finalMetadata.status,
      tags: finalMetadata.tags || [],
    });
  const existingFormulaEvent = approvalSessionId && formulaId
    ? recordedEvents.find((candidate) => (
      candidate.kind === "formula_poured" && candidate.approval_session_id === approvalSessionId
    ))
    : null;
  const formulaEvent = !formulaId
    ? null
    : existingFormulaEvent
      ? { ok: true, reused: true, path: "cadre/events.jsonl", event: existingFormulaEvent }
      : appendCadreEvent(root, {
        kind: "formula_poured",
        workflow: "formula",
        formula_id: formulaId,
        wisp_id: asOptionalString(args.wispId || args.wisp_id) || null,
        track_id: trackId,
        approval_session_id: approvalSessionId || null,
      });
  const approvalAudit = recordApprovalCompletionFromArgs(root, args);
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "newtrack",
    subject: `create ${trackId}`,
    before: traceBefore,
    trackId,
    allowDirty: true,
    includeDirtyFiles: [
      ...asStringArray(reviewValidation.files),
      "cadre/tracks.json",
      "cadre/events.jsonl",
    ],
    note: {
      event_id: asOptionalString(asJsonObject(event.event).id) || null,
      formula_id: asOptionalString(args.formulaId || args.formula_id) || null,
      wisp_id: asOptionalString(args.wispId || args.wisp_id) || null,
    },
  });
  const approvalSessionClose = regen.ok !== false && controlCommit.ok !== false
    ? closeApprovalSessionFromArgs(root, args)
    : null;
  return {
    ...base,
    ok: regen.ok !== false && controlCommit.ok !== false,
    dry_run: false,
    phase_state: regen.ok === false || controlCommit.ok === false ? "recovery_required" : "executed",
    metadata_path: metadataPath,
    regen,
    event,
    formula_event: formulaEvent,
    approval_audit: approvalAudit,
    approval_session_close: approvalSessionClose,
    control_commit: controlCommit,
    review_validation: reviewValidation,
    reused_review_files: asStringArray(reviewValidation.files),
    worktree_plan: worktreePlan(root, { trackId }),
  };
}
