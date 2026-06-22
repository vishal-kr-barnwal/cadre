import path from "node:path";

import * as core from "../../cadre-core";
import type { JsonObject, RuntimeArgs } from "../../types";
import { asJsonObject, asOptionalString } from "../../guards";
import { envelope } from "./envelope";
import { parseResourceUri } from "../domain/resource-catalog";
import type { RuntimeDependencies } from "./ports";
import { packagedAgentReference, packagedAgentReferences, packagedSkillContract, packagedTemplateJson, packagedWorkflowProtocol, packagedWorkflowProtocols } from "../../core/application/runtime/packaged-assets";

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

function normalizeResourceArgs(resource: ReturnType<typeof parseResourceUri>): RuntimeArgs {
  const args: RuntimeArgs = {
    base: resource.base,
    files: resource.files,
  };
  if (resource.root != null) args.root = resource.root;
  if (resource.trackId != null) args.trackId = resource.trackId;
  if (resource.symbol != null) args.symbol = resource.symbol;
  if (resource.workflow != null) args.workflow = resource.workflow;
  if (resource.artifact != null) args.artifact = resource.artifact;
  if (resource.scope != null) args.scope = resource.scope;
  if (resource.jobId != null) args.jobId = resource.jobId;
  if (resource.baseRef != null) args.baseRef = resource.baseRef;
  if (resource.headRef != null) args.headRef = resource.headRef;
  const responseMode = resource.responseMode ?? resource.response_mode;
  if (responseMode != null) {
    args.responseMode = responseMode;
    args.response_mode = responseMode;
  }
  if (resource.detail != null) args.detail = resource.detail;
  if (resource.compact != null) args.compact = resource.compact;
  if (resource.includeArchive != null) args.includeArchive = resource.includeArchive;
  return args;
}

function workspaceHealth(root: string, args: RuntimeArgs = {}): JsonObject {
  return asJsonObject(core.workspaceHealth(root, args));
}

function integrations(root: string, args: RuntimeArgs = {}): JsonObject {
  return asJsonObject(core.integrationInventory(root, args));
}

function safeAssetName(name: string): string | null {
  const normalized = name.trim();
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

function skillContract(): JsonObject {
  const skill = packagedSkillContract();
  return skill ? { ok: true, skill } : { ok: false, error: "Skill contract not found" };
}

function workflowProtocolCatalog(): JsonObject {
  const skill = packagedSkillContract() || {};
  const skillWorkflows = asJsonObject(skill.workflows);
  const workflows = packagedWorkflowProtocols().map((protocol) => {
    const workflow = asOptionalString(protocol.workflow) || asOptionalString(protocol.id)?.replace(/^cadre-/, "") || "";
    const skillWorkflow = asJsonObject(skillWorkflows[workflow]);
    return {
      workflow,
      id: asOptionalString(protocol.id) || `cadre-${workflow}`,
      title: asOptionalString(protocol.title) || asOptionalString(skillWorkflow.intent) || workflow,
      uri: `cadre://workflow-protocol?workflow=${encodeURIComponent(workflow)}`,
    };
  });
  return { ok: true, workflows };
}

function workflowProtocol(workflow: string | null): JsonObject {
  const protocol = packagedWorkflowProtocol(workflow);
  if (!protocol) return { ok: false, error: "workflow is required and must match a packaged protocol" };
  return { ok: true, protocol };
}

function agentReferenceCatalog(): JsonObject {
  const references = packagedAgentReferences().map((reference) => {
    const id = asOptionalString(reference.id) || "unknown";
    return {
      id,
      title: asOptionalString(reference.title) || id,
      uri: `cadre://agent-reference?name=${encodeURIComponent(id)}`,
    };
  });
  return { ok: true, references };
}

function agentReference(name: string | null): JsonObject {
  const safeName = name ? safeAssetName(name) : null;
  if (!safeName) return { ok: false, error: "name is required and must be a reference id" };
  const reference = packagedAgentReference(safeName);
  if (!reference) return { ok: false, error: `Unknown agent reference: ${safeName}` };
  return { ok: true, reference };
}

function templateInventory(): JsonObject {
  const templates = packagedTemplateJson("manifest.json");
  if (!templates) return { ok: false, error: "Template manifest not found" };
  return { ok: true, templates };
}

export function resourceRead(uri: string, deps: Pick<RuntimeDependencies, "core" | "jobs" | "rootResolver">): JsonObject {
  const resource = parseResourceUri(uri);
  const normalizedResource = normalizeResourceArgs(resource);
  let value: unknown;
  if (resource.base === "cadre://skill-contract") value = skillContract();
  else if (resource.base === "cadre://workflow-protocols") value = workflowProtocolCatalog();
  else if (resource.base === "cadre://workflow-protocol") value = workflowProtocol(resource.workflow);
  else if (resource.base === "cadre://agent-references") value = agentReferenceCatalog();
  else if (resource.base === "cadre://agent-reference") value = agentReference(resource.name);
  else if (resource.base === "cadre://template-inventory") value = templateInventory();
  else {
    const root = deps.rootResolver.requireCadreRoot(resource.root ? { root: resource.root } : {});
    if (resource.base === "cadre://team-board") value = deps.core.teamBoard(root);
  else if (resource.base === "cadre://fleet-board") value = deps.core.fleetStatus(root);
  else if (resource.base === "cadre://beads-summary") value = deps.core.beadsSummary(root);
  else if (resource.base === "cadre://workspace-health") value = workspaceHealth(root, normalizedResource);
  else if (resource.base === "cadre://integrations") value = integrations(root, normalizedResource);
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
    const track = asJsonObject(asJsonObject(context).track);
    const planPath = asOptionalString(track.plan_json_path);
    value = context.ok === false || !planPath
      ? context
      : deps.core.parsePlanFile(path.resolve(root, planPath));
  }
  else if (resource.base === "cadre://track-spec") {
    value = resource.trackId
      ? deps.core.artifactRender(root, { artifact: `track:${resource.trackId}:spec` })
      : { ok: false, error: "trackId is required" };
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
  else if (resource.base === "cadre://artifact-catalog") {
    value = deps.core.artifactCatalog(root, normalizedResource);
  }
  else if (resource.base === "cadre://artifact-schema") {
    value = deps.core.artifactSchema(resource.artifact || normalizedResource.artifact || "catalog");
  }
  else if (resource.base === "cadre://artifact-preview") {
    value = resource.artifact
      ? deps.core.artifactRender(root, normalizedResource)
      : { ok: false, error: "artifact is required" };
  }
  else if (resource.base === "cadre://artifact-sync-plan") {
    value = deps.core.artifactSync(root, { ...normalizedResource, execute: false });
  }
  else if (resource.base === "cadre://styleguide-selection") {
    value = {
      ok: true,
      track_id: resource.trackId,
      files: resource.files,
      catalog: deps.core.artifactCatalog(root, { ...normalizedResource, scope: "styleguides" }),
    };
  }
  else throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: -32602 });
  }
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(envelope(value), null, 2) }] };
}
