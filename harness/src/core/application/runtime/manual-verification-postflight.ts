import { asJsonObject, isRecord } from "../../../guards";

import { beginTrace, traceDirtyFiles, traceNonIgnoredFiles } from "./commit-trace";
import type { CoreResult, WorkingRoot } from "./contracts";
import { implementationHeadError, productStatusError } from "./task-completion-preflight";

export function manualVerificationPostflight(
  workingRoot: WorkingRoot,
  expectedHead: string,
  controlRootWorktree: boolean,
  completion: CoreResult | null,
): CoreResult | null {
  const status = beginTrace(workingRoot.path);
  const statusError = productStatusError(status, workingRoot as unknown as ReturnType<typeof asJsonObject>);
  if (statusError) return statusError;
  const dirtyFiles = controlRootWorktree
    ? traceDirtyFiles(status, "product")
    : traceNonIgnoredFiles(status);
  if (dirtyFiles.length > 0) {
    return {
      ok: false,
      stage: "manual_verification_worktree",
      blocked: true,
      working_root: workingRoot,
      dirty_files: dirtyFiles,
      manual_verification: isRecord(completion?.manual_verification)
        ? asJsonObject(completion?.manual_verification)
        : isRecord(completion?.evidence)
          ? asJsonObject(completion?.evidence)
          : completion,
      reason: "The manual-verification command changed product files; verification must leave the worktree clean.",
    };
  }
  return implementationHeadError(
    expectedHead,
    typeof status.head_sha === "string" ? status.head_sha : "",
    false,
    workingRoot as unknown as ReturnType<typeof asJsonObject>,
    true,
  );
}
