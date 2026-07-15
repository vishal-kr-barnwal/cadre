import { asJsonObject, asOptionalString, asString, asStringArray, isRecord } from "../../../guards";
import type { CadreTrack, RuntimeArgs } from "../../../types";

import { utcNow } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { actionResultsOk, plannedGitAction, runPlannedGitActions } from "../../infrastructure/runtime/system";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { artifactSync } from "./artifact-actions";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult, PlannedGitAction } from "./contracts";
import { refreshAnalysis, refreshLevelIds, refreshLevelPrompt, refreshSelectionProvided, unsupportedRefreshLevels } from "./refresh-analysis";
import { refreshCandidate } from "./refresh-documents";
import { refreshStageCollection } from "./refresh-stage-lifecycle";
import { repoEntriesError, repoEntriesForTrack } from "./repo-resolution";
import { humanReviewState, packetReviewArtifact, reviewArtifactsFromFiles } from "./review-bundles";
import { lspSetup } from "./setup-infrastructure";
import { lspPreviewPayload, machineReviewFile } from "./setup-review-plan";
import { applyStagedApprovalSessionPayload, refreshApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import { selectedTrackId } from "./status";
import { findTrack, trackContext } from "./track-context";
import { metadataPatch } from "./track-mutations";
import { parsePlanFile } from "./track-schedule";
import { workflowSummary } from "./workflow-response";
import { doctor, lspConfigStatus } from "./workspace-health";
import { dependencyGraph, workspaceDiagnostics } from "./workspace-intel";

export function revertGitActions(root: string, track: CadreTrack, args: RuntimeArgs = {}): PlannedGitAction[] {
  const plan = parsePlanFile(track.plan_path);
  const requestedCommit = asOptionalString(args.commitSha || args.commit);
  const topology = loadTopology(root);
  const commitEntries = requestedCommit
    ? [{ commit: requestedCommit, repo: asOptionalString(args.repo) || (topology.polyrepo ? topology.defaultRepo : "root") }]
    : plan.tasks.flatMap((task) => {
      const taskCommits = asStringArray(task.commit_shas || []).concat(task.commit ? [task.commit] : []);
      const repo = asOptionalString(args.repo) || task.repo || (topology.polyrepo ? topology.defaultRepo : "root");
      return taskCommits.map((commit) => ({ commit, repo }));
    });
  return commitEntries.reverse().map((entryInfo, index) => {
    const commit = entryInfo.commit;
    const repo = asOptionalString(entryInfo.repo) || (topology.polyrepo ? topology.defaultRepo : "root");
    const entry = repoEntriesForTrack(root, track, { ...args, repo }).find((item) => item.repo === repo);
    return plannedGitAction(
      `revert-${index + 1}`,
      "revert_commit",
      repo,
      entry ? asString(entry.root, root) : root,
      ["revert", "--no-edit", commit],
      `Revert ${commit} in ${repo}`
    );
  });
}

export function workflowRevert(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "revert", args);
  if (!trackId) return { ...summary, ok: false, phase_state: "blocked", error: "trackId is required" };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, phase_state: "blocked", error: `Track not found: ${trackId}` };
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return { ...summary, ok: false, phase_state: "blocked", stage: "polyrepo_repo_resolution", repo_error: repoError };
  const affectedRepos = repoEntriesForTrack(root, track, args).map((entry) => entry.repo);
  if ((args.commitSha || args.commit) && loadTopology(root).polyrepo && !args.repo && affectedRepos.length > 1) {
    return {
      ...summary,
      ok: false,
      phase_state: "blocked",
      stage: "polyrepo_repo_resolution",
      reason: "Explicit polyrepo revert requires repo when a track affects multiple repos",
      affected_repos: affectedRepos,
    };
  }
  const gitActions = revertGitActions(root, track, args);
  if (gitActions.length === 0) {
    return {
      ...summary,
      ok: false,
      phase_state: "blocked",
      track_context: trackContext(root, trackId),
      reason: "No commit evidence found to revert; pass commitSha or record task commits first",
      git_actions: gitActions,
    };
  }
  const reviewArtifacts = [
    packetReviewArtifact("Revert scope", "workflow:revert", {
      track_id: trackId,
      git_actions: gitActions,
      reason: args.reason || null,
    }),
  ];
  const humanReview = { required: false, execution_required: true, workflow: "revert", artifacts: reviewArtifacts };
  const gitResults = args.execute === true ? runPlannedGitActions(gitActions) : [];
  const gitOk = actionResultsOk(gitResults);
  const traceBefore = args.execute === true && gitOk ? beginTrace(root) : null;
  const projectionRepair = args.execute === true && gitOk
    ? artifactSync(root, { execute: true, commitMode: "off" })
    : null;
  const mutationOk = gitOk && (!projectionRepair || projectionRepair.ok !== false);
  const statusResult = args.execute === true && mutationOk
    ? metadataPatch(root, {
      trackId,
      patch: {
        status: "in_progress",
        last_revert: {
          reverted_at: utcNow(),
          commits: gitActions.map((action) => action.args[action.args.length - 1]).filter((commit): commit is string => typeof commit === "string"),
          reason: args.reason || null,
        },
      },
    })
    : null;
  const controlCommit = args.execute === true && mutationOk && statusResult && statusResult.ok !== false
    ? commitTrace(root, args, {
      kind: "control",
      workflow: "revert",
      subject: `record ${trackId} revert`,
      before: traceBefore,
      trackId,
      note: {
        git_results: gitResults.map(asJsonObject),
        reason: args.reason || null,
      },
    })
    : null;
  return {
    ...summary,
    ok: args.execute === true ? mutationOk && (!statusResult || statusResult.ok !== false) && (!controlCommit || controlCommit.ok !== false) : true,
    phase_state: args.execute !== true ? "dry_run" : (mutationOk && (!controlCommit || controlCommit.ok !== false) ? "executed" : "recovery_required"),
    dry_run: args.execute !== true,
    track_context: trackContext(root, trackId),
    git_actions: gitActions,
    git_results: gitResults,
    projection_repair: projectionRepair,
    metadata_patch: statusResult,
    control_commit: controlCommit,
    human_review: humanReview,
    review_artifacts: reviewArtifacts,
  };
}

export function workflowRefresh(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "refresh");
  const summary = workflowSummary(root, "refresh", args);
  const analysis = refreshAnalysis(root, args);
  const recommended = asStringArray(analysis.recommended_levels);
  const unsupported = unsupportedRefreshLevels(args);
  if (unsupported.length > 0) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "intent_clarification",
      refresh_analysis: analysis,
      intent_prompts: [refreshLevelPrompt(analysis)],
      unsupported_levels: unsupported,
      error: `Unsupported refresh level(s): ${unsupported.join(", ")}`,
    };
  }
  if (!refreshSelectionProvided(args)) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "refresh_analysis",
      refresh_analysis: analysis,
      intent_prompts: [refreshLevelPrompt(analysis)],
      next_actions: ["Select one or more evidence-backed refresh levels from the returned native prompt."],
      error: "Cadre analyzed repository drift; select the refresh levels to continue.",
    };
  }
  const levels = refreshLevelIds(args, recommended);
  const stages = refreshApprovalStages(levels);
  const lspSelected = levels.includes("lsp");
  const lspPreview = lspSetup(root, { ...args, execute: false });
  const topologyCandidate = refreshCandidate(args, "repository-topology");
  const lspReviewFiles = lspSelected
    ? [{
      ...machineReviewFile(
        "cadre/lsp.json",
        "LSP configuration",
        "refresh:lsp",
        `${JSON.stringify(lspPreviewPayload(root, lspPreview, isRecord(topologyCandidate) ? asJsonObject(topologyCandidate) : null), null, 2)}\n`,
      ),
      documentId: "lsp",
    }]
    : [];
  const documents = refreshStageCollection(root, args, levels, stages, lspReviewFiles);
  const reviewFiles = documents.files;
  const projectionsSelected = levels.includes("projections");
  const diagnosticsOnly = levels.length === 0 || levels.every((level) => level === "diagnostics");
  const semanticRefresh = stages.length > 0;
  const mutatingRefresh = semanticRefresh || lspSelected || projectionsSelected;
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  const approval = semanticRefresh
    ? stagedApprovalState(root, "refresh", args, stages, reviewFiles, {
      selected_levels: levels,
      final_only_files: [],
    }, { allowEmptyActiveStage: true })
    : { required: false, valid_for_execute: true, current_stage: null, pending_stages: [] };
  const currentReviewBundle = asJsonObject(asJsonObject(approval).current_review_bundle);
  const stageReviewBundle = Object.keys(currentReviewBundle).length > 0 ? currentReviewBundle : null;
  const currentArtifacts = asJsonObject(approval).current_review_artifacts;
  const stageReviewArtifacts = Array.isArray(currentArtifacts)
    ? currentArtifacts.map(asJsonObject)
    : reviewArtifacts;
  const humanReview = semanticRefresh && stageReviewArtifacts.length > 0
    ? humanReviewState("refresh", args, stageReviewArtifacts, stageReviewBundle)
    : null;
  const approvalError = semanticRefresh ? stagedApprovalError(approval) : null;
  const cancelled = asJsonObject(approval).cancelled === true;
  const warnings = [
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  if (cancelled) {
    return {
      ...summary,
      ok: true,
      dry_run: true,
      phase_state: "cancelled",
      scope: levels,
      selected_levels: levels,
      refresh_analysis: analysis,
      approval,
      review_artifacts: [],
      review_bundle: null,
      warnings,
    };
  }
  if (documents.missingEvidence.length > 0 && !approvalError) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "refresh_evidence",
      scope: levels,
      selected_levels: levels,
      refresh_analysis: analysis,
      missing_payload: documents.missingEvidence,
      required_payload: documents.missingEvidence,
      approval,
      warnings,
      error: `Current refresh level requires evidence-backed canonical input: ${documents.missingEvidence.join(", ")}`,
      next_actions: ["Use the refresh analysis to supply the current level only at decision.writable_paths, then invoke the returned decision.resume; this is not approval."],
    };
  }
  const awaitingDocumentReview = args.execute === true && semanticRefresh && !stagedApprovalReady(approval);
  if (awaitingDocumentReview) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      refresh_analysis: analysis,
      doctor: doctor(root, { hasCadreProject: true }),
      workspace: workspaceDiagnostics(root, { execute: false }),
      dependency_graph: dependencyGraph(root),
      lsp: lspConfigStatus(root),
      lsp_setup: lspPreview,
      scope: levels,
      selected_levels: levels,
      approval,
      human_review: humanReview,
      review_artifacts: stageReviewArtifacts,
      review_bundle: stageReviewBundle,
      warnings,
      error: approvalError || "Staged approval is required before refreshing Cadre context documents",
    };
  }
  const reviewValidation = args.execute === true && reviewFiles.length > 0
    ? validateApprovedTargetReviewFiles(root, args)
    : { ok: true, skipped: true };
  if (args.execute === true && reviewValidation.ok === false) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_review_drift",
      refresh_analysis: analysis,
      doctor: doctor(root, { hasCadreProject: true }),
      workspace: workspaceDiagnostics(root, { execute: false }),
      dependency_graph: dependencyGraph(root),
      lsp: lspConfigStatus(root),
      lsp_setup: lspPreview,
      scope: levels,
      selected_levels: levels,
      approval,
      human_review: humanReview,
      review_artifacts: stageReviewArtifacts,
      review_bundle: stageReviewBundle,
      review_validation: reviewValidation,
      warnings,
      error: asOptionalString(asJsonObject(reviewValidation).error) || "Approved review files changed after staged approval",
    };
  }

  const traceBefore = args.execute === true && mutatingRefresh ? beginTrace(root) : null;
  const lsp = lspSelected
    ? { ...lspPreview, reviewed_snapshot: true, applied: args.execute === true && reviewValidation.ok !== false }
    : lspPreview;
  const projectionRepair = args.execute === true && projectionsSelected
    ? artifactSync(root, { scope: "project", execute: true, commitMode: "off" })
    : null;
  const operationsOk = !projectionRepair || projectionRepair.ok !== false;
  const approvalAudit = args.execute === true && reviewFiles.length > 0 && operationsOk
    ? recordApprovalCompletionFromArgs(root, args)
    : null;
  const controlCommit = args.execute === true && mutatingRefresh && operationsOk
    ? commitTrace(root, args, {
      kind: "control",
      workflow: "refresh",
      subject: "refresh project context",
      before: traceBefore,
      allowDirty: true,
      includeDirtyFiles: asStringArray(asJsonObject(reviewValidation).files),
      note: {
        selected_levels: levels,
        recommended_levels: recommended,
        reviewed_paths: asStringArray(asJsonObject(reviewValidation).files),
        lsp_setup: asJsonObject(lsp),
        projection_repair: projectionRepair ? asJsonObject(projectionRepair) : null,
      },
    })
    : null;
  const completedOk = operationsOk && (!controlCommit || controlCommit.ok !== false);
  const approvalSessionClose = args.execute === true && reviewFiles.length > 0 && completedOk
    ? closeApprovalSessionFromArgs(root, args)
    : null;
  const patterns = levels.includes("patterns")
    ? {
      ok: !approvalError && (args.execute !== true || completedOk),
      paths: documents.paths.filter((file) => file === "cadre/patterns.jsonl" || file === "cadre/patterns.md"),
      evidence_backed: true,
    }
    : null;
  const phaseState = diagnosticsOnly
    ? "complete"
    : args.execute === true
      ? (completedOk ? "executed" : "recovery_required")
      : reviewFiles.length > 0
        ? "awaiting_staged_approval"
        : "ready";
  return {
    ...summary,
    ok: (!approvalError || args.execute === true) && (args.execute !== true || completedOk),
    phase_state: phaseState,
    dry_run: args.execute !== true || diagnosticsOnly,
    ...(approvalError && args.execute !== true ? { stage: "staged_approval", error: approvalError } : {}),
    scope: levels,
    selected_levels: levels,
    refresh_analysis: analysis,
    doctor: doctor(root, { hasCadreProject: true }),
    workspace: workspaceDiagnostics(root, { execute: false }),
    dependency_graph: dependencyGraph(root),
    lsp: lspConfigStatus(root),
    lsp_setup: lsp,
    refreshed_documents: {
      selected: documents.documentIds,
      paths: documents.paths,
      applied: reviewFiles.length > 0 && args.execute === true && completedOk,
    },
    patterns,
    projection_repair: projectionRepair,
    control_commit: controlCommit,
    approval_audit: approvalAudit,
    approval_session_close: approvalSessionClose,
    approval,
    human_review: humanReview,
    review_artifacts: stageReviewArtifacts,
    review_bundle: stageReviewBundle,
    review_validation: reviewValidation,
    reused_review_files: asStringArray(asJsonObject(reviewValidation).files),
    warnings: [
      ...warnings,
      ...(!operationsOk && projectionRepair?.ok === false ? [asOptionalString(projectionRepair.error) || "Projection refresh failed"] : []),
    ],
  };
}
