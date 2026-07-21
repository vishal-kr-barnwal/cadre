import path from "node:path";

import { asJsonArray, asJsonObject, asOptionalString } from "../../../guards";
import type { CadreTrack, JsonObject, ParsedPlan, PlanTask } from "../../../types";

import { coverageThreshold } from "../../infrastructure/runtime/coverage";
import { configuredCoverageCommand, loadTopology } from "../../infrastructure/runtime/project-config";
import { beginTrace, traceFingerprint, traceNonIgnoredFiles } from "./commit-trace";
import type { CoreResult, WorkingRoot } from "./contracts";
import { implementationDispatchMatches } from "./implementation-dispatch";
import { isManualVerificationTaskObject } from "./plan-docs";
import { completionJournalIntegrity } from "./manual-verification";
import { findTrack } from "./track-context";
import { recoveryTaskForDirtyPlan, resolveTaskChangeSet } from "./task-change-set";
import { activeCompletionIntents, completionStateRecovery } from "./task-completion-state";
import { parsePlanFile } from "./track-schedule";

interface WorktreeScan {
  repo: string;
  working_root: string;
  head_sha: string;
  dirty_files: string[];
  fingerprint: string;
}

function canonicalRepo(value: unknown): string {
  const repo = asOptionalString(value) || "root";
  return repo === "." ? "root" : repo;
}

function taskRepo(task: PlanTask | null, defaultRepo: string | null): string {
  return canonicalRepo(task?.repo || defaultRepo);
}

function scanWorktrees(rawPlan: unknown): { scans: WorktreeScan[]; error?: CoreResult } {
  const scans: WorktreeScan[] = [];
  for (const rawEntry of asJsonArray(asJsonObject(rawPlan).branch_set)) {
    const entry = asJsonObject(rawEntry);
    if (entry.affected === false || entry.exists !== true || entry.health !== "ready") continue;
    const workingRoot = asOptionalString(entry.integration_worktree);
    if (!workingRoot) continue;
    const snapshot = beginTrace(workingRoot);
    if (!snapshot.ok || snapshot.skipped) {
      return {
        scans,
        error: {
          ok: false,
          stage: "product_git_status",
          error: snapshot.reason || `Unable to inspect Git status for ${workingRoot}`,
          working_root: workingRoot,
        },
      };
    }
    const dirtyFiles = traceNonIgnoredFiles(snapshot);
    const fingerprint = traceFingerprint(snapshot, dirtyFiles);
    if (fingerprint.ok === false) {
      return { scans, error: { ...fingerprint, working_root: workingRoot } };
    }
    scans.push({
      repo: canonicalRepo(entry.repo),
      working_root: workingRoot,
      head_sha: asOptionalString(snapshot.head_sha) || "",
      dirty_files: dirtyFiles,
      fingerprint: asOptionalString(fingerprint.fingerprint) || "",
    });
  }
  return { scans };
}

function actionCall(root: string, input: JsonObject): JsonObject {
  return {
    tool: "cadre_action",
    arguments: { root, action: "task.complete", input, execute: true },
  };
}

function stateRecoveryGate(root: string, track: CadreTrack, plan: ParsedPlan, scans: WorktreeScan[]): CoreResult | null {
  const intents = activeCompletionIntents(track);
  if (intents.length === 0) return null;
  const ready: Array<{ key: string; task: PlanTask; scan: WorktreeScan; recovery: CoreResult }> = [];
  for (const intent of intents) {
    const task = plan.tasks.find((candidate) => (
      candidate.task_key === asOptionalString(intent.entry.task_key)
      && candidate.phase_index === Number(intent.entry.phase_index)
      && candidate.task_index === Number(intent.entry.task_index)
    ));
    const workingRoot = asOptionalString(intent.entry.working_root);
    const scan = scans.find((candidate) => (
      candidate.repo === canonicalRepo(intent.entry.repo)
      && workingRoot
      && path.resolve(candidate.working_root) === path.resolve(workingRoot)
    ));
    if (!task || !scan) {
      return {
        ok: false,
        clean: false,
        stage: "completion_state_recovery",
        blocked: true,
        journal_key: intent.key,
        error: "An active completion journal no longer maps to one canonical task integration worktree.",
      };
    }
    const recovery = completionStateRecovery(
      track,
      intent.key,
      task,
      { repo: scan.repo, path: scan.working_root, source: "completion_journal" } as WorkingRoot,
      scan.head_sha,
      scan.dirty_files,
      false,
    );
    if (recovery.ok === false) return { ...recovery, clean: false, scans };
    if (recovery.active === true) ready.push({ key: intent.key, task, scan, recovery });
  }
  if (ready.length === 0) return null;
  if (ready.length > 1) {
    return {
      ok: false,
      clean: false,
      stage: "completion_state_recovery",
      blocked: true,
      journal_keys: ready.map((entry) => entry.key),
      error: "Multiple task completions require state-only recovery; Cadre will not choose one implicitly.",
    };
  }
  const selected = ready[0]!;
  const input: JsonObject = {
    trackId: track.track_id,
    phaseIndex: selected.task.phase_index,
    taskIndex: selected.task.task_index,
    workingRoot: selected.scan.working_root,
    stateRecovery: true,
    completionJournalKey: selected.key,
  };
  return {
    ok: true,
    clean: false,
    state_recovery_ready: true,
    scans,
    task: {
      task_key: selected.task.task_key,
      phase_index: selected.task.phase_index,
      task_index: selected.task.task_index,
      working_root: selected.scan.working_root,
      journal_key: selected.key,
      state_recovery_packet: actionCall(root, input),
    },
    next: actionCall(root, input),
  };
}

function reconciliationCoverageInput(
  root: string,
  track: CadreTrack,
  task: PlanTask,
  workingRoot: string,
): { ok: boolean; input: JsonObject; error?: string } {
  const lastTask = asJsonObject(track.metadata.last_task_result);
  const lastTest = asJsonObject(track.metadata.last_test_run);
  const matchesTask = asOptionalString(lastTask.task_key) === task.task_key;
  const command = (matchesTask ? asOptionalString(lastTest.command) : null)
    || configuredCoverageCommand(root, {}, workingRoot);
  const allowMissing = matchesTask && lastTest.allow_missing_coverage === true;
  if (!command && !allowMissing) {
    return {
      ok: false,
      input: {},
      error: "The partial task has no reusable coverage command or recorded allow-missing policy.",
    };
  }
  return {
    ok: true,
    input: {
      ...(command ? { command } : {}),
      coverageThreshold: matchesTask && typeof lastTest.threshold === "number"
        ? lastTest.threshold
        : coverageThreshold(root),
      allowMissingCoverage: allowMissing,
      allowLowCoverage: matchesTask && lastTest.allow_low_coverage === true,
    },
  };
}

export function implementationWorktreeGate(
  root: string,
  trackId: string,
  rawWorktreePlan: unknown,
  rawTargetTask: unknown,
  allowPendingContinuation = true,
): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, stage: "track", error: `Track not found: ${trackId}` };
  const journalIntegrity = completionJournalIntegrity(track);
  if (journalIntegrity.ok === false) return journalIntegrity;
  const plan = parsePlanFile(track.plan_path);
  if (!plan.ok) return { ok: false, stage: "plan_graph", errors: plan.errors, error: plan.errors[0] };
  const defaultRepo = asOptionalString(loadTopology(root).defaultRepo) || null;
  const scanned = scanWorktrees(rawWorktreePlan);
  if (scanned.error) return { ...scanned.error, scans: scanned.scans };
  const dirtyScans = scanned.scans.filter((scan) => scan.dirty_files.length > 0);
  const stateRecovery = stateRecoveryGate(root, track, plan, scanned.scans);
  if (stateRecovery) return stateRecovery;
  if (dirtyScans.length === 0) return { ok: true, clean: true, scans: scanned.scans };

  const targetKey = asOptionalString(asJsonObject(rawTargetTask).task_key);
  const targetTask = targetKey ? plan.tasks.find((task) => task.task_key === targetKey) || null : null;
  const continuable = allowPendingContinuation && targetTask && targetTask.marker !== "x" && !isManualVerificationTaskObject(targetTask)
    ? dirtyScans.filter((scan) => scan.repo === taskRepo(targetTask, defaultRepo)).map((scan) => {
        const dispatchClean = implementationDispatchMatches(
          track.dir,
          targetTask,
          scan.repo,
          scan.working_root,
          scan.head_sha,
        );
        return {
          scan,
          dispatchClean,
          changeSet: resolveTaskChangeSet(plan, targetTask, scan.dirty_files, scan.repo, {
            includeDependencyClaims: dispatchClean,
            evidence: [],
            defaultRepo,
          }),
        };
      })
    : [];
  if (
    continuable.length === dirtyScans.length
    && continuable.every((entry) => entry.changeSet.ok)
  ) {
    return {
      ok: true,
      clean: false,
      continuation: true,
      dispatch_clean: continuable.every((entry) => entry.dispatchClean),
      scans: scanned.scans,
      task_key: targetTask?.task_key || null,
      reason: continuable.every((entry) => entry.dispatchClean)
        ? "The persisted clean dispatch authorizes this pending task and its completed-dependency claims."
        : "The current pending task has only changes inside its own direct claims.",
    };
  }

  const recoveries = dirtyScans.map((scan) => ({
    scan,
    recovery: recoveryTaskForDirtyPlan(plan, scan.dirty_files, scan.repo, scan.head_sha, defaultRepo),
  }));
  const blocked = recoveries.find((entry) => !entry.recovery.ok);
  if (blocked) {
    return {
      ok: false,
      clean: false,
      stage: "implementation_worktree_dirty",
      blocked: true,
      scans: scanned.scans,
      recovery: blocked.recovery as unknown as JsonObject,
      error: blocked.recovery.reason || "The dirty implementation worktree cannot be attributed safely.",
    };
  }

  const selected = recoveries.sort((left, right) => left.scan.repo.localeCompare(right.scan.repo))[0]!;
  const task = selected.recovery.task!;
  const coverage = reconciliationCoverageInput(root, track, task, selected.scan.working_root);
  if (!coverage.ok) {
    return {
      ok: false,
      clean: false,
      stage: "reconciliation_coverage",
      blocked: true,
      scans: scanned.scans,
      error: coverage.error,
    };
  }
  const input: JsonObject = {
    trackId,
    phaseIndex: task.phase_index,
    taskIndex: task.task_index,
    workingRoot: selected.scan.working_root,
    baselineSha: selected.scan.head_sha,
    changeSetFingerprint: selected.scan.fingerprint,
    reconcileCommit: true,
    filesChanged: selected.scan.dirty_files,
    ...coverage.input,
  };
  return {
    ok: true,
    clean: false,
    reconciliation_ready: true,
    scans: scanned.scans,
    task: {
      task_key: task.task_key,
      phase_index: task.phase_index,
      task_index: task.task_index,
      working_root: selected.scan.working_root,
      dirty_files: selected.scan.dirty_files,
      change_set: selected.recovery.change_set as unknown as JsonObject,
      reconcile_packet: actionCall(root, input),
    },
    next: actionCall(root, input),
  };
}
