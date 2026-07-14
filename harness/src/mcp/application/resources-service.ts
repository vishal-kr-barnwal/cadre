import type { JsonObject, RuntimeArgs } from "../../types";
import { asJsonObject } from "../../guards";
import { packagedTemplateJson } from "../../core/application/runtime/packaged-assets";
import { envelope } from "./envelope";
import {
  parseResourceUri,
  type ParsedResourceQuery,
  type ResourceHandlerId,
} from "../domain/resource-catalog";
import type { RuntimeEnvelope } from "../domain/protocol-types";
import type { RuntimeDependencies } from "./ports";

export type ResourceRuntimeDependencies = Pick<
  RuntimeDependencies,
  "core" | "jobs" | "rootResolver" | "projectSourceReader"
>;

interface ResourceContext {
  query: ParsedResourceQuery;
  args: RuntimeArgs;
  root: string | null;
  deps: ResourceRuntimeDependencies;
}

type ResourceHandler = (context: ResourceContext) => unknown;

function normalizeResourceArgs(resource: ParsedResourceQuery): RuntimeArgs {
  const args: RuntimeArgs = {};
  if (resource.root != null) args.root = resource.root;
  if (resource.trackId != null) args.trackId = resource.trackId;
  if (resource.symbol != null) args.symbol = resource.symbol;
  if (resource.workflow != null) args.workflow = resource.workflow;
  if (resource.id != null) args.id = resource.id;
  if (resource.reference != null) args.reference = resource.reference;
  if (resource.path != null) args.path = resource.path;
  if (resource.skillRuleBudget != null) args.skillRuleBudget = resource.skillRuleBudget;
  if (resource.artifact != null) args.artifact = resource.artifact;
  if (resource.scope != null) args.scope = resource.scope;
  if (resource.jobId != null) args.jobId = resource.jobId;
  if (resource.baseRef != null) args.base = resource.baseRef;
  if (resource.headRef != null) args.head = resource.headRef;
  if (resource.files.length > 0) args.files = resource.files;
  if (resource.repos.length > 0) args.repos = resource.repos;
  if (resource.responseMode != null) args.responseMode = resource.responseMode;
  if (resource.detail != null) args.detail = resource.detail;
  if (resource.compact != null) args.compact = resource.compact;
  if (resource.includeArchive != null) args.includeArchive = resource.includeArchive;
  return args;
}

function requiredRoot(context: ResourceContext): string {
  if (context.root) return context.root;
  throw Object.assign(new Error(`Resource ${context.query.base} requires a resolved project root`), { code: -32602 });
}

function resolveRoot(query: ParsedResourceQuery, deps: ResourceRuntimeDependencies): string | null {
  if (query.spec.rootPolicy === "none") return null;
  if (query.spec.rootPolicy === "candidate") {
    const candidate = deps.rootResolver.rootFromCandidate(query.root);
    if (candidate) return candidate.root;
  }
  return deps.rootResolver.requireCadreRoot(query.root ? { root: query.root } : {});
}

function templateInventory(): JsonObject {
  const templates = packagedTemplateJson("manifest.json");
  return templates
    ? { ok: true, templates }
    : { ok: false, error: "Template manifest not found" };
}

const RESOURCE_HANDLERS = {
  "template-inventory": () => templateInventory(),
  "team-board": (context) => context.deps.core.teamBoard(requiredRoot(context)),
  "fleet-board": (context) => context.deps.core.fleetStatus(requiredRoot(context)),
  "workspace-health": (context) => context.deps.core.workspaceHealth(requiredRoot(context), context.args),
  integrations: (context) => context.deps.core.integrationInventory(requiredRoot(context), context.args),
  "mcp-readiness": (context) => context.deps.core.mcpReadiness(requiredRoot(context), context.args),
  "track-context": (context) => context.deps.core.trackContext(requiredRoot(context), context.query.trackId),
  "review-evidence": (context) => context.deps.core.reviewEvidence(requiredRoot(context), context.query.trackId),
  collisions: (context) => context.deps.core.collisionScan(requiredRoot(context)),
  "repo-map": (context) => context.deps.core.repoMap(
    requiredRoot(context),
    context.query.symbol ? { symbol: context.query.symbol } : {},
  ),
  "workspace-diagnostics": (context) => context.deps.core.workspaceDiagnostics(requiredRoot(context), context.args),
  "dependency-graph": (context) => context.deps.core.dependencyGraph(requiredRoot(context), context.args),
  "lsp-status": (context) => {
    const root = requiredRoot(context);
    return {
      ok: true,
      status: context.deps.core.lspConfigStatus(root),
      setup: context.deps.core.lspSetup(root, { execute: false }),
    };
  },
  "dap-status": (context) => {
    const root = requiredRoot(context);
    return {
      ok: true,
      status: context.deps.core.dapStatus(root, context.args),
      setup: context.deps.core.dapSetup(root, { ...context.args, execute: false }),
    };
  },
  "repo-topology": (context) => {
    const root = requiredRoot(context);
    return { ok: true, root, topology: context.deps.core.loadTopology(root) };
  },
  "provider-actions": (context) => {
    const root = requiredRoot(context);
    const workflow = context.query.workflow as "ship" | "land";
    const plan = asJsonObject(context.deps.core.workflowPacket(root, {
      workflow,
      trackId: context.query.trackId || undefined,
    }));
    return {
      ok: plan.ok !== false,
      workflow,
      track_id: context.query.trackId,
      phase_state: plan.phase_state,
      provider_actions: Array.isArray(plan.provider_actions) ? plan.provider_actions : [],
      required_provider_mcp: plan.required_provider_mcp || null,
      required_evidence: plan.required_evidence || null,
      continuation_token: plan.continuation_token || null,
    };
  },
  "ship-plan": (context) => context.deps.core.workflowPacket(requiredRoot(context), {
    workflow: "ship",
    trackId: context.query.trackId || undefined,
  }),
  "land-plan": (context) => context.deps.core.workflowPacket(requiredRoot(context), {
    workflow: "land",
    trackId: context.query.trackId || undefined,
  }),
  "my-next-actions": (context) => {
    const root = requiredRoot(context);
    const mine = context.deps.core.teamBoard(root, { mine: true });
    const available = context.deps.core.availableWork(root);
    return {
      ok: mine.ok !== false && available.ok !== false,
      mine: {
        wip: Array.isArray(mine.wip) ? mine.wip : [],
        incoming_handoffs: Array.isArray(mine.incoming_handoffs) ? mine.incoming_handoffs : [],
        review_queue: Array.isArray(mine.review_queue) ? mine.review_queue : [],
      },
      available: Array.isArray(available.available) ? available.available : [],
      reclaimable: Array.isArray(available.reclaimable) ? available.reclaimable : [],
    };
  },
  "review-queue": (context) => {
    const board = context.deps.core.teamBoard(requiredRoot(context));
    return { ok: board.ok !== false, review_queue: Array.isArray(board.review_queue) ? board.review_queue : [] };
  },
  "handoff-inbox": (context) => {
    const board = context.deps.core.teamBoard(requiredRoot(context), { mine: true });
    return { ok: board.ok !== false, incoming_handoffs: Array.isArray(board.incoming_handoffs) ? board.incoming_handoffs : [] };
  },
  "parallel-state": (context) => context.deps.core.parallelWorkflow(requiredRoot(context), {
    action: "plan",
    trackId: context.query.trackId || undefined,
  }),
  "quality-gate": (context) => {
    const root = requiredRoot(context);
    const trackId = context.query.trackId;
    if (!trackId) throw Object.assign(new Error("quality-gate requires trackId"), { code: -32602 });
    return {
      ok: true,
      track_id: trackId,
      integrity: context.deps.core.planIntegrity(root, trackId),
      review_gate: context.deps.core.reviewGate(root, trackId, {}),
      collisions: context.deps.core.collisionScan(root),
    };
  },
  "test-impact": (context) => context.deps.core.testImpact(requiredRoot(context), context.args),
  "track-plan": (context) => {
    const trackContext = context.deps.core.trackContext(requiredRoot(context), context.query.trackId);
    return trackContext.ok === false ? trackContext : asJsonObject(trackContext.plan);
  },
  "job-result": (context) => {
    const job = context.deps.jobs.loadPersisted(requiredRoot(context), context.query.jobId);
    if (!job) return { ok: false, error: `Job not found: ${context.query.jobId}` };
    return job.stale === true
      ? { ...job, ok: false, error: "Job was interrupted by an MCP server restart; start it again." }
      : job;
  },
  "artifact-catalog": (context) => context.deps.core.artifactCatalog(requiredRoot(context), context.args),
  "artifact-schema": (context) => {
    requiredRoot(context);
    return context.deps.core.artifactSchema(context.query.artifact);
  },
  "artifact-preview": (context) => context.deps.core.artifactRender(requiredRoot(context), context.args),
  "artifact-sync-plan": (context) => context.deps.core.artifactSync(requiredRoot(context), {
    ...context.args,
    execute: false,
  }),
  "track-spec": (context) => context.deps.core.artifactRender(requiredRoot(context), {
    artifact: `track:${context.query.trackId}:spec`,
  }),
  "styleguide-selection": (context) => ({
    ok: true,
    track_id: context.query.trackId,
    files: context.query.files,
    catalog: context.deps.core.artifactCatalog(requiredRoot(context), { ...context.args, scope: "styleguides" }),
  }),
  "project-skills": (context) => context.deps.core.projectSkillSelection(
    requiredRoot(context),
    context.query.workflow || "",
    context.args,
  ),
  "project-skill": (context) => {
    const detail = context.deps.core.projectSkillDetail(requiredRoot(context), context.query.id || "");
    if (!context.query.reference) return detail;
    const skill = asJsonObject(asJsonObject(detail).skill);
    const references = Array.isArray(skill.references) ? skill.references.map(asJsonObject) : [];
    const selected = references.find((entry) => entry.id === context.query.reference);
    return selected
      ? { ok: true, skill_id: context.query.id, reference: selected }
      : { ok: false, skill_id: context.query.id, error: `Unknown project-skill reference: ${context.query.reference}` };
  },
  "project-skill-source": (context) => context.deps.projectSourceReader.readText(
    requiredRoot(context),
    context.query.path || "",
    context.query.token || "",
  ),
} satisfies Record<ResourceHandlerId, ResourceHandler>;

export function resolveResource(uri: string, deps: ResourceRuntimeDependencies): RuntimeEnvelope {
  const query = parseResourceUri(uri);
  const context: ResourceContext = {
    query,
    args: normalizeResourceArgs(query),
    root: resolveRoot(query, deps),
    deps,
  };
  return envelope(RESOURCE_HANDLERS[query.spec.handler](context));
}

export function resourceRead(uri: string, deps: ResourceRuntimeDependencies): JsonObject {
  const resolved = resolveResource(uri, deps);
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(resolved, null, 2) }],
  };
}
