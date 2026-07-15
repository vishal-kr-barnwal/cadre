import type { ReviewFile } from "./contracts";
import { listApprovalSessions } from "./approval-session-store";
import type { ApprovalSession } from "./approval-session-model";

export function activeApprovalSessionsForTargets(
  root: string,
  workflow: string,
  files: ReviewFile[],
): ApprovalSession[] {
  const paths = new Set(files.filter((file) => file.missing !== true).map((file) => file.path));
  if (paths.size === 0) return [];
  return listApprovalSessions(root)
    .filter((session) => session.workflow === workflow && session.preview_files.length > 0)
    .filter((session) => {
      const stageOrder = session.stage_order || [];
      return stageOrder.length === 0 || session.approved_stages.length < stageOrder.length;
    })
    .filter((session) => session.snapshot_files.some((file) => file.missing !== true && paths.has(file.path)))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}
