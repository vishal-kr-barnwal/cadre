import type { JsonObject } from "../types";

export const PROTOCOL_VERSION = "2025-11-25";

interface ToolDescription {
  name: string;
  text: string;
}

const packetSchema = (description: ToolDescription, actionEnum: string[] | null = null): JsonObject => ({
  name: description.name,
  description: description.text,
  inputSchema: {
    type: "object",
    properties: {
      root: { type: "string" },
      action: actionEnum ? { type: "string", enum: actionEnum } : { type: "string" },
      workflow: actionEnum ? { type: "string", enum: actionEnum } : { type: "string" },
      execute: { type: "boolean" },
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
      providerMcpAvailable: { type: "boolean" },
      provider_mcp_available: { type: "boolean" },
      githubMcpAvailable: { type: "boolean" },
      gitlabMcpAvailable: { type: "boolean" },
      providerEvidence: { oneOf: [{ type: "object" }, { type: "string" }] },
      provider_evidence: { oneOf: [{ type: "object" }, { type: "string" }] },
      remoteHost: { type: "string" },
      remote_host: { type: "string" },
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
      force: { type: "boolean" },
      allowNoCommit: { type: "boolean" },
      styleGuideIds: { oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }] },
      styleGuideMaxChars: { type: "number" },
      techStack: { type: "object" },
      args: { type: "object" },
      type: { type: "string" },
      jobId: { type: "string" },
      view: { type: "string" },
      description: { type: "string" },
      handoffText: { type: "string" },
      bump: { type: "string" },
      includeProvider: { type: "boolean" },
    },
    additionalProperties: true,
  },
});

export const TOOLS = [
  packetSchema(
    {
      name: "cadre_workflow",
      text: "Packet-only Cadre workflow coordinator for setup, new track, implementation, status, review, validation, archive, handoff, ship, land, release, refresh, flag, revert, revise, and formula flows.",
    },
    [
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
    ]
  ),
  packetSchema(
    { name: "cadre_project", text: "Cadre project packet: ping, doctor, root, topology/config, tech-stack summary, sync, and polyrepo preflight." },
    ["ping", "doctor", "root", "topology", "tech_stack_summary", "sync_control_plane", "polyrepo_preflight"]
  ),
  packetSchema(
    { name: "cadre_status", text: "Cadre status packet: live, team, mine, available, collisions, and team board." },
    ["live", "team", "mine", "available", "collisions", "board", "fleet", "beads_summary"]
  ),
  packetSchema(
    { name: "cadre_track", text: "Cadre track packet: context, plan parsing, integrity, phase scheduling, implementation prep, and Beads tree creation." },
    ["context", "parse_plan", "integrity", "phase_schedule", "prepare_implementation", "create_beads_tree", "plan_assist", "worktree_plan"]
  ),
  packetSchema(
    { name: "cadre_parallel", text: "Cadre parallel packet: plan worker waves, dry-run worker setup, record finishes, merge back, and cleanup." },
    ["plan", "next_wave", "setup_workers", "record_finish", "merge_back", "cleanup"]
  ),
  packetSchema(
    { name: "cadre_mutate", text: "Cadre mutation packet: claim, heartbeat, status, metadata, review, worker, task-result, and index writes." },
    ["claim", "heartbeat", "set_status", "metadata_patch", "record_review", "record_worker", "record_task_result", "regen_index"]
  ),
  packetSchema(
    { name: "cadre_complete_task", text: "Journaled task completion: coverage gate, locked plan/metadata writes, and idempotent Beads note/close." },
    null
  ),
  packetSchema(
    { name: "cadre_beads", text: "CLI-backed Beads packet for ready/list/show/update/note/close/labels/deps/create/mail/formula/compact/dolt/sql/worktree." },
    null
  ),
  packetSchema(
    { name: "cadre_job", text: "Cadre job packet: start, status, result, cancel, and list process-local long-running jobs." },
    ["start", "status", "result", "cancel", "list"]
  ),
  packetSchema(
    { name: "cadre_review", text: "Cadre review packet: review assist, machine gate, review gate, and PR/CI status." },
    ["assist", "machine_gate", "gate", "pr_ci_status", "provider_evidence"]
  ),
  packetSchema(
    { name: "cadre_intel", text: "Cadre code intelligence packet: repo map, LSP impact, warm/cold LSP review, daemon status, and daemon shutdown." },
    ["repo_map", "lsp_setup", "lsp_impact", "lsp_review", "lsp_warm_review", "lsp_daemon_status", "lsp_daemon_shutdown", "workspace_diagnostics", "test_impact", "dependency_graph"]
  ),
];
