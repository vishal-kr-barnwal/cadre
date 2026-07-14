import type { JsonObject, RuntimeArgs } from "../../../types";

import type { ReviewFile } from "./contracts";
import { stageRecord, type ApprovalSession } from "./approval-session-model";
import { readApprovalSession } from "./approval-session-store";
import { approvedStageIds, requestedApprovalSessionId, requestedApprovalStage } from "./approval-request";
import { setupIntentPrompts } from "./intent-prompts";
import { setupNativePrompts } from "./native-prompts";
import { setupStageMissingEvidence, type SetupEvidenceStage } from "./setup-evidence";
import type { ApprovalStage } from "./staged-approval-stages";

export interface SetupApprovalCursor {
  session: ApprovalSession | null;
  approvedStageIds: string[];
  activeStage: SetupEvidenceStage | null;
}

export interface SetupNativePromptContext {
  provider: JsonObject;
  syncMode: string;
  styleGuides: JsonObject;
  lspSetup: JsonObject;
  integrations: unknown;
}

export interface SetupStageCollection {
  cursor: SetupApprovalCursor;
  missingEvidence: string[];
  intentPrompts: JsonObject[];
  nativePrompts: JsonObject[];
  pending: boolean;
  activeReady: boolean;
}

function setupStageId(value: string | undefined): SetupEvidenceStage | null {
  return value === "product" || value === "product_guidelines" || value === "technical" || value === "workflow"
    ? value
    : null;
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

export function setupApprovalCursor(
  root: string,
  args: RuntimeArgs,
  stages: ApprovalStage[],
): SetupApprovalCursor {
  const sessionId = requestedApprovalSessionId(args);
  const session = sessionId ? readApprovalSession(root, sessionId) : null;
  const validSession = session?.workflow === "setup" ? session : null;
  let approved = validSession?.approved_stages || [];
  const requested = approvedStageIds(args);
  if (validSession && validRequestedPrefix(validSession, stages, requested, requestedApprovalStage(args))) {
    approved = requested;
  }
  const active = stages.find((stage) => !approved.includes(stage.id));
  return {
    session: validSession,
    approvedStageIds: approved,
    activeStage: setupStageId(active?.id),
  };
}

export function setupStageCollection(
  root: string,
  args: RuntimeArgs,
  stages: ApprovalStage[],
  polyrepoRequested: boolean,
  context: SetupNativePromptContext,
): SetupStageCollection {
  const cursor = setupApprovalCursor(root, args, stages);
  const missingEvidence = setupStageMissingEvidence(args, cursor.activeStage, polyrepoRequested);
  const intentPrompts = setupIntentPrompts(args, cursor.activeStage);
  const nativePrompts = cursor.activeStage === "technical" && missingEvidence.length === 0 && intentPrompts.length === 0
    ? setupNativePrompts({ ...context, runtimeArgs: args })
    : [];
  const pending = Boolean(cursor.activeStage)
    && (missingEvidence.length > 0 || intentPrompts.length > 0 || nativePrompts.length > 0);
  return {
    cursor,
    missingEvidence,
    intentPrompts,
    nativePrompts,
    pending,
    activeReady: Boolean(cursor.activeStage) && !pending,
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

function approvedSnapshots(cursor: SetupApprovalCursor): ReviewFile[] {
  return cursor.approvedStageIds.flatMap((stageId) => {
    return cursor.session ? stageRecord(cursor.session, stageId)?.snapshot_files || [] : [];
  });
}

export function setupScopedReviewFiles(
  cursor: SetupApprovalCursor,
  currentFiles: ReviewFile[],
  newFinalFiles: ReviewFile[],
): ReviewFile[] {
  const frozenFinalFiles = cursor.session?.final_snapshot_files || [];
  return uniqueReviewFiles([
    ...approvedSnapshots(cursor),
    ...currentFiles,
    ...(frozenFinalFiles.length > 0 ? frozenFinalFiles : newFinalFiles),
  ]);
}
