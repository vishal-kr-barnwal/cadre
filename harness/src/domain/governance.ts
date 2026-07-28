import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { safeProjectRoot } from "./paths.js";
import {
  buildTracks, cadreRoot, validateProject,
  type DiscoveredTrack, type ProjectState, type TrackState
} from "./state.js";

const SHA = /^[0-9a-f]{7,40}$/;
const TRACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BATCH_ID = /^archive-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertWritableFile(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing to write through symbolic link ${path}`);
  }
}

function writeApprovedFile(path: string, content: string): void {
  assertWritableFile(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function requireCurrentProject(projectRoot: string) {
  const validation = validateProject(projectRoot);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  if (!validation.project) throw new Error("Cadre project state is unavailable");
  return validation;
}

export interface ReviewCompleteInput {
  projectRoot: string;
  trackId: string;
  reviewedAt: string;
  reviewedHead: string;
  commitRange: string;
  approval: string;
  acceptedRisks?: string[];
}

export function previewReviewComplete(input: ReviewCompleteInput): {
  statePath: string;
  state: TrackState;
  tracksPath: string;
  tracksContent: string;
  digest: string;
} {
  if (!TRACK_ID.test(input.trackId)) throw new Error("invalid trackId");
  if (!SHA.test(input.reviewedHead)) throw new Error("reviewedHead must be a Git commit SHA");
  if (!Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("reviewedAt must be an ISO timestamp");
  if (!input.approval.trim()) throw new Error("approval must record the explicit human decision");
  const range = input.commitRange.match(/^([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})$/);
  if (!range || range[2] !== input.reviewedHead) {
    throw new Error("commitRange must end at reviewedHead");
  }
  const root = safeProjectRoot(input.projectRoot);
  const validation = requireCurrentProject(root);
  const track = validation.tracks.find((candidate) => candidate.id === input.trackId);
  const current = validation.states.get(input.trackId);
  if (!track || !current) throw new Error(`unknown track ${input.trackId}`);
  if (track.location !== `tracks/${input.trackId}` || current.status !== "ready_for_review") {
    throw new Error(`${input.trackId} is not ready for review`);
  }
  if (current.operation != null) throw new Error(`${input.trackId} already has an active operation`);
  const execution = current.lastExecution;
  if (!execution?.executionId || !execution.planRevision || !execution.graphDigest
    || execution.headCommit !== input.reviewedHead) {
    throw new Error("review evidence does not match the current completed execution");
  }
  const statePath = join(cadreRoot(root), track.location, "state.json");
  const tracksPath = join(cadreRoot(root), "tracks.md");
  const stateBody = readFileSync(statePath, "utf8");
  const tracksBody = readFileSync(tracksPath, "utf8");
  const acceptedRisks = (input.acceptedRisks ?? []).map((risk) => risk.trim()).filter(Boolean);
  const cycle = {
    cycle: (current.reviewCycles?.length ?? 0) + 1,
    reviewedAt: input.reviewedAt,
    outcome: "clean",
    executionId: execution.executionId,
    planRevision: execution.planRevision,
    graphDigest: execution.graphDigest,
    reviewedHead: input.reviewedHead,
    commitRange: input.commitRange,
    approval: input.approval,
    ...(acceptedRisks.length ? { acceptedRisks } : {})
  };
  const state: TrackState = {
    ...current,
    status: "completed",
    checkpoint: "completed",
    reviewCycles: [...(current.reviewCycles ?? []), cycle]
  };
  const tracks = validation.tracks.map((candidate): DiscoveredTrack => candidate.id === input.trackId
    ? { ...candidate, ...state, id: input.trackId, location: `tracks/${input.trackId}` }
    : candidate);
  const tracksContent = buildTracks(tracks);
  return {
    statePath,
    state,
    tracksPath,
    tracksContent,
    digest: hash({ stateBody, tracksBody, input, state, tracksContent })
  };
}

export function applyReviewComplete(input: ReviewCompleteInput, proposalDigest: string) {
  const proposal = previewReviewComplete(input);
  if (proposal.digest !== proposalDigest) throw new Error("review completion proposal is stale; preview it again");
  writeApprovedFile(proposal.statePath, json(proposal.state));
  writeApprovedFile(proposal.tracksPath, proposal.tracksContent);
  const validation = validateProject(input.projectRoot);
  if (validation.errors.length || validation.warnings.length) {
    throw new Error([...validation.errors, ...validation.warnings].join("\n"));
  }
  return { ...proposal, valid: true, derivedStateCurrent: true };
}

export interface ArchiveContentUpdate {
  path: string;
  content: string;
}

export interface ArchiveBatchInput {
  projectRoot: string;
  batchId: string;
  selectedTracks: string[];
  baseCommit: string;
  approvedAt: string;
  updates: ArchiveContentUpdate[];
}

interface ArchiveMove {
  trackId: string;
  sourcePath: string;
  targetPath: string;
  state: TrackState;
}

interface ArchiveOperation {
  schemaVersion: 1;
  action: "archive";
  batchId: string;
  status: "in_progress" | "completed";
  checkpoint: string;
  baseCommit: string;
  expectedCommit: string;
  selectedTracks: string[];
  completedTracks: string[];
  approvedArtifacts: string[];
  artifactProgress: string[];
  approvedAt: string;
  archiveCommit: string | null;
}

function assertArchiveUpdate(path: string, selected: Set<string>): void {
  if (path === "patterns/index.md" || /^patterns\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)) return;
  const seed = path.match(/^tracks\/([a-z0-9]+(?:-[a-z0-9]+)*)\/learning\.md$/);
  if (seed && !selected.has(seed[1]!)) return;
  throw new Error(`archive update path is not allowed: ${path}`);
}

function directorySnapshot(path: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`refusing archive source symbolic link ${target}`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push({ path: relative(path, target), content: readFileSync(target, "utf8") });
      else throw new Error(`unsupported archive source entry ${target}`);
    }
  }
  visit(path);
  return files;
}

export function previewArchiveBatch(input: ArchiveBatchInput): {
  operationPath: string;
  operation: ArchiveOperation;
  moves: ArchiveMove[];
  writes: ArchiveContentUpdate[];
  tracksPath: string;
  tracksContent: string;
  digest: string;
} {
  if (!BATCH_ID.test(input.batchId)) throw new Error("invalid archive batchId");
  if (!SHA.test(input.baseCommit)) throw new Error("baseCommit must be a Git commit SHA");
  if (!Number.isFinite(Date.parse(input.approvedAt))) throw new Error("approvedAt must be an ISO timestamp");
  if (!input.selectedTracks.length || new Set(input.selectedTracks).size !== input.selectedTracks.length) {
    throw new Error("selectedTracks must be a non-empty ordered set");
  }
  if (input.selectedTracks.some((trackId) => !TRACK_ID.test(trackId))) throw new Error("invalid selected track ID");
  const root = safeProjectRoot(input.projectRoot);
  const validation = requireCurrentProject(root);
  const selected = new Set(input.selectedTracks);
  const updates = input.updates.map((update) => ({ ...update, path: update.path.replaceAll("\\", "/") }));
  if (new Set(updates.map((update) => update.path)).size !== updates.length) {
    throw new Error("archive updates contain duplicate paths");
  }
  for (const update of updates) assertArchiveUpdate(update.path, selected);
  const activeOperations = join(cadreRoot(root), "operations");
  const unfinished = existsSync(activeOperations)
    ? readdirSync(activeOperations).filter((file) => file.endsWith(".json")).find((file) => {
      const operation = JSON.parse(readFileSync(join(activeOperations, file), "utf8")) as { status?: string };
      return operation.status === "in_progress";
    })
    : undefined;
  if (unfinished) throw new Error(`active project operation must be reconciled first: ${unfinished}`);
  const moves = input.selectedTracks.map((trackId): ArchiveMove => {
    const track = validation.tracks.find((candidate) => candidate.id === trackId);
    const state = validation.states.get(trackId);
    if (!track || !state) throw new Error(`unknown selected track ${trackId}`);
    if (track.status !== "completed" || track.location !== `tracks/${trackId}` || state.operation != null) {
      throw new Error(`${trackId} is not an eligible completed track`);
    }
    const sourcePath = join(cadreRoot(root), "tracks", trackId);
    const targetPath = join(cadreRoot(root), "archive", trackId);
    if (existsSync(targetPath)) throw new Error(`archive target already exists for ${trackId}`);
    return { trackId, sourcePath, targetPath, state: { ...state, status: "archived" } };
  });
  const proposedTracks = validation.tracks.map((track): DiscoveredTrack => selected.has(track.id)
    ? { ...track, status: "archived", location: `archive/${track.id}` }
    : track);
  const tracksContent = buildTracks(proposedTracks);
  const expectedCommit = input.selectedTracks.length <= 3
    ? `cadre(archive): archive ${input.selectedTracks.join(" ")}`
    : `cadre(archive): archive batch ${input.batchId}`;
  const moveArtifacts = moves.map((move) => `archive/${move.trackId}`);
  const updateArtifacts = updates.map((update) => update.path);
  const approvedArtifacts = [...moveArtifacts, ...updateArtifacts, "tracks.md", "project.json"];
  const operation: ArchiveOperation = {
    schemaVersion: 1,
    action: "archive",
    batchId: input.batchId,
    status: "in_progress",
    checkpoint: "commit-pending",
    baseCommit: input.baseCommit,
    expectedCommit,
    selectedTracks: [...input.selectedTracks],
    completedTracks: [...input.selectedTracks],
    approvedArtifacts,
    artifactProgress: [...moveArtifacts, ...updateArtifacts, "tracks.md"],
    approvedAt: input.approvedAt,
    archiveCommit: null
  };
  const operationPath = join(cadreRoot(root), "operations", `${input.batchId}.json`);
  if (existsSync(operationPath)) throw new Error(`archive batch ${input.batchId} already exists`);
  const current = {
    project: readFileSync(join(cadreRoot(root), "project.json"), "utf8"),
    tracks: readFileSync(join(cadreRoot(root), "tracks.md"), "utf8"),
    sources: moves.map((move) => ({ trackId: move.trackId, files: directorySnapshot(move.sourcePath) })),
    updates: updates.map((update) => ({
      path: update.path,
      content: existsSync(join(cadreRoot(root), update.path))
        ? readFileSync(join(cadreRoot(root), update.path), "utf8")
        : null
    }))
  };
  return {
    operationPath,
    operation,
    moves,
    writes: updates,
    tracksPath: join(cadreRoot(root), "tracks.md"),
    tracksContent,
    digest: hash({ current, input, operation, moves: moves.map(({ trackId, state }) => ({ trackId, state })), updates, tracksContent })
  };
}

export function applyArchiveBatch(input: ArchiveBatchInput, proposalDigest: string) {
  const proposal = previewArchiveBatch(input);
  if (proposal.digest !== proposalDigest) throw new Error("archive batch proposal is stale; preview it again");
  writeApprovedFile(proposal.operationPath, json(proposal.operation));
  mkdirSync(join(cadreRoot(input.projectRoot), "archive"), { recursive: true });
  for (const move of proposal.moves) {
    renameSync(move.sourcePath, move.targetPath);
    writeApprovedFile(join(move.targetPath, "state.json"), json(move.state));
  }
  for (const update of proposal.writes) writeApprovedFile(join(cadreRoot(input.projectRoot), update.path), update.content);
  writeApprovedFile(proposal.tracksPath, proposal.tracksContent);
  const validation = validateProject(input.projectRoot);
  if (validation.errors.length || validation.warnings.length) {
    throw new Error([...validation.errors, ...validation.warnings].join("\n"));
  }
  return { ...proposal, valid: true, derivedStateCurrent: true };
}

export interface ArchiveBatchRecordInput {
  projectRoot: string;
  batchId: string;
  archiveCommit: string;
}

export function previewArchiveBatchRecord(input: ArchiveBatchRecordInput): {
  operationPath: string;
  operation: ArchiveOperation;
  projectPath: string;
  project: ProjectState;
  states: Array<{ path: string; state: TrackState }>;
  digest: string;
} {
  if (!BATCH_ID.test(input.batchId)) throw new Error("invalid archive batchId");
  if (!SHA.test(input.archiveCommit)) throw new Error("archiveCommit must be a Git commit SHA");
  const root = safeProjectRoot(input.projectRoot);
  const operationPath = join(cadreRoot(root), "operations", `${input.batchId}.json`);
  const operationBody = readFileSync(operationPath, "utf8");
  const currentOperation = JSON.parse(operationBody) as ArchiveOperation;
  if (currentOperation.action !== "archive" || currentOperation.status !== "in_progress") {
    throw new Error(`${input.batchId} is not an in-progress archive batch`);
  }
  const projectPath = join(cadreRoot(root), "project.json");
  const projectBody = readFileSync(projectPath, "utf8");
  const currentProject = JSON.parse(projectBody) as ProjectState;
  const states = currentOperation.selectedTracks.map((trackId) => {
    const path = join(cadreRoot(root), "archive", trackId, "state.json");
    const body = readFileSync(path, "utf8");
    const current = JSON.parse(body) as TrackState;
    if (current.status !== "archived") throw new Error(`${trackId} is not archived`);
    return {
      path,
      body,
      state: {
        ...current,
        commits: { ...(current.commits ?? {}), archive: input.archiveCommit },
        history: [...(Array.isArray(current.history) ? current.history : []), {
          action: "archive", batchId: input.batchId, commit: input.archiveCommit
        }]
      } as TrackState
    };
  });
  const project: ProjectState = {
    ...currentProject,
    history: [...(currentProject.history ?? []), {
      action: "archive",
      batchId: input.batchId,
      tracks: [...currentOperation.selectedTracks],
      commit: input.archiveCommit
    }]
  };
  const operation: ArchiveOperation = {
    ...currentOperation,
    status: "completed",
    checkpoint: "completed",
    archiveCommit: input.archiveCommit
  };
  return {
    operationPath,
    operation,
    projectPath,
    project,
    states: states.map(({ path, state }) => ({ path, state })),
    digest: hash({ operationBody, projectBody, states: states.map(({ path, body, state }) => ({ path, body, state })), operation, project })
  };
}

export function applyArchiveBatchRecord(input: ArchiveBatchRecordInput, proposalDigest: string) {
  const proposal = previewArchiveBatchRecord(input);
  if (proposal.digest !== proposalDigest) throw new Error("archive record proposal is stale; preview it again");
  for (const state of proposal.states) writeApprovedFile(state.path, json(state.state));
  writeApprovedFile(proposal.projectPath, json(proposal.project));
  writeApprovedFile(proposal.operationPath, json(proposal.operation));
  const validation = validateProject(input.projectRoot);
  if (validation.errors.length || validation.warnings.length) {
    throw new Error([...validation.errors, ...validation.warnings].join("\n"));
  }
  return { ...proposal, valid: true, derivedStateCurrent: true };
}
