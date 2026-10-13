export const CADRE_MCP_TOOLS = {
  workflowElicit: "workflow_elicit",
  templateGetMany: "template_get_many",
  styleguideResolve: "styleguide_resolve",
  contextRead: "context_read",
  diagnosticRead: "diagnostic_read",
  projectStatus: "project_status",
  stateValidate: "state_validate",
  candidateStagePrepare: "candidate_stage_prepare",
  candidateInspect: "candidate_inspect",
  candidateApply: "candidate_apply",
  executionGraphValidate: "execution_graph_validate",
  reviewComplete: "review_complete",
  archiveBatchCandidate: "archive_batch_candidate",
  executionStart: "execution_start",
  executionCheckpoint: "execution_checkpoint",
  executionStatus: "execution_status",
  executionFinish: "execution_finish",
  worktreeCreate: "worktree_create",
  integration: "integration",
  worktreeCleanup: "worktree_cleanup",
  projectInitCandidate: "project_init_candidate",
  tracksRender: "tracks_render"
} as const;

export const CADRE_MCP_TOOL_NAMES = Object.freeze(Object.values(CADRE_MCP_TOOLS));

export type CadreMcpToolName = typeof CADRE_MCP_TOOL_NAMES[number];
