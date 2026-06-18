#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import * as core from "../cadre-core";
import type { JsonObject, RuntimeArgs, TextJsonResult } from "../types";
import { asJsonObject, asOptionalString, errorMessage } from "../guards";
import { asTextJson, beadsOperationMutates, envelope, syncedEnvelope } from "./envelope";
import { JobManager } from "./job-manager";
import { LspDaemonClient } from "./lsp-daemon-client";
import type { McpMessage, RuntimeEnvelope } from "./protocol-types";
import { resourceList, resourceRead, resourceTemplatesList } from "./resources";
import { requireCadreRoot, rootFromCandidate } from "./root-resolution";
import { PROTOCOL_VERSION, SERVER_INSTRUCTIONS, TOOLS } from "./tool-catalog";

const lspDaemon = new LspDaemonClient();
const jobs = new JobManager();

function selectedRepos(args: RuntimeArgs): Set<string> | null {
  const values = [
    asOptionalString(args.repo),
    ...(Array.isArray(args.repos) ? args.repos.filter((item): item is string => typeof item === "string") : []),
  ].filter((item): item is string => Boolean(item));
  return values.length > 0 ? new Set(values) : null;
}

function repoReviewTargets(root: string, args: RuntimeArgs): JsonObject[] {
  const trackId = asOptionalString(args.trackId) || asOptionalString(args.track_id);
  const selected = selectedRepos(args);
  if (!trackId) return [{ repo: ".", path: ".", cwd: root, base: args.base || "main", head: args.head || "HEAD", source: "project-root" }];
  const context = asJsonObject(core.trackContext(root, trackId));
  const topology = asJsonObject(context.topology);
  if (topology.polyrepo !== true) {
    return [{ repo: ".", path: ".", cwd: root, base: args.base || "main", head: args.head || "HEAD", source: "project-root" }];
  }
  const track = asJsonObject(context.track);
  const fromContext = Array.isArray(context.worktrees)
    ? context.worktrees.map((entry) => asJsonObject(entry))
    : [];
  const topologyInfo = asJsonObject(core.loadTopology(root));
  const topologyRepos = asJsonObject(topologyInfo.repos);
  const fromTopology = Array.isArray(topologyRepos.repos)
    ? topologyRepos.repos.map((entry) => asJsonObject(entry))
    : [];
  const rawTargets = fromContext.length > 0 ? fromContext : fromTopology;
  const seen = new Set<string>();
  return rawTargets
    .map((entry): JsonObject | null => {
      const repo = asOptionalString(entry.repo) || asOptionalString(entry.name) || ".";
      if (selected && !selected.has(repo)) return null;
      const rel = asOptionalString(entry.path)
        || asOptionalString(entry.worktree_path)
        || asOptionalString(entry.submodule_path)
        || ".";
      const key = `${repo}:${rel}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        repo,
        path: rel,
        cwd: path.isAbsolute(rel) ? rel : path.resolve(root, rel),
        base: args.base || asOptionalString(entry.base_branch) || asOptionalString(entry.default_branch) || "main",
        head: args.head || asOptionalString(entry.git_branch) || asOptionalString(track.git_branch) || `track/${trackId}`,
        source: asOptionalString(entry.source) || (entry.worktree_path ? "metadata.repos.worktree_path" : "repos.json"),
      };
    })
    .filter((entry): entry is JsonObject => entry !== null);
}

function annotateRepoFindings(result: JsonObject, target: JsonObject): JsonObject[] {
  const findings = Array.isArray(result.findings)
    ? result.findings.map((finding) => asJsonObject(finding))
    : [];
  const repoPath = asOptionalString(target.path) || ".";
  const cwd = asOptionalString(target.cwd) || "";
  return findings.map((finding) => ({
    ...finding,
    repo: target.repo,
    path: asOptionalString(finding.path) || asOptionalString(finding.file) || repoPath,
    cwd,
    repo_path: repoPath,
  }));
}

async function warmLspReview(root: string, args: RuntimeArgs): Promise<JsonObject> {
  const targets = repoReviewTargets(root, args);
  const timeoutMs = Number(args.timeoutMs || 120000);
  const rawConfig = asOptionalString(args.config) || path.join(root, "cadre", "lsp.json");
  const config = path.isAbsolute(rawConfig) ? rawConfig : path.resolve(root, rawConfig);
  if (targets.length <= 1 && targets[0]?.repo === ".") {
    return asJsonObject(await lspDaemon.request(
      "review",
      { ...args, root, base: args.base || "main", head: args.head || "HEAD", config },
      timeoutMs
    ).catch((error) => ({ available: false, reason: errorMessage(error), findings: [] })));
  }
  const repos = await Promise.all(targets.map(async (target) => {
    const cwd = asOptionalString(target.cwd) || root;
    const repo = asOptionalString(target.repo) || ".";
    if (!fs.existsSync(cwd)) {
      const result = {
        available: false,
        reason: `Repo working root is missing: ${cwd}`,
        findings: [],
      };
      return { ...target, result, findings: [] };
    }
    const result = asJsonObject(await lspDaemon.request(
      "review",
      {
        ...args,
        root: cwd,
        base: asOptionalString(target.base) || args.base || "main",
        head: asOptionalString(target.head) || args.head || "HEAD",
        config,
      },
      timeoutMs
    ).catch((error) => ({ available: false, reason: errorMessage(error), findings: [] })));
    const findings = annotateRepoFindings(result, target);
    return {
      ...target,
      repo,
      result: { ...result, findings },
      findings,
    };
  }));
  const findings = repos.flatMap((entry) => Array.isArray(entry.findings) ? entry.findings : []);
  return {
    available: repos.some((entry) => asJsonObject(entry.result).available !== false),
    polyrepo: true,
    config,
    repos,
    findings,
  };
}

function jobTypeForPacket(name: string, args: RuntimeArgs): string | null {
  if (name === "cadre_complete_task") return "complete_task";
  if (name === "cadre_review" && args.action === "assist") return "review_assist";
  if (name === "cadre_review" && args.action === "machine_gate") return "machine_gate";
  if (name === "cadre_intel" && args.action === "lsp_review") return "lsp_review";
  if (name === "cadre_intel" && args.action === "lsp_impact") return "lsp_impact";
  return args.type || null;
}

function jobEnvelope(type: string | null, root: string, args: RuntimeArgs): RuntimeEnvelope {
  if (!type) return envelope({ ok: false, error: "job type is required" });
  return envelope({ ok: true, job: jobs.start(type, root, args) });
}

async function workflowPacket(args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const workflow = asOptionalString(args.workflow) || asOptionalString(args.action) || "status";
  const setupWorkflows = new Set(["setup", "setup_assist", "setup_scaffold"]);
  if (setupWorkflows.has(workflow)) {
    const info = rootFromCandidate(args.root || process.cwd());
    return envelope(core.workflowPacket(info ? info.root : process.cwd(), { ...args, workflow }));
  }
  const root = requireCadreRoot(args);
  if ((workflow === "review" || workflow === "revise") && args.includeLsp !== false) {
    const lspResult = await warmLspReview(root, args);
    return envelope(core.workflowPacket(root, { ...args, workflow, lspResult }));
  }
  return envelope(core.workflowPacket(root, { ...args, workflow }));
}

async function projectPacket(args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const action = args.action || "ping";
  if (action === "ping") {
    return envelope({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      server: "cadre",
      rootContract: "project-scoped tools require { root } per call",
    });
  }
  if (action === "doctor") {
    const info = rootFromCandidate(args.root || process.cwd());
    return envelope(core.doctor(info ? info.root : process.cwd(), { hasCadreProject: Boolean(info && info.has_cadre) }));
  }
  if (action === "root") {
    const root = requireCadreRoot(args);
    return envelope({ ok: true, root, source: "argument.root" });
  }
  const root = requireCadreRoot(args);
  if (action === "topology") return envelope({ ok: true, root, topology: core.loadTopology(root) });
  if (action === "tech_stack_summary") return envelope(core.techStackSummary(root, args));
  if (action === "sync_control_plane") return envelope(core.syncControlPlane(root, args));
  if (action === "polyrepo_preflight") return envelope(core.polyrepoPreflight(root));
  return envelope({ ok: false, error: `Unknown cadre_project action: ${action}` });
}

function statusPacket(args: RuntimeArgs): RuntimeEnvelope {
  const root = requireCadreRoot(args);
  const action = args.action || "live";
  if (action === "live") return envelope(core.liveStatus(root));
  if (action === "team") return envelope(core.teamStatus(root));
  if (action === "mine") return envelope(core.teamBoard(root, { ...args, mine: true }));
  if (action === "available") return envelope(core.availableWork(root));
  if (action === "collisions") return envelope(core.collisionScan(root));
  if (action === "board") return envelope(core.teamBoard(root, args));
  if (action === "fleet") return envelope(core.fleetStatus(root, args));
  if (action === "beads_summary") return envelope(core.beadsSummary(root));
  return envelope({ ok: false, error: `Unknown cadre_status action: ${action}` });
}

function trackPacket(args: RuntimeArgs): RuntimeEnvelope {
  const root = requireCadreRoot(args);
  const action = args.action || "context";
  if (action === "context") return envelope(core.trackContext(root, args.trackId || args.track_id));
  if (action === "parse_plan") {
    if (!args.planPath) return envelope({ ok: false, error: "planPath is required" });
    return envelope(core.parsePlanFile(path.resolve(root, args.planPath)));
  }
  if (action === "integrity") return envelope(core.planIntegrity(root, args.trackId || args.track_id || null));
  if (action === "phase_schedule") return envelope(core.phaseSchedule(root, args));
  if (action === "prepare_implementation") return envelope(core.implementationPrep(root, args));
  if (action === "create_beads_tree") return envelope(core.createBeadsTree(root, args));
  if (action === "plan_assist") return envelope(core.planAssist(root, args));
  if (action === "worktree_plan") return envelope(core.worktreePlan(root, args));
  return envelope({ ok: false, error: `Unknown cadre_track action: ${action}` });
}

function mutatePacket(args: RuntimeArgs): RuntimeEnvelope {
  const root = requireCadreRoot(args);
  const action = args.action;
  if (action === "claim") {
    const trackId = args.trackId || args.track_id;
    if (!trackId) return envelope({ ok: false, error: "trackId is required" });
    return syncedEnvelope(root, "mutate:claim", () => core.claimTrack(root, trackId, args));
  }
  if (action === "heartbeat") return syncedEnvelope(root, "mutate:heartbeat", () => core.heartbeatTrack(root, args));
  if (action === "set_status") {
    const trackId = args.trackId || args.track_id;
    if (!trackId || !args.status) return envelope({ ok: false, error: "trackId and status are required" });
    return syncedEnvelope(root, "mutate:set_status", () => core.setTrackStatus(root, String(trackId), String(args.status)));
  }
  if (action === "metadata_patch") return syncedEnvelope(root, "mutate:metadata_patch", () => core.metadataPatch(root, args));
  if (action === "record_review") return syncedEnvelope(root, "mutate:record_review", () => core.recordReview(root, args));
  if (action === "record_worker") return syncedEnvelope(root, "mutate:record_worker", () => core.recordParallelWorker(root, { ...args, execute: false }));
  if (action === "record_task_result") return syncedEnvelope(root, "mutate:record_task_result", () => core.recordTaskResult(root, args));
  if (action === "regen_index") return syncedEnvelope(root, "mutate:regen_index", () => core.regenIndex(root));
  return envelope({ ok: false, error: `Unknown cadre_mutate action: ${action}` });
}

function parallelPacket(args: RuntimeArgs): RuntimeEnvelope {
  const root = requireCadreRoot(args);
  return envelope(core.parallelWorkflow(root, args));
}

async function reviewPacket(args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const root = requireCadreRoot(args);
  const action = args.action || "assist";
  if (args.async === true) return jobEnvelope(jobTypeForPacket("cadre_review", args), root, args);
  if (action === "assist") {
    let lspResult: JsonObject | null = null;
    if (args.includeLsp !== false) {
      lspResult = await warmLspReview(root, args);
    }
    const reviewArgs: RuntimeArgs = { ...args };
    if (lspResult) reviewArgs.lspResult = lspResult;
    return envelope(core.reviewAssist(root, reviewArgs));
  }
  if (action === "machine_gate") return envelope(core.reviewMachineGate(root, args));
  if (action === "gate") {
    const trackId = args.trackId || args.track_id;
    if (!trackId) return envelope({ ok: false, error: "trackId is required" });
    return envelope(core.reviewGate(root, trackId, args));
  }
  if (action === "pr_ci_status") return envelope(core.prCiStatus(root, args));
  if (action === "provider_evidence") return syncedEnvelope(root, "review:provider_evidence", () => core.providerEvidence(root, args));
  return envelope({ ok: false, error: `Unknown cadre_review action: ${action}` });
}

async function intelPacket(args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const daemonRoot = args.root ? rootFromCandidate(args.root) : null;
  const root = args.action && args.action.startsWith("lsp_daemon")
    ? (daemonRoot ? daemonRoot.root : process.cwd())
    : requireCadreRoot(args);
  const action = args.action || "repo_map";
  if (args.async === true) return jobEnvelope(jobTypeForPacket("cadre_intel", args), root, args);
  if (action === "repo_map") return envelope(core.repoMap(root, args));
  if (action === "lsp_setup") return envelope(core.lspSetup(root, args));
  if (action === "workspace_diagnostics") return envelope(core.workspaceDiagnostics(root, args));
  if (action === "test_impact") return envelope(core.testImpact(root, args));
  if (action === "dependency_graph") return envelope(core.dependencyGraph(root, args));
  if (action === "lsp_impact") {
    let lspResult: JsonObject | null = null;
    if ((args.base || args.head) && args.includeLsp !== false) {
      lspResult = await warmLspReview(root, args);
    }
    const impactArgs: RuntimeArgs = { ...args };
    if (lspResult) impactArgs.lspResult = lspResult;
    return envelope(core.lspImpact(root, impactArgs));
  }
  if (action === "lsp_review") return envelope(core.lspReview(root, args));
  if (action === "lsp_warm_review") {
    return envelope(await warmLspReview(root, args));
  }
  if (action === "lsp_daemon_status") return envelope(await lspDaemon.request("status", {}, 5000));
  if (action === "lsp_daemon_shutdown") return envelope(await lspDaemon.shutdown());
  return envelope({ ok: false, error: `Unknown cadre_intel action: ${action}` });
}

function jobPacket(args: RuntimeArgs): RuntimeEnvelope {
  const action = args.action || "status";
  if (action === "start") {
    const root = requireCadreRoot(args);
    const type = args.type;
    if (!type) return envelope({ ok: false, error: "type is required for cadre_job start" });
    return jobEnvelope(type, root, args.args || args);
  }
  if (action === "status") {
    const job = jobs.get(args.jobId || args.id);
    if (job) return envelope({ ok: true, job: jobs.summary(job) });
    const info = args.root ? rootFromCandidate(args.root) : null;
    const persisted = info ? jobs.loadPersisted(info.root, args.jobId || args.id) : null;
    return envelope(persisted ? { ok: true, job: persisted } : { ok: false, error: `Job not found: ${args.jobId || args.id}` });
  }
  if (action === "result") {
    const live = jobs.result(args.jobId || args.id);
    if (live.ok !== false) return envelope(live);
    const info = args.root ? rootFromCandidate(args.root) : null;
    const persisted = info ? jobs.loadPersisted(info.root, args.jobId || args.id) : null;
    return envelope(persisted ? { ok: persisted.status === "succeeded", job: persisted, result: asJsonObject(persisted.result) } : live);
  }
  if (action === "cancel") return envelope(jobs.cancel(args.jobId || args.id));
  if (action === "list") return envelope(jobs.list());
  return envelope({ ok: false, error: `Unknown cadre_job action: ${action}` });
}

async function toolCall(name: string, args: RuntimeArgs = {}): Promise<TextJsonResult> {
  if (name === "cadre_workflow") return asTextJson(await workflowPacket(args));
  if (name === "cadre_project") return asTextJson(await projectPacket(args));
  if (name === "cadre_status") return asTextJson(statusPacket(args));
  if (name === "cadre_track") return asTextJson(trackPacket(args));
  if (name === "cadre_parallel") return asTextJson(parallelPacket(args));
  if (name === "cadre_mutate") return asTextJson(mutatePacket(args));
  if (name === "cadre_complete_task") {
    const root = requireCadreRoot(args);
    if (args.async === true) return asTextJson(jobEnvelope("complete_task", root, args));
    return asTextJson(syncedEnvelope(root, "complete_task", () => core.completeTask(root, { ...args, execute: false })));
  }
  if (name === "cadre_beads") {
    const root = requireCadreRoot(args);
    if (beadsOperationMutates(args.operation)) {
      return asTextJson(syncedEnvelope(root, `beads:${args.operation || "unknown"}`, () => core.beadsTaskWrite(root, args)));
    }
    return asTextJson(envelope(core.beadsTaskWrite(root, args)));
  }
  if (name === "cadre_job") return asTextJson(jobPacket(args));
  if (name === "cadre_review") return asTextJson(await reviewPacket(args));
  if (name === "cadre_intel") return asTextJson(await intelPacket(args));
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

export async function handle(message: McpMessage): Promise<unknown> {
  const method = message.method;
  const params = asJsonObject(message.params);
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { resources: { listChanged: false }, tools: { listChanged: false } },
      serverInfo: { name: "cadre", version: "2.0.0" },
      instructions: SERVER_INSTRUCTIONS,
    };
  }
  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") {
    const name = asOptionalString(params.name);
    if (!name) throw Object.assign(new Error("tools/call requires params.name"), { code: -32602 });
    return toolCall(name, asJsonObject(params.arguments) as RuntimeArgs);
  }
  if (method === "resources/list") return resourceList();
  if (method === "resources/templates/list") return resourceTemplatesList();
  if (method === "resources/read") {
    const uri = asOptionalString(params.uri);
    if (!uri) throw Object.assign(new Error("resources/read requires params.uri"), { code: -32602 });
    return resourceRead(uri, jobs);
  }
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}
