import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";

import { coverageThreshold, runCoverage } from "../../infrastructure/runtime/coverage";
import { utcNow } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { beginTrace, commitTrace, traceDirtyFiles, traceFingerprint, traceNonIgnoredFiles } from "./commit-trace";
import type { CoreResult, CoverageResult } from "./contracts";
import { completionJournalIntegrity, prepareManualVerificationCompletion } from "./manual-verification";
import { manualVerificationPostflight } from "./manual-verification-postflight";
import { isManualVerificationTaskObject } from "./plan-docs";
import { worktreePlan } from "./planning";
import { isWorkingRootError, resolveTaskWorkingRoot } from "./repo-resolution";
import { findTrack } from "./track-context";
import { resolveTaskChangeSet } from "./task-change-set";
import { changeSetBlock, completedDirtyReconciliationError, implementationHeadError, productStatusError, reconciliationFingerprintError, recordedTaskSha } from "./task-completion-preflight";
import { completionIntentKey, completionStateRecovery, markCompletionProductCommitted, prepareCompletionIntent, prepareCompletionStateIntent, recordCompletionState } from "./task-completion-state";
import { runTaskCompletionLocked } from "./task-completion-lock";
import { traceResultFingerprint } from "./git-change-fingerprint";
import { markCompletionProductIntegrityFailed, productCommitIntegrity, taskProductCommitFailure } from "./product-commit-integrity";
import { parsePlanFile } from "./track-schedule";

export function completeTask(root: string, args: RuntimeArgs = {}): CoreResult {
  return runTaskCompletionLocked(root, args, () => completeTaskInner(root, { ...args, skipSync: true, lock: false }));
}

export function completeTaskInner(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const journalIntegrity = completionJournalIntegrity(track);
  if (journalIntegrity.ok === false) return journalIntegrity;
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const plan = parsePlanFile(track.plan_path);
  if (plan.ok === false) {
    return {
      ok: false,
      stage: "plan_graph",
      blocked: true,
      errors: plan.errors,
      reason: plan.errors[0] || "Canonical plan graph is invalid",
    };
  }
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };
  const workingRoot = resolveTaskWorkingRoot(root, track, task, args);
  if (isWorkingRootError(workingRoot)) {
    return {
      ok: false,
      stage: "polyrepo_repo_resolution",
      blocked: true,
      working_root: workingRoot,
      reason: workingRoot.error,
    };
  }
  if (workingRoot.source !== "argument.workingRoot" && workingRoot.source !== "branch-set.integration_worktree" && workingRoot.branch_set) {
    const branchSet = workingRoot.branch_set;
    return {
      ok: false,
      stage: "worktree_setup",
      blocked: true,
      working_root: workingRoot,
      branch_set: branchSet,
      reason: branchSet.exists
        ? `Integration worktree for ${branchSet.repo} is ${branchSet.health}; complete_task requires the expected track branch or an explicit worker root`
        : `Integration worktree for ${branchSet.repo} is missing; run worktree_plan with execute before complete_task or pass an explicit worker root`,
      worktree_plan: worktreePlan(root, { trackId: track.track_id, repo: branchSet.repo }),
    };
  }
  const initialProductStatus = beginTrace(workingRoot.path);
  const initialStatusError = productStatusError(initialProductStatus, workingRoot as unknown as JsonObject);
  if (initialStatusError) return initialStatusError;
  const controlRootWorktree = path.resolve(workingRoot.path) === path.resolve(root);
  const dirtyFilesFor = (snapshot: ReturnType<typeof beginTrace>): string[] => controlRootWorktree
    ? traceDirtyFiles(snapshot, "product")
    : traceNonIgnoredFiles(snapshot);
  const initialDirtyFiles = dirtyFilesFor(initialProductStatus);
  const manualVerificationTask = isManualVerificationTaskObject(task);
  const baselineSha = asOptionalString(args.baselineSha || args.baseline_sha) || "";
  const currentHead = asOptionalString(initialProductStatus.head_sha) || "";
  const priorTaskSha = recordedTaskSha(task);
  const defaultIntentKey = completionIntentKey(phaseIndex, taskIndex, workingRoot.repo);
  const requestedIntentKey = asOptionalString(args.completionJournalKey || args.completion_journal_key) || defaultIntentKey;
  const stateRecovery = completionStateRecovery(
    track,
    requestedIntentKey,
    task,
    workingRoot,
    currentHead,
    initialDirtyFiles,
  );
  if (stateRecovery.ok === false) return stateRecovery;
  if ((args.stateRecovery === true || args.state_recovery === true) && stateRecovery.active !== true) {
    return {
      ok: false,
      stage: "completion_state_recovery",
      blocked: true,
      journal_key: requestedIntentKey,
      reason: "The requested completion journal no longer has an exact state-only recovery to apply.",
    };
  }
  if (stateRecovery.active === true) {
    const recoveryEntry = asJsonObject(stateRecovery.entry);
    const storedCoverage = asJsonObject(recoveryEntry.coverage);
    const recoveryStatus = asOptionalString(recoveryEntry.requested_status) || args.status;
    const recoveryCoverage: CoverageResult = {
      ...storedCoverage,
      ok: storedCoverage.ok !== false,
      available: storedCoverage.available === true,
      command: asOptionalString(storedCoverage.command) || null,
      coverage: typeof storedCoverage.coverage === "number" ? storedCoverage.coverage : null,
    };
    return recordCompletionState({
      root,
      args: { ...args, ...(recoveryStatus ? { status: recoveryStatus } : {}) },
      track,
      task,
      phaseIndex,
      taskIndex,
      workingRoot,
      coverage: recoveryCoverage,
      threshold: Number(recoveryEntry.threshold ?? coverageThreshold(root)),
      resolvedCommitSha: asOptionalString(stateRecovery.commit_sha) || "",
      productCommit: null,
      manualVerificationEvidence: Object.keys(asJsonObject(recoveryEntry.manual_verification_evidence)).length > 0
        ? asJsonObject(recoveryEntry.manual_verification_evidence)
        : null,
      lastTestRun: Object.keys(asJsonObject(recoveryEntry.last_test_run)).length > 0
        ? asJsonObject(recoveryEntry.last_test_run)
        : null,
      controlBefore: beginTrace(root),
      intentKey: requestedIntentKey,
      expectedProductHead: currentHead,
    });
  }
  const cleanCompletedReplay = task.marker === "x"
    && initialDirtyFiles.length === 0
    && priorTaskSha.length >= 7
    && currentHead.startsWith(priorTaskSha);
  const initialHeadError = implementationHeadError(
    baselineSha,
    currentHead,
    cleanCompletedReplay,
    workingRoot as unknown as JsonObject,
  );
  if (initialHeadError) return initialHeadError;
  const reconcileCommit = args.reconcileCommit === true || args.reconcile_commit === true;
  const expectedFingerprint = asOptionalString(args.changeSetFingerprint || args.change_set_fingerprint) || "";
  if (reconcileCommit && task.marker !== "x") {
    return {
      ok: false,
      stage: "task_reconciliation",
      blocked: true,
      working_root: workingRoot,
      reason: "reconcileCommit is valid only for a task already recorded as completed.",
    };
  }
  if (reconcileCommit) {
    const fingerprintError = reconciliationFingerprintError(
      initialProductStatus,
      initialDirtyFiles,
      expectedFingerprint,
      workingRoot as unknown as JsonObject,
    );
    if (fingerprintError) return fingerprintError;
  }
  const initialCompletedDirtyError = completedDirtyReconciliationError(
    task.marker === "x", initialDirtyFiles, reconcileCommit, workingRoot as unknown as JsonObject,
  );
  if (initialCompletedDirtyError) return initialCompletedDirtyError;
  if (task.marker === "x" && initialDirtyFiles.length > 0) {
    if (!priorTaskSha || !currentHead.startsWith(priorTaskSha)) {
      return {
        ok: false,
        stage: "task_reconciliation",
        blocked: true,
        working_root: workingRoot,
        recorded_task_sha: priorTaskSha || null,
        actual_head: currentHead || null,
        reason: "The completed task's recorded commit does not match worktree HEAD; reconciliation ownership is not provable.",
      };
    }
  }
  if (manualVerificationTask && initialDirtyFiles.length > 0) {
    return {
      ok: false,
      stage: "manual_verification_worktree",
      blocked: true,
      working_root: workingRoot,
      dirty_files: initialDirtyFiles,
      reason: "Manual verification cannot begin while product changes remain uncommitted.",
    };
  }
  const evidenceFiles = asStringArray(args.filesChanged || args.files_changed || args.files);
  const defaultRepo = asOptionalString(loadTopology(root).defaultRepo) || null;
  const includeDependencyClaims = Boolean(
    (args.dispatchClean === true && baselineSha && currentHead === baselineSha)
    || (reconcileCommit && priorTaskSha && currentHead.startsWith(priorTaskSha)),
  );
  if (!manualVerificationTask && !args.commitSha) {
    const preflightChangeSet = resolveTaskChangeSet(plan, task, initialDirtyFiles, workingRoot.repo, {
      includeDependencyClaims,
      evidence: evidenceFiles,
      defaultRepo,
    });
    if (!preflightChangeSet.ok) return changeSetBlock(preflightChangeSet, workingRoot as unknown as JsonObject);
    if (args.allowNoCommit === true && initialDirtyFiles.length > 0) {
      return {
        ok: false,
        stage: "product_commit",
        blocked: true,
        working_root: workingRoot,
        change_set: preflightChangeSet as unknown as JsonObject,
        reason: "allowNoCommit is valid only when the product worktree is clean.",
      };
    }
  } else if (args.commitSha && initialDirtyFiles.length > 0) {
    return {
      ok: false,
      stage: "product_commit",
      blocked: true,
      working_root: workingRoot,
      dirty_files: initialDirtyFiles,
      reason: "commitSha can be recorded only when the product worktree is clean.",
    };
  }
  const manualVerificationCompletion = manualVerificationTask
    ? prepareManualVerificationCompletion(root, track, task, args, workingRoot)
    : null;
  if (manualVerificationTask) {
    const manualPostflight = manualVerificationPostflight(workingRoot, currentHead, controlRootWorktree, manualVerificationCompletion);
    if (manualPostflight) return manualPostflight;
  }
  if (manualVerificationCompletion && manualVerificationCompletion.ok === false) return manualVerificationCompletion;
  const manualVerificationEvidence = manualVerificationCompletion && isRecord(manualVerificationCompletion.evidence)
    ? asJsonObject(manualVerificationCompletion.evidence)
    : null;
  const coverage: CoverageResult = manualVerificationTask
    ? {
        ok: true,
        available: false,
        command: null,
        coverage: null,
        reason: "Manual verification task uses structured human-approved evidence instead of coverage.",
      }
    : runCoverage(root, args, workingRoot.path);
  const threshold = Number(args.coverageThreshold ?? coverageThreshold(root));
  const allowMissingCoverage = args.allowMissingCoverage === true;
  const allowLowCoverage = args.allowLowCoverage === true;
  if (!manualVerificationTask && !coverage.available && !allowMissingCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: coverage.reason || "Coverage command unavailable",
    };
  }
  if (!manualVerificationTask && coverage.available && !coverage.ok) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: "Coverage/test command failed; task was not marked complete",
    };
  }
  if (!manualVerificationTask && coverage.available && typeof coverage.coverage === "number" && coverage.coverage < threshold && !allowLowCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: `Coverage ${coverage.coverage}% is below required ${threshold}%; task was not marked complete`,
    };
  }
  const lastTestRun = manualVerificationTask ? null : {
    command: coverage.command,
    cwd: coverage.cwd || workingRoot.path,
    ok: coverage.available ? coverage.ok : null,
    status: coverage.available ? coverage.status : null,
    signal: coverage.available ? coverage.signal : null,
    coverage: coverage.coverage,
    threshold,
    measured_at: utcNow(),
    allow_missing_coverage: allowMissingCoverage,
    allow_low_coverage: allowLowCoverage,
  };
  let resolvedCommitSha = args.commitSha ? String(args.commitSha).trim() : "";
  let productCommit: CoreResult | null = null;
  let intentJournalKey: string | null = null;
  let stateControlBefore: ReturnType<typeof beginTrace> | null = null;
  let validatedProductHead = currentHead;
  if (!manualVerificationTask) {
    const productBefore = beginTrace(workingRoot.path);
    const productStatusFailure = productStatusError(productBefore, workingRoot as unknown as JsonObject);
    if (productStatusFailure) return productStatusFailure;
    const productDirtyFiles = dirtyFilesFor(productBefore);
    const afterCoverageHead = asOptionalString(productBefore.head_sha) || "";
    validatedProductHead = afterCoverageHead;
    const afterCoverageHeadError = implementationHeadError(
      baselineSha,
      afterCoverageHead,
      cleanCompletedReplay,
      workingRoot as unknown as JsonObject,
      true,
    );
    if (afterCoverageHeadError) return afterCoverageHeadError;
    const afterCoverageDirtyError = completedDirtyReconciliationError(
      task.marker === "x", productDirtyFiles, reconcileCommit, workingRoot as unknown as JsonObject, true,
    );
    if (afterCoverageDirtyError) return afterCoverageDirtyError;
    if (reconcileCommit) {
      const fingerprintError = reconciliationFingerprintError(
        productBefore,
        productDirtyFiles,
        expectedFingerprint,
        workingRoot as unknown as JsonObject,
        true,
      );
      if (fingerprintError) return fingerprintError;
    }
    if (resolvedCommitSha || args.allowNoCommit === true) {
      if (productDirtyFiles.length > 0) {
        return {
          ok: false,
          stage: "product_commit",
          blocked: true,
          working_root: workingRoot,
          dirty_files: productDirtyFiles,
          reason: resolvedCommitSha
            ? "commitSha can be recorded only when the product worktree is clean."
            : "allowNoCommit is valid only when the product worktree is clean.",
        };
      }
    } else if (productDirtyFiles.length > 0) {
      const productChangeSet = resolveTaskChangeSet(plan, task, productDirtyFiles, workingRoot.repo, {
        includeDependencyClaims,
        evidence: evidenceFiles,
        defaultRepo,
      });
      if (!productChangeSet.ok) return changeSetBlock(productChangeSet, workingRoot as unknown as JsonObject);
      const productFingerprint = traceFingerprint(productBefore, productDirtyFiles);
      if (productFingerprint.ok === false) return { ...productFingerprint, working_root: workingRoot };
      const currentFingerprint = asOptionalString(productFingerprint.fingerprint) || "";
      const productResultFingerprint = traceResultFingerprint(workingRoot.path, productDirtyFiles);
      if (productResultFingerprint.ok === false) return { ...productResultFingerprint, working_root: workingRoot };
      stateControlBefore = beginTrace(root);
      intentJournalKey = defaultIntentKey;
      prepareCompletionIntent({
        track,
        key: intentJournalKey,
        task,
        workingRoot,
        baselineSha: afterCoverageHead,
        dirtyFiles: productDirtyFiles,
        fingerprint: currentFingerprint,
        resultFingerprint: asOptionalString(productResultFingerprint.fingerprint) || "",
        coverage,
        lastTestRun: lastTestRun as JsonObject,
        threshold,
        status: args.status || "completed",
      });
      productCommit = commitTrace(root, args, {
        kind: "product",
        workflow: "complete_task",
        subject: task.title.replace(/^Task\s+\d+:\s*/i, ""),
        scope: asOptionalString(workingRoot.repo) && workingRoot.repo !== "." ? asOptionalString(workingRoot.repo) || "task" : "task",
        cwd: workingRoot.path,
        before: productBefore,
        resolvedFiles: productChangeSet.authorized_files,
        expectedFingerprint: currentFingerprint,
        expectedResultFingerprint: asOptionalString(productResultFingerprint.fingerprint) || "",
        expectedParentSha: afterCoverageHead,
        expectedDirtyFiles: productDirtyFiles,
        expectedDirtyKind: controlRootWorktree ? "product" : "nonignored",
        allowDirty: true,
        trackId: track.track_id,
        taskKey: task.task_key,
        repo: workingRoot.repo,
        note: {
          phase_index: phaseIndex,
          task_index: taskIndex,
          task_key: task.task_key,
          dependency_task_keys: productChangeSet.dependency_task_keys,
          reconciled: reconcileCommit,
          coverage: coverage.coverage ?? null,
        },
      });
      if (productCommit.ok === false) return taskProductCommitFailure(productCommit, workingRoot);
      resolvedCommitSha = asOptionalString(productCommit.commit_sha) || "";
      if (resolvedCommitSha) validatedProductHead = resolvedCommitSha;
      if (resolvedCommitSha) {
        const commitIntegrity = productCommitIntegrity(
          workingRoot.path,
          resolvedCommitSha,
          afterCoverageHead,
          productDirtyFiles,
          asOptionalString(productResultFingerprint.fingerprint) || "",
        );
        if (commitIntegrity.ok === false) {
          markCompletionProductIntegrityFailed(
            track,
            intentJournalKey,
            resolvedCommitSha,
            productDirtyFiles,
            asStringArray(commitIntegrity.actual_files),
            asOptionalString(commitIntegrity.reason) || "Product commit integrity failed",
          );
          return {
            ...commitIntegrity,
            ok: false,
            stage: "product_commit_integrity",
            blocked: true,
            recovery_required: true,
            manual_recovery_required: true,
            product_commit: productCommit,
          };
        }
        markCompletionProductCommitted(track, intentJournalKey, resolvedCommitSha, productChangeSet.authorized_files);
      }
      const afterCommit = beginTrace(workingRoot.path);
      const afterCommitError = productStatusError(afterCommit, workingRoot as unknown as JsonObject);
      if (afterCommitError) return { ...afterCommitError, product_commit: productCommit };
      const residual = dirtyFilesFor(afterCommit);
      const afterCommitHeadError = resolvedCommitSha
        ? implementationHeadError(resolvedCommitSha, asOptionalString(afterCommit.head_sha) || "", false, workingRoot as unknown as JsonObject, true)
        : null;
      if (afterCommitHeadError) {
        markCompletionProductIntegrityFailed(track, intentJournalKey, resolvedCommitSha, productDirtyFiles, [], asOptionalString(afterCommitHeadError.reason) || "Product HEAD changed after commit validation");
        return { ...afterCommitHeadError, stage: "product_commit_integrity", recovery_required: true, manual_recovery_required: true, product_commit: productCommit };
      }
      if (residual.length > 0 || !resolvedCommitSha) {
        return {
          ok: false,
          stage: "product_commit_residual",
          blocked: true,
          recovery_required: Boolean(resolvedCommitSha),
          working_root: workingRoot,
          product_commit: productCommit,
          residual_files: residual,
          reason: residual.length > 0
            ? "Cadre did not record task completion because product changes remain after the commit."
            : "Cadre could not create the required product commit; task state was not mutated.",
        };
      }
    } else if (cleanCompletedReplay) {
      resolvedCommitSha = priorTaskSha;
    } else {
      return {
        ok: false,
        stage: "product_commit",
        blocked: true,
        working_root: workingRoot,
        reason: "No product changes or commitSha were provided; pass allowNoCommit only for an intentionally no-op task.",
      };
    }
  }
  if (!intentJournalKey) {
    stateControlBefore = stateControlBefore || beginTrace(root);
    intentJournalKey = defaultIntentKey;
    prepareCompletionStateIntent({
      track,
      key: intentJournalKey,
      task,
      workingRoot,
      baselineSha: asOptionalString(beginTrace(workingRoot.path).head_sha) || currentHead,
      commitSha: resolvedCommitSha,
      coverage,
      lastTestRun,
      manualVerificationEvidence,
      threshold,
      status: args.status || "completed",
    });
  }
  return recordCompletionState({
    root,
    args,
    track,
    task,
    phaseIndex,
    taskIndex,
    workingRoot,
    coverage,
    threshold,
    resolvedCommitSha,
    productCommit,
    manualVerificationEvidence,
    lastTestRun,
    controlBefore: stateControlBefore || beginTrace(root),
    intentKey: intentJournalKey,
    expectedProductHead: validatedProductHead,
  });
}
