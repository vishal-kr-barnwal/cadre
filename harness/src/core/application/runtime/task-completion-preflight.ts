import { asOptionalString } from "../../../guards";
import type { JsonObject } from "../../../types";

import { beginTrace, traceFingerprint } from "./commit-trace";
import type { CoreResult } from "./contracts";
import type { TaskChangeSet } from "./task-change-set";

export function recordedTaskSha(task: { commit_shas?: string[] }): string {
  return task.commit_shas?.[task.commit_shas.length - 1] || "";
}

export function productStatusError(
  snapshot: ReturnType<typeof beginTrace>,
  workingRoot: JsonObject,
): CoreResult | null {
  if (snapshot.ok && !snapshot.skipped) return null;
  return {
    ok: false,
    stage: "product_git_status",
    blocked: true,
    working_root: workingRoot,
    reason: snapshot.reason || "Cadre could not inspect product Git status safely.",
  };
}

export function changeSetBlock(changeSet: TaskChangeSet, workingRoot: JsonObject): CoreResult {
  const reason = changeSet.errors[0]
    || (changeSet.unclaimed_files.length > 0
      ? `Dirty files are outside the task and completed-dependency claims: ${changeSet.unclaimed_files.join(", ")}`
      : changeSet.unmatched_evidence.length > 0
        ? `filesChanged contains paths that are not dirty: ${changeSet.unmatched_evidence.join(", ")}`
        : `filesChanged omitted dirty paths: ${changeSet.missing_evidence.join(", ")}`);
  return {
    ok: false,
    stage: "product_change_set",
    blocked: true,
    working_root: workingRoot,
    change_set: changeSet as unknown as JsonObject,
    reason,
  };
}

export function reconciliationFingerprintError(
  snapshot: ReturnType<typeof beginTrace>,
  files: string[],
  expectedFingerprint: string,
  workingRoot: JsonObject,
  duringChecks = false,
): CoreResult | null {
  const fingerprint = traceFingerprint(snapshot, files);
  if (expectedFingerprint && fingerprint.ok !== false && fingerprint.fingerprint === expectedFingerprint) return null;
  return {
    ok: false,
    stage: "implementation_baseline",
    blocked: true,
    working_root: workingRoot,
    expected_fingerprint: expectedFingerprint || null,
    actual_fingerprint: asOptionalString(fingerprint.fingerprint) || null,
    fingerprint,
    reason: !expectedFingerprint
      ? "A typed reconciliation packet with changeSetFingerprint is required."
      : duringChecks
        ? "The partial task change set changed while Cadre ran completion checks."
        : "The partial task change set changed after Cadre created its reconciliation packet.",
  };
}

export function implementationHeadError(
  expectedHead: string,
  actualHead: string,
  allowCompletedReplay: boolean,
  workingRoot: JsonObject,
  duringChecks = false,
): CoreResult | null {
  if (!expectedHead || expectedHead === actualHead || allowCompletedReplay) return null;
  return {
    ok: false,
    stage: "implementation_baseline",
    blocked: true,
    working_root: workingRoot,
    expected_head: expectedHead,
    actual_head: actualHead || null,
    reason: duringChecks
      ? "Git HEAD changed while Cadre ran completion checks; task state was not mutated."
      : "The implementation worktree HEAD changed after dispatch; Cadre will not attribute or commit this change set automatically.",
  };
}

export function completedDirtyReconciliationError(
  completed: boolean,
  dirtyFiles: string[],
  reconcileCommit: boolean,
  workingRoot: JsonObject,
  duringChecks = false,
): CoreResult | null {
  if (!completed || dirtyFiles.length === 0 || reconcileCommit) return null;
  return {
    ok: false,
    stage: "task_reconciliation",
    blocked: true,
    working_root: workingRoot,
    dirty_files: dirtyFiles,
    reason: duringChecks
      ? "Completion checks produced changes for an already-completed task; a typed reconciliation packet is required."
      : "This completed task still has product changes; rerun Cadre implement and use its typed reconciliation packet.",
  };
}
