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

import { readJsonl, renderJsonlMarkdown } from "./artifact-actions";
import { CoreResult, PlannedGitAction, ReviewFile } from "./contracts";
import { fileExists, utcNow } from "../../infrastructure/runtime/json-store";
import { withGeneratedMarker } from "./markdown-docs";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { regenIndex } from "./project-maintenance";
import { repoEntriesError, repoEntriesForTrack } from "./repo-resolution";
import { humanReviewState, packetReviewArtifact, plainReviewFile, reviewArtifactsFromFiles, setupLspReviewArtifacts, setupLspWriteRequested, textReviewFile, workflowReviewBundle } from "./review-bundles";
import { lspSetup } from "./setup-infrastructure";
import { selectedTrackId } from "./status";
import { actionResultsOk, plannedGitAction, runPlannedGitActions } from "../../infrastructure/runtime/system";
import { humanReviewConfirmed } from "./tech-stack";
import { beginTrace, commitTrace } from "./commit-trace";
import { findTrack, trackContext } from "./track-context";
import { refreshIntentPrompts, refreshScopeIds } from "./intent-prompts";
import { metadataPatch } from "./track-mutations";
import { parsePlanFile } from "./track-schedule";
import { templateJson, workflowSummary } from "./workflow-response";
import { doctor, lspConfigStatus } from "./workspace-health";
import { dependencyGraph, workspaceDiagnostics } from "./workspace-intel";
import { applyStagedApprovalSessionPayload, refreshApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState } from "./staged-approval";

export function refreshedPatternsText(text: string, now = utcNow()): { text: string; stamp: string } {
  const stamp = `Last refreshed: ${now.slice(0, 10)}`;
  const next = /Last refreshed:\s*.*/.test(text)
    ? text.replace(/Last refreshed:\s*.*/, stamp)
    : `${text.replace(/\n*$/, "\n\n")}${stamp}\n`;
  return { text: next, stamp };
}

export function refreshedPatternsArtifacts(root: string): { files: ReviewFile[]; jsonlPath: string; projectionPath: string; jsonl: string; projection: string; stamp: string } | null {
  const jsonlPath = path.join(root, "cadre", "patterns.jsonl");
  if (!fileExists(jsonlPath)) return null;
  const entries = readJsonl(jsonlPath);
  const seed = entries[0] || templateJson("patterns_seed.json", { id: "initial", kind: "patterns_seed", text: "# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n" });
  const currentText = asOptionalString(seed.text) || "# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n";
  const next = refreshedPatternsText(currentText);
  const nextEntries = [{ ...seed, text: next.text, refreshed_at: utcNow() }, ...entries.slice(1)];
  const jsonl = nextEntries.map((entry) => JSON.stringify(entry)).join("\n").replace(/\n*$/, "\n");
  const projection = withGeneratedMarker("cadre/patterns.jsonl", "cadre.patterns.v1", renderJsonlMarkdown("Project patterns", nextEntries));
  const projectionPath = path.join(root, "cadre", "patterns.md");
  return {
    files: [
      plainReviewFile(path.relative(root, jsonlPath), "Refreshed project patterns canonical", "refresh:patterns", jsonl),
      textReviewFile(path.relative(root, projectionPath), "Refreshed project patterns projection", "cadre/patterns.jsonl", projection),
    ],
    jsonlPath,
    projectionPath,
    jsonl,
    projection,
    stamp: next.stamp,
  };
}

export function refreshReviewFiles(root: string): ReviewFile[] {
  return refreshedPatternsArtifacts(root)?.files || [];
}

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
  const humanReview = humanReviewState("revert", args, reviewArtifacts);
  if (args.execute === true && !humanReviewConfirmed(args)) {
    return {
      ...summary,
      ok: false,
      phase_state: "awaiting_staged_approval",
      stage: "human_review",
      dry_run: true,
      track_context: trackContext(root, trackId),
      git_actions: gitActions,
      human_review: humanReview,
      review_artifacts: reviewArtifacts,
      error: "Staged approval is required before reverting tracked commits",
    };
  }
  const gitResults = args.execute === true ? runPlannedGitActions(gitActions) : [];
  const gitOk = actionResultsOk(gitResults);
  const traceBefore = args.execute === true && gitOk ? beginTrace(root) : null;
  const statusResult = args.execute === true && gitOk
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
  const controlCommit = args.execute === true && gitOk && statusResult && statusResult.ok !== false
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
    ok: args.execute === true ? gitOk && (!statusResult || statusResult.ok !== false) && (!controlCommit || controlCommit.ok !== false) : true,
    phase_state: args.execute !== true ? "dry_run" : (gitOk && (!controlCommit || controlCommit.ok !== false) ? "executed" : "recovery_required"),
    dry_run: args.execute !== true,
    track_context: trackContext(root, trackId),
    git_actions: gitActions,
    git_results: gitResults,
    metadata_patch: statusResult,
    control_commit: controlCommit,
    human_review: humanReview,
    review_artifacts: reviewArtifacts,
  };
}

export function workflowRefresh(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(args, "refresh");
  const summary = workflowSummary(root, "refresh", args);
  const intentPrompts = refreshIntentPrompts(args);
  if (intentPrompts.length > 0) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_clarification",
      stage: "intent_clarification",
      intent_prompts: intentPrompts,
      next_actions: [
        "Answer refresh-scope before running refresh.",
        "Call refresh again with refreshScope set to patterns, lsp, docs, diagnostics, or all.",
      ],
      error: "Refresh scope is unclear; Cadre will not generate refresh artifacts until the requested scope is selected.",
    };
  }
  const scopeIds = refreshScopeIds(args);
  const refreshPatterns = scopeIds.some((scope) => ["all", "patterns", "docs", "projections"].includes(scope));
  const lspScopeRequested = scopeIds.some((scope) => ["all", "lsp"].includes(scope));
  const lspWriteRequested = lspScopeRequested && setupLspWriteRequested(args);
  const mutatingRefresh = refreshPatterns || lspWriteRequested;
  const reviewFiles = refreshPatterns ? refreshReviewFiles(root) : [];
  const reviewArtifacts = reviewArtifactsFromFiles(reviewFiles);
  if (lspWriteRequested) reviewArtifacts.push(...setupLspReviewArtifacts(args));
  const reviewBundle = workflowReviewBundle(root, "refresh", args, reviewFiles);
  const approval = stagedApprovalState(root, "refresh", args, refreshApprovalStages(refreshPatterns, lspWriteRequested), reviewFiles);
  const stageReviewBundle = asJsonObject(approval).current_review_bundle || reviewBundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts || reviewArtifacts;
  const humanReview = reviewArtifacts.length > 0 ? humanReviewState("refresh", args, reviewArtifacts, reviewBundle) : null;
  const approvalError = stagedApprovalError(approval);
  const warnings = [
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...(approvalError ? [approvalError] : []),
  ];
  const awaitingDocumentReview = args.execute === true && reviewArtifacts.length > 0 && !stagedApprovalReady(approval);
  const lspRequested = args.execute === true && !awaitingDocumentReview && lspWriteRequested;
  const traceBefore = args.execute === true && !awaitingDocumentReview && mutatingRefresh ? beginTrace(root) : null;
  const lsp = lspRequested ? lspSetup(root, { ...args, execute: true }) : lspSetup(root, { ...args, execute: false });
  if (awaitingDocumentReview) {
    return {
      ...summary,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      doctor: doctor(root, { hasCadreProject: true }),
      workspace: workspaceDiagnostics(root, { execute: false }),
      dependency_graph: dependencyGraph(root),
      lsp: lspConfigStatus(root),
      lsp_setup: lsp,
      scope: scopeIds,
      approval,
      human_review: humanReview,
      review_artifacts: stageReviewArtifacts,
      review_bundle: stageReviewBundle,
      warnings,
      error: approvalError || "Staged approval is required before refreshing Cadre context documents",
    };
  }
  const regen = args.execute === true && mutatingRefresh ? regenIndex(root) : null;
  let patterns: CoreResult | null = null;
  if (args.execute === true && refreshPatterns) {
    const refreshed = refreshedPatternsArtifacts(root);
    if (refreshed) {
      fs.writeFileSync(refreshed.jsonlPath, refreshed.jsonl);
      fs.writeFileSync(refreshed.projectionPath, refreshed.projection);
      patterns = {
        ok: true,
        path: path.relative(root, refreshed.jsonlPath),
        projection: path.relative(root, refreshed.projectionPath),
        refreshed_at: refreshed.stamp,
      };
    }
  }
  const controlCommit = args.execute === true && mutatingRefresh
    ? commitTrace(root, args, {
      kind: "control",
      workflow: "refresh",
      subject: "refresh project context",
      before: traceBefore,
      note: {
        patterns: patterns ? asJsonObject(patterns) : null,
        lsp_setup: asJsonObject(lsp),
      },
    })
    : null;
  return {
    ...summary,
    ok: (!approvalError || args.execute === true) && (!regen || regen.ok !== false) && lsp.ok !== false && (!controlCommit || controlCommit.ok !== false),
    phase_state: args.execute === true ? (controlCommit && controlCommit.ok === false ? "recovery_required" : "executed") : "dry_run",
    ...(approvalError && args.execute !== true ? { stage: "staged_approval", error: approvalError } : {}),
    scope: scopeIds,
    doctor: doctor(root, { hasCadreProject: true }),
    workspace: workspaceDiagnostics(root, { execute: false }),
    dependency_graph: dependencyGraph(root),
    lsp: lspConfigStatus(root),
    lsp_setup: lsp,
    regen,
    patterns,
    control_commit: controlCommit,
    approval,
    human_review: humanReview,
    review_artifacts: stageReviewArtifacts,
    review_bundle: stageReviewBundle,
    warnings,
  };
}
