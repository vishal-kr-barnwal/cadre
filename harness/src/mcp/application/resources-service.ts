import path from "node:path";

import * as core from "../../cadre-core";
import type { JsonObject, RuntimeArgs } from "../../types";
import { asJsonObject, asOptionalString } from "../../guards";
import { envelope } from "./envelope";
import { parseResourceUri } from "../domain/resource-catalog";
import type { RuntimeDependencies } from "./ports";

function summarizeRecords(records: unknown, limit = 8): JsonObject[] {
  if (!Array.isArray(records)) return [];
  return records.slice(0, limit).map((record) => asJsonObject(record));
}

function summarizeAdapters(adapters: unknown): JsonObject[] {
  return summarizeRecords(adapters, 10).map((adapter) => ({
    id: adapter.id || null,
    repo: adapter.repo || null,
    path: adapter.path || null,
    available: adapter.available,
    manifest: adapter.manifest || null,
    ecosystem: adapter.ecosystem || null,
    commands: Array.isArray(adapter.commands) ? adapter.commands.slice(0, 3) : [],
  }));
}

function summarizeCommands(commands: unknown): JsonObject[] {
  return summarizeRecords(commands, 10).map((command) => ({
    adapter: command.adapter || null,
    command: command.command || null,
    cwd: command.cwd || null,
    repo: command.repo || null,
    path: command.path || null,
  }));
}

function summarizeRecs(recommended: unknown): JsonObject[] {
  return summarizeRecords(recommended, 10).map((rec) => ({
    id: rec.id || null,
    label: rec.label || null,
    command: rec.command || null,
    files: rec.files || 0,
    available: rec.available,
    samples: Array.isArray(rec.samples) ? rec.samples.slice(0, 3) : [],
  }));
}

function workspaceHealth(root: string): JsonObject {
  const topology = asJsonObject(core.loadTopology(root));
  const topologyRepos = asJsonObject(topology.repos);
  const topologyConfig = asJsonObject(topology.config);
  const workspace = core.workspaceDiagnostics(root);
  const dependencyGraph = core.dependencyGraph(root);
  const techStack = core.techStackSummary(root);
  const lspStatus = core.lspConfigStatus(root);
  const lspSetup = core.lspSetup(root, { execute: false });
  const availableWork = core.availableWork(root);
  const lspStatusObject = asJsonObject(lspStatus);

  return {
    ok: true,
    root,
    languages: {
      detected: summarizeRecs(lspSetup.ok === false ? [] : lspSetup.recommended).map((rec) => rec.id).filter(Boolean),
      configured: Array.isArray(lspStatusObject.servers)
        ? lspStatusObject.servers
          .map((server) => asJsonObject(server).id || null)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
        : [],
    },
    topology: {
      polyrepo: Boolean(topology.polyrepo),
      default_repo: topology.defaultRepo || null,
      sync_mode: typeof topologyConfig.sync_mode === "string"
        ? topologyConfig.sync_mode
        : "local",
      repos: Array.isArray(topologyRepos.repos)
        ? topologyRepos.repos.slice(0, 10).map((repo) => {
          const entry = asJsonObject(repo);
          return {
            name: entry.name || null,
            submodule_path: entry.submodule_path || null,
            worktree_path: entry.worktree_path || null,
            enabled: entry.enabled !== false,
          };
        })
        : [],
    },
    tech_stack: techStack.ok === false
      ? { ok: false, error: techStack.error || "Missing tech stack" }
      : {
        ok: true,
        path: techStack.path,
        summary: techStack.summary,
        styleGuideIds: techStack.styleGuideIds,
      },
    workspace: {
      adapters: summarizeAdapters(workspace.adapters),
      commands: summarizeCommands(workspace.commands),
      repo_count: Array.isArray(workspace.repos) ? workspace.repos.length : 0,
    },
    dependency_graph: {
      manifest_count: Array.isArray(dependencyGraph.manifests) ? dependencyGraph.manifests.length : 0,
      edge_count: Array.isArray(dependencyGraph.edges) ? dependencyGraph.edges.length : 0,
      repo_count: Array.isArray(dependencyGraph.repos) ? dependencyGraph.repos.length : 0,
      manifests: summarizeRecords(dependencyGraph.manifests, 10),
    },
    parallel: availableWork.ok === false
      ? { ok: false, error: availableWork.error || "Available work unavailable" }
      : {
        ok: true,
        available_count: Array.isArray(availableWork.available) ? availableWork.available.length : 0,
        reclaimable_count: Array.isArray(availableWork.reclaimable) ? availableWork.reclaimable.length : 0,
        available: summarizeRecords(availableWork.available, 5),
        reclaimable: summarizeRecords(availableWork.reclaimable, 5),
      },
    lsp: {
      status: lspStatus,
      setup: lspSetup.ok === false
        ? { ok: false, error: lspSetup.error || "LSP setup unavailable" }
        : {
          ok: true,
          config: lspSetup.config,
          missingFromConfig: Array.isArray(lspSetup.missingFromConfig) ? lspSetup.missingFromConfig : [],
          missingCommands: Array.isArray(lspSetup.missingCommands) ? lspSetup.missingCommands.slice(0, 10) : [],
          recommended: summarizeRecs(lspSetup.recommended),
          workspaceFolders: Array.isArray(lspSetup.workspaceFolders) ? lspSetup.workspaceFolders.slice(0, 10) : [],
          added: Array.isArray(lspSetup.added) ? lspSetup.added : [],
        },
    },
  } as JsonObject;
}

export function resourceRead(uri: string, deps: Pick<RuntimeDependencies, "core" | "jobs" | "rootResolver">): JsonObject {
  const resource = parseResourceUri(uri);
  const root = deps.rootResolver.requireCadreRoot(resource.root ? { root: resource.root } : {});
  let value: unknown;
  if (resource.base === "cadre://team-board") value = deps.core.teamBoard(root);
  else if (resource.base === "cadre://fleet-board") value = deps.core.fleetStatus(root);
  else if (resource.base === "cadre://beads-summary") value = deps.core.beadsSummary(root);
  else if (resource.base === "cadre://workspace-health") value = workspaceHealth(root);
  else if (resource.base === "cadre://track-context") value = deps.core.trackContext(root, resource.trackId);
  else if (resource.base === "cadre://review-evidence") value = deps.core.reviewEvidence(root, resource.trackId);
  else if (resource.base === "cadre://collisions") value = deps.core.collisionScan(root);
  else if (resource.base === "cadre://repo-map") value = deps.core.repoMap(root, resource.symbol ? { symbol: resource.symbol } : {});
  else if (resource.base === "cadre://workspace-diagnostics") value = deps.core.workspaceDiagnostics(root);
  else if (resource.base === "cadre://lsp-status") value = { ok: true, status: deps.core.lspConfigStatus(root), setup: deps.core.lspSetup(root, { execute: false }) };
  else if (resource.base === "cadre://repo-topology") value = { ok: true, root, topology: deps.core.loadTopology(root) };
  else if (resource.base === "cadre://ship-plan") value = deps.core.workflowPacket(root, { workflow: "ship", trackId: resource.trackId || undefined });
  else if (resource.base === "cadre://land-plan") value = deps.core.workflowPacket(root, { workflow: "land", trackId: resource.trackId || undefined });
  else if (resource.base === "cadre://release-plan") value = deps.core.workflowPacket(root, { workflow: "release" });
  else if (resource.base === "cadre://my-next-actions") {
    const mine = deps.core.teamBoard(root, { mine: true });
    const available = deps.core.availableWork(root);
    value = {
      ok: mine.ok !== false && available.ok !== false,
      mine: {
        wip: Array.isArray(mine.wip) ? mine.wip : [],
        incoming_handoffs: Array.isArray(mine.incoming_handoffs) ? mine.incoming_handoffs : [],
        review_queue: Array.isArray(mine.review_queue) ? mine.review_queue : [],
      },
      available: Array.isArray(available.available) ? available.available : [],
      reclaimable: Array.isArray(available.reclaimable) ? available.reclaimable : [],
    };
  }
  else if (resource.base === "cadre://review-queue") {
    const board = deps.core.teamBoard(root);
    value = { ok: board.ok !== false, review_queue: Array.isArray(board.review_queue) ? board.review_queue : [] };
  }
  else if (resource.base === "cadre://handoff-inbox") {
    const board = deps.core.teamBoard(root, { mine: true });
    value = { ok: board.ok !== false, incoming_handoffs: Array.isArray(board.incoming_handoffs) ? board.incoming_handoffs : [] };
  }
  else if (resource.base === "cadre://parallel-state") value = deps.core.parallelWorkflow(root, { action: "plan", trackId: resource.trackId || undefined });
  else if (resource.base === "cadre://quality-gate") {
    if (!resource.trackId) value = { ok: false, error: "trackId is required" };
    else value = {
      ok: true,
      track_id: resource.trackId,
      integrity: deps.core.planIntegrity(root, resource.trackId),
      review_gate: deps.core.reviewGate(root, resource.trackId, {}),
      collisions: deps.core.collisionScan(root),
    };
  }
  else if (resource.base === "cadre://test-impact") value = deps.core.testImpact(root, {
    files: resource.files,
    base: resource.baseRef || undefined,
    head: resource.headRef || undefined,
  });
  else if (resource.base === "cadre://track-plan") {
    const context = deps.core.trackContext(root, resource.trackId);
    const planPath = asOptionalString(asJsonObject(asJsonObject(context).track).plan_path);
    value = context.ok === false || !planPath
      ? context
      : deps.core.parsePlanFile(path.resolve(root, planPath));
  }
  else if (resource.base === "cadre://job-result") {
    const persisted = deps.jobs.loadPersisted(root, resource.jobId);
    value = persisted || { ok: false, error: `Job not found: ${resource.jobId}` };
  }
  else if (resource.base === "cadre://provider-actions") {
    const workflow = resource.workflow === "land" ? "land" : "ship";
    const plan = asJsonObject(deps.core.workflowPacket(root, { workflow, trackId: resource.trackId || undefined }));
    value = {
      ok: plan.ok !== false,
      workflow,
      track_id: resource.trackId,
      phase_state: plan.phase_state,
      provider_actions: Array.isArray(plan.provider_actions) ? plan.provider_actions : [],
      required_provider_mcp: plan.required_provider_mcp || null,
      required_evidence: plan.required_evidence || null,
      continuation_token: plan.continuation_token || null,
    };
  }
  else throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: -32602 });
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(envelope(value), null, 2) }] };
}
