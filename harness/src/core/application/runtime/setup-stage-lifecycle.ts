import type { JsonObject, RuntimeArgs } from "../../../types";

import { approvalStageCursor, type ApprovalStageCursor } from "./approval-stage-cursor";
import { setupIntentPrompts } from "./intent-prompts";
import { setupNativePrompts } from "./native-prompts";
import { setupStageMissingEvidence, type SetupEvidenceStage } from "./setup-evidence";
import type { ApprovalStage } from "./staged-approval-stages";
import { approvalReadOnlyRequested } from "./approval-request";

export interface SetupApprovalCursor extends Omit<ApprovalStageCursor, "activeStage"> {
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

export function setupApprovalCursor(
  root: string,
  args: RuntimeArgs,
  stages: ApprovalStage[],
): SetupApprovalCursor {
  const cursor = approvalStageCursor(root, args, "setup", stages);
  return {
    session: cursor.session,
    approvedStageIds: cursor.approvedStageIds,
    activeStage: setupStageId(cursor.activeStage?.id),
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
  const invalidChoiceCorrection = approvalReadOnlyRequested(args);
  const nativePrompts = invalidChoiceCorrection
    ? setupNativePrompts({ ...context, runtimeArgs: args })
    : cursor.activeStage === "technical" && missingEvidence.length === 0 && intentPrompts.length === 0
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
