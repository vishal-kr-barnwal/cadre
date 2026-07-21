import fs from "node:fs";
import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { readJson, utcNow, writeJsonEnsured } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult } from "./contracts";
import { trackGenerationWarnings } from "./generation-quality";
import { reviseIntentPrompts } from "./intent-prompts";
import { withGeneratedMarker } from "./markdown-docs";
import { renderPlanMarkdown, trackPlanJsonPath, trackSpecJsonPath } from "./plan-docs";
import { regenIndex } from "./project-maintenance";
import { revisionScope, scopeIncludes } from "./revision-scope";
import { reviseStageCollection } from "./revise-stage-lifecycle";
import { renderSpecMarkdown } from "./spec-docs";
import {
  applyStagedApprovalSessionPayload,
  reviseApprovalStages,
  stagedApprovalError,
  stagedApprovalReady,
  stagedApprovalState,
  validateApprovedTargetReviewFiles,
} from "./staged-approval";
import { selectedTrackId } from "./status";
import { findTrack, trackContext } from "./track-context";
import { markdownPayloadError, normalizePlanJson, normalizeSpecJson, workflowSummary } from "./workflow-response";
import { lspImpact } from "./workspace-intel";

export function workflowRevise(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "revise");
  const trackId = selectedTrackId(root, args);
  if (trackId && !args.trackId && !args.track_id) args = { ...args, trackId };
  const summary = workflowSummary(root, "revise", args);
  const markdownError = markdownPayloadError(args);
  if (markdownError) return { ...summary, ...markdownError };
  const initialPrompts = reviseIntentPrompts(args, trackId || null);
  if (initialPrompts.length > 0) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "intent_clarification",
      ...(trackId ? { track_id: trackId, track_context: trackContext(root, trackId) } : {}),
      intent_prompts: initialPrompts,
      next_actions: ["Answer the target, reason, and revision-scope prompts before starting staged revision."],
      error: "Revision intent is under-specified; Cadre needs a target, reason, and spec/plan scope.",
    };
  }
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const track = findTrack(root, trackId);
  const context = trackContext(root, trackId);
  const impact = lspImpact(root, args);
  if (!track) return { ...summary, ok: false, track_context: context, impact, error: `Track not found: ${trackId}` };
  const scope = revisionScope(args, trackId);
  if (!scope) return { ...summary, ok: false, track_context: context, impact, error: "Revision scope is required" };

  const stages = reviseApprovalStages(scope);
  const collection = reviseStageCollection(root, args, track, stages);
  const reviewFiles = collection.files;
  const approval = stagedApprovalState(root, "revise", args, stages, reviewFiles, {
    track_id: trackId,
    final_only_files: ["cadre/tracks.json", "cadre/events.jsonl"],
  }, { allowEmptyActiveStage: true });
  const currentReviewBundle = asJsonObject(asJsonObject(approval).current_review_bundle);
  const stageReviewBundle = Object.keys(currentReviewBundle).length > 0 ? currentReviewBundle : null;
  const currentArtifacts = asJsonObject(approval).current_review_artifacts;
  const stageReviewArtifacts = Array.isArray(currentArtifacts) ? currentArtifacts.map(asJsonObject) : [];
  const approvalError = stagedApprovalError(approval);
  const approvalState = asJsonObject(approval);
  const cancelled = approvalState.cancelled === true;
  const approvalRecoveryRequired = approvalState.approval_recovery_required === true;
  const raw = args as UnknownRecord;
  const existingSpec = readJson<JsonObject | null>(trackSpecJsonPath(track), null);
  const collectSpec = args.execute === true || (collection.activeKind === "spec" && collection.missingEvidence.length === 0);
  const collectPlan = args.execute === true || (collection.activeKind === "plan" && collection.missingEvidence.length === 0);
  const revisedSpec = collectSpec && scopeIncludes(scope, "spec") && isRecord(raw.spec)
    ? normalizeSpecJson(trackId, raw.spec)
    : null;
  const approvedSpecContext = revisedSpec || (
    collectPlan && scopeIncludes(scope, "spec") && isRecord(raw.spec)
      ? normalizeSpecJson(trackId, raw.spec)
      : existingSpec
  );
  const revisedPlan = collectPlan && scopeIncludes(scope, "plan") && isRecord(raw.plan)
    ? normalizePlanJson(trackId, raw.plan, approvedSpecContext)
    : null;
  const qualityWarnings = revisedPlan
    ? trackGenerationWarnings(revisedSpec || existingSpec || {}, revisedPlan)
    : revisedSpec
      ? trackGenerationWarnings(revisedSpec, {
        phases: [{ tasks: [{ title: "context-only", files: ["context"], manual_verification: { scope: "revision" } }] }],
      })
      : [];
  const warnings = [
    ...qualityWarnings,
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  const base = {
    ...summary,
    track_id: trackId,
    track_context: context,
    impact,
    revision_scope: scope,
    approval,
    human_review: null,
    review_artifacts: stageReviewArtifacts,
    review_bundle: stageReviewBundle,
    warnings,
  };
  if (cancelled) return { ...base, ok: true, dry_run: true, phase_state: "cancelled" };
  if (collection.missingEvidence.length > 0 && !approvalError) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "revision_evidence",
      track_id: trackId,
      track_context: context,
      impact,
      revision_scope: scope,
      approval,
      missing_payload: collection.missingEvidence,
      required_payload: collection.missingEvidence,
      warnings,
      error: `Current revision stage requires evidence-backed ${collection.missingEvidence.join(" and ")} JSON.`,
      next_actions: ["Supply only the current revision artifact at decision.writable_paths and invoke decision.resume; this is not approval."],
    };
  }
  if (collection.schemaIssues.length > 0 && !approvalError) {
    const artifact = collection.activeKind || "plan";
    return {
      ...base,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "schema_validation",
      schema_errors: collection.schemaIssues,
      schema_resources: [`cadre://artifact-schema?root=${encodeURIComponent(root)}&artifact=${artifact}`],
      missing_payload: [artifact],
      required_payload: [artifact],
      next_actions: [
        `Load the Cadre ${artifact} schema, correct only decision.writable_paths, and invoke decision.resume without recording approval.`,
      ],
      error: `Current revise ${artifact} JSON does not match the Cadre schema.`,
    };
  }
  if (args.execute !== true) {
    return {
      ...base,
      ok: !approvalError,
      dry_run: true,
      phase_state: approvalRecoveryRequired ? "recovery_required" : "awaiting_staged_approval",
      ...(approvalError ? { error: approvalError, stage: "staged_approval" } : {}),
    };
  }
  if (!stagedApprovalReady(approval)) {
    return {
      ...base,
      ok: false,
      dry_run: true,
      phase_state: approvalRecoveryRequired ? "recovery_required" : "awaiting_staged_approval",
      stage: "staged_approval",
      error: approvalError || "Staged approval is required before revising track artifacts",
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
  const reusedReviewFiles = new Set(asStringArray(reviewValidation.files));
  const traceBefore = beginTrace(root);
  const writeResult = withTrackLock(root, track.track_id, () => {
    const written: string[] = [];
    if (revisedSpec) {
      if (!reusedReviewFiles.has(path.relative(root, trackSpecJsonPath(track)))) writeJsonEnsured(trackSpecJsonPath(track), revisedSpec);
      if (!reusedReviewFiles.has(path.relative(root, track.spec_path))) {
        fs.writeFileSync(track.spec_path, withGeneratedMarker(
          path.relative(root, trackSpecJsonPath(track)),
          "cadre.spec.v1",
          renderSpecMarkdown(revisedSpec, path.relative(root, trackSpecJsonPath(track))),
        ));
      }
      written.push(path.relative(root, trackSpecJsonPath(track)), path.relative(root, track.spec_path));
    }
    if (revisedPlan) {
      if (!reusedReviewFiles.has(path.relative(root, trackPlanJsonPath(track)))) writeJsonEnsured(trackPlanJsonPath(track), revisedPlan);
      if (!reusedReviewFiles.has(path.relative(root, track.plan_path))) {
        fs.writeFileSync(track.plan_path, withGeneratedMarker(
          path.relative(root, trackPlanJsonPath(track)),
          "cadre.plan.v1",
          renderPlanMarkdown(revisedPlan, path.relative(root, trackPlanJsonPath(track))),
        ));
      }
      written.push(path.relative(root, trackPlanJsonPath(track)), path.relative(root, track.plan_path));
    }
    return { ok: true, written, revised_at: utcNow() };
  });
  const regen = writeResult.ok !== false ? regenIndex(root) : null;
  const approvalAudit = writeResult.ok !== false && (!regen || regen.ok !== false)
    ? recordApprovalCompletionFromArgs(root, args)
    : null;
  const auditOk = !approvalAudit || approvalAudit.ok !== false;
  const controlCommit = writeResult.ok !== false && (!regen || regen.ok !== false) && auditOk
    ? commitTrace(root, args, {
      kind: "control",
      workflow: "revise",
      subject: `update ${trackId}`,
      before: traceBefore,
      trackId,
      allowDirty: true,
      includeDirtyFiles: asStringArray(reviewValidation.files),
      note: { revised_spec: Boolean(revisedSpec), revised_plan: Boolean(revisedPlan) },
    })
    : null;
  const approvalSessionClose = writeResult.ok !== false && (!regen || regen.ok !== false) && auditOk && (!controlCommit || controlCommit.ok !== false)
    ? closeApprovalSessionFromArgs(root, args)
    : null;
  return {
    ...base,
    ok: writeResult.ok !== false && (!regen || regen.ok !== false) && auditOk && (!controlCommit || controlCommit.ok !== false),
    dry_run: false,
    phase_state: writeResult.ok === false || (regen && regen.ok === false) || !auditOk || (controlCommit && controlCommit.ok === false)
      ? "recovery_required"
      : "executed",
    ...(!auditOk ? {
      stage: "approval_audit",
      error: asOptionalString(asJsonObject(approvalAudit).error) || "Revised artifacts were written but their approval audit was not recorded",
    } : {}),
    write: writeResult,
    regen,
    control_commit: controlCommit,
    approval_audit: approvalAudit,
    approval_session_close: approvalSessionClose,
    review_validation: reviewValidation,
    reused_review_files: asStringArray(reviewValidation.files),
  };
}
