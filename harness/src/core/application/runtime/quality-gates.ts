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

import { CoreResult, DiffSurface, RepoExecutionEntry, TodoFinding, WorkingRootResolution } from "./contracts";
import { runCoverage } from "../../infrastructure/runtime/coverage";
import { fileExists, patchJsonFile, utcNow } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { configuredProvider, loadPackageJson, loadTopology } from "../../infrastructure/runtime/project-config";
import { lspReview } from "./project-maintenance";
import { isIgnoredRepoMapFile } from "./repo-map";
import { isWorkingRootError, repoEntriesError, repoEntriesForTrack, resolveTaskWorkingRoot } from "./repo-resolution";
import { providerEvidence } from "./review-records";
import { asArray } from "./status";
import { runCommand } from "../../infrastructure/runtime/system";
import { findTrack, trackContext } from "./track-context";
import { recordTaskResult } from "./track-mutations";
import { parsePlanFile } from "./track-schedule";

export function testCoverage(root: string, args: RuntimeArgs = {}): CoreResult {
  let track: CadreTrack | null = null;
  let task: PlanTask | null = null;
  let workingRoot: WorkingRootResolution = {
    repo: args.repo || ".",
    path: args.workingRoot ? path.resolve(root, args.workingRoot) : root,
    source: args.workingRoot ? "argument.workingRoot" : "project-root",
  };
  if (args.trackId) {
    track = findTrack(root, args.trackId);
    if (!track) {
      return { ok: false, available: false, error: `Track not found: ${args.trackId}` };
    }
    if (args.phaseIndex != null && args.taskIndex != null) {
      const plan = parsePlanFile(track.plan_path);
      const phase = (plan.phases || []).find((item) => item.phase_index === Number(args.phaseIndex));
      task = phase?.tasks.find((item) => item.task_index === Number(args.taskIndex)) || null;
    }
    workingRoot = resolveTaskWorkingRoot(root, track, task, args);
    if (isWorkingRootError(workingRoot)) {
      return {
        ok: false,
        available: false,
        stage: "polyrepo_repo_resolution",
        working_root: workingRoot,
        reason: workingRoot.error,
      };
    }
  }
  const coverageRun = runCoverage(root, args, workingRoot.path);
  if (!coverageRun.available) return coverageRun;
  const { command, coverage } = coverageRun;
  let task_result: CoreResult | null = null;
  let metadata: CoreResult | null = null;
  if (track) {
    const writeCoverage = () => {
      metadata = patchJsonFile(track.metadata_path, (current) => {
        current.last_test_run = {
          command,
          cwd: coverageRun.cwd || workingRoot.path,
          ok: coverageRun.ok,
          status: coverageRun.status,
          signal: coverageRun.signal,
          coverage,
          measured_at: utcNow(),
        };
        if (typeof coverage === "number") current.last_coverage = coverage;
        return current;
      }, { lock: false });
      return metadata;
    };
    const metadataWrite = withTrackLock(root, track.track_id, writeCoverage);
    if (!metadataWrite.ok) return { ok: false, available: true, command, coverage, working_root: workingRoot, stage: "metadata_lock", metadata: metadataWrite };
    const metadataResult = metadata ?? metadataWrite;
    if (!metadataResult.ok) {
      return { ok: false, available: true, command, coverage, working_root: workingRoot, stage: "metadata_patch", metadata: metadataResult };
    }
    if (args.phaseIndex != null && args.taskIndex != null) {
      task_result = recordTaskResult(root, {
        trackId: args.trackId,
        phaseIndex: args.phaseIndex,
        taskIndex: args.taskIndex,
        status: args.status || (coverageRun.ok ? "completed" : "blocked"),
        commitSha: args.commitSha,
        coverage,
        repo: workingRoot.repo,
        workingRoot: path.relative(root, workingRoot.path) || ".",
      });
    }
  }
  return {
    ok: coverageRun.ok,
    available: true,
    command,
    cwd: coverageRun.cwd,
    status: coverageRun.status,
    signal: coverageRun.signal,
    coverage,
    coverage_source: coverageRun.coverage_source,
    timed_out: coverageRun.signal === "SIGTERM" || coverageRun.signal === "SIGKILL",
    stdout_tail: coverageRun.stdout_tail,
    stderr_tail: coverageRun.stderr_tail,
    working_root: workingRoot,
    metadata,
    task_result,
  };
}

export function configuredMachineGateCommand(root: string, args: RuntimeArgs = {}, workingRoot = root): string | null {
  const explicit = args.machineCommand || args.machine_command || args.command;
  if (explicit) return String(explicit);
  const config = loadTopology(root).config || {};
  for (const key of [
    "review_machine_gate_command",
    "machine_gate_command",
    "review_check_command",
    "typecheck_command",
    "build_command",
    "check_command",
  ]) {
    if (typeof config[key] === "string" && config[key].trim()) return config[key].trim();
  }
  const pkg = loadPackageJson(workingRoot);
  const scripts = pkg ? asJsonObject(pkg.scripts) : {};
  if (Object.keys(scripts).length > 0) {
    for (const name of ["typecheck", "check", "build", "lint"]) {
      if (scripts[name]) {
        if (fileExists(path.join(workingRoot, "pnpm-lock.yaml"))) return `pnpm ${name}`;
        if (fileExists(path.join(workingRoot, "yarn.lock"))) return `yarn ${name}`;
        return `npm run ${name}`;
      }
    }
  }
  return null;
}

export function runMachineGate(root: string, args: RuntimeArgs = {}, workingRoot = root): CoreResult {
  const command = configuredMachineGateCommand(root, args, workingRoot);
  if (!command) {
    return {
      ok: true,
      available: false,
      reason: "No review machine-gate command configured or discovered",
      hints: [
        "Pass { machineCommand } explicitly",
        "Set cadre/config.json review_machine_gate_command",
        "Add a package script named typecheck, check, build, or lint",
      ],
    };
  }
  const timeoutMs = Number(args.timeoutMs || 10 * 60 * 1000);
  const result = runCommand(command, [], {
    cwd: workingRoot,
    shell: true,
    timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });
  return {
    ok: result.ok,
    available: true,
    command,
    cwd: workingRoot,
    status: result.status,
    signal: result.signal,
    timed_out: result.signal === "SIGTERM" || result.signal === "SIGKILL",
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
  };
}

export function reviewMachineGate(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = args.trackId || args.track_id || null;
  const track = trackId ? findTrack(root, trackId) : null;
  if (trackId && !track) return { ok: false, error: `Track not found: ${trackId}` };
  if (track) {
    const repoError = repoEntriesError(root, track, args);
    if (repoError) return repoError;
  }
  const entries: RepoExecutionEntry[] = track
    ? repoEntriesForTrack(root, track, args)
    : [{
      repo: args.repo || ".",
      root: args.workingRoot ? path.resolve(root, args.workingRoot) : root,
      path: args.workingRoot || ".",
      source: args.workingRoot ? "argument.workingRoot" : "project-root",
    }];
  const results: CoreResult[] = entries.map((entry) => {
    const gate = runMachineGate(root, args, entry.root);
    return {
      repo: entry.repo,
      path: entry.path,
      source: entry.source,
      ...gate,
    };
  });
  const blocking = results.filter((result) => result.available === true && !result.ok);
  return {
    ok: blocking.length === 0,
    available: results.some((result) => result.available === true),
    track_id: trackId,
    results,
    blocking_count: blocking.length,
  };
}

export function providerFromConfig(root: string, args: RuntimeArgs = {}): string {
  return asOptionalString(configuredProvider(root, args).provider_mode) || "local";
}

export function providerEvidenceRequirement(root: string, args: RuntimeArgs = {}): CoreResult {
  const providerInfo = configuredProvider(root, args);
  const provider = asOptionalString(providerInfo.provider_mode) || "local";
  const track = args.trackId ? findTrack(root, args.trackId) : null;
  const branch = args.branch || (track && (track.metadata.git_branch || `track/${track.track_id}`)) || null;
  const target = args.pr || args.prNumber || args.mr || branch || null;
  const kind = provider === "gitlab" ? "gitlab_merge_request_status" : "github_pull_request_status";
  const minimumFields = provider === "gitlab"
    ? ["url", "state", "source_branch", "target_branch", "head_sha", "approvals", "pipeline_status", "discussions"]
    : ["url", "state", "head_ref", "base_ref", "head_sha", "review_decision", "status_checks", "workflow_runs", "comments"];
  return {
    ok: false,
    available: false,
    provider,
    target,
    branch,
    provider_mode: provider,
    required_provider_mcp: provider === "local" ? null : {
      provider,
      server: provider,
      purpose: "Fetch provider evidence through the installed provider MCP. CLI fallback is intentionally disabled.",
    },
    required_evidence: provider === "local" ? null : {
      kind,
      provider,
      target,
      branch,
      minimum_fields: minimumFields,
      write_back: {
        tool: "cadre_review",
        action: "provider_evidence",
        trackId: args.trackId || args.track_id || null,
      },
    },
    next_actions: provider === "local"
      ? []
      : [
        `Use the installed ${provider} MCP to fetch PR/MR metadata, reviews, checks or pipeline status, and discussion evidence for the target.`,
        "Call cadre_review with action provider_evidence and the fetched evidence before recording review or shipping.",
      ],
    reason: provider === "local"
      ? "provider_mode is local; provider evidence is not required"
      : `${provider} provider evidence must come from the ${provider} MCP; CLI fallback is disabled`,
    unsupported_reason: provider === "local"
      ? null
      : `provider_mode ${provider} requires ${provider} MCP evidence; Cadre workflow packets do not use provider CLI fallback`,
  };
}

export function prCiStatus(root: string, args: RuntimeArgs = {}): CoreResult {
  const provider = providerFromConfig(root, args);
  const evidence = args.evidence || args.providerEvidence || args.provider_evidence || null;
  if (provider === "local") {
    return {
      ok: true,
      available: false,
      skipped: true,
      provider,
      provider_mode: "local",
      reason: "provider_mode is local; no provider MCP evidence required",
    };
  }
  if (provider !== "github" && provider !== "gitlab") {
    return { ok: false, available: false, provider, reason: `Unsupported provider_mode: ${provider}` };
  }
  if (evidence) {
    return {
      ok: true,
      available: true,
      provider,
      provider_mode: provider,
      evidence_source: `${provider}_mcp`,
      evidence: asJsonObject(evidence),
    };
  }
  return providerEvidenceRequirement(root, args);
}

export function diffSurface(root: string, base: string, head: string): DiffSurface {
  const range = `${base}...${head}`;
  const stat = runCommand("git", ["diff", "--stat", range], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const names = runCommand("git", ["diff", "--name-only", range], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return {
    ok: stat.ok || names.ok,
    base,
    head,
    stat: stat.stdout.trim(),
    files: names.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    errors: [stat.stderr, names.stderr].filter(Boolean).join("\n").trim(),
  };
}

export function scanReviewTodos(root: string, files: string[], limit = 100): TodoFinding[] {
  const findings: TodoFinding[] = [];
  const patterns = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /\bstub\b/i,
    /throw new Error\(["']not implemented/i,
  ];
  for (const file of files || []) {
    if (isIgnoredRepoMapFile(file)) continue;
    const abs = path.join(root, file);
    if (!fileExists(abs)) continue;
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > 1024 * 1024) continue;
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length && findings.length < limit; index += 1) {
      const line = lines[index] || "";
      if (patterns.some((pattern) => pattern.test(line))) {
        findings.push({ file, line: index + 1, snippet: line.trim().slice(0, 180) });
      }
    }
  }
  return findings;
}

export function reviewAssist(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = args.trackId || args.track_id;
  if (!trackId) return { ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  if (!context.ok) return context;
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
  const plan = parsePlanFile(track.plan_path);
  const base = args.base || "main";
  const head = args.head || track.metadata.git_branch || "HEAD";
  const repoEntries = repoEntriesForTrack(root, track, args);
  const repoDiffs = repoEntries.map((entry) => ({
    repo: entry.repo,
    path: entry.path,
    cwd: entry.root,
    source: entry.source,
    ...diffSurface(entry.root, entry.base || base, entry.head || head),
  }));
  const diff = repoDiffs.find((entry) => entry.repo === ".") || diffSurface(root, base, head);
  const incompleteTasks: JsonObject[] = [];
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      if (task.marker !== "x" && task.marker !== "-") {
        incompleteTasks.push({
          phase: phase.phase_index,
          task: task.task_index,
          task_key: task.task_key,
          title: task.title,
          marker: task.marker,
          repo: task.repo || null,
        });
      }
    }
  }
  const todoLimit = Number(args.todoLimit || 100);
  const repoTodos = repoDiffs.map((entry) => ({
    repo: entry.repo,
    path: entry.path,
    cwd: entry.cwd,
    todos: scanReviewTodos(entry.cwd || root, entry.files, todoLimit),
  }));
  const todos = repoTodos.flatMap((entry) => entry.todos.map((todo) => ({ ...todo, repo: entry.repo }))).slice(0, todoLimit);
  const lsp = args.includeLsp === false
    ? null
    : (args.lspResult || args.lsp_result || lspReview(root, { base, head, config: args.config }));
  const machineGate = args.includeMachine === false ? null : reviewMachineGate(root, args);
  const lspObject = asJsonObject(lsp);
  const machineGateObject = asJsonObject(machineGate);
  const blocking: string[] = [];
  if (incompleteTasks.length > 0) blocking.push(`${incompleteTasks.length} plan task(s) are not completed or skipped`);
  if (todos.length > 0) blocking.push(`${todos.length} TODO/FIXME/stub marker(s) found in changed files`);
  if (track.metadata.last_coverage == null) blocking.push("No measured coverage recorded on the track");
  if (lsp && lspObject.available !== false && Array.isArray(lspObject.findings)) {
    const lspBlocking = asArray(lspObject.findings).filter((finding) => finding.severity === "blocking" || finding.blocking === true);
    if (lspBlocking.length > 0) blocking.push(`${lspBlocking.length} blocking LSP/code-intelligence finding(s)`);
  }
  const machineBlockingCount = asNumber(machineGateObject.blocking_count);
  if (machineGate && machineBlockingCount > 0) {
    blocking.push(`${machineBlockingCount} machine gate check(s) failed`);
  }

  return {
    ok: true,
    root,
    track_id: trackId,
    base,
    head,
    diff,
    repo_diffs: repoDiffs,
    task_counts: context.task_counts,
    incomplete_tasks: incompleteTasks,
    coverage: track.metadata.last_coverage ?? null,
    todos,
    repo_todos: repoTodos,
    lsp,
    machine_gate: machineGate,
    suggested_verdict: blocking.length === 0 ? "approved" : "changes_requested",
    blocking_reasons: blocking,
  };
}
