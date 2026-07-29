import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export interface PlanTask {
  checked: boolean;
  id: string;
  phaseId: string;
  ordinal: number;
  title: string;
  commit: string | null;
  dependencies: string[];
  dependencyDeclared: boolean;
  manualVerification: boolean;
  line: number;
}

export interface PlanPhase {
  number: number;
  id: string;
  title: string;
  dependencies: string[];
  dependencyDeclared: boolean;
  tasks: PlanTask[];
  completionCommit: string | null | undefined;
  line: number;
  trackVerification: boolean;
}

export interface PlanGraph {
  specRevision: number | null;
  planRevision: number | null;
  phases: PlanPhase[];
  digest: string;
}

function dependencyList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "none") return [];
  return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function graphDigest(graph: Omit<PlanGraph, "digest">): string {
  const normalized = {
    specRevision: graph.specRevision,
    planRevision: graph.planRevision,
    phases: graph.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      dependencies: phase.dependencies,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        dependencies: task.dependencies,
        manualVerification: task.manualVerification
      }))
    }))
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function parsePlanContent(content: string, sourceLabel: string, errors: string[] = []): PlanGraph {
  const phases: PlanPhase[] = [];
  let specRevision: number | null = null;
  let planRevision: number | null = null;
  let currentTask: PlanTask | null = null;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const spec = line.match(/^- Spec revision: (\d+)$/);
    if (spec) specRevision = Number(spec[1]);
    const revision = line.match(/^- Plan revision: (\d+)$/);
    if (revision) planRevision = Number(revision[1]);

    const phaseMatch = line.match(/^## Phase (\d+): (.+)$/);
    if (phaseMatch) {
      const number = Number(phaseMatch[1]);
      phases.push({
        number,
        id: `P${number}`,
        title: phaseMatch[2]!.trim(),
        dependencies: [],
        dependencyDeclared: false,
        tasks: [],
        completionCommit: undefined,
        line: lineNumber,
        trackVerification: phaseMatch[2]!.trim() === "Track-level User Manual Verification"
      });
      currentTask = null;
      continue;
    }

    const phaseDependencies = line.match(/^- Phase dependencies: (.+)$/);
    if (phaseDependencies) {
      const phase = phases.at(-1);
      if (!phase) errors.push(`${sourceLabel}:${lineNumber}: phase dependencies appear before a phase`);
      else if (phase.dependencyDeclared) errors.push(`${sourceLabel}:${lineNumber}: ${phase.id} has duplicate phase dependencies`);
      else {
        phase.dependencies = dependencyList(phaseDependencies[1]!);
        phase.dependencyDeclared = true;
      }
      continue;
    }

    const phaseCommit = line.match(/^- Phase completion commit: (pending|`([0-9a-f]{7,40})`)$/);
    if (phaseCommit) {
      const phase = phases.at(-1);
      if (!phase) errors.push(`${sourceLabel}:${lineNumber}: phase completion commit appears before a phase`);
      else phase.completionCommit = phaseCommit[1] === "pending" ? null : phaseCommit[2]!;
      continue;
    }

    const taskMatch = line.match(/^- \[([ xX])\] (T(\d+)\.(\d+)) (.+)$/);
    if (taskMatch) {
      const phase = phases.at(-1);
      if (!phase) {
        errors.push(`${sourceLabel}:${lineNumber}: task appears before a phase`);
        continue;
      }
      let title = taskMatch[5]!.trim();
      let commit: string | null = null;
      const marker = title.match(/^(.*?)\s+<!-- commit: ([0-9a-f]{7,40}) -->$/);
      if (marker) {
        title = marker[1]!.trim();
        commit = marker[2]!;
      }
      currentTask = {
        checked: taskMatch[1]!.toLowerCase() === "x",
        id: taskMatch[2]!,
        phaseId: `P${taskMatch[3]!}`,
        ordinal: Number(taskMatch[4]),
        title,
        commit,
        dependencies: [],
        dependencyDeclared: false,
        manualVerification: title === "User Manual Verification",
        line: lineNumber
      };
      phase.tasks.push(currentTask);
      continue;
    }

    const taskDependencies = line.match(/^  - Task dependencies: (.+)$/);
    if (taskDependencies) {
      if (!currentTask) errors.push(`${sourceLabel}:${lineNumber}: task dependencies do not follow a task`);
      else if (currentTask.dependencyDeclared) errors.push(`${sourceLabel}:${lineNumber}: ${currentTask.id} has duplicate task dependencies`);
      else {
        currentTask.dependencies = dependencyList(taskDependencies[1]!);
        currentTask.dependencyDeclared = true;
      }
    }
  }

  const graphWithoutDigest = { specRevision, planRevision, phases };
  return { ...graphWithoutDigest, digest: graphDigest(graphWithoutDigest) };
}

export function parsePlan(path: string, errors: string[] = []): PlanGraph {
  if (!existsSync(path)) {
    errors.push(`${path}: missing plan`);
    return { specRevision: null, planRevision: null, phases: [], digest: graphDigest({ specRevision: null, planRevision: null, phases: [] }) };
  }
  return parsePlanContent(readFileSync(path, "utf8"), path, errors);
}

function findCycles(nodes: Array<{ id: string; dependencies: string[] }>, owner: string, errors: string[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  function visit(id: string, trail: string[]): void {
    if (visiting.has(id)) {
      errors.push(`${owner}: dependency cycle ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (ids.has(dependency)) visit(dependency, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of nodes) visit(node.id, []);
}

export function validatePlanGraph(path: string, graph: PlanGraph, status: string, errors: string[]): void {
  if (!graph.phases.length) return;
  if (!Number.isInteger(graph.specRevision) || (graph.specRevision ?? 0) < 1) {
    errors.push(`${path}: Spec revision must be a positive integer`);
  }
  if (!Number.isInteger(graph.planRevision) || (graph.planRevision ?? 0) < 1) {
    errors.push(`${path}: Plan revision must be a positive integer`);
  }
  const phaseIds = new Set(graph.phases.map((phase) => phase.id));
  const finalPhase = graph.phases.at(-1)!;
  graph.phases.forEach((phase, phaseIndex) => {
    if (phase.number !== phaseIndex + 1) errors.push(`${path}: phases must be sequential from 1`);
    if (!phase.tasks.length) errors.push(`${path}: ${phase.id} has no tasks`);
    if (phase.trackVerification && phase !== finalPhase) {
      errors.push(`${path}: Track-level User Manual Verification must be the final phase`);
    }
    if (!phase.trackVerification && !phase.dependencyDeclared) {
      errors.push(`${path}:${phase.line}: ${phase.id} must declare phase dependencies`);
    }
    if (phase.trackVerification && phase.dependencyDeclared) {
      errors.push(`${path}:${phase.line}: final track verification dependencies are derived and must not be declared`);
    }
    if (new Set(phase.dependencies).size !== phase.dependencies.length) {
      errors.push(`${path}:${phase.line}: ${phase.id} contains duplicate phase dependencies`);
    }
    for (const dependency of phase.dependencies) {
      if (!/^P\d+$/.test(dependency) || !phaseIds.has(dependency)) errors.push(`${path}:${phase.line}: ${phase.id} has unknown phase dependency ${dependency}`);
      if (dependency === phase.id) errors.push(`${path}:${phase.line}: ${phase.id} cannot depend on itself`);
      if (dependency === finalPhase.id) errors.push(`${path}:${phase.line}: ${phase.id} cannot depend on final track verification`);
    }
    const nonManualTasks = phase.tasks.filter((task) => !task.manualVerification);
    if (!phase.trackVerification && !nonManualTasks.length) errors.push(`${path}: ${phase.id} has no delivery task`);
    if (phase.trackVerification && (phase.tasks.length !== 1 || !phase.tasks[0]?.manualVerification)) {
      errors.push(`${path}: final track verification phase must contain only User Manual Verification`);
    }
    phase.tasks.forEach((task, taskIndex) => {
      if (task.phaseId !== phase.id) errors.push(`${path}:${task.line}: ${task.id} is in the wrong phase`);
      if (task.ordinal !== taskIndex + 1) errors.push(`${path}:${task.line}: task ordinals must be sequential`);
      if (task.checked && !task.commit) errors.push(`${path}:${task.line}: completed task ${task.id} has no commit marker`);
      if (!task.checked && task.commit) errors.push(`${path}:${task.line}: pending task ${task.id} has a commit marker`);
      if (task.manualVerification) {
        if (task !== phase.tasks.at(-1)) errors.push(`${path}:${task.line}: User Manual Verification must be the final phase task`);
        if (task.dependencyDeclared) errors.push(`${path}:${task.line}: ${task.id} dependencies are derived and must not be declared`);
        task.dependencies = nonManualTasks.map((candidate) => candidate.id);
      } else if (!task.dependencyDeclared) {
        errors.push(`${path}:${task.line}: ${task.id} must declare task dependencies`);
      }
      if (new Set(task.dependencies).size !== task.dependencies.length) {
        errors.push(`${path}:${task.line}: ${task.id} contains duplicate task dependencies`);
      }
      for (const dependency of task.dependencies) {
        const target = phase.tasks.find((candidate) => candidate.id === dependency);
        if (!target) errors.push(`${path}:${task.line}: ${task.id} has unknown or cross-phase task dependency ${dependency}`);
        if (dependency === task.id) errors.push(`${path}:${task.line}: ${task.id} cannot depend on itself`);
        if (target?.manualVerification) errors.push(`${path}:${task.line}: ${task.id} cannot depend on manual verification`);
      }
    });
    if (phase.completionCommit === undefined) errors.push(`${path}: ${phase.id} lacks a completion commit field`);
    const phaseDone = phase.tasks.length > 0 && phase.tasks.every((task) => task.checked);
    if (phaseDone && !phase.completionCommit) errors.push(`${path}: completed ${phase.id} has no completion commit`);
    if (!phaseDone && phase.completionCommit) errors.push(`${path}: incomplete ${phase.id} has a completion commit`);
    findCycles(phase.tasks, `${path}:${phase.id}`, errors);
  });
  if (!finalPhase.trackVerification) errors.push(`${path}: final phase must be Track-level User Manual Verification`);
  finalPhase.dependencies = graph.phases.slice(0, -1).map((phase) => phase.id);
  findCycles(graph.phases, path, errors);
  if (["ready_for_review", "completed", "archived"].includes(status)) {
    const pending = graph.phases.flatMap((phase) => phase.tasks).filter((task) => !task.checked);
    if (pending.length) errors.push(`${path}: ${status} track has ${pending.length} pending task(s)`);
  }
}

export function readAndValidatePlan(path: string, status: string, errors: string[]): PlanGraph {
  const graph = parsePlan(path, errors);
  validatePlanGraph(path, graph, status, errors);
  return graph;
}
