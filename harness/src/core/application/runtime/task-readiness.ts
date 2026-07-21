import type { ParsedPlan, PlanPhase, PlanTask } from "../../../types";

export function completedTaskKeys(
  plan: Pick<ParsedPlan, "tasks">,
  additional: Iterable<string> = [],
): Set<string> {
  return new Set([
    ...plan.tasks.filter((task) => ["x", "-"].includes(task.marker)).map((task) => task.task_key),
    ...additional,
  ]);
}

export function taskBlockedBy(task: PlanTask, completed: ReadonlySet<string>): string[] {
  return (task.depends || []).filter((dependency) => !completed.has(dependency));
}

export function taskIsReady(
  task: PlanTask,
  completed: ReadonlySet<string>,
  active: ReadonlySet<string> = new Set(),
): boolean {
  return !["x", "-", "!"].includes(task.marker)
    && !active.has(task.task_key)
    && taskBlockedBy(task, completed).length === 0;
}

/** Apply one canonical dependency rule to both sequential and parallel schedulers. */
export function readyTasksForPhase(
  phase: PlanPhase,
  completed: ReadonlySet<string>,
  active: ReadonlySet<string> = new Set(),
): PlanTask[] {
  if (phase.annotations.execution === "parallel") {
    return phase.tasks.filter((task) => taskIsReady(task, completed, active));
  }
  const firstOpen = phase.tasks.find((task) => !["x", "-"].includes(task.marker));
  return firstOpen && taskIsReady(firstOpen, completed, active) ? [firstOpen] : [];
}
