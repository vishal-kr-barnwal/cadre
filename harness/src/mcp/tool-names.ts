export const CADRE_MCP_TOOLS = {
  workflowElicit: "workflow_elicit",
  templateGetMany: "template_get_many",
  styleguideResolve: "styleguide_resolve",
  contextRead: "context_read",
  projectStatus: "project_status",
  stateValidate: "state_validate",
  candidateStagePrepare: "candidate_stage_prepare",
  candidateInspect: "candidate_inspect",
  executionGraphValidate: "execution_graph_validate",
  reviewComplete: "review_complete",
  archiveBatchCandidate: "archive_batch_candidate",
  archiveBatchRecord: "archive_batch_record",
  executionStart: "execution_start",
  executionCheckpoint: "execution_checkpoint",
  executionStatus: "execution_status",
  executionFinish: "execution_finish",
  worktreeCreate: "worktree_create",
  integration: "integration",
  worktreeCleanup: "worktree_cleanup",
  projectInitCandidate: "project_init_candidate",
  setupRecordCommit: "setup_record_commit",
  setupRecordGitInitialized: "setup_record_git_initialized",
  tracksRender: "tracks_render"
} as const;

export const CADRE_MCP_TOOL_NAMES = Object.freeze(Object.values(CADRE_MCP_TOOLS));

export type CadreMcpToolName = typeof CADRE_MCP_TOOL_NAMES[number];
