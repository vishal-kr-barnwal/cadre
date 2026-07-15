import type { JsonObject } from "../../../types";

import type { ReviewFile } from "./contracts";
import { approvalStageHash } from "./approval-request";
import type { ApprovalStage } from "./staged-approval-stages";

export function approvalStageReviewHash(
  workflow: string,
  stage: ApprovalStage,
  files: ReviewFile[],
  extras: JsonObject,
): string {
  return approvalStageHash(workflow, stage, files.map((file) => ({
    path: file.path,
    source: file.source,
    kind: file.kind,
    missing: file.missing === true,
    content: file.content,
  })), extras);
}
