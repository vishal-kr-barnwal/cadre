import type { ParsedPlan, PlanTask } from "../../../types";

import { claimPathError, concreteGitPathError, normalizeClaimPath, resolveClaimsToPaths } from "./claim-paths";

export interface TaskChangeSet {
  ok: boolean;
  task_key: string;
  dirty_files: string[];
  declared_claims: string[];
  dependency_claims: string[];
  dependency_task_keys: string[];
  task_files: string[];
  dependency_files: string[];
  authorized_files: string[];
  unclaimed_files: string[];
  evidence_files: string[];
  unmatched_evidence: string[];
  missing_evidence: string[];
  errors: string[];
}

export interface TaskChangeSetOptions {
  includeDependencyClaims?: boolean;
  evidence?: string[];
  defaultRepo?: string | null;
}

export interface TaskRecoveryResolution {
  ok: boolean;
  task?: PlanTask;
  change_set?: TaskChangeSet;
  candidate_task_keys: string[];
  reason?: string;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function canonicalRepo(value: string | null | undefined, defaultRepo: string | null | undefined, fallback: string): string {
  const repo = String(value || defaultRepo || fallback || "root");
  return repo === "." ? "root" : repo;
}

function sameRepo(left: PlanTask, right: PlanTask, workingRepo: string, defaultRepo?: string | null): boolean {
  return canonicalRepo(left.repo, defaultRepo, workingRepo) === canonicalRepo(right.repo, defaultRepo, workingRepo);
}

function dependencyTasks(plan: ParsedPlan, task: PlanTask, workingRepo: string, defaultRepo?: string | null): PlanTask[] {
  const byKey = new Map((plan.tasks || []).map((candidate) => [candidate.task_key, candidate]));
  const found = new Map<string, PlanTask>();
  const visit = (key: string): void => {
    if (found.has(key)) return;
    const candidate = byKey.get(key);
    if (!candidate || candidate.marker !== "x" || !sameRepo(task, candidate, workingRepo, defaultRepo)) return;
    found.set(key, candidate);
    for (const dependency of candidate.depends || []) visit(dependency);
  };
  for (const dependency of task.depends || []) visit(dependency);
  return Array.from(found.values());
}

function normalizedClaims(values: string[]): { claims: string[]; errors: string[] } {
  const errors = values.flatMap((claim) => {
    const error = claimPathError(claim);
    return error ? [error] : [];
  });
  return {
    claims: errors.length > 0 ? [] : unique(values.map(normalizeClaimPath)),
    errors,
  };
}

function evidenceResolution(
  evidence: string[],
  dirty: string[],
): { files: string[]; unmatched: string[]; missing: string[]; errors: string[] } {
  if (evidence.length === 0) return { files: [], unmatched: [], missing: [], errors: [] };
  const errors = evidence.flatMap((file) => {
    const error = concreteGitPathError(file);
    if (error) return [error];
    return [];
  });
  const normalized = errors.length > 0 ? [] : unique(evidence);
  const files = normalized.filter((file) => dirty.includes(file));
  return {
    files,
    unmatched: normalized.filter((file) => !dirty.includes(file)),
    missing: dirty.filter((file) => !normalized.includes(file)),
    errors,
  };
}

export function resolveTaskChangeSet(
  plan: ParsedPlan,
  task: PlanTask,
  dirtyFiles: string[],
  workingRepo = ".",
  options: TaskChangeSetOptions = {},
): TaskChangeSet {
  const dirty = unique(dirtyFiles);
  const declared = normalizedClaims(task.files || []);
  const dependencies = options.includeDependencyClaims === true
    ? dependencyTasks(plan, task, workingRepo, options.defaultRepo)
    : [];
  const dependency = normalizedClaims(dependencies.flatMap((candidate) => candidate.files || []));
  const declaredClaims = declared.claims;
  const dependencyClaims = dependency.claims;
  const taskResolution = resolveClaimsToPaths(declaredClaims, dirty);
  const dependencyResolution = resolveClaimsToPaths(dependencyClaims, dirty);
  const authorized = unique([...taskResolution.files, ...dependencyResolution.files]);
  const evidenceResult = evidenceResolution(options.evidence || [], dirty);
  const errors = unique([
    ...declared.errors,
    ...dependency.errors,
    ...taskResolution.errors,
    ...dependencyResolution.errors,
    ...evidenceResult.errors,
  ]);
  const unclaimed = dirty.filter((file) => !authorized.includes(file));
  return {
    ok: errors.length === 0
      && unclaimed.length === 0
      && evidenceResult.unmatched.length === 0
      && evidenceResult.missing.length === 0,
    task_key: task.task_key,
    dirty_files: dirty,
    declared_claims: declaredClaims,
    dependency_claims: dependencyClaims,
    dependency_task_keys: dependencies.map((candidate) => candidate.task_key).sort(),
    task_files: taskResolution.files,
    dependency_files: dependencyResolution.files,
    authorized_files: authorized,
    unclaimed_files: unclaimed,
    evidence_files: evidenceResult.files,
    unmatched_evidence: evidenceResult.unmatched,
    missing_evidence: evidenceResult.missing,
    errors,
  };
}

export function recoveryTaskForDirtyPlan(
  plan: ParsedPlan,
  dirtyFiles: string[],
  workingRepo = ".",
  headSha = "",
  defaultRepo: string | null = null,
): TaskRecoveryResolution {
  if (dirtyFiles.length === 0) {
    return { ok: false, candidate_task_keys: [], reason: "The worktree is clean; no task reconciliation is required." };
  }
  if (!headSha) {
    return { ok: false, candidate_task_keys: [], reason: "Git HEAD is unavailable; Cadre cannot attribute the partial completion safely." };
  }
  const candidates = (plan.tasks || [])
    .filter((task) => task.marker === "x" && task.task_type !== "user_manual_verification")
    .filter((task) => canonicalRepo(task.repo, defaultRepo, workingRepo) === canonicalRepo(workingRepo, defaultRepo, workingRepo))
    .filter((task) => {
      const recorded = task.commit_shas?.[task.commit_shas.length - 1] || "";
      return recorded.length >= 7 && headSha.startsWith(recorded);
    });
  const candidateKeys = candidates.map((task) => task.task_key).sort();
  if (candidates.length !== 1) {
    return {
      ok: false,
      candidate_task_keys: candidateKeys,
      reason: candidates.length === 0
        ? "No completed task is tied to the current Git HEAD; refusing to guess which task owns the residual changes."
        : "Multiple completed tasks are tied to the current Git HEAD; task reconciliation is ambiguous.",
    };
  }
  const task = candidates[0]!;
  const changeSet = resolveTaskChangeSet(plan, task, dirtyFiles, workingRepo, {
    includeDependencyClaims: true,
    evidence: dirtyFiles,
    defaultRepo,
  });
  return changeSet.ok
    ? { ok: true, task, change_set: changeSet, candidate_task_keys: candidateKeys }
    : {
        ok: false,
        task,
        change_set: changeSet,
        candidate_task_keys: candidateKeys,
        reason: changeSet.errors[0]
          || (changeSet.unclaimed_files.length > 0
            ? `Residual changes are outside the completed task scope: ${changeSet.unclaimed_files.join(", ")}`
            : "Residual changes do not match the recorded task completion evidence."),
      };
}
