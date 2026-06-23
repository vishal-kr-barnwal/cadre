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

import { CoreResult, PlannedGitAction, PlannedProviderAction, WorkflowPhaseState } from "./contracts";
import { appendJsonl, safeName, utcNow } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { polyrepoPreflight } from "./project-maintenance";
import { prCiStatus, providerEvidenceRequirement, providerFromConfig } from "./quality-gates";
import { repoEntriesForTrack } from "./repo-resolution";
import { providerEvidence } from "./review-records";
import { asArray, fleetStatus, selectedTrackId } from "./status";
import { actionResultsOk, continuationToken, hasProviderEvidence, plannedGitAction, runPlannedGitActions, workflowPhaseState } from "../../infrastructure/runtime/system";
import { beginTrace, commitTrace, notesPushAction, notesPushEnabled } from "./commit-trace";
import { findTrack } from "./track-context";
import { reviewGate } from "./track-mutations";
import { workflowSummary } from "./workflow-response";

export function providerActionKind(workflow: string, provider: string): string {
  if (provider === "gitlab") return workflow === "land" ? "open_merge_request_group" : "open_merge_request";
  return workflow === "land" ? "open_pull_request_group" : "open_pull_request";
}

export function providerActionsForTrack(root: string, workflow: "ship" | "land", track: CadreTrack, args: RuntimeArgs = {}): PlannedProviderAction[] {
  const provider = providerFromConfig(root, args);
  if (provider === "local") return [];
  const entries = workflow === "land"
    ? repoEntriesForTrack(root, track, args)
    : repoEntriesForTrack(root, track, { ...args, repo: args.repo || "." }).filter((entry) => entry.repo === "." || !loadTopology(root).polyrepo);
  const label = `cadre-track:${track.track_id}`;
  return entries.map((entry) => {
    const repo = asString(entry.repo, ".");
    const target = entry.head || track.metadata.git_branch || `track/${track.track_id}`;
    return {
      id: `${workflow}-${safeName(repo)}`,
      provider,
      kind: providerActionKind(workflow, provider),
      repo,
      track_id: track.track_id,
      title: `${track.track_id}: ${track.metadata.description || track.metadata.name || track.track_id}`,
      source_branch: target,
      target_branch: entry.base || args.base || "main",
      body: [
        `Cadre track: ${track.track_id}`,
        `Repo: ${repo}`,
        "Provider evidence must be fetched through the installed provider MCP and written back to Cadre.",
      ].join("\n"),
      labels: [label],
      evidence_key: `${provider}:${workflow}:${track.track_id}:${repo}`,
      required_evidence: asJsonObject(providerEvidenceRequirement(root, { ...args, trackId: track.track_id })),
    };
  });
}

export function shipGitActions(root: string, track: CadreTrack, args: RuntimeArgs = {}): PlannedGitAction[] {
  const remote = args.remote || "origin";
  const base = args.base || "main";
  const branch = args.branch || track.metadata.git_branch || `track/${track.track_id}`;
  return [
    plannedGitAction("ship-fetch", "fetch_base", ".", root, ["fetch", String(remote), String(base)], `Fetch ${remote}/${base}`),
    plannedGitAction("ship-rebase", "rebase_base", ".", root, ["rebase", `${remote}/${base}`], `Rebase ${branch} onto ${remote}/${base}`),
    plannedGitAction("ship-push", "push_branch", ".", root, ["push", "-u", String(remote), String(branch)], `Push ${branch}`),
  ];
}

export function landGitActions(root: string, track: CadreTrack, args: RuntimeArgs = {}): PlannedGitAction[] {
  const remote = args.remote || "origin";
  const actions: PlannedGitAction[] = [];
  for (const entry of repoEntriesForTrack(root, track, args)) {
    const repo = asString(entry.repo, ".");
    const branch = asString(entry.head || track.metadata.git_branch || `track/${track.track_id}`);
    actions.push(plannedGitAction(
      `land-push-${safeName(repo)}`,
      "push_repo_branch",
      repo,
      asString(entry.root, root),
      ["push", "-u", String(remote), branch],
      `Push ${repo} branch ${branch}`
    ));
  }
  actions.push(plannedGitAction(
    "land-push-control",
    "push_control_branch",
    ".",
    root,
    ["push", String(remote), args.branch || "HEAD"],
    "Push control-plane branch"
  ));
  return actions;
}

function publicationLedger(root: string, workflow: "ship" | "land", track: CadreTrack, args: RuntimeArgs, data: JsonObject): CoreResult {
  const before = beginTrace(root);
  const entry: JsonObject = {
    version: 1,
    schema: "cadre.publication.v1",
    workflow,
    track_id: track.track_id,
    recorded_at: utcNow(),
    continuation_token: asOptionalString(data.continuation_token) || null,
    ...data,
  };
  const file = path.join(root, "cadre", "operations", "publication.jsonl");
  appendJsonl(file, entry);
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow,
    subject: `publish ${track.track_id}`,
    before,
    files: [
      path.relative(root, file),
    ],
    trackId: track.track_id,
    note: entry,
  });
  return { ok: controlCommit.ok !== false, path: path.relative(root, file), entry, control_commit: controlCommit };
}

function runPublicationGit(root: string, workflow: "ship" | "land", track: CadreTrack, args: RuntimeArgs, gitActions: PlannedGitAction[], providerActions: PlannedProviderAction[]): CoreResult {
  const remote = asOptionalString(args.remote) || "origin";
  const pushKinds = new Set(["push_branch", "push_control_branch"]);
  const beforePush = gitActions.filter((action) => !pushKinds.has(action.kind));
  const pushActions = gitActions.filter((action) => pushKinds.has(action.kind));
  const beforePushResults = runPlannedGitActions(beforePush);
  if (!actionResultsOk(beforePushResults)) {
    return { ok: false, stage: "git_before_push", git_results: beforePushResults };
  }
  const token = continuationToken(workflow, track.track_id, [...providerActions, ...gitActions]);
  const publication = publicationLedger(root, workflow, track, args, {
    git_actions: gitActions,
    provider_actions: providerActions,
    continuation_token: token,
  });
  if (publication.ok === false) {
    return { ok: false, stage: "publication_ledger", git_results: beforePushResults, publication };
  }
  const noteActions = notesPushEnabled(root)
    ? Array.from(new Map([
      ...pushActions,
      ...repoEntriesForTrack(root, track, args).map((entry) => notesPushAction(root, asString(entry.repo, "."), asString(entry.root, root), remote)),
    ].map((action) => [`${action.cwd}:${action.kind}:${action.repo}`, action])).values())
    : pushActions;
  const pushResults = runPlannedGitActions(noteActions);
  return {
    ok: actionResultsOk(pushResults),
    git_results: [...beforePushResults, ...pushResults],
    publication,
    push_actions: noteActions,
  };
}

export function persistProviderEvidenceIfSupplied(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult | null {
  const evidence = args.evidence || args.providerEvidence || args.provider_evidence;
  if (!evidence || args.execute !== true) return null;
  return providerEvidence(root, {
    ...args,
    trackId: track.track_id,
    evidence,
  });
}

export function workflowShip(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "ship", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, error: `Track not found: ${trackId}` };
  const gate = reviewGate(root, trackId, args);
  const provider = args.includeProvider === false ? null : prCiStatus(root, { ...args, trackId });
  const providerActions = providerActionsForTrack(root, "ship", track, args);
  const gitActions = shipGitActions(root, track, args);
  const evidenceSupplied = hasProviderEvidence(args);
  const pendingProvider = Boolean(provider && provider.ok === false && providerActions.length > 0 && !evidenceSupplied);
  const blocked = gate.ok === false;
  const evidenceWrite = persistProviderEvidenceIfSupplied(root, track, args);
  const canExecuteGit = args.execute === true && !blocked && !evidenceSupplied && (!evidenceWrite || evidenceWrite.ok !== false);
  const execution = canExecuteGit ? runPublicationGit(root, "ship", track, args, gitActions, providerActions) : null;
  const gitResults = asArray(asJsonObject(execution).git_results);
  const publication = args.execute === true && evidenceWrite && evidenceWrite.ok !== false
    ? publicationLedger(root, "ship", track, args, { provider_evidence_write: asJsonObject(evidenceWrite), provider_actions: providerActions })
    : asJsonObject(execution).publication || null;
  const executionFailed = canExecuteGit && (!execution || execution.ok === false);
  const phaseState: WorkflowPhaseState = executionFailed
    ? "recovery_required"
    : workflowPhaseState(args, blocked || Boolean(evidenceWrite && evidenceWrite.ok === false), pendingProvider);
  return {
    ...summary,
    ok: gate.ok !== false && (!evidenceWrite || evidenceWrite.ok !== false) && (!publication || asJsonObject(publication).ok !== false) && !executionFailed,
    phase_state: phaseState,
    gate,
    provider,
    pr_ci_status: provider,
    provider_actions: providerActions,
    git_actions: gitActions,
    git_results: gitResults,
    publication,
    git_action_state: canExecuteGit ? "executed" : (evidenceSupplied ? "skipped_provider_evidence_continuation" : "pending_execute"),
    provider_evidence_write: evidenceWrite,
    continuation_token: continuationToken("ship", trackId, [...providerActions, ...gitActions]),
    required_provider_mcp: provider && provider.ok === false ? provider.required_provider_mcp || null : null,
    required_evidence: provider && provider.ok === false ? provider.required_evidence || null : null,
    unsupported_reason: provider && provider.ok === false ? provider.unsupported_reason || provider.reason || null : null,
    next_actions: provider && Array.isArray(provider.next_actions) ? provider.next_actions : [],
  };
}

export function workflowLand(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "land", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, error: `Track not found: ${trackId}` };
  const topology = loadTopology(root);
  const preflight = polyrepoPreflight(root);
  const gate = reviewGate(root, trackId, args);
  const provider = args.includeProvider === false ? null : prCiStatus(root, { ...args, trackId });
  const providerActions = topology.polyrepo && preflight.ok !== false ? providerActionsForTrack(root, "land", track, args) : [];
  const gitActions = topology.polyrepo && preflight.ok !== false ? landGitActions(root, track, args) : [];
  const evidenceSupplied = hasProviderEvidence(args);
  const pendingProvider = Boolean(provider && provider.ok === false && providerActions.length > 0 && !evidenceSupplied);
  const blocked = !topology.polyrepo || preflight.ok === false || gate.ok === false;
  const evidenceWrite = persistProviderEvidenceIfSupplied(root, track, args);
  const canExecuteGit = args.execute === true && !blocked && !evidenceSupplied && (!evidenceWrite || evidenceWrite.ok !== false);
  const execution = canExecuteGit ? runPublicationGit(root, "land", track, args, gitActions, providerActions) : null;
  const gitResults = asArray(asJsonObject(execution).git_results);
  const publication = args.execute === true && evidenceWrite && evidenceWrite.ok !== false
    ? publicationLedger(root, "land", track, args, { provider_evidence_write: asJsonObject(evidenceWrite), provider_actions: providerActions })
    : asJsonObject(execution).publication || null;
  const executionFailed = canExecuteGit && (!execution || execution.ok === false);
  const phaseState: WorkflowPhaseState = executionFailed
    ? "recovery_required"
    : workflowPhaseState(args, blocked || Boolean(evidenceWrite && evidenceWrite.ok === false), pendingProvider);
  return {
    ...summary,
    ok: topology.polyrepo && preflight.ok !== false && gate.ok !== false && (!evidenceWrite || evidenceWrite.ok !== false) && (!publication || asJsonObject(publication).ok !== false) && !executionFailed,
    phase_state: phaseState,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    preflight,
    gate,
    provider,
    provider_actions: providerActions,
    git_actions: gitActions,
    git_results: gitResults,
    publication,
    git_action_state: canExecuteGit ? "executed" : (evidenceSupplied ? "skipped_provider_evidence_continuation" : "pending_execute"),
    provider_evidence_write: evidenceWrite,
    continuation_token: continuationToken("land", trackId, [...providerActions, ...gitActions]),
    required_provider_mcp: provider && provider.ok === false ? provider.required_provider_mcp || null : null,
    required_evidence: provider && provider.ok === false ? provider.required_evidence || null : null,
    unsupported_reason: provider && provider.ok === false ? provider.unsupported_reason || provider.reason || null : null,
    next_actions: provider && Array.isArray(provider.next_actions) ? provider.next_actions : [],
    fleet: fleetStatus(root, { includeCollisions: false }),
  };
}
