import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject } from "../../../types";

export interface PlanGraphResult {
  plan: JsonObject;
  issues: JsonObject[];
}

interface PhaseIdentity {
  index: number;
  id: string;
  raw: JsonObject;
  aliases: string[];
}

interface TaskIdentity {
  phase: PhaseIdentity;
  index: number;
  key: string;
  raw: JsonObject;
  aliases: string[];
}

function issue(path: string, message: string, expected?: string): JsonObject {
  return { path, message, ...(expected ? { expected } : {}) };
}

function normalizedAlias(value: unknown): string | null {
  const text = asOptionalString(value)?.trim().toLowerCase();
  return text || null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function manualScope(task: JsonObject): "phase" | "track" | null {
  const key = asOptionalString(task.task_key)?.toLowerCase() || "";
  const type = asOptionalString(task.task_type || asJsonObject(task.annotations)["task-type"])?.toLowerCase() || "";
  const scope = asOptionalString(asJsonObject(task.manual_verification).scope
    || asJsonObject(task.annotations)["manual-verification-scope"])?.toLowerCase();
  if (scope === "track" || key === "track_manual_verification") return "track";
  if (scope === "phase" || key.includes("manual_verification") || type === "user_manual_verification") return "phase";
  return null;
}

function identities(plan: JsonObject): { phases: PhaseIdentity[]; tasks: TaskIdentity[]; issues: JsonObject[] } {
  const issues: JsonObject[] = [];
  const rawPhases = Array.isArray(plan.phases) ? plan.phases.map(asJsonObject) : [];
  const phases = rawPhases.map((raw, offset) => {
    const index = offset + 1;
    const id = `phase${index}`;
    return {
      index,
      id,
      raw,
      aliases: unique([
        id,
        normalizedAlias(raw.phase_id),
        Number.isSafeInteger(raw.phase_index) ? `phase${raw.phase_index}` : null,
      ]),
    };
  });
  const tasks = phases.flatMap((phase) => {
    const rawTasks = Array.isArray(phase.raw.tasks) ? phase.raw.tasks.map(asJsonObject) : [];
    let implementationOffset = 0;
    return rawTasks.map((raw, offset) => {
      const scope = manualScope(raw);
      if (!scope) implementationOffset += 1;
      const key = scope === "track"
        ? "track_manual_verification"
        : scope === "phase"
          ? `phase${phase.index}_manual_verification`
          : `phase${phase.index}_task${implementationOffset}`;
      return {
        phase,
        index: offset + 1,
        key,
        raw,
        aliases: unique([
          key,
          normalizedAlias(raw.task_key),
          Number.isSafeInteger(raw.task_index) && !scope
            ? `phase${phase.index}_task${raw.task_index}`
            : null,
        ]),
      };
    });
  });
  const supplied = new Map<string, TaskIdentity[]>();
  for (const task of tasks) {
    const rawKey = normalizedAlias(task.raw.task_key);
    if (!rawKey) continue;
    supplied.set(rawKey, [...(supplied.get(rawKey) || []), task]);
  }
  for (const [key, owners] of supplied) {
    if (owners.length > 1) {
      issues.push(issue("plan.phases[].tasks[].task_key", `Duplicate task key ${key}.`, "unique task keys"));
    }
  }
  const phaseAliasOwners = new Map<string, PhaseIdentity[]>();
  for (const phase of phases) {
    for (const alias of phase.aliases) {
      phaseAliasOwners.set(alias, [...(phaseAliasOwners.get(alias) || []), phase]);
    }
  }
  for (const [alias, owners] of phaseAliasOwners) {
    if (owners.length > 1) {
      issues.push(issue("plan.phases[].phase_id", `Ambiguous phase alias ${alias}.`, "aliases unique across canonical phase ids"));
    }
  }
  const taskAliasOwners = new Map<string, TaskIdentity[]>();
  for (const task of tasks) {
    for (const alias of task.aliases) {
      taskAliasOwners.set(alias, [...(taskAliasOwners.get(alias) || []), task]);
    }
  }
  for (const [alias, owners] of taskAliasOwners) {
    if (owners.length > 1) {
      issues.push(issue("plan.phases[].tasks[].task_key", `Ambiguous task alias ${alias}.`, "aliases unique across canonical task keys"));
    }
  }
  return { phases, tasks, issues };
}

function unambiguousMap<T extends { aliases: string[] }>(values: T[]): Map<string, T> {
  const candidates = new Map<string, T[]>();
  for (const value of values) {
    for (const alias of value.aliases) candidates.set(alias, [...(candidates.get(alias) || []), value]);
  }
  return new Map(Array.from(candidates.entries()).flatMap(([alias, entries]) => (
    entries.length === 1 ? [[alias, entries[0]!] as const] : []
  )));
}

function mapDependency(value: string, aliases: Map<string, { id?: string; key?: string }>): string {
  const normalized = normalizedAlias(value);
  const target = normalized ? aliases.get(normalized) : null;
  return target?.id || target?.key || value;
}

function dependencyArrayIssues(value: unknown, path: string): JsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [issue(path, "Dependencies must be an array of strings.", "string[]")];
  return value.flatMap((entry, index) => (
    typeof entry === "string" && entry.trim().length > 0
      ? []
      : [issue(`${path}[${index}]`, "Dependency must be a non-empty string.", "string")]
  ));
}

function rawGraphShapeIssues(plan: JsonObject): JsonObject[] {
  if (!Array.isArray(plan.phases)) {
    return [issue("plan.phases", "Plan phases must be an array.", "phase[]")];
  }
  if (plan.phases.length === 0) {
    return [issue("plan.phases", "Plan must contain at least one phase.", "non-empty phase[]")];
  }
  return plan.phases.flatMap((rawPhase, phaseIndex) => {
    const phasePath = `plan.phases[${phaseIndex}]`;
    if (!isRecord(rawPhase)) return [issue(phasePath, "Phase must be an object.", "phase")];
    const phase = asJsonObject(rawPhase);
    const issues = dependencyArrayIssues(phase.depends_on, `${phasePath}.depends_on`);
    if (!Array.isArray(phase.tasks) || phase.tasks.length === 0) {
      issues.push(issue(`${phasePath}.tasks`, "Phase tasks must be a non-empty array.", "task[]"));
      return issues;
    }
    phase.tasks.forEach((rawTask, taskIndex) => {
      const taskPath = `${phasePath}.tasks[${taskIndex}]`;
      if (!isRecord(rawTask)) {
        issues.push(issue(taskPath, "Task must be an object.", "task"));
        return;
      }
      const task = asJsonObject(rawTask);
      issues.push(...dependencyArrayIssues(
        task.depends_on === undefined ? task.depends : task.depends_on,
        `${taskPath}.depends_on`,
      ));
    });
    return issues;
  });
}

export function canonicalizePlanGraph(plan: JsonObject): PlanGraphResult {
  const identity = identities(plan);
  const shapeIssues = rawGraphShapeIssues(plan);
  const phaseAliases = unambiguousMap(identity.phases);
  const taskAliases = unambiguousMap(identity.tasks);
  const phaseDependencyAliases = new Map<string, { id: string }>();
  for (const [alias, phase] of phaseAliases) phaseDependencyAliases.set(alias, { id: phase.id });
  const tasksByPhase = new Map<number, TaskIdentity[]>();
  for (const task of identity.tasks) tasksByPhase.set(task.phase.index, [...(tasksByPhase.get(task.phase.index) || []), task]);

  const phases = identity.phases.map((phase) => ({
    ...phase.raw,
    phase_index: phase.index,
    phase_id: phase.id,
    depends_on: asStringArray(phase.raw.depends_on).map((dependency) => mapDependency(dependency, phaseDependencyAliases)),
    tasks: (tasksByPhase.get(phase.index) || []).map((task) => ({
      ...task.raw,
      task_index: task.index,
      task_key: task.key,
      depends_on: asStringArray(task.raw.depends_on || task.raw.depends)
        .map((dependency) => mapDependency(dependency, taskAliases)),
    })),
  }));
  const normalized = { ...plan, phases };
  return { plan: normalized, issues: [...shapeIssues, ...identity.issues, ...validateCanonicalPlanGraph(normalized)] };
}

function dependencyCycles(nodes: Map<string, string[]>): string[][] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependency of nodes.get(id) || []) if (nodes.has(dependency)) visit(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodes.keys()) visit(id);
  return cycles;
}

export function validateCanonicalPlanGraph(plan: JsonObject): JsonObject[] {
  const issues: JsonObject[] = [];
  const phases = Array.isArray(plan.phases) ? plan.phases.map(asJsonObject) : [];
  const phaseIds = new Set(phases.map((phase, index) => asOptionalString(phase.phase_id) || `phase${index + 1}`));
  const phaseGraph = new Map<string, string[]>();
  const tasks = phases.flatMap((phase) => Array.isArray(phase.tasks) ? phase.tasks.map(asJsonObject) : []);
  const taskKeys = new Set(tasks.map((task) => asOptionalString(task.task_key) || "").filter(Boolean));
  const taskGraph = new Map<string, string[]>();
  const taskOwners = new Map<string, { phaseId: string; path: string; dependencies: string[] }>();

  phases.forEach((phase, phaseOffset) => {
    const id = asOptionalString(phase.phase_id) || `phase${phaseOffset + 1}`;
    const dependencies = asStringArray(phase.depends_on);
    phaseGraph.set(id, dependencies);
    dependencies.forEach((dependency, dependencyOffset) => {
      const path = `plan.phases[${phaseOffset}].depends_on[${dependencyOffset}]`;
      if (!/^phase\d+$/.test(dependency)) issues.push(issue(path, `Phase dependency ${dependency} is not a canonical phase id.`, "phaseN"));
      else if (!phaseIds.has(dependency)) issues.push(issue(path, `Unknown phase dependency ${dependency}.`, "existing phaseN"));
      else if (dependency === id) issues.push(issue(path, `Phase ${id} cannot depend on itself.`));
    });
    const phaseTasks = Array.isArray(phase.tasks) ? phase.tasks.map(asJsonObject) : [];
    phaseTasks.forEach((task, taskOffset) => {
      const key = asOptionalString(task.task_key) || "";
      const taskPath = `plan.phases[${phaseOffset}].tasks[${taskOffset}]`;
      if (!/^phase\d+_task\d+$/.test(key)
        && !/^phase\d+_manual_verification$/.test(key)
        && key !== "track_manual_verification") {
        issues.push(issue(`${taskPath}.task_key`, `Task key ${key || "(missing)"} is not canonical.`, "phaseN_taskM"));
      }
      const dependencies = asStringArray(task.depends_on);
      taskGraph.set(key, dependencies);
      taskOwners.set(key, { phaseId: id, path: taskPath, dependencies });
      dependencies.forEach((dependency, dependencyOffset) => {
        const path = `${taskPath}.depends_on[${dependencyOffset}]`;
        if (!taskKeys.has(dependency)) issues.push(issue(path, `Unknown task dependency ${dependency}.`, "existing canonical task key"));
        else if (dependency === key) issues.push(issue(path, `Task ${key} cannot depend on itself.`));
      });
    });
  });
  const ancestorCache = new Map<string, Set<string>>();
  const phaseAncestors = (phaseId: string, visiting = new Set<string>()): Set<string> => {
    const cached = ancestorCache.get(phaseId);
    if (cached) return cached;
    if (visiting.has(phaseId)) return new Set();
    const nextVisiting = new Set(visiting).add(phaseId);
    const ancestors = new Set<string>();
    for (const dependency of phaseGraph.get(phaseId) || []) {
      if (!phaseGraph.has(dependency)) continue;
      ancestors.add(dependency);
      for (const ancestor of phaseAncestors(dependency, nextVisiting)) ancestors.add(ancestor);
    }
    ancestorCache.set(phaseId, ancestors);
    return ancestors;
  };
  for (const [taskKey, owner] of taskOwners) {
    owner.dependencies.forEach((dependency, dependencyOffset) => {
      const dependencyOwner = taskOwners.get(dependency);
      if (!dependencyOwner || dependencyOwner.phaseId === owner.phaseId) return;
      if (phaseAncestors(owner.phaseId).has(dependencyOwner.phaseId)) return;
      issues.push(issue(
        `${owner.path}.depends_on[${dependencyOffset}]`,
        `Task ${taskKey} depends on ${dependency} from ${dependencyOwner.phaseId}, but ${dependencyOwner.phaseId} is not a phase dependency ancestor of ${owner.phaseId}.`,
        `task in ${owner.phaseId} or an ancestor phase`,
      ));
    });
  }
  for (const cycle of dependencyCycles(phaseGraph)) issues.push(issue("plan.phases[].depends_on", `Phase dependency cycle: ${cycle.join(" -> ")}.`));
  for (const cycle of dependencyCycles(taskGraph)) issues.push(issue("plan.phases[].tasks[].depends_on", `Task dependency cycle: ${cycle.join(" -> ")}.`));
  return issues;
}
