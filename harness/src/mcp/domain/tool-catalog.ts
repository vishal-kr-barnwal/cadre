import type { JsonObject } from "../../types";

export const PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INSTRUCTIONS = [
  "Cadre MCP is the packet-owned runtime for Cadre workflows. Pass an explicit root on every project-scoped call; setup packets may use a root candidate before cadre/ exists.",
  "Prefer compact responses and Cadre resources for dashboards, review queues, quality gates, workspace health, repo maps, job results, and status views.",
  "Do not mutate cadre/, provider state, indexes, worker state, or merge/cleanup state outside Cadre packets.",
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
  uri: { type: "string", description: "Cadre MCP resource URI to read through a tool fallback." },
  execute: { type: "boolean", description: "Run a mutating packet when true; omitted or false is a dry-run where supported." },
  async: { type: "boolean" },
  trackId: { type: "string" },
  track_id: { type: "string" },
  phaseIndex: { type: "number" },
  taskIndex: { type: "number" },
  status: { type: "string" },
  patch: { type: "object" },
  identity: { type: "string" },
  takeover: { type: "boolean" },
  base: { type: "string" },
  head: { type: "string" },
  config: { type: "string" },
  configurationId: { type: "string" },
  configuration: { type: "object" },
  breakpoints: { type: "array", items: { type: "object" } },
  operation: { type: "string" },
  id: { type: "string" },
  formulaId: { type: "string" },
  formula_id: { type: "string" },
  variables: { type: "object" },
  vars: { type: "object" },
  wispId: { type: "string" },
  wisp_id: { type: "string" },
  stepId: { type: "string" },
  step_id: { type: "string" },
  stepIndex: { type: "number" },
  step_index: { type: "number" },
  command: { type: "string" },
  machineCommand: { type: "string" },
  testCommand: { type: "string" },
  timeoutMs: { type: "number" },
  limit: { type: "number" },
  maxWorkers: { type: "number" },
  includeHeavy: { type: "boolean" },
  agentIdentifier: { type: "string", enum: ["claude", "codex", "copilot", "antigravity"], description: "Calling agent platform used to select the worker dispatch adapter." },
  provider: { type: "string" },
  providerMode: { type: "string", enum: ["local", "github", "gitlab"] },
  provider_mode: { type: "string", enum: ["local", "github", "gitlab"] },
  providerEvidence: { oneOf: [{ type: "object" }, { type: "string" }] },
  provider_evidence: { oneOf: [{ type: "object" }, { type: "string" }] },
  evidence: { oneOf: [{ type: "object" }, { type: "string" }] },
  mcpCapabilities: { type: "object" },
  mcp_capabilities: { type: "object" },
  continuationToken: { type: "string" },
  continuation_token: { type: "string" },
  responseMode: { type: "string", enum: ["compact", "detail", "detailed", "full", "verbose"] },
  response_mode: { type: "string", enum: ["compact", "detail", "detailed", "full", "verbose"] },
  detail: { type: "boolean" },
  compact: { type: "boolean" },
  symbol: { type: "string" },
  symbols: { type: "array", items: { type: "string" } },
  files: { type: "array", items: { type: "string" } },
  filesChanged: { type: "array", items: { type: "string" } },
  files_changed: { type: "array", items: { type: "string" } },
  repo: { type: "string" },
  repos: { type: "array", items: { type: "string" } },
  workerId: { type: "string" },
  worker_id: { type: "string" },
  commitSha: { type: "string" },
  commitMode: { type: "string", enum: ["auto", "off", "manual", "product", "control"] },
  commitType: { type: "string" },
  commitScope: { type: "string" },
  commitSubject: { type: "string" },
  commitBody: { type: "string" },
  notesRef: { type: "string" },
  allowDirty: { type: "boolean" },
  coverage: { type: "number" },
  tests: { type: "array" },
  summary: { type: "string" },
  blockers: { type: "array", items: { type: "string" } },
  force: { type: "boolean" },
  allowNoCommit: { type: "boolean" },
  completeTask: { type: "boolean" },
  styleGuideIds: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
  styleGuideMaxChars: { type: "number" },
  techStack: { type: "object" },
  product: { type: "object" },
  productGuidelines: { type: "object" },
  product_guidelines: { type: "object" },
  workflowPolicy: { type: "object" },
  workflow_policy: { type: "object" },
  approvalStage: { type: "string" },
  approval_stage: { type: "string" },
  approvalSessionId: { type: "string" },
  approval_session_id: { type: "string" },
  approvedStages: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
  approved_stages: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
  approvalComplete: { type: "boolean" },
  approval_complete: { type: "boolean" },
  manualVerificationMode: { type: "string", enum: ["offline", "autorun"] },
  manual_verification_mode: { type: "string", enum: ["offline", "autorun"] },
  manualVerificationSummary: { type: "string" },
  manual_verification_summary: { type: "string" },
  manualVerificationChecks: { oneOf: [{ type: "array" }, { type: "object" }, { type: "string" }] },
  manual_verification_checks: { oneOf: [{ type: "array" }, { type: "object" }, { type: "string" }] },
  manualVerificationCommand: { type: "string" },
  manual_verification_command: { type: "string" },
  manualVerificationResult: { oneOf: [{ type: "object" }, { type: "string" }] },
  manual_verification_result: { oneOf: [{ type: "object" }, { type: "string" }] },
  reviewBundle: { type: "boolean" },
  reviewFiles: { type: "boolean" },
  reviewBundleDir: { type: "string" },
  review_bundle_dir: { type: "string" },
  reviewOutputMode: { type: "string", enum: ["target", "bundle"] },
  review_output_mode: { type: "string", enum: ["target", "bundle"] },
  spec: { type: "object" },
  plan: { type: "object" },
  args: { type: "object" },
  type: { type: "string" },
  jobId: { type: "string" },
  artifact: { type: "string" },
  scope: { type: "string" },
  artifactAction: { type: "string" },
  artifact_action: { type: "string" },
  includeArchive: { type: "boolean" },
  include_archive: { type: "boolean" },
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
  return [{ required: ["trackId"] }];
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
      allOf: [...(options.allOf || []), forbidMarkdownPayloadFields()],
      additionalProperties: true,
    },
  };
}

function forbidMarkdownPayloadFields(): JsonObject {
  return {
    not: {
      anyOf: [
        "productText",
        "productGuidelinesText",
        "workflowText",
        "specText",
        "planText",
        "planPath",
        "importLegacy",
        "import_legacy",
      ].map((name) => ({ required: [name] })),
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
  "debug",
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
  "artifacts",
  "artifact_sync",
];

const FORMULA_ACTIONS = [
  "list",
  "show",
  "cook",
  "wisp_create",
  "wisp_list",
  "wisp_update_step",
  "wisp_squash",
  "wisp_burn",
  "pour",
];

export const TOOLS = [
  packetSchema({
    name: "cadre_resource",
    description: "Tool fallback for Cadre MCP resources/read. Prefer resources when available; use this when a client exposes tools more reliably than resources.",
    fields: ["uri"],
    required: ["uri"],
  }),
  packetSchema({
    name: "cadre_workflow",
    description: "Packet-only Cadre workflow coordinator for setup, newtrack, implement, debug, status, review, validate, archive, handoff, ship, land, release, refresh, flag, revert, revise, formula, and artifact sync flows.",
    workflowEnum: WORKFLOWS,
    actionEnum: [...WORKFLOWS, ...FORMULA_ACTIONS],
    fields: ["workflow", "action", "id", "formulaId", "variables", "wispId", "stepId", "stepIndex", "execute", "approvalStage", "approvalSessionId", "approvedStages", "approvalComplete", "trackId", "detail", "providerMode", "providerEvidence", "mcpCapabilities", "product", "productGuidelines", "workflowPolicy", "techStack", "spec", "plan", "description", "artifact", "scope", "status", "summary", "evidence", "config", "configurationId", "configuration", "breakpoints", "files", "testCommand", "async", "timeoutMs"],
    required: ["root"],
    anyOf: [{ required: ["workflow"] }, { required: ["action"] }],
    allOf: [{
      if: { properties: { workflow: { enum: ["implement", "review", "ship", "land", "archive", "handoff", "flag", "revert", "revise"] } }, required: ["workflow"] },
      then: { anyOf: trackIdAnyOf() },
    }],
  }),
  packetSchema({
    name: "cadre_project",
    description: "Cadre project packet: ping, doctor, root, topology/config, tech-stack summary, integrations, sync, and polyrepo preflight.",
    actionEnum: ["ping", "doctor", "root", "topology", "tech_stack_summary", "integrations", "sync_control_plane", "polyrepo_preflight"],
    fields: ["action", "execute", "detail"],
    required: ["action"],
    allOf: [requireRootForActions(["root", "topology", "tech_stack_summary", "integrations", "sync_control_plane", "polyrepo_preflight"])],
  }),
  packetSchema({
    name: "cadre_status",
    description: "Cadre status packet: live, team, mine, available, collisions, fleet, and team board.",
    actionEnum: ["live", "team", "mine", "available", "collisions", "board", "fleet"],
    fields: ["action", "identity", "view", "limit", "detail"],
    required: ["root", "action"],
  }),
  packetSchema({
    name: "cadre_track",
    description: "Cadre track packet: context, JSON plan parsing, integrity, phase scheduling, implementation prep, planning evidence, and worktree planning.",
    actionEnum: ["context", "parse_plan", "integrity", "phase_schedule", "prepare_implementation", "plan_assist", "worktree_plan"],
    fields: ["action", "trackId", "plan", "execute", "identity", "base", "head", "limit", "styleGuideIds", "detail"],
    required: ["root", "action"],
    allOf: [
      requireTrackForActions(["context", "phase_schedule", "prepare_implementation", "worktree_plan"]),
      { if: { properties: { action: { enum: ["parse_plan"] } }, required: ["action"] }, then: { anyOf: [{ required: ["plan"] }, { required: ["trackId"] }] } },
    ],
  }),
  packetSchema({
    name: "cadre_parallel",
    description: "Cadre parallel packet: plan worker waves, setup workers, record finishes, merge back, and cleanup.",
    actionEnum: ["plan", "next_wave", "setup_workers", "record_finish", "merge_back", "cleanup"],
    fields: ["action", "trackId", "execute", "phaseIndex", "taskIndex", "workerId", "status", "commitSha", "repo", "maxWorkers", "agentIdentifier", "filesChanged", "tests", "summary", "blockers", "coverage", "force", "approvalComplete"],
    required: ["root", "action"],
    anyOf: trackIdAnyOf(),
    allOf: [{ if: { properties: { action: { enum: ["setup_workers"] } }, required: ["action"] }, then: { required: ["agentIdentifier"] } }],
  }),
  packetSchema({
    name: "cadre_mutate",
    description: "Cadre mutation packet: claim, heartbeat, status, metadata, review, worker, task-result, and index writes.",
    actionEnum: ["claim", "heartbeat", "set_status", "metadata_patch", "record_review", "record_worker", "record_task_result", "regen_index"],
    fields: ["action", "trackId", "execute", "status", "patch", "identity", "workerId", "phaseIndex", "taskIndex", "commitSha", "repo", "coverage", "force"],
    required: ["root", "action"],
    allOf: [requireTrackForActions(["claim", "heartbeat", "set_status", "metadata_patch", "record_review", "record_worker", "record_task_result"])],
  }),
  packetSchema({
    name: "cadre_complete_task",
    description: "Journaled task completion: coverage gate plus locked plan, metadata, and completion journal writes.",
    fields: ["trackId", "phaseIndex", "taskIndex", "commitSha", "repo", "coverage", "filesChanged", "summary", "force", "allowNoCommit", "approvalComplete", "manualVerificationMode", "manualVerificationSummary", "manualVerificationChecks", "manualVerificationCommand", "manualVerificationResult", "async"],
    required: ["root", "phaseIndex", "taskIndex"],
    anyOf: trackIdAnyOf(),
  }),
  packetSchema({
    name: "cadre_job",
    description: "Cadre job packet: start, status, result, cancel, and list process-local or persisted long-running jobs.",
    actionEnum: ["start", "status", "result", "cancel", "list"],
    fields: ["action", "type", "jobId", "args", "timeoutMs"],
    required: ["action"],
    allOf: [
      requireRootForActions(["start"]),
      { if: { properties: { action: { enum: ["status", "result", "cancel"] } }, required: ["action"] }, then: { required: ["jobId"] } },
    ],
  }),
  packetSchema({
    name: "cadre_review",
    description: "Cadre review packet: review assist, machine gate, review gate, provider evidence, and PR/MR/CI status.",
    actionEnum: ["assist", "machine_gate", "gate", "pr_ci_status", "provider_evidence"],
    fields: ["action", "trackId", "base", "head", "config", "machineCommand", "providerEvidence", "mcpCapabilities", "includeLsp", "includeMachine", "async", "timeoutMs", "limit", "detail"],
    required: ["root", "action"],
    allOf: [requireTrackForActions(["assist", "gate", "provider_evidence"])],
  }),
  packetSchema({
    name: "cadre_intel",
    description: "Cadre code intelligence packet: repo map, LSP setup/impact/review, DAP setup/status/snapshot, workspace diagnostics, test impact, dependency graph, and daemon lifecycle.",
    actionEnum: ["repo_map", "lsp_setup", "lsp_impact", "lsp_review", "lsp_warm_review", "lsp_daemon_status", "lsp_daemon_shutdown", "dap_setup", "dap_status", "dap_snapshot", "workspace_diagnostics", "test_impact", "dependency_graph", "mcp_readiness"],
    fields: ["action", "trackId", "base", "head", "config", "configurationId", "configuration", "breakpoints", "testCommand", "files", "symbol", "symbols", "repo", "repos", "execute", "async", "timeoutMs", "limit", "mcpCapabilities", "detail"],
    required: ["action"],
    allOf: [requireRootForActions(["repo_map", "lsp_setup", "lsp_impact", "lsp_review", "lsp_warm_review", "dap_setup", "dap_status", "dap_snapshot", "workspace_diagnostics", "test_impact", "dependency_graph", "mcp_readiness"])],
  }),
  packetSchema({
    name: "cadre_artifact",
    description: "Cadre artifact packet: catalog, schema, validate JSON canonicals, render human projections, diff, and sync generated artifacts.",
    actionEnum: ["catalog", "schema", "validate", "render", "diff", "sync"],
    fields: ["action", "artifact", "id", "scope", "trackId", "execute", "approvalStage", "approvalSessionId", "approvedStages", "approvalComplete", "force", "includeArchive"],
    required: ["root", "action"],
  }),
];
