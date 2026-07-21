import fs from "node:fs";
import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray, errorMessage } from "../../../guards";
import type { RuntimeArgs } from "../../../types";

import { fileExists, writeJsonEnsured } from "../../infrastructure/runtime/json-store";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { artifactValidate, renderArtifact } from "./artifact-actions";
import { artifactDefinitions } from "./artifact-catalog";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { branchSetForTrack } from "./branch-set";
import { collisionScan } from "./collision";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult } from "./contracts";
import { hasGeneratedMarker, markdownDocJson, renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import { appendCadreEvent, appendCadreMessage, nativeStateSummary } from "./native-state";
import { trackHandoffJsonPath } from "./plan-docs";
import { planIntegrity, worktreePlan } from "./planning";
import { regenIndex } from "./project-maintenance";
import { projectSkillDiagnostics } from "./project-skills";
import { prCiStatus, reviewAssist } from "./quality-gates";
import { implementationPrep } from "./repo-resolution";
import { documentReviewPair, humanReviewState, jsonReviewFile, packetReviewArtifact, reviewArtifactsFromFiles, textReviewFile, workflowReviewBundle } from "./review-bundles";
import { syncControlPlane } from "./review-records";
import { applyStagedApprovalSessionPayload, handoffApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import { availableWork, fleetStatus, liveStatus, metadataTrackSummary, selectedTrackId, teamBoard, teamStatus } from "./status";
import { findTrack, trackContext } from "./track-context";
import { handoffIntentPrompts, meaningfulHandoffText } from "./workflow-evidence";
import {
  deferredTaskPacket,
  implementationTarget,
  parallelImplementation,
  worktreeSetupContinuation,
  worktreesReady,
} from "./implementation-orchestration";
import { recordImplementationDispatch } from "./implementation-dispatch";
import { implementationWorktreeGate } from "./implementation-recovery";
import { reviewGate } from "./track-mutations";
import { listTracks, phaseSchedule } from "./track-schedule";
import { workflowSummary } from "./workflow-response";
import { doctor } from "./workspace-health";

export function workflowImplement(root: string, args: RuntimeArgs = {}): CoreResult {
  const shouldClaim = args.claim === true || args.execute === true;
  const preflight = implementationPrep(root, { ...args, claim: false });
  const trackId = asOptionalString(preflight.selected_track) || args.trackId || args.track_id || null;
  const schedule = trackId ? phaseSchedule(root, { ...args, trackId }) : null;
  const integrationWorktrees = trackId && preflight.ok !== false
    ? worktreePlan(root, { ...args, trackId, repo: undefined, execute: false })
    : null;
  const readOk = preflight.ok !== false && schedule?.ok !== false && integrationWorktrees?.ok !== false;
  const orchestration = {
    prepare_implementation: preflight,
    phase_schedule: schedule,
  };
  const target = readOk ? implementationTarget(orchestration) : null;
  const worktreeSetup = readOk && trackId && integrationWorktrees
    ? worktreeSetupContinuation(root, trackId, integrationWorktrees, args)
    : null;
  const implementationGuard = readOk && trackId && integrationWorktrees && worktreesReady(integrationWorktrees)
    ? implementationWorktreeGate(
        root,
        String(trackId),
        integrationWorktrees,
        target?.task,
        Boolean(target && !parallelImplementation(target)),
      )
    : null;
  const prep = readOk && implementationGuard?.ok !== false && shouldClaim
    ? implementationPrep(root, { ...args, claim: true })
    : preflight;
  const ready = readOk && prep.ok !== false && implementationGuard?.ok !== false;
  const stateRecoveryReady = implementationGuard?.state_recovery_ready === true;
  const reconciliation = implementationGuard?.reconciliation_ready === true || stateRecoveryReady
    ? asJsonObject(implementationGuard.next)
    : null;
  const task = ready && !reconciliation && target && integrationWorktrees
    ? deferredTaskPacket(
        root,
        target,
        integrationWorktrees,
        implementationGuard?.clean === true || implementationGuard?.dispatch_clean === true,
        implementationGuard?.continuation === true,
      )
    : null;
  const implementationDispatch = task && shouldClaim && implementationGuard?.clean === true && trackId
    ? recordImplementationDispatch(root, String(trackId), task)
    : null;
  const ok = ready && implementationDispatch?.ok !== false;
  const parallelReady = Boolean(
    target
    && integrationWorktrees
    && worktreesReady(integrationWorktrees)
    && implementationGuard?.clean === true
    && parallelImplementation(target),
  );
  return {
    ...workflowSummary(root, "implement", args),
    ok,
    phase_state: ok
      ? worktreeSetup
        ? "awaiting_worktree"
        : reconciliation
          ? stateRecoveryReady ? "state_recovery_ready" : "reconciliation_ready"
          : task
            ? "implementation_ready"
            : parallelReady
              ? "parallel_ready"
              : "ready"
      : "blocked",
    prepare_implementation: prep,
    phase_schedule: schedule,
    integration_worktrees: integrationWorktrees,
    implementation_guard: implementationGuard,
    implementation_dispatch: implementationDispatch,
    ...(implementationGuard?.ok === false ? { stage: implementationGuard.stage, error: implementationGuard.error, blocked: implementationGuard.blocked } : {}),
    next: ok ? worktreeSetup || reconciliation : null,
    ...(ok && task ? { task } : {}),
    ...(ok && worktreeSetup ? {
      decision: {
        kind: "worktree_setup",
        track_id: trackId,
        prompt: "Create and check out the required integration worktree before implementation begins.",
        call: worktreeSetup,
      },
    } : ok && reconciliation ? {
      decision: {
        kind: stateRecoveryReady ? "task_state_recovery" : "task_reconciliation",
        track_id: trackId,
        prompt: stateRecoveryReady
          ? "A product commit succeeded before task state finished recording. Invoke the returned state-only recovery call."
          : "A completed task left an attributable partial change set. Invoke the returned reconciliation call before continuing implementation.",
        call: reconciliation,
      },
    } : ok && task ? {
      decision: {
        kind: "implementation_task",
        track_id: trackId,
        task_key: task.task_key || null,
        prompt: "Perform the task in working_root, then invoke complete_packet with implementation evidence.",
      },
    } : ok && parallelReady ? {
      decision: {
        kind: "parallel_ready",
        track_id: trackId,
        prompt: "The integration worktrees are ready; schedule the next dependency-ready worker wave.",
      },
    } : {}),
    ...(ok ? {} : {
      error: asOptionalString(prep.error || prep.reason)
        || asOptionalString(schedule?.error)
        || asOptionalString(integrationWorktrees?.error)
        || asOptionalString(implementationGuard?.error || implementationGuard?.reason)
        || asOptionalString(implementationDispatch?.error)
        || "Implementation preparation failed",
    }),
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
  const branchSets = listTracks(root).map((track) => ({
    track_id: track.track_id,
    branch_set: branchSetForTrack(root, track),
  }));
  const projections = artifactValidate(root, { ...args, includeArchive: true });
  return {
    ...summary,
    ok: projections.ok !== false,
    doctor: doctor(root, { hasCadreProject: true }),
    team: teamStatus(root),
    integrity: planIntegrity(root, args.trackId || args.track_id || null),
    collisions: collisionScan(root),
    fleet: fleetStatus(root, { includeCollisions: false }),
    branch_sets: branchSets,
    native_state: nativeStateSummary(root),
    project_skill_diagnostics: projectSkillDiagnostics(root),
    projection_validation: projections,
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
  const humanReview = { required: false, execution_required: true, workflow: "archive", artifacts: reviewArtifacts };
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
    const archiveDefs = artifactDefinitions(root, { includeArchive: true })
      .filter((definition) => definition.id.startsWith(`archive:${track.track_id}:`) && definition.projection);
    const projectionErrors: string[] = [];
    const projectionWrites = archiveDefs.flatMap((definition) => {
      if (!fileExists(path.join(root, definition.canonical))) return [];
      const existingProjection = definition.projection ? path.join(root, definition.projection) : null;
      if (existingProjection && fileExists(existingProjection) && !hasGeneratedMarker(fs.readFileSync(existingProjection, "utf8"))) {
        projectionErrors.push(`Refusing to rewrite user-owned archived projection ${definition.projection}`);
        return [];
      }
      const rendered = renderArtifact(root, definition);
      if (rendered.ok !== true || !rendered.content || !definition.projection) {
        projectionErrors.push(`Unable to render archived projection for ${definition.canonical}`);
        return [];
      }
      return rendered.ok === true && rendered.content && definition.projection
        ? [{ path: definition.projection, content: rendered.content }]
        : [];
    });
    const projectionMutation = projectionErrors.length > 0
      ? { ok: false, error: projectionErrors[0], errors: projectionErrors }
      : projectionWrites.length > 0
        ? writeArtifactFilesAtomic(root, projectionWrites)
        : { ok: true, skipped: true };
    let moveRollback: CoreResult | null = null;
    if (projectionMutation.ok === false) {
      try {
        fs.renameSync(target, track.dir);
        moveRollback = { ok: true, restored: path.relative(root, track.dir) };
      } catch (error) {
        moveRollback = { ok: false, error: errorMessage(error) };
      }
    }
    archived.push({
      track_id: track.track_id,
      ok: projectionMutation.ok !== false,
      path: path.relative(root, target),
      projection_mutation: projectionMutation,
      move_rollback: moveRollback,
    });
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
  args = applyStagedApprovalSessionPayload(root, args, "handoff");
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "handoff", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  if (context.ok === false) return { ...summary, ok: false, track_context: context };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, track_context: context, error: `Track not found: ${trackId}` };
  const text = meaningfulHandoffText(args);
  if (!text) {
    const intentPrompts = handoffIntentPrompts(args);
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "intent_clarification",
      track_id: trackId,
      track_context: context,
      ...(intentPrompts.length > 0 ? { intent_prompts: intentPrompts } : {}),
      missing_payload: ["handoffText"],
      next_actions: [
        "Provide substantive handoffText covering current state, blockers or decisions, and the exact next action.",
        "Call handoff again after the handoff content is ready; Cadre has not generated handoff artifacts.",
      ],
      error: "Handoff content is missing or generic; Cadre will not generate a placeholder handoff.",
    };
  }
  const handoffPath = path.join(track.dir, "HANDOFF.md");
  const handoffJsonPath = trackHandoffJsonPath(track);
  const handoffJson = markdownDocJson("handoff", text, { track_id: trackId });
  const handoffCanonicalContent = `${JSON.stringify(handoffJson, null, 2)}\n`;
  const reviewFiles = documentReviewPair("handoff",
    jsonReviewFile(path.relative(root, handoffJsonPath), "Track handoff canonical", "handoffText", handoffJson),
    textReviewFile(
      path.relative(root, handoffPath),
      "Track handoff",
      "handoff.json",
      withGeneratedMarker(path.relative(root, handoffJsonPath), "cadre.handoff.v1", renderMarkdownDoc(handoffJson, `Handoff: ${trackId}`, path.relative(root, handoffJsonPath)), { canonicalContent: handoffCanonicalContent, projection: path.relative(root, handoffPath) })
    ));
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  const reviewBundle = workflowReviewBundle(root, "handoff", args, reviewFiles, { track_id: trackId });
  const approval = stagedApprovalState(root, "handoff", args, handoffApprovalStages(), reviewFiles, { track_id: trackId, final_only_files: ["cadre/events.jsonl"] });
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
  if (args.execute === true) {
    if (!reusedReviewFiles.has(path.relative(root, handoffJsonPath))) writeJsonEnsured(handoffJsonPath, handoffJson);
    if (!reusedReviewFiles.has(path.relative(root, handoffPath))) {
      fs.writeFileSync(handoffPath, withGeneratedMarker(path.relative(root, handoffJsonPath), "cadre.handoff.v1", renderMarkdownDoc(handoffJson, `Handoff: ${trackId}`, path.relative(root, handoffJsonPath))));
    }
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
  if (event.ok === false) {
    return {
      ...base,
      ok: false,
      dry_run: false,
      phase_state: "recovery_required",
      stage: "event_log",
      message,
      event,
      error: asOptionalString(event.error) || "Handoff was written but its required audit event was not recorded",
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
      message,
      event,
      approval_audit: approvalAudit,
      error: asOptionalString(approvalAudit.error) || "Handoff approval audit was not recorded",
    };
  }
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "handoff",
    subject: `record ${trackId} handoff`,
    before: traceBefore,
    trackId,
    allowDirty: true,
    includeDirtyFiles: asStringArray(reviewValidation.files),
    note: {
      event_id: asOptionalString(asJsonObject(event.event).id) || null,
      message_id: asOptionalString(asJsonObject(message.message).id) || null,
      to: recipient,
    },
  });
  const approvalSessionClose = controlCommit.ok !== false ? closeApprovalSessionFromArgs(root, args) : null;
  return {
    ...base,
    ok: controlCommit.ok !== false,
    dry_run: args.execute !== true,
    phase_state: controlCommit.ok === false ? "recovery_required" : "executed",
    message,
    event,
    approval_audit: approvalAudit,
    approval_session_close: approvalSessionClose,
    control_commit: controlCommit,
    review_validation: reviewValidation,
    reused_review_files: asStringArray(reviewValidation.files),
  };
}
