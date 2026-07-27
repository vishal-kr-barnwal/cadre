import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CADRE_RUNTIME_VERSION, TEMPLATE_SET_VERSION } from "./version.js";

export interface OperationState {
  action?: string;
  expectedCommit?: string;
  approvedArtifacts?: string[];
  approvedAt?: string;
  [key: string]: unknown;
}

export interface ReviewCycle {
  outcome?: string;
  [key: string]: unknown;
}

export interface TrackState {
  schemaVersion: number;
  trackId: string;
  title: string;
  type: string;
  status: string;
  checkpoint?: string;
  revision?: number;
  activePhase?: string | number | null;
  activeTask?: string | null;
  dependencies?: string[];
  commits?: { spec?: string | null; plan?: string | null };
  artifactProgress?: string[];
  operation?: OperationState | null;
  reviewCycles?: ReviewCycle[];
  path?: unknown;
  [key: string]: unknown;
}

export interface ProjectState {
  schemaVersion: number;
  runtimeVersion?: string;
  templateSetVersion?: string;
  project?: { name?: string; context?: string };
  setup?: {
    status?: string;
    checkpoint?: string;
    commit?: string | null;
    artifactProgress?: string[];
    operation?: OperationState | null;
  };
  lastRefresh?: { commit?: string } | null;
  history?: unknown[];
  tracks?: unknown;
  [key: string]: unknown;
}

export interface DiscoveredTrack extends TrackState {
  id: string;
  location: string;
}

export interface ValidationResult {
  project: ProjectState | null;
  tracks: DiscoveredTrack[];
  states: Map<string, TrackState>;
  errors: string[];
}

const TRACK_STATUSES = new Set([
  "drafting-spec", "drafting-plan", "planned", "in_progress",
  "ready_for_review", "completed", "archived"
]);
const TRACK_TYPES = new Set(["feature", "bug"]);
const REQUIRED_CONTEXT = [
  "workflow.md", "product.md", "guidelines.md", "tech-stack.md",
  "styleguides/general.md", "patterns/index.md", "operations", "tracks", "archive",
  "project.json", "tracks.md"
];

export function cadreRoot(projectRoot: string): string {
  return join(resolve(projectRoot), ".cadre");
}

function readJson<T>(path: string, errors: string[]): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    errors.push(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function validateOperation(operation: OperationState | null | undefined, owner: string, errors: string[]): void {
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

function validateLearning(path: string, required: boolean, errors: string[]): void {
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

interface PlanTask {
  checked: boolean;
  id: string;
  phase: number;
  ordinal: number;
  title: string;
  commit: string | null;
  line: number;
}

interface PlanPhase {
  number: number;
  title: string;
  tasks: PlanTask[];
  completionCommit: string | null | undefined;
}

function parsePlan(path: string, errors: string[]): PlanPhase[] {
  if (!existsSync(path)) {
    errors.push(`${path}: missing plan`);
    return [];
  }
  const phases: PlanPhase[] = [];
  for (const [index, line] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
    const phase = line.match(/^## Phase (\d+): (.+)$/);
    if (phase) {
      phases.push({ number: Number(phase[1]), title: phase[2]!.trim(), tasks: [], completionCommit: undefined });
      continue;
    }
    const phaseCommit = line.match(/^- Phase completion commit: (pending|`([0-9a-f]{7,40})`)$/);
    if (phaseCommit && phases.length) {
      phases.at(-1)!.completionCommit = phaseCommit[1] === "pending" ? null : phaseCommit[2]!;
      continue;
    }
    const task = line.match(/^- \[([ xX])\] (T(\d+)\.(\d+)) (.+)$/);
    if (!task) continue;
    if (!phases.length) {
      errors.push(`${path}:${index + 1}: task appears before a phase`);
      continue;
    }
    let remainder = task[5]!.trim();
    let commit: string | null = null;
    const marker = remainder.match(/^(.*?)\s+<!-- commit: ([0-9a-f]{7,40}) -->$/);
    if (marker) {
      remainder = marker[1]!.trim();
      commit = marker[2]!;
    }
    phases.at(-1)!.tasks.push({
      checked: task[1]!.toLowerCase() === "x",
      id: task[2]!,
      phase: Number(task[3]),
      ordinal: Number(task[4]),
      title: remainder,
      commit,
      line: index + 1
    });
  }
  return phases;
}

function validatePlan(path: string, status: string, errors: string[]): void {
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
  if (phases.at(-1)!.title !== "Track-level User Manual Verification") {
    errors.push(`${path}: final phase must be Track-level User Manual Verification`);
  }
  if (["ready_for_review", "completed", "archived"].includes(status)) {
    const pending = phases.flatMap((phase) => phase.tasks).filter((task) => !task.checked);
    if (pending.length) errors.push(`${path}: ${status} track has ${pending.length} pending task(s)`);
  }
}

function validateSpec(path: string, errors: string[]): void {
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

function validateArchiveOperations(root: string, byId: Map<string, DiscoveredTrack>, errors: string[]): void {
  const operationsRoot = join(root, "operations");
  if (!existsSync(operationsRoot)) return;
  let activeCount = 0;
  for (const file of readdirSync(operationsRoot).filter((name) => name.endsWith(".json"))) {
    const owner = `operations/${file}`;
    const operation = readJson<OperationState & {
      action?: string;
      batchId?: string;
      status?: string;
      selectedTracks?: string[];
      completedTracks?: string[];
      archiveCommit?: string | null;
    }>(join(operationsRoot, file), errors);
    if (!operation) continue;
    if (operation.action !== "archive") errors.push(`${owner}: unsupported action ${operation.action ?? "<missing>"}`);
    validateOperation(operation, owner, errors);
    if (!operation.batchId || file !== `${operation.batchId}.json`) {
      errors.push(`${owner}: filename must match batchId`);
    }
    if (!operation.status || !["in_progress", "completed"].includes(operation.status)) {
      errors.push(`${owner}: status must be in_progress or completed`);
    }
    if (operation.status === "in_progress") activeCount += 1;
    if (!Array.isArray(operation.selectedTracks) || !operation.selectedTracks.length) {
      errors.push(`${owner}: selectedTracks must be a non-empty array`);
      continue;
    }
    if (new Set(operation.selectedTracks).size !== operation.selectedTracks.length) {
      errors.push(`${owner}: selectedTracks contains duplicates`);
    }
    if (!Array.isArray(operation.completedTracks)) {
      errors.push(`${owner}: completedTracks must be an array`);
      continue;
    }
    for (const trackId of operation.selectedTracks) {
      const track = byId.get(trackId);
      if (!track) errors.push(`${owner}: unknown selected track ${trackId}`);
      else if (!["completed", "archived"].includes(track.status)) {
        errors.push(`${owner}: selected track ${trackId} is ${track.status}, not completed or archived`);
      }
    }
    for (const trackId of operation.completedTracks) {
      if (!operation.selectedTracks.includes(trackId)) errors.push(`${owner}: completed track ${trackId} was not selected`);
      else if (byId.get(trackId)?.status !== "archived") errors.push(`${owner}: completed track ${trackId} is not archived`);
    }
    if (operation.status === "completed") {
      if (operation.completedTracks.length !== operation.selectedTracks.length) {
        errors.push(`${owner}: completed journal has unfinished selected tracks`);
      }
      if (!/^[0-9a-f]{7,40}$/.test(operation.archiveCommit ?? "")) {
        errors.push(`${owner}: completed journal requires an archive commit SHA`);
      }
    } else if (operation.archiveCommit != null && !/^[0-9a-f]{7,40}$/.test(operation.archiveCommit)) {
      errors.push(`${owner}: archiveCommit must be null or a commit SHA`);
    }
  }
  if (activeCount > 1) errors.push("operations: more than one archive batch is in progress");
}

function discoverTracks(root: string, errors: string[]): {
  tracks: DiscoveredTrack[];
  states: Map<string, TrackState>;
  byId: Map<string, DiscoveredTrack>;
} {
  const tracks: DiscoveredTrack[] = [];
  const states = new Map<string, TrackState>();
  const byId = new Map<string, DiscoveredTrack>();
  for (const directory of ["tracks", "archive"]) {
    const directoryRoot = join(root, directory);
    if (!existsSync(directoryRoot)) continue;
    const entries = readdirSync(directoryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const location = `${directory}/${entry.name}`;
      const state = readJson<TrackState>(join(directoryRoot, entry.name, "state.json"), errors);
      if (!state) continue;
      const id = state.trackId;
      if (!id) {
        errors.push(`${location}: state trackId is required`);
        continue;
      }
      if (entry.name !== id) errors.push(`${location}: directory name must match trackId ${id}`);
      if (byId.has(id)) {
        errors.push(`${id}: duplicate track state under ${byId.get(id)!.location} and ${location}`);
        continue;
      }
      if (Object.hasOwn(state, "path")) errors.push(`${id}: state must not persist a path`);
      const track = { ...state, id, location };
      tracks.push(track);
      states.set(id, state);
      byId.set(id, track);
    }
  }
  tracks.sort((left, right) => left.id.localeCompare(right.id));
  return { tracks, states, byId };
}

export function buildTracks(tracks: DiscoveredTrack[]): string {
  const lines = [
    "# Tracks",
    "",
    "Generated from track-local `state.json` files by the Cadre MCP server.",
    "",
    "| Track | Type | Status | Revision |",
    "| --- | --- | --- | ---: |"
  ];
  for (const track of tracks) {
    lines.push(`| \`${track.id}\` ${track.title ?? ""} | ${track.type} | ${track.status} | ${track.revision ?? 1} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function validateProject(projectRoot: string): ValidationResult {
  const root = cadreRoot(projectRoot);
  const errors = [];
  for (const file of REQUIRED_CONTEXT) {
    if (!existsSync(join(root, file))) errors.push(`${join(root, file)}: missing required Cadre file`);
  }
  const project = readJson<ProjectState>(join(root, "project.json"), errors);
  if (!project) return { project: null, tracks: [], states: new Map<string, TrackState>(), errors };
  if (project.schemaVersion !== 1) errors.push("project.json: unsupported schemaVersion");
  if (project.runtimeVersion !== CADRE_RUNTIME_VERSION) errors.push(`project.json: runtimeVersion must be ${CADRE_RUNTIME_VERSION}`);
  if (project.templateSetVersion !== TEMPLATE_SET_VERSION) errors.push(`project.json: templateSetVersion must be ${TEMPLATE_SET_VERSION}`);
  if (!project.project?.context || !["greenfield", "brownfield"].includes(project.project.context)) {
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
  if (Object.hasOwn(project, "tracks")) errors.push("project.json: must not duplicate track records");
  const { tracks, states, byId } = discoverTracks(root, errors);
  for (const track of tracks) {
    const state = states.get(track.id)!;
    const trackRoot = join(root, track.location);
    if (state.schemaVersion !== 1) errors.push(`${track.id}: unsupported state schemaVersion`);
    if (!state.title || typeof state.title !== "string") errors.push(`${track.id}: title is required`);
    if (!TRACK_TYPES.has(track.type)) errors.push(`${track.id}: type must be feature or bug`);
    if (!TRACK_STATUSES.has(track.status)) errors.push(`${track.id}: invalid status ${track.status}`);
    if (!Array.isArray(track.dependencies)) errors.push(`${track.id}: dependencies must be an array`);
    if (!Number.isInteger(track.revision) || (track.revision ?? 0) < 1) errors.push(`${track.id}: revision must be a positive integer`);
    if (!state.checkpoint) errors.push(`${track.id}: state checkpoint is required`);
    if (!Array.isArray(state.artifactProgress)) errors.push(`${track.id}: artifactProgress must be an array`);
    if (state.operation != null) validateOperation(state.operation, `${track.id} state`, errors);
    const expectedDirectory = track.status === "archived" ? "archive" : "tracks";
    if (track.location !== `${expectedDirectory}/${track.id}`) {
      errors.push(`${track.id}: status ${track.status} requires location ${expectedDirectory}/${track.id}`);
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
  }
  validateArchiveOperations(root, byId, errors);
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
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string, trail: string[]): void {
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)!.dependencies ?? []) visit(dep, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id, []);
  const tracksPath = join(root, "tracks.md");
  if (existsSync(tracksPath) && readFileSync(tracksPath, "utf8") !== buildTracks(tracks)) {
    errors.push("tracks.md is stale; regenerate it after approved state changes");
  }
  return { project, tracks, states, errors };
}

function nextCommand(track: DiscoveredTrack): string {
  return ({
    "drafting-spec": "track", "drafting-plan": "track", planned: "implement",
    in_progress: "implement", ready_for_review: "review", completed: "archive", archived: "—"
  })[track.status] ?? "—";
}

export function renderTracksPreview(projectRoot: string): {
  path: string;
  content: string;
  previousContent: string | null;
  changed: boolean;
  digest: string;
} {
  const result = validateProject(projectRoot);
  if (!result.project) throw new Error(result.errors.join("\n") || "Cadre project state is unavailable");
  const blockingErrors = result.errors.filter((error) => error !== "tracks.md is stale; regenerate it after approved state changes");
  if (blockingErrors.length) throw new Error(blockingErrors.join("\n"));
  const path = join(cadreRoot(projectRoot), "tracks.md");
  const previousContent = existsSync(path) ? readFileSync(path, "utf8") : null;
  const content = buildTracks(result.tracks);
  const digest = createHash("sha256").update(JSON.stringify({ content, previousContent })).digest("hex");
  return { path, content, previousContent, changed: previousContent !== content, digest };
}

export function writeTracks(projectRoot: string, proposalDigest: string): string {
  const preview = renderTracksPreview(projectRoot);
  if (preview.digest !== proposalDigest) {
    throw new Error("tracks.md proposal is stale; preview it again before applying");
  }
  if (existsSync(preview.path)) {
    if (lstatSync(preview.path).isSymbolicLink()) throw new Error("Refusing to write tracks.md through a symbolic link");
    readFileSync(preview.path, "utf8");
  }
  writeFileSync(preview.path, preview.content);
  return preview.path;
}

export function formatStatus(projectRoot: string): { text: string; result: ValidationResult } {
  const result = validateProject(projectRoot);
  const project = result.project;
  if (!project) return { text: result.errors.join("\n"), result };
  const lines = [
    `Project: ${project.project?.name ?? "unknown"}; context=${project.project?.context ?? "unknown"}`,
    `Setup: ${project.setup?.status ?? "unknown"}; checkpoint=${project.setup?.checkpoint ?? "none"}; operation=${project.setup?.operation?.action ?? "none"}; commit=${project.setup?.commit ?? "none"}`,
    `Last refresh: ${project.lastRefresh?.commit ?? "none"}`
  ];
  for (const track of result.tracks) {
    const dependencies = track.dependencies?.length ? track.dependencies.join(",") : "none";
    const state = result.states.get(track.id);
    lines.push(`${track.id} [${track.type}] ${track.status}; checkpoint=${state?.checkpoint ?? "none"}; operation=${state?.operation?.action ?? "none"}; deps=${dependencies}; revision=${track.revision ?? 1}; phase=${state?.activePhase ?? "none"}; task=${state?.activeTask ?? "none"}; reviews=${state?.reviewCycles?.length ?? 0}; next=${nextCommand(track)}`);
  }
  const counts = result.tracks.reduce<Record<string, number>>((summary, track) => {
    summary[track.status] = (summary[track.status] ?? 0) + 1;
    return summary;
  }, {});
  lines.push(`Counts: ready_for_review=${counts.ready_for_review ?? 0}; completed=${counts.completed ?? 0}; archived=${counts.archived ?? 0}`);
  lines.push(`Validation: ${result.errors.length ? `${result.errors.length} error(s)` : "clean"}`);
  return { text: `${lines.join("\n")}\n`, result };
}
