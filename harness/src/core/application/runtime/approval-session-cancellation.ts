import fs from "node:fs";
import path from "node:path";

import { asOptionalString, errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import type { CoreResult } from "./contracts";
import { approvalRestoreBeforeFiles, approvalRestoreSnapshots, removeEmptyApprovalParents } from "./approval-session-ancillary";
import {
  removeApprovalCancellationJournal,
  writeApprovalCancellationJournal,
  type ApprovalCancellationJournal,
} from "./approval-cancellation-journal";
import { approvalHeadExpectation, readApprovalSessionResult } from "./approval-session-store";
import {
  inspectReviewGitState,
  removeReviewIntentToAddAtomic,
  restoreReviewIntentToAdd,
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

function restoreFile(file: string, content: string | null): void {
  if (content === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.cancel-tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function sessionPath(root: string, sessionId: string): string {
  return path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
}

export function cancelApprovalSession(root: string, sessionId: string, expectedWorkflow?: string): CoreResult {
  const initialRead = readApprovalSessionResult(root, sessionId);
  if (initialRead.recovery_required) {
    return {
      ok: false,
      cancelled: false,
      recovery_required: true,
      stage: "approval_cancel_recovery",
      error: initialRead.error || "Approval transaction recovery failed before cancellation",
    };
  }
  if (!initialRead.session) return { ok: false, cancelled: false, error: "Approval session was not found" };
  return withLock(root, "approval-target-lifecycle", () => {
    const sessionRead = readApprovalSessionResult(root, sessionId, { lifecycleLocked: true });
    if (sessionRead.recovery_required) {
      return {
        ok: false,
        cancelled: false,
        session_retained: true,
        recovery_required: true,
        stage: "approval_cancel_recovery",
        error: sessionRead.error || "Approval transaction recovery failed before cancellation",
      };
    }
    const session = sessionRead.session;
    if (!session) return { ok: false, cancelled: false, error: "Approval session was not found" };
    if (expectedWorkflow && session.workflow !== expectedWorkflow) {
      return { ok: false, cancelled: false, session_retained: true, error: `Approval session belongs to ${session.workflow}, not ${expectedWorkflow}` };
    }
    const outputMode = asOptionalString(session.payload.reviewOutputMode || session.payload.review_output_mode);
    const explicitBundleDirectory = asOptionalString(session.payload.reviewBundleDir || session.payload.review_bundle_dir || session.payload.reviewDir || session.payload.review_dir);
    const targetMode = !explicitBundleDirectory && !["bundle", "temp", "temporary"].includes(outputMode || "");
    const previewPaths = new Set((targetMode ? session.preview_files : [])
      .filter((file) => file.missing !== true)
      .map((file) => asOptionalString(file.path))
      .filter((file): file is string => Boolean(file)));
    const restoreSnapshots = approvalRestoreSnapshots(session);
    const beforeByPath = new Map(approvalRestoreBeforeFiles(session).map((before) => [before.path, before]));
    const nativeIgnore = restoreSnapshots.find((file) => file.path === "cadre/.gitignore" && file.missing !== true);
    const nativeIgnoreBefore = beforeByPath.get("cadre/.gitignore");
    const nativeIgnoreBaseline = nativeIgnoreBefore?.existed ? nativeIgnoreBefore.content : null;
    const nativeIgnoreCurrent = nativeIgnore ? fileContent(path.join(root, nativeIgnore.path)) : null;
    if (nativeIgnore && nativeIgnoreBefore && nativeIgnoreCurrent === nativeIgnore.content && nativeIgnoreCurrent !== nativeIgnoreBaseline) {
      previewPaths.add(nativeIgnore.path);
    }
    const restorePlan = new Map<string, { target: string; before: string | null; preview: string }>();
    const expectations: ReviewHeadExpectation[] = [];
    for (const snapshot of restoreSnapshots) {
      if (!previewPaths.has(snapshot.path) || snapshot.missing === true) continue;
      const before = beforeByPath.get(snapshot.path);
      const target = safeSessionTarget(root, snapshot.path);
      if (!before || !target) {
        return { ok: false, cancelled: false, session_retained: true, stage: "approval_cancel_restore", error: `Approval session has an invalid restore record for ${snapshot.path}` };
      }
      const current = fileContent(target);
      if (current !== snapshot.content) {
        return { ok: false, cancelled: false, session_retained: true, stage: "approval_cancel_drift", error: `Review target changed after Cadre created it: ${snapshot.path}`, path: snapshot.path };
      }
      restorePlan.set(snapshot.path, { target, before: before.existed ? before.content : null, preview: current });
      expectations.push(approvalHeadExpectation(before));
    }
    const gitState = inspectReviewGitState(root, Array.from(restorePlan.keys()), expectations);
    if (!gitState.ok) {
      return {
        ok: false,
        cancelled: false,
        session_retained: true,
        stage: "approval_cancel_git_drift",
        error: gitState.error || "A review target has staged or committed Git changes",
        staged_paths: gitState.stagedPaths,
        baseline_paths: gitState.baselinePaths,
      };
    }

    const liveSessionPath = sessionPath(root, sessionId);
    const quarantinedSessionPath = `${liveSessionPath}.${process.pid}.${Date.now()}.canceling`;
    const completedSessionPath = quarantinedSessionPath.replace(/\.canceling$/, ".cancelled");
    let journal: ApprovalCancellationJournal = {
      version: 1,
      session_id: sessionId,
      state: "prepared",
      session,
      targets: Array.from(restorePlan, ([relativePath, entry]) => ({
        path: relativePath,
        before: entry.before,
        preview: entry.preview,
      })),
      intent_to_add_paths: session.intent_to_add_paths,
      quarantine_name: path.basename(quarantinedSessionPath),
      completed_name: path.basename(completedSessionPath),
    };
    try {
      writeApprovalCancellationJournal(root, journal);
    } catch (error) {
      return { ok: false, cancelled: false, session_retained: true, stage: "approval_cancel_journal", error: errorMessage(error) };
    }
    try {
      fs.renameSync(liveSessionPath, quarantinedSessionPath);
    } catch (error) {
      let rollbackError: string | null = null;
      try {
        if (!fs.existsSync(liveSessionPath) && fs.existsSync(quarantinedSessionPath)) {
          fs.renameSync(quarantinedSessionPath, liveSessionPath);
        }
        removeApprovalCancellationJournal(root, sessionId);
      } catch (rollback) {
        rollbackError = errorMessage(rollback);
      }
      return {
        ok: false,
        cancelled: false,
        session_retained: fs.existsSync(liveSessionPath),
        recovery_required: Boolean(rollbackError),
        stage: "approval_cancel_session",
        error: [errorMessage(error), rollbackError].filter(Boolean).join("; "),
      };
    }
    const restoreSession = (): string | null => {
      try {
        if (fs.existsSync(quarantinedSessionPath)) fs.renameSync(quarantinedSessionPath, liveSessionPath);
        else if (fs.existsSync(completedSessionPath)) fs.renameSync(completedSessionPath, liveSessionPath);
        return null;
      } catch (error) {
        return `approval session rollback failed: ${errorMessage(error)}`;
      }
    };
    const rollbackCancellation = (intentPaths: string[]): string[] => {
      const errors: string[] = [];
      for (const { target, preview } of restorePlan.values()) {
        try { restoreFile(target, preview); } catch (error) { errors.push(errorMessage(error)); }
      }
      const indexRollback = restoreReviewIntentToAdd(root, intentPaths);
      if (!indexRollback.ok) errors.push(indexRollback.error || "Git intent-to-add rollback failed");
      const sessionRollback = restoreSession();
      if (sessionRollback) errors.push(sessionRollback);
      if (errors.length === 0) {
        try { removeApprovalCancellationJournal(root, sessionId); } catch (error) { errors.push(errorMessage(error)); }
      }
      return errors;
    };
    journal = { ...journal, state: "restoring" };
    try {
      writeApprovalCancellationJournal(root, journal);
    } catch (error) {
      const rollbackErrors = rollbackCancellation([]);
      return {
        ok: false,
        cancelled: false,
        session_retained: fs.existsSync(liveSessionPath),
        recovery_required: rollbackErrors.length > 0,
        stage: "approval_cancel_journal",
        error: [errorMessage(error), ...rollbackErrors].join("; "),
      };
    }
    const intentRemoval = removeReviewIntentToAddAtomic(root, session.intent_to_add_paths);
    if (!intentRemoval.ok) {
      const rollbackErrors = rollbackCancellation([]);
      return {
        ok: false,
        cancelled: false,
        session_retained: fs.existsSync(liveSessionPath),
        recovery_required: rollbackErrors.length > 0,
        stage: "approval_cancel_index",
        error: [intentRemoval.error, ...rollbackErrors].filter(Boolean).join("; "),
      };
    }
    try {
      for (const { target, before } of restorePlan.values()) restoreFile(target, before);
      for (const { target, before } of restorePlan.values()) if (before === null) removeEmptyApprovalParents(root, target);
    } catch (error) {
      const rollbackErrors = rollbackCancellation(intentRemoval.paths);
      return {
        ok: false,
        cancelled: false,
        session_retained: fs.existsSync(liveSessionPath),
        recovery_required: rollbackErrors.length > 0,
        stage: "approval_cancel_restore",
        error: [errorMessage(error), ...rollbackErrors].join("; "),
      };
    }
    journal = { ...journal, state: "restored" };
    try {
      writeApprovalCancellationJournal(root, journal);
    } catch (error) {
      const rollbackErrors = rollbackCancellation(intentRemoval.paths);
      return {
        ok: false,
        cancelled: false,
        session_retained: fs.existsSync(liveSessionPath),
        recovery_required: rollbackErrors.length > 0,
        stage: "approval_cancel_journal",
        error: [errorMessage(error), ...rollbackErrors].join("; "),
      };
    }
    let cleanupWarning: string | null = null;
    try {
      fs.renameSync(quarantinedSessionPath, completedSessionPath);
    } catch (error) {
      if (!fs.existsSync(completedSessionPath) || fs.existsSync(quarantinedSessionPath)) {
        cleanupWarning = `Cancelled session finalization is pending: ${errorMessage(error)}`;
      }
    }
    if (!cleanupWarning) {
      try {
        fs.rmSync(completedSessionPath, { force: true });
        removeApprovalCancellationJournal(root, sessionId);
      } catch (error) {
        cleanupWarning = `Cancelled session tombstone cleanup is pending: ${errorMessage(error)}`;
      }
    }
    return {
      ok: true,
      cancelled: true,
      session_id: sessionId,
      session_retained: false,
      cleanup_pending: Boolean(cleanupWarning),
      ...(cleanupWarning ? { warning: cleanupWarning } : {}),
      restored: Array.from(restorePlan.entries()).filter(([, entry]) => entry.before !== null).map(([relativePath]) => relativePath),
      removed: Array.from(restorePlan.entries()).filter(([, entry]) => entry.before === null).map(([relativePath]) => relativePath),
      intent_to_add_removed: intentRemoval.paths,
    };
  });
}
