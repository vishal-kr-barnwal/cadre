import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { safeProjectRoot } from "./paths.js";
import { isGitAncestor, resolveGitCommit } from "./git.js";
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

export interface ReviewCompleteRequest {
  projectRoot: string;
  trackId: string;
  commitRangeStart: string;
  approval: string;
  acceptedRisks?: string[];
}

export function deriveReviewCompleteInput(input: ReviewCompleteRequest): ReviewCompleteInput {
  const validation = requireCurrentProject(input.projectRoot);
  const state = validation.states.get(input.trackId);
  const reviewedHead = state?.lastExecution?.headCommit;
  if (!reviewedHead || !SHA.test(reviewedHead)) throw new Error(`${input.trackId} has no completed execution head`);
  if (!isGitAncestor(input.projectRoot, reviewedHead)) {
    throw new Error(`completed execution head ${reviewedHead} is not an ancestor of current HEAD`);
  }
  const commitRangeStart = resolveGitCommit(input.projectRoot, input.commitRangeStart);
  return {
    projectRoot: input.projectRoot,
    trackId: input.trackId,
    reviewedAt: new Date().toISOString(),
    reviewedHead,
    commitRange: `${commitRangeStart}..${reviewedHead}`,
    approval: input.approval,
    ...(input.acceptedRisks ? { acceptedRisks: input.acceptedRisks } : {})
  };
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

export type ArchiveContentRequest =
  | { kind: "pattern"; slug: string; content: string }
  | { kind: "pattern_index"; content: string }
  | { kind: "active_track_seed"; trackId: string; content: string };

export interface ArchiveBatchRequest {
  projectRoot: string;
  selectedTracks?: string[];
  updates: ArchiveContentRequest[];
}

interface ArchiveMove {
  trackId: string;
  sourcePath: string;
  targetPath: string;
  state: TrackState;
  needsMove: boolean;
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
  approvalDigest: string;
  archiveCommit: string | null;
}

function dependencyOrder(tracks: DiscoveredTrack[]): string[] {
  const included = new Set(tracks.map((track) => track.id));
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (trackId: string) => {
    if (visited.has(trackId)) return;
    if (visiting.has(trackId)) throw new Error(`track dependency cycle includes ${trackId}`);
    visiting.add(trackId);
    for (const dependency of byId.get(trackId)?.dependencies ?? []) {
      if (included.has(dependency)) visit(dependency);
    }
    visiting.delete(trackId);
    visited.add(trackId);
    ordered.push(trackId);
  };
  for (const track of tracks) visit(track.id);
  return ordered;
}

export function deriveArchiveBatchInput(input: ArchiveBatchRequest): ArchiveBatchInput {
  const root = safeProjectRoot(input.projectRoot);
  const validation = requireCurrentProject(root);
  const operationsPath = join(cadreRoot(root), "operations");
  const activeOperation = existsSync(operationsPath)
    ? readdirSync(operationsPath).filter((file) => file.endsWith(".json")).map((file) =>
      JSON.parse(readFileSync(join(operationsPath, file), "utf8")) as ArchiveOperation
    ).find((operation) => operation.action === "archive" && operation.status === "in_progress")
    : undefined;
  const selectedTracks = input.selectedTracks?.length
    ? [...new Set(input.selectedTracks)]
    : activeOperation?.selectedTracks ?? dependencyOrder(
      validation.tracks.filter((track) => track.status === "completed" && track.location === `tracks/${track.id}`)
    );
  if (!selectedTracks.length) throw new Error("there are no completed tracks to archive");
  if (activeOperation && JSON.stringify(selectedTracks) !== JSON.stringify(activeOperation.selectedTracks)) {
    throw new Error(`active archive batch ${activeOperation.batchId} must be resumed with its original selection`);
  }
  const now = new Date().toISOString();
  const updates = input.updates.map((update): ArchiveContentUpdate => {
    if (update.kind === "pattern") {
      if (!TRACK_ID.test(update.slug)) throw new Error(`invalid pattern slug ${update.slug}`);
      return { path: `patterns/${update.slug}.md`, content: update.content };
    }
    if (update.kind === "pattern_index") return { path: "patterns/index.md", content: update.content };
    if (!TRACK_ID.test(update.trackId)) throw new Error(`invalid active track ID ${update.trackId}`);
    return { path: `tracks/${update.trackId}/learning.md`, content: update.content };
  });
  return {
    projectRoot: root,
    batchId: activeOperation?.batchId ?? `archive-${now.replace(/[:.]/g, "-")}`,
    selectedTracks,
    baseCommit: activeOperation?.baseCommit ?? resolveGitCommit(root),
    approvedAt: activeOperation?.approvedAt ?? now,
    updates
  };
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
  initialOperation: ArchiveOperation;
  operation: ArchiveOperation;
  moves: ArchiveMove[];
  writes: ArchiveContentUpdate[];
  tracksPath: string;
  tracksContent: string;
  resuming: boolean;
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
  const operationPath = join(cadreRoot(root), "operations", `${input.batchId}.json`);
  const existingOperation = existsSync(operationPath)
    ? JSON.parse(readFileSync(operationPath, "utf8")) as ArchiveOperation
    : null;
  if (existingOperation && (existingOperation.action !== "archive"
    || existingOperation.status !== "in_progress"
    || existingOperation.baseCommit !== input.baseCommit
    || JSON.stringify(existingOperation.selectedTracks) !== JSON.stringify(input.selectedTracks))) {
    throw new Error(`archive batch ${input.batchId} does not match the approved input`);
  }
  const validation = requireCurrentProject(root);
  const selected = new Set(input.selectedTracks);
  const updates = input.updates.map((update) => ({ ...update, path: update.path.replaceAll("\\", "/") }));
  if (new Set(updates.map((update) => update.path)).size !== updates.length) {
    throw new Error("archive updates contain duplicate paths");
  }
  for (const update of updates) assertArchiveUpdate(update.path, selected);
  const approvalDigest = hash({
    batchId: input.batchId,
    selectedTracks: input.selectedTracks,
    baseCommit: input.baseCommit,
    approvedAt: input.approvedAt,
    updates
  });
  if (existingOperation && existingOperation.approvalDigest !== approvalDigest) {
    throw new Error(`archive batch ${input.batchId} content differs from its approved journal`);
  }
  const activeOperations = join(cadreRoot(root), "operations");
  const unfinished = existsSync(activeOperations)
    ? readdirSync(activeOperations).filter((file) => file.endsWith(".json")).find((file) => {
      const operation = JSON.parse(readFileSync(join(activeOperations, file), "utf8")) as { status?: string };
      return operation.status === "in_progress";
    })
    : undefined;
  if (unfinished && unfinished !== `${input.batchId}.json`) {
    throw new Error(`active project operation must be reconciled first: ${unfinished}`);
  }
  const moves = input.selectedTracks.map((trackId): ArchiveMove => {
    const track = validation.tracks.find((candidate) => candidate.id === trackId);
    const state = validation.states.get(trackId);
    if (!track || !state) throw new Error(`unknown selected track ${trackId}`);
    const pending = track.status === "completed" && track.location === `tracks/${trackId}`;
    const completed = existingOperation?.completedTracks.includes(trackId)
      && track.status === "archived" && track.location === `archive/${trackId}`;
    if ((!pending && !completed) || state.operation != null) {
      throw new Error(`${trackId} is not an eligible completed track`);
    }
    const sourcePath = join(cadreRoot(root), pending ? "tracks" : "archive", trackId);
    const targetPath = join(cadreRoot(root), "archive", trackId);
    if (pending && existsSync(targetPath)) throw new Error(`archive target already exists for ${trackId}`);
    return { trackId, sourcePath, targetPath, state: { ...state, status: "archived" }, needsMove: pending };
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
  const initialOperation: ArchiveOperation = {
    schemaVersion: 1,
    action: "archive",
    batchId: input.batchId,
    status: "in_progress",
    checkpoint: "approved",
    baseCommit: input.baseCommit,
    expectedCommit,
    selectedTracks: [...input.selectedTracks],
    completedTracks: [],
    approvedArtifacts,
    artifactProgress: [],
    approvedAt: input.approvedAt,
    approvalDigest,
    archiveCommit: null
  };
  const operation: ArchiveOperation = {
    ...initialOperation,
    checkpoint: "commit-pending",
    completedTracks: [...input.selectedTracks],
    artifactProgress: [...moveArtifacts, ...updateArtifacts, "tracks.md"]
  };
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
    initialOperation,
    operation,
    moves,
    writes: updates,
    tracksPath: join(cadreRoot(root), "tracks.md"),
    tracksContent,
    resuming: existingOperation != null,
    digest: hash({ current, input, initialOperation, operation, moves: moves.map(({ trackId, state, needsMove }) => ({ trackId, state, needsMove })), updates, tracksContent })
  };
}

export function applyArchiveBatch(input: ArchiveBatchInput, proposalDigest: string) {
  const proposal = previewArchiveBatch(input);
  if (proposal.digest !== proposalDigest) throw new Error("archive batch proposal is stale; preview it again");
  const currentOperation = existsSync(proposal.operationPath)
    ? JSON.parse(readFileSync(proposal.operationPath, "utf8")) as ArchiveOperation
    : proposal.initialOperation;
  if (!existsSync(proposal.operationPath)) writeApprovedFile(proposal.operationPath, json(currentOperation));
  mkdirSync(join(cadreRoot(input.projectRoot), "archive"), { recursive: true });
  const completedTracks = new Set(currentOperation.completedTracks);
  const artifactProgress = new Set(currentOperation.artifactProgress);
  for (const move of proposal.moves) {
    if (move.needsMove) renameSync(move.sourcePath, move.targetPath);
    writeApprovedFile(join(move.targetPath, "state.json"), json(move.state));
    completedTracks.add(move.trackId);
    artifactProgress.add(`archive/${move.trackId}`);
    writeApprovedFile(proposal.operationPath, json({
      ...currentOperation,
      completedTracks: [...currentOperation.selectedTracks].filter((trackId) => completedTracks.has(trackId)),
      artifactProgress: [...artifactProgress]
    }));
  }
  for (const update of proposal.writes) {
    writeApprovedFile(join(cadreRoot(input.projectRoot), update.path), update.content);
    artifactProgress.add(update.path);
    writeApprovedFile(proposal.operationPath, json({
      ...currentOperation,
      completedTracks: [...currentOperation.selectedTracks].filter((trackId) => completedTracks.has(trackId)),
      artifactProgress: [...artifactProgress]
    }));
  }
  writeApprovedFile(proposal.tracksPath, proposal.tracksContent);
  writeApprovedFile(proposal.operationPath, json(proposal.operation));
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

export type ArchiveBatchRecordRequest = Omit<ArchiveBatchRecordInput, "archiveCommit">;

export function deriveArchiveBatchRecordInput(input: ArchiveBatchRecordRequest): ArchiveBatchRecordInput {
  return { ...input, archiveCommit: resolveGitCommit(input.projectRoot) };
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
