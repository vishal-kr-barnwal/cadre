import type { RuntimeArgs } from "../../../types";

import type { ReviewFile } from "./contracts";
import { stageRecord, type ApprovalSession } from "./approval-session-model";
import { readApprovalSession } from "./approval-session-store";
import { approvedStageIds, requestedApprovalSessionId, requestedApprovalStage } from "./approval-request";
import type { ApprovalStage } from "./staged-approval-stages";

export interface ApprovalStageCursor {
  session: ApprovalSession | null;
  approvedStageIds: string[];
  activeStage: ApprovalStage | null;
}

function validRequestedPrefix(
  session: ApprovalSession,
  stages: ApprovalStage[],
  requested: string[],
  requestedStage: string | null,
): boolean {
  const order = stages.map((stage) => stage.id);
  const previous = session.approved_stages;
  if (requested.length < previous.length || requested.length > previous.length + 1) return false;
  if (!requested.every((stageId, index) => stageId === order[index])) return false;
  if (!previous.every((stageId, index) => stageId === requested[index])) return false;
  return requested.length === previous.length || requestedStage === requested[requested.length - 1];
}

export function approvalStageCursor(
  root: string,
  args: RuntimeArgs,
  workflow: string,
  stages: ApprovalStage[],
): ApprovalStageCursor {
  const sessionId = requestedApprovalSessionId(args);
  const session = sessionId ? readApprovalSession(root, sessionId) : null;
  const validSession = session?.workflow === workflow ? session : null;
  let approved = validSession?.approved_stages || [];
  const requested = approvedStageIds(args);
  if (validSession && validRequestedPrefix(validSession, stages, requested, requestedApprovalStage(args))) {
    approved = requested;
  }
  return {
    session: validSession,
    approvedStageIds: approved,
    activeStage: stages.find((stage) => !approved.includes(stage.id)) || null,
  };
}

function uniqueReviewFiles(files: ReviewFile[]): ReviewFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

export function scopedApprovalReviewFiles(
  cursor: Pick<ApprovalStageCursor, "session" | "approvedStageIds">,
  currentFiles: ReviewFile[],
  newFinalFiles: ReviewFile[] = [],
): ReviewFile[] {
  const approvedSnapshots = cursor.approvedStageIds.flatMap((stageId) => (
    cursor.session ? stageRecord(cursor.session, stageId)?.snapshot_files || [] : []
  ));
  const frozenFinalFiles = cursor.session?.final_snapshot_files || [];
  return uniqueReviewFiles([
    ...approvedSnapshots,
    ...currentFiles,
    ...(frozenFinalFiles.length > 0 ? frozenFinalFiles : newFinalFiles),
  ]);
}
