import type { JsonObject } from "../types";

export const PROTOCOL_VERSION = "2025-11-25";

export const SERVER_INSTRUCTIONS = [
  "Cadre MCP is the packet-owned runtime for Cadre workflows. Pass an explicit root on every project-scoped call; setup packets may use a root candidate before cadre/ exists.",
  "Prefer compact responses and Cadre resources for dashboards, review queues, quality gates, repo maps, job results, and status views.",
  "Do not mutate cadre/, Beads, provider state, indexes, worker state, or merge/cleanup state outside Cadre packets.",
].join(" ");

interface ToolOptions {
  name: string;
  description: string;
  actionEnum?: string[];
  workflowEnum?: string[];
  fields?: string[];
  required?: string[];
  anyOf?: JsonObject[];
  allOf?: JsonObject[];
}

const PROPS: Record<string, JsonObject> = {
  root: { type: "string", description: "Absolute project root or a path inside it." },
  action: { type: "string" },
  workflow: { type: "string" },
  execute: { type: "boolean", description: "Run a mutating packet when true; omitted or false is a dry-run where supported." },
  async: { type: "boolean" },
  trackId: { type: "string" },
  track_id: { type: "string" },
  phaseIndex: { type: "number" },
  taskIndex: { type: "number" },
  planPath: { type: "string" },
  status: { type: "string" },
  patch: { type: "object" },
  identity: { type: "string" },
  takeover: { type: "boolean" },
  base: { type: "string" },
  head: { type: "string" },
  config: { type: "string" },
  operation: { type: "string" },
  id: { type: "string" },
  command: { type: "string" },
  machineCommand: { type: "string" },
  timeoutMs: { type: "number" },
  provider: { type: "string" },
  providerMode: { type: "string", enum: ["local", "github", "gitlab"] },
  provider_mode: { type: "string", enum: ["local", "github", "gitlab"] },
  providerEvidence: { oneOf: [{ type: "object" }, { type: "string" }] },
  provider_evidence: { oneOf: [{ type: "object" }, { type: "string" }] },
  continuationToken: { type: "string" },
  continuation_token: { type: "string" },
  responseMode: { type: "string", enum: ["compact", "detail", "detailed", "full", "verbose"] },
  response_mode: { type: "string", enum: ["compact", "detail", "detailed", "full", "verbose"] },
  detail: { type: "boolean" },
  compact: { type: "boolean" },
  symbol: { type: "string" },
  symbols: { type: "array", items: { type: "string" } },
  files: { type: "array", items: { type: "string" } },
  repo: { type: "string" },
  repos: { type: "array", items: { type: "string" } },
  workerId: { type: "string" },
  worker_id: { type: "string" },
  commitSha: { type: "string" },
  coverage: { type: "number" },
  force: { type: "boolean" },
  allowNoCommit: { type: "boolean" },
  completeTask: { type: "boolean" },
  styleGuideIds: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
  styleGuideMaxChars: { type: "number" },
  techStack: { type: "object" },
  productText: { type: "string" },
  specText: { type: "string" },
  planText: { type: "string" },
  args: { type: "object" },
  type: { type: "string" },
  jobId: { type: "string" },
  view: { type: "string" },
  description: { type: "string" },
  handoffText: { type: "string" },
  bump: { type: "string" },
  includeProvider: { type: "boolean" },
  includeLsp: { type: "boolean" },
  includeMachine: { type: "boolean" },
};

function props(names: string[], actionEnum?: string[], workflowEnum?: string[]): JsonObject {
  const picked: JsonObject = {};
  for (const name of names) picked[name] = PROPS[name];
  if (actionEnum && picked.action) picked.action = { ...PROPS.action, enum: actionEnum };
  if (workflowEnum && picked.workflow) picked.workflow = { ...PROPS.workflow, enum: workflowEnum };
  return picked;
}

function trackIdAnyOf(): JsonObject[] {
  return [{ required: ["trackId"] }, { required: ["track_id"] }];
}

function requireTrackForActions(actions: string[]): JsonObject {
  return {
    if: { properties: { action: { enum: actions } }, required: ["action"] },
    then: { anyOf: trackIdAnyOf() },
  };
}

function requireRootForActions(actions: string[]): JsonObject {
  return {
    if: { properties: { action: { enum: actions } }, required: ["action"] },
    then: { required: ["root"] },
  };
}

function packetSchema(options: ToolOptions): JsonObject {
  const fieldNames = Array.from(new Set(["root", ...(options.fields || [])]));
  return {
    name: options.name,
    description: options.description,
    inputSchema: {
      type: "object",
      properties: props(fieldNames, options.actionEnum, options.workflowEnum),
      required: options.required || [],
      ...(options.anyOf ? { anyOf: options.anyOf } : {}),
      ...(options.allOf ? { allOf: options.allOf } : {}),
      additionalProperties: true,
    },
  };
}

const WORKFLOWS = [
  "setup",
  "setup_assist",
  "setup_scaffold",
  "newtrack",
  "new_track",
  "implement",
  "status",
  "review",
  "validate",
  "archive",
  "handoff",
  "ship",
  "land",
  "release",
  "revise",
  "refresh",
  "flag",
  "revert",
  "formula",
];

export const TOOLS = [
  packetSchema({
    name: "cadre_workflow",
    description: "Packet-only Cadre workflow coordinator for setup, newtrack, implement, status, review, validate, archive, handoff, ship, land, release, refresh, flag, revert, revise, and formula flows.",
    workflowEnum: WORKFLOWS,
    actionEnum: WORKFLOWS,
    fields: ["workflow", "action", "execute", "trackId", "track_id", "responseMode", "response_mode", "detail", "compact", "providerEvidence", "provider_evidence", "continuationToken", "continuation_token", "productText", "techStack", "specText", "planText", "description"],
    required: ["root"],
    anyOf: [{ required: ["workflow"] }, { required: ["action"] }],
    allOf: [{
      if: { properties: { workflow: { enum: ["implement", "review", "ship", "land", "archive", "handoff", "flag", "revert", "revise"] } }, required: ["workflow"] },
      then: { anyOf: trackIdAnyOf() },
    }],
  }),
  packetSchema({
    name: "cadre_project",
    description: "Cadre project packet: ping, doctor, root, topology/config, tech-stack summary, sync, and polyrepo preflight.",
    actionEnum: ["ping", "doctor", "root", "topology", "tech_stack_summary", "sync_control_plane", "polyrepo_preflight"],
    fields: ["action", "execute", "responseMode", "response_mode", "detail", "compact"],
    required: ["action"],
    allOf: [requireRootForActions(["root", "topology", "tech_stack_summary", "sync_control_plane", "polyrepo_preflight"])],
  }),
  packetSchema({
    name: "cadre_status",
    description: "Cadre status packet: live, team, mine, available, collisions, fleet, Beads summary, and team board.",
    actionEnum: ["live", "team", "mine", "available", "collisions", "board", "fleet", "beads_summary"],
    fields: ["action", "identity", "view", "responseMode", "response_mode", "detail", "compact"],
    required: ["root", "action"],
  }),
  packetSchema({
    name: "cadre_track",
    description: "Cadre track packet: context, plan parsing, integrity, phase scheduling, implementation prep, planning evidence, worktree planning, and Beads tree creation.",
    actionEnum: ["context", "parse_plan", "integrity", "phase_schedule", "prepare_implementation", "create_beads_tree", "plan_assist", "worktree_plan"],
    fields: ["action", "trackId", "track_id", "planPath", "execute", "identity", "takeover", "base", "head", "styleGuideIds", "styleGuideMaxChars", "responseMode", "response_mode", "detail", "compact"],
    required: ["root", "action"],
    allOf: [
      requireTrackForActions(["context", "phase_schedule", "prepare_implementation", "create_beads_tree", "worktree_plan"]),
      { if: { properties: { action: { enum: ["parse_plan"] } }, required: ["action"] }, then: { required: ["planPath"] } },
    ],
  }),
  packetSchema({
    name: "cadre_parallel",
    description: "Cadre parallel packet: plan worker waves, setup workers, record finishes, merge back, and cleanup.",
    actionEnum: ["plan", "next_wave", "setup_workers", "record_finish", "merge_back", "cleanup"],
    fields: ["action", "trackId", "track_id", "execute", "phaseIndex", "taskIndex", "workerId", "worker_id", "status", "commitSha", "repo", "command", "timeoutMs", "force", "allowNoCommit", "completeTask", "responseMode", "response_mode", "detail", "compact"],
    required: ["root", "action"],
    anyOf: trackIdAnyOf(),
  }),
  packetSchema({
    name: "cadre_mutate",
    description: "Cadre mutation packet: claim, heartbeat, status, metadata, review, worker, task-result, and index writes.",
    actionEnum: ["claim", "heartbeat", "set_status", "metadata_patch", "record_review", "record_worker", "record_task_result", "regen_index"],
    fields: ["action", "trackId", "track_id", "execute", "status", "patch", "identity", "workerId", "worker_id", "phaseIndex", "taskIndex", "commitSha", "repo", "coverage", "command", "timeoutMs", "force"],
    required: ["root", "action"],
    allOf: [requireTrackForActions(["claim", "heartbeat", "set_status", "metadata_patch", "record_review", "record_worker", "record_task_result"])],
  }),
  packetSchema({
    name: "cadre_complete_task",
    description: "Journaled task completion: coverage gate, locked plan/metadata writes, and idempotent Beads note/close.",
    fields: ["trackId", "track_id", "phaseIndex", "taskIndex", "commitSha", "repo", "command", "timeoutMs", "coverage", "force", "allowNoCommit", "async"],
    required: ["root", "phaseIndex", "taskIndex"],
    anyOf: trackIdAnyOf(),
  }),
  packetSchema({
    name: "cadre_beads",
    description: "CLI-backed Beads packet for ready/list/show/update/note/close/labels/deps/create/mail/formula/compact/dolt/sql/worktree.",
    fields: ["operation", "id", "description", "status", "patch", "args"],
    required: ["root", "operation"],
  }),
  packetSchema({
    name: "cadre_job",
    description: "Cadre job packet: start, status, result, cancel, and list process-local long-running jobs.",
    actionEnum: ["start", "status", "result", "cancel", "list"],
    fields: ["action", "type", "jobId", "id", "args", "timeoutMs"],
    required: ["action"],
    allOf: [
      requireRootForActions(["start"]),
      { if: { properties: { action: { enum: ["status", "result", "cancel"] } }, required: ["action"] }, then: { anyOf: [{ required: ["jobId"] }, { required: ["id"] }] } },
    ],
  }),
  packetSchema({
    name: "cadre_review",
    description: "Cadre review packet: review assist, machine gate, review gate, provider evidence, and PR/MR/CI status.",
    actionEnum: ["assist", "machine_gate", "gate", "pr_ci_status", "provider_evidence"],
    fields: ["action", "trackId", "track_id", "base", "head", "config", "machineCommand", "command", "providerEvidence", "provider_evidence", "includeLsp", "includeMachine", "async", "timeoutMs", "responseMode", "response_mode", "detail", "compact"],
    required: ["root", "action"],
    allOf: [requireTrackForActions(["assist", "gate", "provider_evidence"])],
  }),
  packetSchema({
    name: "cadre_intel",
    description: "Cadre code intelligence packet: repo map, LSP setup/impact/review, workspace diagnostics, test impact, dependency graph, and daemon lifecycle.",
    actionEnum: ["repo_map", "lsp_setup", "lsp_impact", "lsp_review", "lsp_warm_review", "lsp_daemon_status", "lsp_daemon_shutdown", "workspace_diagnostics", "test_impact", "dependency_graph"],
    fields: ["action", "trackId", "track_id", "base", "head", "config", "files", "symbol", "symbols", "repo", "repos", "execute", "async", "timeoutMs", "responseMode", "response_mode", "detail", "compact"],
    required: ["action"],
    allOf: [requireRootForActions(["repo_map", "lsp_setup", "lsp_impact", "lsp_review", "lsp_warm_review", "workspace_diagnostics", "test_impact", "dependency_graph"])],
  }),
];
