import path from "node:path";

import * as core from "../cadre-core";
import type { JsonObject } from "../types";
import { asJsonObject, asOptionalString, asString } from "../guards";
import { envelope } from "./envelope";
import type { JobManager } from "./job-manager";
import type { ResourceQuery } from "./protocol-types";
import { requireCadreRoot } from "./root-resolution";

export function resourceList(): JsonObject {
  return {
    resources: [
      { uri: "cadre://team-board", name: "Cadre team board", description: "Rich team board. Read with ?root=/path/to/project.", mimeType: "application/json" },
      { uri: "cadre://fleet-board", name: "Cadre fleet board", description: "Mono/polyrepo fleet status. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://beads-summary", name: "Cadre Beads summary", description: "Beads ready/WIP/review summary. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://track-context", name: "Cadre track context", description: "Track context. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://review-evidence", name: "Cadre review evidence", description: "Review evidence artifact. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://collisions", name: "Cadre collisions", description: "File collision scan. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://repo-map", name: "Cadre repo map", description: "Symbol map. Read with ?root=/path and optional &symbol=<name>.", mimeType: "application/json" },
      { uri: "cadre://workspace-diagnostics", name: "Cadre workspace diagnostics", description: "Detected build/test adapters. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://lsp-status", name: "Cadre LSP status", description: "Configured LSP servers plus setup recommendations. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://repo-topology", name: "Cadre repo topology", description: "Mono/polyrepo topology. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://provider-actions", name: "Cadre provider actions", description: "Provider action queue from ship/land packets. Read with ?root=/path&trackId=<id>&workflow=ship|land.", mimeType: "application/json" },
      { uri: "cadre://ship-plan", name: "Cadre ship plan", description: "Ship workflow dry-run plan. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://land-plan", name: "Cadre land plan", description: "Land workflow dry-run plan. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://release-plan", name: "Cadre release plan", description: "Release workflow dry-run plan. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://my-next-actions", name: "Cadre next actions", description: "Mine/available/action queue. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://review-queue", name: "Cadre review queue", description: "Bounded tracks needing review/ship attention. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://handoff-inbox", name: "Cadre handoff inbox", description: "Incoming handoffs from team board and Beads. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://parallel-state", name: "Cadre parallel state", description: "Track parallel worker state. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://quality-gate", name: "Cadre quality gate", description: "Review and integrity gate summary. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://test-impact", name: "Cadre test impact", description: "Impacted tests/manifests. Read with ?root=/path&files=a,b.", mimeType: "application/json" },
      { uri: "cadre://track-plan", name: "Cadre track plan", description: "Parsed track plan. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://job-result", name: "Cadre job result", description: "Persisted async job result. Read with ?root=/path&jobId=<id>.", mimeType: "application/json" },
    ],
  };
}

export function resourceTemplatesList(): JsonObject {
  const listed = resourceList();
  const resources = Array.isArray(listed.resources) ? listed.resources : [];
  const contracts: Record<string, JsonObject> = {
    "cadre://team-board": { required: ["root"] },
    "cadre://fleet-board": { required: ["root"] },
    "cadre://beads-summary": { required: ["root"] },
    "cadre://track-context": { required: ["root", "trackId"] },
    "cadre://review-evidence": { required: ["root", "trackId"] },
    "cadre://collisions": { required: ["root"] },
    "cadre://repo-map": { required: ["root"] },
    "cadre://workspace-diagnostics": { required: ["root"] },
    "cadre://lsp-status": { required: ["root"] },
    "cadre://repo-topology": { required: ["root"] },
    "cadre://provider-actions": { required: ["root", "trackId", "workflow"] },
    "cadre://ship-plan": { required: ["root", "trackId"] },
    "cadre://land-plan": { required: ["root", "trackId"] },
    "cadre://release-plan": { required: ["root"] },
    "cadre://my-next-actions": { required: ["root"] },
    "cadre://review-queue": { required: ["root"] },
    "cadre://handoff-inbox": { required: ["root"] },
    "cadre://parallel-state": { required: ["root", "trackId"] },
    "cadre://quality-gate": { required: ["root", "trackId"] },
    "cadre://test-impact": { required: ["root"], requiredAny: [["files"], ["base", "head"]] },
    "cadre://track-plan": { required: ["root", "trackId"] },
    "cadre://job-result": { required: ["root", "jobId"] },
  };
  const templates = resources.map((resource) => {
    const uri = asString(asJsonObject(resource).uri);
    const contract = contracts[uri] || { required: ["root"] };
    return {
      uriTemplate: `${uri}{?root,trackId,symbol,workflow,files,base,head,jobId}`,
      name: asJsonObject(resource).name,
      description: asJsonObject(resource).description,
      mimeType: "application/json",
      ...contract,
    };
  });
  return { resourceTemplates: templates };
}

function parseResourceUri(uri: string): ResourceQuery {
  const [rawBase, query = ""] = uri.split("?");
  const base = rawBase || "";
  const params = new URLSearchParams(query);
  return {
    base,
    root: params.get("root"),
    trackId: params.get("trackId"),
    symbol: params.get("symbol"),
    workflow: params.get("workflow"),
    jobId: params.get("jobId"),
    baseRef: params.get("base"),
    headRef: params.get("head"),
    files: (params.get("files") || "").split(",").map((item) => item.trim()).filter(Boolean),
  };
}

export function resourceRead(uri: string, jobs: Pick<JobManager, "loadPersisted">): JsonObject {
  const resource = parseResourceUri(uri);
  const root = requireCadreRoot(resource.root ? { root: resource.root } : {});
  let value: unknown;
  if (resource.base === "cadre://team-board") value = core.teamBoard(root);
  else if (resource.base === "cadre://fleet-board") value = core.fleetStatus(root);
  else if (resource.base === "cadre://beads-summary") value = core.beadsSummary(root);
  else if (resource.base === "cadre://track-context") value = core.trackContext(root, resource.trackId);
  else if (resource.base === "cadre://review-evidence") value = core.reviewEvidence(root, resource.trackId);
  else if (resource.base === "cadre://collisions") value = core.collisionScan(root);
  else if (resource.base === "cadre://repo-map") value = core.repoMap(root, resource.symbol ? { symbol: resource.symbol } : {});
  else if (resource.base === "cadre://workspace-diagnostics") value = core.workspaceDiagnostics(root);
  else if (resource.base === "cadre://lsp-status") value = { ok: true, status: core.lspConfigStatus(root), setup: core.lspSetup(root, { execute: false }) };
  else if (resource.base === "cadre://repo-topology") value = { ok: true, root, topology: core.loadTopology(root) };
  else if (resource.base === "cadre://ship-plan") value = core.workflowPacket(root, { workflow: "ship", trackId: resource.trackId || undefined });
  else if (resource.base === "cadre://land-plan") value = core.workflowPacket(root, { workflow: "land", trackId: resource.trackId || undefined });
  else if (resource.base === "cadre://release-plan") value = core.workflowPacket(root, { workflow: "release" });
  else if (resource.base === "cadre://my-next-actions") {
    const mine = core.teamBoard(root, { mine: true });
    const available = core.availableWork(root);
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
    const board = core.teamBoard(root);
    value = { ok: board.ok !== false, review_queue: Array.isArray(board.review_queue) ? board.review_queue : [] };
  }
  else if (resource.base === "cadre://handoff-inbox") {
    const board = core.teamBoard(root, { mine: true });
    value = { ok: board.ok !== false, incoming_handoffs: Array.isArray(board.incoming_handoffs) ? board.incoming_handoffs : [] };
  }
  else if (resource.base === "cadre://parallel-state") value = core.parallelWorkflow(root, { action: "plan", trackId: resource.trackId || undefined });
  else if (resource.base === "cadre://quality-gate") {
    if (!resource.trackId) value = { ok: false, error: "trackId is required" };
    else value = {
      ok: true,
      track_id: resource.trackId,
      integrity: core.planIntegrity(root, resource.trackId),
      review_gate: core.reviewGate(root, resource.trackId, {}),
      collisions: core.collisionScan(root),
    };
  }
  else if (resource.base === "cadre://test-impact") value = core.testImpact(root, {
    files: resource.files,
    base: resource.baseRef || undefined,
    head: resource.headRef || undefined,
  });
  else if (resource.base === "cadre://track-plan") {
    const context = core.trackContext(root, resource.trackId);
    const planPath = asOptionalString(asJsonObject(asJsonObject(context).track).plan_path);
    value = context.ok === false || !planPath
      ? context
      : core.parsePlanFile(path.resolve(root, planPath));
  }
  else if (resource.base === "cadre://job-result") {
    const persisted = jobs.loadPersisted(root, resource.jobId);
    value = persisted || { ok: false, error: `Job not found: ${resource.jobId}` };
  }
  else if (resource.base === "cadre://provider-actions") {
    const workflow = resource.workflow === "land" ? "land" : "ship";
    const plan = asJsonObject(core.workflowPacket(root, { workflow, trackId: resource.trackId || undefined }));
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
