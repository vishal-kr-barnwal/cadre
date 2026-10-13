import { isDeepStrictEqual } from "node:util";
import { parsePlanContent, validatePlanGraph, type PlanGraph } from "./plan.js";
import type { TrackState } from "./state.js";

/** Every review appends repairs; approval mode changes authority, never preservation rules. */
export function requireReviewPlan(before: string, after: string): void {
  const errors: string[] = [];
  const original = parsePlanContent(before, "review/original-plan.md", errors);
  const proposed = parsePlanContent(after, "review/proposed-plan.md", errors);
  validatePlanGraph("review/original-plan.md", original, "ready_for_review", errors);
  validatePlanGraph("review/proposed-plan.md", proposed, "in_progress", errors);
  if (errors.length) throw new Error(errors.join("; "));
  if (proposed.specRevision !== original.specRevision || proposed.planRevision !== original.planRevision! + 1
    || proposed.phases.length <= original.phases.length) throw new Error("Review must append remediation to the next plan revision without changing specification scope");
  const evidence = (graph: PlanGraph) => graph.phases.map(({line: _line, tasks, ...phase}) => ({...phase,
    tasks: tasks.map(({line: _taskLine, ...task}) => task)}));
  if (!isDeepStrictEqual(evidence(original), evidence(proposed).slice(0, original.phases.length))) {
    throw new Error("Review remediation must preserve every completed phase, task and commit marker");
  }
}

export function requireReviewState(previous: TrackState, proposed: TrackState): void {
  if (previous.status !== "ready_for_review" || previous.operation || proposed.status !== "in_progress" || proposed.operation) {
    throw new Error("Review remediation requires an idle ready_for_review baseline and in_progress result");
  }
  for (const field of ["trackId", "title", "type", "revision", "dependencies", "lastExecution", "approvalModeMigration"] as const) {
    if (!isDeepStrictEqual(previous[field], proposed[field])) throw new Error(`Review must preserve ${field}; scope changes require revision`);
  }
  if (previous.commits?.spec !== proposed.commits?.spec) throw new Error("Review must preserve approved specification authority");
  if (!isDeepStrictEqual(previous.artifactProgress, proposed.artifactProgress)) throw new Error("Review must preserve artifact progress evidence");
  const history = Array.isArray(previous.history) ? previous.history : [];
  const nextHistory = Array.isArray(proposed.history) ? proposed.history : [];
  if (nextHistory.length !== history.length + 1 || !isDeepStrictEqual(nextHistory.slice(0, -1), history)
    || (nextHistory.at(-1) as {action?: string})?.action !== "review") throw new Error("Review must append its history without replacing prior evidence");
  if (Boolean(previous.autonomousReview) !== Boolean(proposed.autonomousReview)) throw new Error("Review cannot add or remove Autonomous authority");
  const prior = previous.reviewCycles ?? [], cycles = proposed.reviewCycles ?? [], cycle = cycles.at(-1);
  if (cycles.length !== prior.length + 1 || !isDeepStrictEqual(cycles.slice(0, -1), prior)
    || cycle?.outcome !== "changes_requested" || cycle.executionId !== previous.lastExecution?.executionId
    || cycle.reviewedHead !== previous.lastExecution?.headCommit
    || cycle.planRevision !== previous.lastExecution?.planRevision || cycle.graphDigest !== previous.lastExecution?.graphDigest) {
    throw new Error("Review must append one changes-requested cycle bound to the retained completed execution");
  }
}
