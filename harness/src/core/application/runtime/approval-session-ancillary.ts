import fs from "node:fs";
import path from "node:path";

import { fileExists } from "../../infrastructure/runtime/json-store";
import type { ReviewFile } from "./contracts";
import { ensureNativeState } from "./native-state";
import type { ApprovalBeforeFile, ApprovalSession } from "./approval-session-model";
import { reviewHeadFiles } from "./review-output";

const NATIVE_IGNORE_PATH = "cadre/.gitignore";

export interface ApprovalSessionAncillaryState {
  snapshots: ReviewFile[];
  beforeFiles: ApprovalBeforeFile[];
}

function fileContent(file: string): string | null {
  return fileExists(file) ? fs.readFileSync(file, "utf8") : null;
}

export function initializeApprovalSessionAncillary(
  root: string,
  reviewFiles: ReviewFile[],
): ApprovalSessionAncillaryState {
  const target = path.join(root, NATIVE_IGNORE_PATH);
  const existed = fileExists(target);
  const beforeContent = fileContent(target);
  const head = reviewHeadFiles(root, [NATIVE_IGNORE_PATH]);
  const headFile = head.ok && head.available ? head.files[0] : null;
  ensureNativeState(root);
  const content = fileContent(target);
  if (reviewFiles.some((file) => file.path === NATIVE_IGNORE_PATH) || content === beforeContent || content === null) {
    return { snapshots: [], beforeFiles: [] };
  }
  return {
    snapshots: [{
      path: NATIVE_IGNORE_PATH,
      title: "Approval session local-state ignore",
      kind: "text",
      source: "approval:session-state",
      content,
      reviewRole: "machine",
    }],
    beforeFiles: [{
      path: NATIVE_IGNORE_PATH,
      existed,
      content: beforeContent,
      ...(headFile ? { head_existed: headFile.existed, head_content: headFile.content } : {}),
    }],
  };
}

export function approvalRestoreSnapshots(session: ApprovalSession): ReviewFile[] {
  const ancillary = session.ancillary_snapshot_files || [];
  const ancillaryPaths = new Set(ancillary.map((file) => file.path));
  return [
    ...session.snapshot_files.filter((file) => !ancillaryPaths.has(file.path)),
    ...ancillary,
  ];
}

export function approvalRestoreBeforeFiles(session: ApprovalSession): ApprovalBeforeFile[] {
  const ancillary = session.ancillary_before_files || [];
  const ancillaryPaths = new Set(ancillary.map((file) => file.path));
  return [
    ...session.before_files.filter((file) => !ancillaryPaths.has(file.path)),
    ...ancillary,
  ];
}

export function removeEmptyApprovalParents(root: string, target: string): void {
  const boundary = path.resolve(root);
  let current = path.dirname(path.resolve(target));
  while (current !== boundary && current.startsWith(`${boundary}${path.sep}`)) {
    try { fs.rmdirSync(current); } catch { break; }
    current = path.dirname(current);
  }
}
