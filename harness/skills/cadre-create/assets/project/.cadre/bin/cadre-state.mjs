#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TRACK_STATUSES = new Set([
  "drafting-spec", "drafting-plan", "planned", "in_progress",
  "ready_for_review", "completed", "archived"
]);
const TRACK_TYPES = new Set(["feature", "bug"]);
const REQUIRED_CONTEXT = [
  "workflow.md", "product.md", "guidelines.md", "tech-stack.md",
  "styleguides/general.md", "patterns/index.md", "project.json", "tracks.md"
];

function findCadreRoot(start) {
  let cursor = resolve(start);
  while (true) {
    const candidate = join(cursor, ".cadre", "project.json");
    if (existsSync(candidate)) return join(cursor, ".cadre");
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error("No .cadre/project.json found from current directory upward");
    cursor = parent;
  }
}

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: invalid JSON (${error.message})`);
    return null;
  }
}

function validateOperation(operation, owner, errors) {
  if (!operation || typeof operation !== "object") {
    errors.push(`${owner}: incomplete state requires an operation journal`);
    return;
  }
  if (!operation.action) errors.push(`${owner}: operation action is required`);
  if (!operation.expectedCommit) errors.push(`${owner}: operation expectedCommit is required`);
  if (!Array.isArray(operation.approvedArtifacts) || !operation.approvedArtifacts.length) {
    errors.push(`${owner}: operation approvedArtifacts must be a non-empty array`);
  }
  if (!operation.approvedAt) errors.push(`${owner}: operation approvedAt is required`);
}

function validateLearning(path, required, errors) {
  if (!existsSync(path)) {
    if (required) errors.push(`${path}: missing learning file`);
    return;
  }
  const body = readFileSync(path, "utf8");
  const start = "<!-- cadre:pattern-seed:start -->";
  const end = "<!-- cadre:pattern-seed:end -->";
  if (!body.includes(start) || !body.includes(end) || body.indexOf(start) >= body.indexOf(end)) {
    errors.push(`${path}: missing or invalid marked Pattern Seed section`);
  }
}

function parsePlan(path, errors) {
  if (!existsSync(path)) {
    errors.push(`${path}: missing plan`);
    return [];
  }
  const phases = [];
  for (const [index, line] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
    const phase = line.match(/^## Phase (\d+): (.+)$/);
    if (phase) {
      phases.push({ number: Number(phase[1]), title: phase[2].trim(), tasks: [], completionCommit: undefined });
      continue;
    }
    const phaseCommit = line.match(/^- Phase completion commit: (pending|`([0-9a-f]{7,40})`)$/);
    if (phaseCommit && phases.length) {
      phases.at(-1).completionCommit = phaseCommit[1] === "pending" ? null : phaseCommit[2];
      continue;
    }
    const task = line.match(/^- \[([ xX])\] (T(\d+)\.(\d+)) (.+)$/);
    if (!task) continue;
    if (!phases.length) {
      errors.push(`${path}:${index + 1}: task appears before a phase`);
      continue;
    }
    let remainder = task[5].trim();
    let commit = null;
    const marker = remainder.match(/^(.*?)\s+<!-- commit: ([0-9a-f]{7,40}) -->$/);
    if (marker) {
      remainder = marker[1].trim();
      commit = marker[2];
    }
    phases.at(-1).tasks.push({
      checked: task[1].toLowerCase() === "x",
      id: task[2],
      phase: Number(task[3]),
      ordinal: Number(task[4]),
      title: remainder,
      commit,
      line: index + 1
    });
  }
  return phases;
}

function validatePlan(path, status, errors) {
  const phases = parsePlan(path, errors);
  if (!phases.length) return;
  phases.forEach((phase, phaseIndex) => {
    if (phase.number !== phaseIndex + 1) errors.push(`${path}: phases must be sequential from 1`);
    if (!phase.tasks.length) errors.push(`${path}: phase ${phase.number} has no tasks`);
    phase.tasks.forEach((task, taskIndex) => {
      if (task.phase !== phase.number) errors.push(`${path}:${task.line}: ${task.id} is in the wrong phase`);
      if (task.ordinal !== taskIndex + 1) errors.push(`${path}:${task.line}: task ordinals must be sequential`);
      if (task.checked && !task.commit) errors.push(`${path}:${task.line}: completed task ${task.id} has no commit marker`);
      if (!task.checked && task.commit) errors.push(`${path}:${task.line}: pending task ${task.id} has a commit marker`);
    });
    if (phase.tasks.at(-1)?.title !== "User Manual Verification") {
      errors.push(`${path}: phase ${phase.number} must end with User Manual Verification`);
    }
    const phaseDone = phase.tasks.length > 0 && phase.tasks.every((task) => task.checked);
    if (phase.completionCommit === undefined) errors.push(`${path}: phase ${phase.number} lacks a completion commit field`);
    if (phaseDone && !phase.completionCommit) errors.push(`${path}: completed phase ${phase.number} has no completion commit`);
    if (!phaseDone && phase.completionCommit) errors.push(`${path}: incomplete phase ${phase.number} has a completion commit`);
  });
  if (phases.at(-1).title !== "Track-level User Manual Verification") {
    errors.push(`${path}: final phase must be Track-level User Manual Verification`);
  }
  if (["ready_for_review", "completed", "archived"].includes(status)) {
    const pending = phases.flatMap((phase) => phase.tasks).filter((task) => !task.checked);
    if (pending.length) errors.push(`${path}: ${status} track has ${pending.length} pending task(s)`);
  }
}

function validateSpec(path, errors) {
  if (!existsSync(path)) {
    errors.push(`${path}: missing specification`);
    return;
  }
  const body = readFileSync(path, "utf8");
  for (const heading of [
    "## Functional Requirements", "## Non-Functional Requirements", "## Acceptance Criteria",
    "## Dependencies", "## Additional Information", "## Dependent-track impact"
  ]) {
    if (!body.includes(heading)) errors.push(`${path}: missing ${heading}`);
  }
}

function buildTracks(project) {
  const lines = [
    "# Tracks",
    "",
    "Generated from `.cadre/project.json` by `node .cadre/bin/cadre-state.mjs render`.",
    "",
    "| Track | Type | Status | Dependencies | Revision | Path |",
    "| --- | --- | --- | --- | ---: | --- |"
  ];
  for (const track of project.tracks ?? []) {
    const deps = track.dependencies?.length ? track.dependencies.map((id) => `\`${id}\``).join(", ") : "—";
    lines.push(`| \`${track.id}\` ${track.title ?? ""} | ${track.type} | ${track.status} | ${deps} | ${track.revision ?? 1} | \`${track.path}\` |`);
  }
  return `${lines.join("\n")}\n`;
}

function validate(root) {
  const errors = [];
  const states = new Map();
  for (const file of REQUIRED_CONTEXT) {
    if (!existsSync(join(root, file))) errors.push(`${join(root, file)}: missing required Cadre file`);
  }
  const project = readJson(join(root, "project.json"), errors);
  if (!project) return { project: null, errors };
  if (project.schemaVersion !== 1) errors.push("project.json: unsupported schemaVersion");
  if (!["greenfield", "brownfield"].includes(project.project?.context)) {
    errors.push("project.json: project context must be greenfield or brownfield");
  }
  if (!project.setup?.checkpoint) errors.push("project.json: setup checkpoint is required");
  if (!Array.isArray(project.setup?.artifactProgress)) errors.push("project.json: setup artifactProgress must be an array");
  if (project.setup?.status === "in_progress") {
    validateOperation(project.setup.operation, "project.json setup", errors);
  } else if (project.setup?.status === "completed") {
    if (!/^[0-9a-f]{7,40}$/.test(project.setup?.commit ?? "")) {
      errors.push("project.json: completed setup requires a commit SHA");
    }
    if (project.setup.checkpoint !== "completed") errors.push("project.json: completed setup requires completed checkpoint");
    if (project.setup.operation != null) errors.push("project.json: completed setup cannot retain an operation journal");
  } else {
    errors.push(`project.json: invalid setup status ${project.setup?.status ?? "<missing>"}`);
  }
  if (project.lastRefresh && !/^[0-9a-f]{7,40}$/.test(project.lastRefresh.commit ?? "")) {
    errors.push("project.json: lastRefresh requires a commit SHA");
  }
  if (!Array.isArray(project.tracks)) errors.push("project.json: tracks must be an array");
  const tracks = Array.isArray(project.tracks) ? project.tracks : [];
  const byId = new Map();
  for (const track of tracks) {
    if (!track.id || byId.has(track.id)) errors.push(`project.json: missing or duplicate track id ${track.id ?? "<empty>"}`);
    else byId.set(track.id, track);
    if (!TRACK_TYPES.has(track.type)) errors.push(`${track.id}: type must be feature or bug`);
    if (!TRACK_STATUSES.has(track.status)) errors.push(`${track.id}: invalid status ${track.status}`);
    if (!Array.isArray(track.dependencies)) errors.push(`${track.id}: dependencies must be an array`);
    if (!track.path) {
      errors.push(`${track.id}: missing path`);
      continue;
    }
    const trackRoot = join(root, track.path);
    const state = readJson(join(trackRoot, "state.json"), errors);
    if (state) {
      states.set(track.id, state);
      if (state.trackId !== track.id) errors.push(`${track.id}: state trackId mismatch`);
      if (state.type !== track.type) errors.push(`${track.id}: project/state type mismatch`);
      if (state.status !== track.status) errors.push(`${track.id}: project/state status mismatch`);
      if ((state.revision ?? 1) !== (track.revision ?? 1)) errors.push(`${track.id}: project/state revision mismatch`);
      if (!state.checkpoint) errors.push(`${track.id}: state checkpoint is required`);
      if (!Array.isArray(state.artifactProgress)) errors.push(`${track.id}: artifactProgress must be an array`);
      if (state.operation != null) validateOperation(state.operation, `${track.id} state`, errors);
      if (JSON.stringify(state.dependencies ?? []) !== JSON.stringify(track.dependencies ?? [])) {
        errors.push(`${track.id}: project/state dependencies mismatch`);
      }
      const specCommit = state.commits?.spec;
      const planCommit = state.commits?.plan;
      if (track.status !== "drafting-spec" && !specCommit && state.operation?.action !== "specify") {
        errors.push(`${track.id}: status ${track.status} requires a recorded spec commit or active specify operation`);
      }
      if (["planned", "in_progress", "ready_for_review", "completed", "archived"].includes(track.status)
        && !planCommit && state.operation?.action !== "plan") {
        errors.push(`${track.id}: status ${track.status} requires a recorded plan commit or active plan operation`);
      }
      if (["completed", "archived"].includes(track.status) && state.reviewCycles?.at(-1)?.outcome !== "clean") {
        errors.push(`${track.id}: ${track.status} track lacks a final clean review cycle`);
      }
    }
    const specPath = join(trackRoot, "spec.md");
    const planPath = join(trackRoot, "plan.md");
    const learningPath = join(trackRoot, "learning.md");
    if (existsSync(specPath)) validateSpec(specPath, errors);
    else if (track.status !== "drafting-spec" && state?.operation?.action !== "specify") errors.push(`${track.id}: missing spec.md`);
    if (existsSync(planPath)) validatePlan(planPath, track.status, errors);
    else if (["planned", "in_progress", "ready_for_review", "completed", "archived"].includes(track.status)
      && state?.operation?.action !== "plan") errors.push(`${track.id}: missing plan.md`);
    validateLearning(
      learningPath,
      ["planned", "in_progress", "ready_for_review", "completed", "archived"].includes(track.status)
        && state?.operation?.action !== "plan",
      errors
    );
    if (track.status === "archived" && !track.path.startsWith("archive/")) errors.push(`${track.id}: archived path must be under archive/`);
    if (track.status !== "archived" && !track.path.startsWith("tracks/")) errors.push(`${track.id}: active path must be under tracks/`);
  }
  for (const track of tracks) {
    for (const dependency of track.dependencies ?? []) {
      if (!byId.has(dependency)) errors.push(`${track.id}: unknown dependency ${dependency}`);
      if (dependency === track.id) errors.push(`${track.id}: track cannot depend on itself`);
      const dependencyStatus = byId.get(dependency)?.status;
      if (["in_progress", "ready_for_review", "completed", "archived"].includes(track.status)
        && dependencyStatus && !["completed", "archived"].includes(dependencyStatus)) {
        errors.push(`${track.id}: ${track.status} track has incomplete dependency ${dependency}`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).dependencies ?? []) visit(dep, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id, []);
  const tracksPath = join(root, "tracks.md");
  if (existsSync(tracksPath) && readFileSync(tracksPath, "utf8") !== buildTracks(project)) {
    errors.push("tracks.md is stale; regenerate it after approved state changes");
  }
  return { project, states, errors };
}

function nextCommand(track) {
  return ({
    "drafting-spec": "track", "drafting-plan": "track", planned: "implement",
    in_progress: "implement", ready_for_review: "review", completed: "archive", archived: "—"
  })[track.status] ?? "—";
}

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--")) ?? "status";
const rootArgIndex = args.indexOf("--root");
const root = rootArgIndex >= 0 ? resolve(args[rootArgIndex + 1], ".cadre") : findCadreRoot(process.cwd());
const result = validate(root);

if (command === "render") {
  if (!result.project) process.exitCode = 1;
  else {
    const output = join(root, "tracks.md");
    if (existsSync(output)) readFileSync(output, "utf8");
    writeFileSync(output, buildTracks(result.project));
    process.stdout.write(`Rendered ${output}\n`);
  }
} else if (command === "validate") {
  if (result.errors.length) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write("Cadre state is valid.\n");
} else if (command === "status") {
  const project = result.project;
  if (!project) process.exitCode = 1;
  else {
    process.stdout.write(`Project: ${project.project?.name ?? "unknown"}; context=${project.project?.context ?? "unknown"}\n`);
    process.stdout.write(`Setup: ${project.setup?.status ?? "unknown"}; checkpoint=${project.setup?.checkpoint ?? "none"}; operation=${project.setup?.operation?.action ?? "none"}; commit=${project.setup?.commit ?? "none"}\n`);
    process.stdout.write(`Last refresh: ${project.lastRefresh?.commit ?? "none"}\n`);
    for (const track of project.tracks) {
      const dependencies = track.dependencies?.length ? track.dependencies.join(",") : "none";
      const state = result.states.get(track.id);
      process.stdout.write(`${track.id} [${track.type}] ${track.status}; checkpoint=${state?.checkpoint ?? "none"}; operation=${state?.operation?.action ?? "none"}; deps=${dependencies}; revision=${track.revision ?? 1}; phase=${state?.activePhase ?? "none"}; task=${state?.activeTask ?? "none"}; reviews=${state?.reviewCycles?.length ?? 0}; next=${nextCommand(track)}\n`);
    }
    const counts = project.tracks.reduce((result, track) => {
      result[track.status] = (result[track.status] ?? 0) + 1;
      return result;
    }, {});
    process.stdout.write(`Counts: ready_for_review=${counts.ready_for_review ?? 0}; completed=${counts.completed ?? 0}; archived=${counts.archived ?? 0}\n`);
    process.stdout.write(`Validation: ${result.errors.length ? `${result.errors.length} error(s)` : "clean"}\n`);
    if (result.errors.length) process.exitCode = 1;
  }
} else {
  process.stderr.write("Usage: cadre-state.mjs [status|validate|render] [--root PROJECT_ROOT]\n");
  process.exitCode = 2;
}
