import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { RuntimeArgs, TrackMetadata, UnknownRecord } from "../../../types";

import { safeName } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { gitIdentity } from "../../infrastructure/runtime/system";
import { closeApprovalSessionFromArgs, readApprovalSession, recordApprovalCompletionFromArgs } from "./approval-session-store";
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
import {
  APPROVAL_RESTARTED,
  approvalRestartRequested,
  requestedApprovalSessionId,
} from "./approval-request";
import { inspectNewTrackTarget } from "./new-track-target-state";
import { reconcileNewTrackRestarts, restartPristineTrack } from "./new-track-restart-journal";

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

function workflowNewTrackUnlocked(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "newtrack");
  let restarted = (args as UnknownRecord)[APPROVAL_RESTARTED] === true;
  const summary = workflowSummary(root, "newtrack", args);
  const markdownError = markdownPayloadError(args);
  if (markdownError) return { ...summary, ...markdownError };
  const intentPrompts = newTrackIntentPrompts(args);
  const trackId = asOptionalString(args.trackId || args.track_id);
  if (!trackId) return clarificationWithoutTarget(summary, intentPrompts);

  const metadata = trackMetadata(root, trackId, args);
  const restartSessionId = requestedApprovalSessionId(args);
  let targetState = inspectNewTrackTarget(root, trackId, restartSessionId);
  if (approvalRestartRequested(args) && !restartSessionId) {
    if (targetState.kind !== "pristine_track") {
      return {
        ...summary,
        ok: false,
        dry_run: true,
        track_id: trackId,
        target_ownership: targetState,
        error: targetState.kind === "established_track"
          ? `Track ${trackId} has started or retained state; revise it instead of restarting.`
          : `Track ${trackId} is not a proven pristine track and cannot be restarted without its owning approval session.`,
      };
    }
    const reset = restartPristineTrack(root, trackId);
    if (!reset.ok) {
      return {
        ...summary,
        ok: false,
        dry_run: true,
        track_id: trackId,
        stage: "newtrack_restart",
        restart: reset,
        error: asOptionalString(reset.error) || `Unable to restart pristine track ${trackId}.`,
      };
    }
    const mutable = { ...args } as UnknownRecord;
    delete mutable.approvalRestart;
    delete mutable.approval_restart;
    mutable[APPROVAL_RESTARTED] = true;
    args = mutable as RuntimeArgs;
    restarted = true;
    targetState = inspectNewTrackTarget(root, trackId, null);
  }
  if (targetState.kind !== "vacant" && targetState.kind !== "owned_draft") {
    const exactDraft = targetState.kind === "foreign_draft"
      && targetState.owner?.workflow === "newtrack"
      && targetState.ownerTrackId === trackId;
    const revise = {
      tool: "cadre_workflow",
      arguments: { root, workflow: "revise", input: { trackId }, execute: false },
    };
    return {
      ...summary,
      ok: false,
      dry_run: true,
      track_id: trackId,
      occupied_targets: targetState.occupied,
      target_ownership: targetState,
      ...(exactDraft && targetState.owner ? {
        decision: {
          kind: "draft_exists",
          track_id: trackId,
          session_id: targetState.owner.session_id,
          resume: {
            tool: "cadre_workflow",
            arguments: { root, workflow: "newtrack", input: {}, execute: false, approval: { session_id: targetState.owner.session_id } },
          },
          restart: {
            tool: "cadre_workflow",
            arguments: { root, workflow: "newtrack", input: {}, execute: false, approval: { session_id: targetState.owner.session_id, restart: true } },
          },
          cancel: {
            tool: "cadre_workflow",
            arguments: { root, workflow: "newtrack", input: {}, execute: false, approval: { session_id: targetState.owner.session_id, cancel: true } },
          },
        },
      } : targetState.kind === "pristine_track" ? {
        decision: {
          kind: "pristine_track_exists",
          track_id: trackId,
          restart: {
            tool: "cadre_workflow",
            arguments: { root, workflow: "newtrack", input: { trackId }, execute: false, approval: { restart: true } },
          },
          revise,
        },
      } : targetState.kind === "established_track" ? {
        decision: { kind: "track_exists", track_id: trackId, revise },
      } : {}),
      error: [
        `Track target already exists or collides after path normalization: cadre/tracks/${safeName(trackId)}`,
        targetState.reason,
      ].filter(Boolean).join("; "),
    };
  }
  const stages = newTrackApprovalStages();
  const collection = newTrackStageCollection(root, args, trackId, stages, metadata);
  const metadataPath = `cadre/tracks/${safeName(trackId)}/metadata.json`;
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
    ...(restarted ? {
      restart: {
        ok: true,
        session_id: restartSessionId || null,
        track_id: trackId,
        reused_id: true,
      },
    } : {}),
  };
  if (cancelled) return { ...base, ok: true, dry_run: true, phase_state: "cancelled" };
  if (collection.schemaIssues.length > 0 && !approvalError) {
    const encodedRoot = encodeURIComponent(root);
    const artifact = collection.activeKind || "spec";
    const schemaInput = collection.missingEvidence.length > 0 ? collection.missingEvidence : [artifact];
    return {
      ...base,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "schema_validation",
      track_id: trackId,
      approval,
      schema_errors: collection.schemaIssues,
      schema_resources: [`cadre://artifact-schema?root=${encodedRoot}&artifact=${artifact}`],
      missing_payload: schemaInput,
      required_payload: schemaInput,
      warnings,
      next_actions: [
        `Load the Cadre ${artifact} schema, correct only decision.writable_paths for the current ${artifact}, and invoke decision.resume without recording approval.`,
      ],
      error: `Current newtrack ${artifact} JSON does not match the Cadre schema.`,
    };
  }
  if ((intentPrompts.length > 0 || collection.missingEvidence.length > 0) && !approvalError) {
    return {
      ...base,
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
        `Supply only the current ${collection.activeKind || "spec"} evidence at decision.writable_paths and invoke decision.resume; session resume is not approval.`,
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
  if (event.ok === false || formulaEvent?.ok === false) {
    const failedEvent = event.ok === false ? event : formulaEvent;
    return {
      ...base,
      ok: false,
      dry_run: false,
      phase_state: "recovery_required",
      stage: "event_log",
      metadata_path: metadataPath,
      regen,
      event,
      formula_event: formulaEvent,
      error: asOptionalString(asJsonObject(failedEvent).error) || "Newtrack artifacts were written but a required audit event was not recorded; retry execution",
    };
  }
  const approvalAudit = recordApprovalCompletionFromArgs(root, args);
  if (approvalAudit.ok === false) {
    return {
      ...base,
      ok: false,
      dry_run: false,
      phase_state: "recovery_required",
      stage: "approval_audit",
      metadata_path: metadataPath,
      regen,
      event,
      formula_event: formulaEvent,
      approval_audit: approvalAudit,
      error: asOptionalString(approvalAudit.error) || "Newtrack approval audit was not recorded; retry execution",
    };
  }
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

export function workflowNewTrack(root: string, args: RuntimeArgs = {}): CoreResult {
  const restartRecovery = reconcileNewTrackRestarts(root);
  if (!restartRecovery.ok) {
    return {
      ...workflowSummary(root, "newtrack", args),
      ok: false,
      phase_state: "recovery_required",
      stage: "newtrack_restart_recovery",
      recovery_required: true,
      error: restartRecovery.error || "An interrupted newtrack restart requires recovery",
    };
  }
  const sessionId = requestedApprovalSessionId(args);
  const persisted = sessionId ? readApprovalSession(root, sessionId) : null;
  const trackId = asOptionalString(
    args.trackId || args.track_id || persisted?.payload.trackId || persisted?.payload.track_id,
  );
  return args.execute === true && trackId
    ? withTrackLock(root, trackId, () => workflowNewTrackUnlocked(root, args)) as CoreResult
    : workflowNewTrackUnlocked(root, args);
}
