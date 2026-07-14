import type { RuntimeArgs } from "../../../types";

import { approvalStageCursor, scopedApprovalReviewFiles, type ApprovalStageCursor } from "./approval-stage-cursor";
import type { ReviewFile } from "./contracts";
import type { RefreshLevel } from "./refresh-analysis";
import { missingRefreshEvidence, refreshReviewFiles, type RefreshDocumentsResult } from "./refresh-documents";
import type { ApprovalStage } from "./staged-approval-stages";

const TECHNICAL_LEVELS = new Set<RefreshLevel>(["tech-stack", "style-guides", "repository-topology", "lsp"]);

export interface RefreshStageCollection extends RefreshDocumentsResult {
  cursor: ApprovalStageCursor;
  activeLevels: RefreshLevel[];
  missingEvidence: string[];
}

function documentsFromFiles(files: ReviewFile[]): RefreshDocumentsResult {
  return {
    files,
    documentIds: Array.from(new Set(files.flatMap((file) => file.documentId ? [file.documentId] : []))),
    paths: files.map((file) => file.path),
  };
}

export function refreshStageCollection(
  root: string,
  args: RuntimeArgs,
  levels: RefreshLevel[],
  stages: ApprovalStage[],
  technicalMachineFiles: ReviewFile[] = [],
): RefreshStageCollection {
  const cursor = approvalStageCursor(root, args, "refresh", stages);
  const activeLevels = cursor.activeStage?.id === "technical"
    ? levels.filter((level) => TECHNICAL_LEVELS.has(level))
    : levels.filter((level) => (
      (cursor.activeStage?.id === "product" && level === "product")
      || (cursor.activeStage?.id === "product_guidelines" && level === "product-guidelines")
      || (cursor.activeStage?.id === "workflow" && level === "workflow")
      || (cursor.activeStage?.id === "patterns" && level === "patterns")
    ));
  const missingEvidence = missingRefreshEvidence(args, activeLevels);
  const current = activeLevels.length > 0 && missingEvidence.length === 0
    ? refreshReviewFiles(root, args, activeLevels)
    : { files: [], documentIds: [], paths: [] };
  const currentFiles = cursor.activeStage?.id === "technical" && missingEvidence.length === 0
    ? [...current.files, ...technicalMachineFiles]
    : current.files;
  return {
    cursor,
    activeLevels,
    missingEvidence,
    ...documentsFromFiles(scopedApprovalReviewFiles(cursor, currentFiles)),
  };
}
