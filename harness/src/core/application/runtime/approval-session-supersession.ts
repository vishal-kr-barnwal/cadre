import fs from "node:fs";
import path from "node:path";

import { asOptionalString, errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { approvalRestoreBeforeFiles, approvalRestoreSnapshots, removeEmptyApprovalParents } from "./approval-session-ancillary";
import type { ApprovalSession } from "./approval-session-model";
import {
  reconcileApprovalSupersession,
  reconcileApprovalSupersessions,
  writeApprovalSupersessionJournal,
  type ApprovalSupersessionJournal,
} from "./approval-supersession-journal";
import {
  approvalHeadExpectation,
  approvalSessionStorageError,
  listApprovalSessions,
} from "./approval-session-store";
import { reconcileApprovalCancellations } from "./approval-cancellation-journal";
import type { CoreResult, ReviewFile } from "./contracts";
import {
  inspectReviewGitState,
  removeReviewIntentToAddAtomic,
  type ReviewHeadExpectation,
} from "./review-output";

function safeSessionTarget(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function fileContent(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function supersessionOrder(sessions: ApprovalSession[], activeSessionId: string): ApprovalSession[] {
  return [...sessions].sort((left, right) => {
    if (left.session_id === activeSessionId) return -1;
    if (right.session_id === activeSessionId) return 1;
    const leftHasPreview = left.preview_files.length > 0 ? 1 : 0;
    const rightHasPreview = right.preview_files.length > 0 ? 1 : 0;
    if (leftHasPreview !== rightHasPreview) return leftHasPreview - rightHasPreview;
    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  });
}

function materializedSessionPaths(session: ApprovalSession): Set<string> {
  return new Set(session.snapshot_files.filter((file) => file.missing !== true).map((file) => file.path));
}

function overlappingApprovalSessions(
  sessions: ApprovalSession[],
  activeSessionId: string,
  activeFiles: ReviewFile[],
): ApprovalSession[] {
  const paths = new Set(activeFiles.filter((file) => file.missing !== true).map((file) => file.path));
  const remaining = new Map(sessions.map((session) => [session.session_id, session]));
  const selected: ApprovalSession[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [sessionId, session] of remaining) {
      const sessionPaths = materializedSessionPaths(session);
      if (sessionId !== activeSessionId && !Array.from(sessionPaths).some((entry) => paths.has(entry))) continue;
      selected.push(session);
      remaining.delete(sessionId);
      for (const entry of sessionPaths) paths.add(entry);
      changed = true;
    }
  }
  return selected;
}

function transactionFailure(
  root: string,
  journal: ApprovalSupersessionJournal,
  stage: string,
  cause: unknown,
): CoreResult {
  const rollback = reconcileApprovalSupersession(root, journal.transaction_id, { lifecycleLocked: true });
  const rollbackError = rollback.ok ? null : rollback.error || "Approval supersession rollback failed";
  return {
    ok: false,
    stage,
    recovery_required: !rollback.ok && rollback.pending,
    error: [errorMessage(cause), rollbackError].filter(Boolean).join("; "),
  };
}

function cleanupResult(result: ReturnType<typeof reconcileApprovalSupersession>): Partial<Pick<CoreResult, "cleanup_pending" | "warning">> {
  if (!result.cleanup_pending) return {};
  return {
    cleanup_pending: true,
    warning: `Superseded approval tombstone cleanup is pending: ${result.error || "retry cleanup on the next workflow call"}`,
  };
}

export function supersedeUnapprovedApprovalSessions(
  root: string,
  workflow: string,
  activeSessionId: string,
  activeFiles: ReviewFile[],
): CoreResult {
  return withLock(root, "approval-target-lifecycle", () => {
    const priorRecovery = reconcileApprovalSupersessions(root, { lifecycleLocked: true });
    if (!priorRecovery.ok && priorRecovery.pending) {
      return {
        ok: false,
        stage: "approval_supersession_recovery",
        recovery_required: true,
        error: priorRecovery.error || "An interrupted approval supersession must be reconciled before starting another review session",
      };
    }
    const cancellationRecovery = reconcileApprovalCancellations(root, { lifecycleLocked: true });
    if (!cancellationRecovery.ok && cancellationRecovery.pending) {
      return {
        ok: false,
        stage: "approval_cancellation_recovery",
        recovery_required: true,
        error: cancellationRecovery.error || "An interrupted approval cancellation must be reconciled before starting another review session",
      };
    }
    const storageError = approvalSessionStorageError(root);
    if (storageError) {
      return {
        ok: false,
        stage: "approval_session_recovery",
        recovery_required: true,
        error: storageError,
      };
    }
    const sessions = listApprovalSessions(root, { lifecycleLocked: true, includeRecoveryPending: true });
    const recoveryPending = sessions.filter((session) => (
      session.cancellation_recovery_required === true
      || session.supersession_recovery_required === true
      || session.reopen_recovery_required === true
      || session.materialization_recovery_required === true
    ));
    if (recoveryPending.length > 0) {
      return {
        ok: false,
        stage: "approval_session_recovery",
        recovery_required: true,
        error: "An interrupted approval transaction must be reconciled before starting or superseding another review session",
        session_ids: recoveryPending.map((session) => session.session_id),
      };
    }
    const active = sessions.find((session) => session.session_id === activeSessionId);
    if (active && active.preview_files.length > 0) {
      return { ok: true, skipped: true, reason: "active approval preview already exists" };
    }
    const candidates = overlappingApprovalSessions(sessions, activeSessionId, activeFiles)
      .filter((session) => session.session_id !== activeSessionId || session.preview_files.length === 0);
    if (candidates.length === 0) return { ok: true, skipped: true, reason: "no superseded approval previews" };
    const approved = candidates.filter((session) => session.approved_stages.length > 0);
    if (approved.length > 0) {
      return {
        ok: false,
        stage: "superseded_approval",
        error: "An approval for one or more overlapping review targets has reviewed stages and must be resumed or cancelled through Cadre before starting a new payload",
        session_ids: approved.map((session) => session.session_id),
        workflows: Array.from(new Set(approved.map((session) => session.workflow))),
      };
    }

    const ordered = supersessionOrder(candidates, activeSessionId);
    const virtual = new Map<string, string | null>();
    const targets = new Map<string, string>();
    const headExpectations = new Map<string, ReviewHeadExpectation>();
    for (const session of ordered) {
      const beforeByPath = new Map(approvalRestoreBeforeFiles(session).map((entry) => [entry.path, entry]));
      for (const snapshot of approvalRestoreSnapshots(session)) {
        if (snapshot.missing === true) continue;
        const before = beforeByPath.get(snapshot.path);
        const target = safeSessionTarget(root, snapshot.path);
        if (!before || !target) {
          return {
            ok: false,
            stage: "superseded_approval",
            error: `Superseded ${workflow} approval has an invalid restore record for ${snapshot.path}`,
            session_id: session.session_id,
          };
        }
        const beforeContent = before.existed ? before.content : null;
        headExpectations.set(snapshot.path, approvalHeadExpectation(before));
        const current = virtual.has(snapshot.path) ? virtual.get(snapshot.path)! : fileContent(target);
        if (current !== snapshot.content && current !== beforeContent) {
          return {
            ok: false,
            stage: "superseded_approval_drift",
            error: `Superseded ${session.workflow} review target changed after Cadre created it: ${snapshot.path}`,
            session_id: session.session_id,
            path: snapshot.path,
          };
        }
        targets.set(snapshot.path, target);
        virtual.set(snapshot.path, beforeContent);
      }
    }

    const gitState = inspectReviewGitState(root, Array.from(virtual.keys()), Array.from(headExpectations.values()));
    if (!gitState.ok) {
      const changed = [...gitState.stagedPaths, ...gitState.baselinePaths];
      const reason = gitState.error
        || (gitState.stagedPaths.length > 0
          ? `Superseded ${workflow} review target has staged Git content: ${gitState.stagedPaths.join(", ")}`
          : `Superseded ${workflow} review target was committed or changed in Git after Cadre created it: ${gitState.baselinePaths.join(", ")}`);
      return {
        ok: false,
        stage: "superseded_approval_git_drift",
        error: reason,
        paths: changed,
        staged_paths: gitState.stagedPaths,
        baseline_paths: gitState.baselinePaths,
      };
    }

    const stamp = `${process.pid}.${Date.now()}`;
    let journal: ApprovalSupersessionJournal = {
      version: 1,
      transaction_id: activeSessionId,
      state: "prepared",
      sessions: ordered.map((session, index) => ({
        session,
        quarantine_name: `${session.session_id}.json.${stamp}.${index}.superseding`,
      })),
      targets: Array.from(virtual, ([relativePath, before]) => ({
        path: relativePath,
        before,
        preview: fileContent(targets.get(relativePath)!),
      })),
      intent_to_add_paths: Array.from(new Set(ordered.flatMap((session) => session.intent_to_add_paths))),
    };
    try {
      writeApprovalSupersessionJournal(root, journal);
    } catch (error) {
      return { ok: false, stage: "superseded_approval_journal", error: errorMessage(error) };
    }
    try {
      for (const entry of journal.sessions) {
        const live = path.join(root, "cadre", "local", "approval-sessions", `${entry.session.session_id}.json`);
        const quarantine = path.join(path.dirname(live), entry.quarantine_name);
        fs.renameSync(live, quarantine);
      }
      journal = { ...journal, state: "quarantined" };
      writeApprovalSupersessionJournal(root, journal);
      journal = { ...journal, state: "restoring" };
      writeApprovalSupersessionJournal(root, journal);
      const intentRemoval = removeReviewIntentToAddAtomic(root, journal.intent_to_add_paths);
      if (!intentRemoval.ok) throw new Error(intentRemoval.error || "Unable to remove review intent-to-add entries");
      const restored = writeArtifactFilesAtomic(root, journal.targets.map((target) => ({
        path: target.path,
        content: target.before,
      })), { lock: false });
      if (!restored.ok) throw new Error(asOptionalString(restored.error) || "Unable to restore superseded approval targets");
      journal = { ...journal, state: "committed" };
      writeApprovalSupersessionJournal(root, journal);
      for (const target of journal.targets) {
        if (target.before === null) removeEmptyApprovalParents(root, targets.get(target.path)!);
      }
      const cleanup = reconcileApprovalSupersession(root, journal.transaction_id, { lifecycleLocked: true });
      return {
        ok: true,
        superseded: ordered.map((session) => session.session_id),
        restored: journal.targets.filter((target) => target.before !== null).map((target) => target.path),
        removed: journal.targets.filter((target) => target.before === null).map((target) => target.path),
        intent_to_add_removed: intentRemoval.paths,
        ...cleanupResult(cleanup),
      };
    } catch (error) {
      return transactionFailure(root, journal, "superseded_approval_transaction", error);
    }
  });
}
