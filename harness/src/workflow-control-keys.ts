export const WORKFLOW_INPUT_RESERVED_KEYS: ReadonlySet<string> = new Set([
  "root", "workflow", "execute", "approval", "skipSync",
  "source_manifest", "source_snapshot", "source_files", "source_file_hashes",
  "lspResult", "lsp_result", "configOwnerRoot", "config_owner_root",
  "approvalStage", "approval_stage", "approvalSessionId", "approval_session_id",
  "approvalStageHash", "approval_stage_hash", "approvalStageRevision", "approval_stage_revision",
  "approvedStages", "approved_stages", "approvalComplete", "approval_complete",
  "approvalCancel", "approval_cancel", "_cadreApprovalInputError",
]);

export function isWorkflowInputReservedKey(value: string): boolean {
  return WORKFLOW_INPUT_RESERVED_KEYS.has(value);
}
