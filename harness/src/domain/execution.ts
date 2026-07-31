import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CadreError } from "./errors.js";
import { safeProjectRoot } from "./paths.js";
import { parsePlan, parsePlanContent, validatePlanGraph, type PlanGraph } from "./plan.js";
import { renderTracksWithState } from "./tracks-index.js";
import { reachableGitCommits, resolveGitCommit } from "./git.js";

export const EXECUTION_NODE_STATUSES = [
  "pending", "running", "awaiting_approval", "committed", "integrating",
  "conflicted", "integrated", "awaiting_manual_verification", "completed", "blocked"
] as const;
export type ExecutionNodeStatus = typeof EXECUTION_NODE_STATUSES[number];

export const EXECUTION_APPROVAL_MODES = ["governed", "phase", "autonomous"] as const;
export type ExecutionApprovalMode = typeof EXECUTION_APPROVAL_MODES[number];

export interface ExecutionNode {
  id: string;
  kind: "phase" | "task" | "manual-verification";
  phaseId: string;
  dependencies: string[];
  status: ExecutionNodeStatus;
  workerId: string | null;
  workerHistory?: string[];
  worktreePath: string | null;
  branch: string | null;
  workerCommit: string | null;
  mergeCommit: string | null;
  verification: string | null;
  approval: string | null;
  blocker: string | null;
}

export interface ExecutionJournal {
  schemaVersion: number;
  executionId: string;
  trackId: string;
  status: "in_progress" | "completed";
  checkpoint: string;
  requestedMode: "parallel" | "sequential";
  effectiveMode: "parallel" | "sequential";
  approvalMode: ExecutionApprovalMode;
  maxWorkers: number;
  planRevision: number;
  planCommit: string;
  graphDigest: string;
  baseCommit: string;
  startedAt: string;
  completedAt: string | null;
  headCommit: string | null;
  nodes: Record<string, ExecutionNode>;
}

interface ExecutionOperation {
  action: "implement";
  checkpoint: string;
  baseCommit: string;
  expectedCommit: string;
  approvedArtifacts: string[];
  artifactProgress: string[];
  approvedAt: string;
  executionId: string;
  journal: string;
  mode: "parallel" | "sequential";
  approvalMode: ExecutionApprovalMode;
  graphDigest: string;
  planRevision: number;
}

interface ExecutionTrackState {
  trackId: string;
  status: string;
  checkpoint?: string;
  commits?: { plan?: string | null };
  operation?: ExecutionOperation | Record<string, unknown> | null;
  lastExecution?: ({ approvalMode?: ExecutionApprovalMode } & Record<string, unknown>) | null;
  [key: string]: unknown;
}

export interface ExecutionStartInput {
  projectRoot: string;
  trackId: string;
  executionId: string;
  requestedMode: "parallel" | "sequential";
  effectiveMode: "parallel" | "sequential";
  approvalMode?: ExecutionApprovalMode;
  maxWorkers: number;
  baseCommit: string;
  approvedAt: string;
}

export interface ExecutionStartRequest {
  projectRoot: string;
  trackId: string;
  requestedMode?: "parallel" | "sequential";
  approvalMode?: ExecutionApprovalMode;
  maxWorkers?: number;
}

export function deriveExecutionStartInput(input: ExecutionStartRequest): ExecutionStartInput {
  const startedAt = new Date().toISOString();
  const requestedMode = input.requestedMode ?? "parallel";
  return {
    projectRoot: input.projectRoot,
    trackId: input.trackId,
    executionId: startedAt.replace(/[:.]/g, "-"),
    requestedMode,
    effectiveMode: requestedMode,
    ...(input.approvalMode ? { approvalMode: input.approvalMode } : {}),
    maxWorkers: input.maxWorkers ?? 3,
    baseCommit: resolveGitCommit(input.projectRoot),
    approvedAt: startedAt
  };
}

export interface ExecutionProposal {
  journalPath: string;
  journal: ExecutionJournal;
  statePath: string;
  state: ExecutionTrackState;
  digest: string;
}

export interface ExecutionFinishProposal extends ExecutionProposal {
  planPath: string;
  planContent: string;
  tracksPath: string;
  tracksContent: string;
}

export interface ExecutionDerivedStatus {
  readyPhases: string[];
  readyTasks: string[];
  active: string[];
  blocked: string[];
  eventGuidance: Record<string, {
    currentStatus: ExecutionNodeStatus;
    allowed: Array<{
      event: ExecutionCheckpointEvent;
      requiredFields: string[];
    }>;
  }>;
}

const SHA = /^[0-9a-f]{7,40}$/;
const TRACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXECUTION_ID = /^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeJournalAtomically(path: string, journal: ExecutionJournal): void {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function assertIdentifiers(trackId: string, executionId: string): void {
  if (!TRACK_ID.test(trackId)) throw new Error("trackId must be lower-case hyphen-case");
  if (!EXECUTION_ID.test(executionId)) throw new Error("executionId must contain only letters, digits, and hyphens");
}

function activeTrackRoot(projectRoot: string, trackId: string): string {
  return join(safeProjectRoot(projectRoot), ".cadre", "tracks", trackId);
}

function journalRelative(executionId: string): string {
  return `executions/execution-${executionId}.json`;
}

function buildNodes(graph: PlanGraph): Record<string, ExecutionNode> {
  const nodes: Record<string, ExecutionNode> = {};
  for (const phase of graph.phases) {
    const phaseCompleted = phase.tasks.length > 0 && phase.tasks.every((task) => task.checked)
      && phase.completionCommit != null;
    nodes[phase.id] = {
      id: phase.id,
      kind: "phase",
      phaseId: phase.id,
      dependencies: [...phase.dependencies],
      status: phaseCompleted ? "completed" : "pending",
      workerId: null,
      workerHistory: [],
      worktreePath: null,
      branch: null,
      workerCommit: null,
      mergeCommit: phaseCompleted ? phase.completionCommit! : null,
      verification: phaseCompleted ? "carried forward from approved plan provenance" : null,
      approval: phaseCompleted ? "carried forward from approved phase completion" : null,
      blocker: null
    };
    for (const task of phase.tasks) {
      nodes[task.id] = {
        id: task.id,
        kind: task.manualVerification ? "manual-verification" : "task",
        phaseId: phase.id,
        dependencies: [...phase.dependencies, ...task.dependencies],
        status: task.checked ? "completed" : "pending",
        workerId: null,
        workerHistory: [],
        worktreePath: null,
        branch: null,
        workerCommit: task.checked ? task.commit : null,
        mergeCommit: null,
        verification: task.checked ? "carried forward from approved plan provenance" : null,
        approval: task.checked && task.manualVerification
          ? "carried forward from approved manual-verification provenance"
          : null,
        blocker: null
      };
    }
  }
  return nodes;
}

export function previewExecutionStart(input: ExecutionStartInput): ExecutionProposal {
  assertIdentifiers(input.trackId, input.executionId);
  if (input.executionId.startsWith("execution-")) {
    throw new Error("executionId must omit the execution- journal filename prefix");
  }
  if (!SHA.test(input.baseCommit)) throw new Error("baseCommit must be a Git commit SHA");
  if (!Number.isFinite(Date.parse(input.approvedAt))) throw new Error("approvedAt must be an ISO timestamp");
  if (!Number.isInteger(input.maxWorkers) || input.maxWorkers < 1 || input.maxWorkers > 32) {
    throw new Error("maxWorkers must be an integer from 1 through 32");
  }
  if (input.requestedMode === "sequential" && input.effectiveMode !== "sequential") {
    throw new Error("an explicitly sequential execution cannot become parallel");
  }
  const trackRoot = activeTrackRoot(input.projectRoot, input.trackId);
  const statePath = join(trackRoot, "state.json");
  const planPath = join(trackRoot, "plan.md");
  const stateBody = readFileSync(statePath, "utf8");
  const state = JSON.parse(stateBody) as ExecutionTrackState;
  const approvalMode = input.approvalMode ?? state.lastExecution?.approvalMode ?? "phase";
  if (!EXECUTION_APPROVAL_MODES.includes(approvalMode)) throw new Error("approvalMode must be governed, phase, or autonomous");
  if (state.trackId !== input.trackId) throw new Error("track state does not match trackId");
  if (!["planned", "in_progress"].includes(state.status)) throw new Error(`track ${input.trackId} is not implementable from ${state.status}`);
  if (state.operation != null) throw new Error(`track ${input.trackId} already has an active operation`);
  if (!SHA.test(state.commits?.plan ?? "")) throw new Error("track has no approved plan commit");
  const planReachability = reachableGitCommits(input.projectRoot, [state.commits!.plan!]);
  if (planReachability?.get(state.commits!.plan!) === false) {
    throw new Error(`approved plan commit is not reachable: ${state.commits!.plan!}`);
  }
  const planErrors: string[] = [];
  const graph = parsePlan(planPath, planErrors);
  validatePlanGraph(planPath, graph, state.status, planErrors);
  if (planErrors.length) throw new Error(planErrors.join("\n"));
  const planRevision = graph.planRevision!;
  const relativeJournal = journalRelative(input.executionId);
  const journalPath = join(trackRoot, relativeJournal);
  const journal: ExecutionJournal = {
    schemaVersion: 1,
    executionId: input.executionId,
    trackId: input.trackId,
    status: "in_progress",
    checkpoint: "approved",
    requestedMode: input.requestedMode,
    effectiveMode: input.effectiveMode,
    approvalMode,
    maxWorkers: input.maxWorkers,
    planRevision,
    planCommit: state.commits!.plan!,
    graphDigest: graph.digest,
    baseCommit: input.baseCommit,
    startedAt: input.approvedAt,
    completedAt: null,
    headCommit: null,
    nodes: buildNodes(graph)
  };
  if (existsSync(journalPath)) {
    if (lstatSync(journalPath).isSymbolicLink()) throw new Error("refusing an execution journal symbolic link");
    let existing: unknown;
    try {
      existing = JSON.parse(readFileSync(journalPath, "utf8"));
    } catch (error) {
      throw new Error(`existing execution journal is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (JSON.stringify(existing) !== JSON.stringify(journal)) {
      throw new Error(`executionId ${input.executionId} already belongs to a different execution`);
    }
  }
  const operation: ExecutionOperation = {
    action: "implement",
    checkpoint: "approved",
    baseCommit: input.baseCommit,
    expectedCommit: `cadre(implement): start ${input.trackId}`,
    approvedArtifacts: [relativeJournal, "state.json"],
    artifactProgress: [],
    approvedAt: input.approvedAt,
    executionId: input.executionId,
    journal: relativeJournal,
    mode: input.effectiveMode,
    approvalMode,
    graphDigest: graph.digest,
    planRevision
  };
  const proposedState: ExecutionTrackState = {
    ...state,
    status: "in_progress",
    checkpoint: "executing",
    operation
  };
  return {
    journalPath,
    journal,
    statePath,
    state: proposedState,
    digest: hash({ stateBody, planBody: readFileSync(planPath, "utf8"), journal, state: proposedState })
  };
}

export function applyExecutionStart(
  input: ExecutionStartInput,
  proposalDigest: string
): ExecutionProposal & { derivedStatus: ExecutionDerivedStatus } {
  const proposal = previewExecutionStart(input);
  if (proposal.digest !== proposalDigest) throw new Error("execution proposal is stale; preview it again");
  if (lstatSync(proposal.statePath).isSymbolicLink()) throw new Error("refusing to start execution through a state symbolic link");
  mkdirSync(dirname(proposal.journalPath), { recursive: true });
  if (!existsSync(proposal.journalPath)) {
    writeFileSync(proposal.journalPath, `${JSON.stringify(proposal.journal, null, 2)}\n`);
  }
  writeFileSync(proposal.statePath, `${JSON.stringify(proposal.state, null, 2)}\n`);
  return { ...proposal, derivedStatus: deriveExecutionStatus(proposal.journal) };
}

function executionPaths(projectRoot: string, trackId: string, executionId: string): {
  statePath: string;
  journalPath: string;
} {
  assertIdentifiers(trackId, executionId);
  const trackRoot = activeTrackRoot(projectRoot, trackId);
  return { statePath: join(trackRoot, "state.json"), journalPath: join(trackRoot, journalRelative(executionId)) };
}

export function readExecution(projectRoot: string, trackId: string, executionId: string): ExecutionJournal {
  const { journalPath } = executionPaths(projectRoot, trackId, executionId);
  return JSON.parse(readFileSync(journalPath, "utf8")) as ExecutionJournal;
}

const ALLOWED_TRANSITIONS: Record<ExecutionNodeStatus, ExecutionNodeStatus[]> = {
  pending: ["running", "blocked"],
  running: ["awaiting_approval", "awaiting_manual_verification", "blocked"],
  awaiting_approval: ["running", "committed", "awaiting_manual_verification", "blocked"],
  committed: ["integrating", "completed", "blocked"],
  integrating: ["conflicted", "integrated", "blocked"],
  conflicted: ["integrated", "blocked"],
  integrated: ["completed", "awaiting_manual_verification", "blocked"],
  awaiting_manual_verification: ["completed", "blocked"],
  completed: [],
  blocked: ["pending", "running"]
};

export interface ExecutionNodeUpdateInput {
  projectRoot: string;
  trackId: string;
  executionId: string;
  nodeId: string;
  status: ExecutionNodeStatus;
  workerId?: string | null;
  worktreePath?: string | null;
  branch?: string | null;
  workerCommit?: string | null;
  mergeCommit?: string | null;
  verification?: string | null;
  approval?: string | null;
  blocker?: string | null;
}

export type ExecutionNodeUpdate = Omit<ExecutionNodeUpdateInput, "projectRoot" | "trackId" | "executionId">;

export interface ExecutionNodesUpdateInput {
  projectRoot: string;
  trackId: string;
  executionId: string;
  updates: ExecutionNodeUpdate[];
}

function applyNodeTransition(journal: ExecutionJournal, input: ExecutionNodeUpdate): void {
  if (journal.status !== "in_progress") throw new Error("execution is not in progress");
  const node = journal.nodes[input.nodeId];
  if (!node) throw new Error(`unknown execution node ${input.nodeId}`);
  const workerAssignmentChanged = Object.hasOwn(input, "workerId")
    && (input.workerId ?? null) !== node.workerId;
  const phaseWorkerHandoff = node.kind === "phase"
    && node.status === "running"
    && input.status === "running"
    && workerAssignmentChanged
    && (node.workerId == null || input.workerId == null);
  if (!ALLOWED_TRANSITIONS[node.status]?.includes(input.status) && !phaseWorkerHandoff) {
    throw new CadreError(
      "ILLEGAL_EXECUTION_TRANSITION",
      `illegal execution transition ${node.status} -> ${input.status}`,
      {
        nodeId: node.id,
        currentStatus: node.status,
        requestedStatus: input.status,
        allowedNextStatuses: ALLOWED_TRANSITIONS[node.status]
      }
    );
  }
  if (phaseWorkerHandoff && node.workerId != null && input.workerId == null && !input.verification) {
    throw new Error(`${node.id} requires clean-checkpoint verification before releasing its phase worker`);
  }
  const completed = new Set(
    Object.values(journal.nodes).filter((candidate) => candidate.status === "completed").map((candidate) => candidate.id)
  );
  if (input.status === "running") {
    const incompleteDependencies = node.dependencies.filter((dependency) => !completed.has(dependency));
    if (incompleteDependencies.length) {
      throw new Error(`${node.id} has incomplete dependencies: ${incompleteDependencies.join(", ")}`);
    }
    if (node.kind !== "phase" && journal.nodes[node.phaseId]?.status !== "running") {
      throw new Error(`${node.id} cannot start until phase ${node.phaseId} is running`);
    }
  }
  if (node.kind === "phase" && [
    "awaiting_approval", "committed", "integrating", "integrated", "completed"
  ].includes(input.status)) {
    const incompleteTasks = Object.values(journal.nodes)
      .filter((candidate) => candidate.phaseId === node.id && candidate.kind !== "phase" && candidate.status !== "completed")
      .map((candidate) => candidate.id);
    if (incompleteTasks.length) throw new Error(`${node.id} has incomplete tasks: ${incompleteTasks.join(", ")}`);
  }
  const updated: ExecutionNode = { ...node, status: input.status };
  for (const field of [
    "workerId", "worktreePath", "branch", "workerCommit", "mergeCommit",
    "verification", "approval", "blocker"
  ] as const) {
    if (Object.hasOwn(input, field)) updated[field] = input[field] ?? null;
  }
  if (Object.hasOwn(input, "workerId")) {
    const workerHistory = new Set(node.workerHistory ?? []);
    if (node.workerId != null) workerHistory.add(node.workerId);
    if (updated.workerId != null) workerHistory.add(updated.workerId);
    updated.workerHistory = [...workerHistory];
  }
  if (!["blocked", "conflicted"].includes(input.status)) updated.blocker = null;
  if (["blocked", "conflicted"].includes(input.status) && !updated.blocker) {
    throw new Error(`${node.id} requires a blocker description while ${input.status}`);
  }
  if (updated.workerCommit != null && !SHA.test(updated.workerCommit)) throw new Error("workerCommit must be a Git commit SHA");
  if (updated.mergeCommit != null && !SHA.test(updated.mergeCommit)) throw new Error("mergeCommit must be a Git commit SHA");
  if (input.status === "committed" && !updated.workerCommit) {
    throw new Error(`${node.id} requires a commit before it can be marked committed`);
  }
  if (input.status === "committed" && !updated.approval) {
    throw new Error(`${node.id} requires recorded approval authorization before commit`);
  }
  if (input.status === "committed" && node.kind === "task") {
    const duplicate = Object.values(journal.nodes).find(
      (candidate) => candidate.id !== node.id
        && candidate.kind === "task"
        && candidate.phaseId === node.phaseId
        && candidate.workerCommit === updated.workerCommit
    );
    if (duplicate) {
      throw new Error(`${node.id} must use a distinct worker commit from ${duplicate.id}`);
    }
  }
  if (input.status === "integrated" && !updated.mergeCommit) {
    throw new Error(`${node.id} requires a merge commit before it can be marked integrated`);
  }
  if (input.status === "completed") {
    if (node.kind === "phase") {
      const incompleteTasks = Object.values(journal.nodes)
        .filter((candidate) => candidate.phaseId === node.id && candidate.kind !== "phase" && candidate.status !== "completed")
        .map((candidate) => candidate.id);
      if (incompleteTasks.length) throw new Error(`${node.id} has incomplete tasks: ${incompleteTasks.join(", ")}`);
    }
    if (node.kind === "manual-verification" && !updated.approval) {
      throw new Error(`${node.id} requires recorded verification authorization`);
    }
  }
  if (updated.workerId != null) {
    if (node.kind === "phase") {
      const taskWorkers = Object.values(journal.nodes).filter(
        (candidate) => candidate.phaseId === node.id && candidate.kind !== "phase"
          && candidate.workerId != null && candidate.status !== "completed"
      );
      if (taskWorkers.length) throw new Error(`${node.id} cannot acquire a phase worker while task workers are active`);
    } else {
      const phase = journal.nodes[node.phaseId];
      if (phase?.workerId != null) {
        throw new Error(`${node.id} cannot use a task worker while ${node.phaseId} has an active phase worker`);
      }
    }
  }
  journal.nodes[input.nodeId] = updated;
  journal.checkpoint = `${input.nodeId}:${input.status}`;
}

export function previewExecutionNodesUpdate(input: ExecutionNodesUpdateInput): {
  path: string;
  journal: ExecutionJournal;
  digest: string;
} {
  if (!Array.isArray(input.updates) || input.updates.length < 1 || input.updates.length > 128) {
    throw new Error("updates must contain 1 through 128 ordered node transitions");
  }
  const { journalPath } = executionPaths(input.projectRoot, input.trackId, input.executionId);
  const currentBody = readFileSync(journalPath, "utf8");
  const journal = JSON.parse(currentBody) as ExecutionJournal;
  for (const update of input.updates) applyNodeTransition(journal, update);
  return { path: journalPath, journal, digest: hash({ currentBody, journal }) };
}

export function applyExecutionNodesUpdate(input: ExecutionNodesUpdateInput, proposalDigest: string): {
  path: string;
  journal: ExecutionJournal;
  derivedStatus: ExecutionDerivedStatus;
} {
  const proposal = previewExecutionNodesUpdate(input);
  if (proposal.digest !== proposalDigest) throw new Error("execution nodes proposal is stale; preview it again");
  writeJournalAtomically(proposal.path, proposal.journal);
  return {
    path: proposal.path,
    journal: proposal.journal,
    derivedStatus: deriveExecutionStatus(proposal.journal)
  };
}

export function previewExecutionNodeUpdate(input: ExecutionNodeUpdateInput): {
  path: string;
  journal: ExecutionJournal;
  digest: string;
} {
  const { projectRoot, trackId, executionId, ...update } = input;
  return previewExecutionNodesUpdate({ projectRoot, trackId, executionId, updates: [update] });
}

export function applyExecutionNodeUpdate(input: ExecutionNodeUpdateInput, proposalDigest: string): {
  path: string;
  journal: ExecutionJournal;
  derivedStatus: ExecutionDerivedStatus;
} {
  const { projectRoot, trackId, executionId, ...update } = input;
  const proposal = previewExecutionNodesUpdate({ projectRoot, trackId, executionId, updates: [update] });
  if (proposal.digest !== proposalDigest) throw new Error("execution node proposal is stale; preview it again");
  writeJournalAtomically(proposal.path, proposal.journal);
  return {
    path: proposal.path,
    journal: proposal.journal,
    derivedStatus: deriveExecutionStatus(proposal.journal)
  };
}

function deriveExecutionStatus(journal: ExecutionJournal): ExecutionDerivedStatus {
  const completed = new Set(Object.values(journal.nodes).filter((node) => node.status === "completed").map((node) => node.id));
  const ready = Object.values(journal.nodes).filter(
    (node) => node.status === "pending" && node.dependencies.every((dependency) => completed.has(dependency))
  );
  const eventGuidance = Object.fromEntries(Object.values(journal.nodes).map((node) => {
    const allowed: Array<{ event: ExecutionCheckpointEvent; requiredFields: string[] }> = [];
    if (node.status === "pending") allowed.push({ event: "start", requiredFields: [] });
    if (node.status === "running") {
      allowed.push(node.kind === "manual-verification"
        ? { event: "record_verification", requiredFields: ["commit", "verification", "authorization"] }
        : { event: "record_commit", requiredFields: ["commit", "verification", "authorization"] });
    }
    if (node.status === "awaiting_approval") {
      allowed.push({ event: "record_commit", requiredFields: ["commit", "verification", "authorization"] });
    }
    if (node.status === "committed") {
      allowed.push(
        { event: "record_integration", requiredFields: ["commit", "verification"] },
        { event: "complete", requiredFields: [] }
      );
    }
    if (["integrating", "conflicted", "integrated"].includes(node.status)) {
      allowed.push({ event: "record_integration", requiredFields: ["commit", "verification"] });
    }
    if (node.status === "awaiting_manual_verification") {
      allowed.push({ event: "record_verification", requiredFields: ["commit", "verification", "authorization"] });
    }
    if (node.status === "blocked") allowed.push({ event: "resume", requiredFields: [] });
    if (node.status !== "completed") allowed.push({ event: "block", requiredFields: ["blocker"] });
    return [node.id, { currentStatus: node.status, allowed }];
  }));
  return {
    readyPhases: ready.filter((node) => node.kind === "phase").map((node) => node.id),
    readyTasks: ready.filter(
      (node) => node.kind !== "phase" && journal.nodes[node.phaseId]?.status === "running"
    ).map((node) => node.id),
    active: Object.values(journal.nodes).filter((node) => !["pending", "completed", "blocked"].includes(node.status)).map((node) => node.id),
    blocked: Object.values(journal.nodes).filter((node) => node.status === "blocked").map((node) => node.id),
    eventGuidance
  };
}

export function executionStatus(projectRoot: string, trackId: string, executionId: string): {
  journal: ExecutionJournal;
} & ExecutionDerivedStatus {
  const journal = readExecution(projectRoot, trackId, executionId);
  return { journal, ...deriveExecutionStatus(journal) };
}

export const EXECUTION_CHECKPOINT_EVENTS = [
  "start", "record_commit", "record_integration", "record_verification", "complete", "block", "resume"
] as const;
export type ExecutionCheckpointEvent = typeof EXECUTION_CHECKPOINT_EVENTS[number];

export interface ExecutionCheckpointInput {
  projectRoot: string;
  trackId: string;
  executionId: string;
  nodeId: string;
  event: ExecutionCheckpointEvent;
  workerId?: string | null;
  worktreePath?: string | null;
  branch?: string | null;
  commit?: string;
  verification?: string;
  authorization?: string;
  blocker?: string;
}

function checkpointUpdates(journal: ExecutionJournal, input: ExecutionCheckpointInput): ExecutionNodeUpdate[] {
  const node = journal.nodes[input.nodeId];
  if (!node) throw new Error(`unknown execution node ${input.nodeId}`);
  const evidence = input.verification?.trim();
  const authorization = input.authorization?.trim();
  const commit = input.commit;
  const updates: ExecutionNodeUpdate[] = [];
  const start = () => {
    if (node.status === "pending" || node.status === "blocked") {
      updates.push({
        nodeId: node.id,
        status: "running",
        ...(Object.hasOwn(input, "workerId") ? { workerId: input.workerId ?? null } : {}),
        ...(Object.hasOwn(input, "worktreePath") ? { worktreePath: input.worktreePath ?? null } : {}),
        ...(Object.hasOwn(input, "branch") ? { branch: input.branch ?? null } : {})
      });
    } else if (node.status === "running" && Object.hasOwn(input, "workerId")) {
      updates.push({
        nodeId: node.id,
        status: "running",
        workerId: input.workerId ?? null,
        ...(evidence ? { verification: evidence } : {})
      });
    } else if (node.status !== "running") {
      throw new Error(`${node.id} cannot start from ${node.status}`);
    }
  };

  switch (input.event) {
    case "start":
      start();
      break;
    case "record_commit":
      if (!commit || !evidence || !authorization) {
        throw new Error("record_commit requires commit, verification, and authorization");
      }
      if (node.status === "running") {
        updates.push({ nodeId: node.id, status: "awaiting_approval", verification: evidence });
      } else if (node.status !== "awaiting_approval") {
        throw new Error(`${node.id} cannot record a commit from ${node.status}`);
      }
      updates.push({ nodeId: node.id, status: "committed", workerCommit: commit, approval: authorization });
      break;
    case "record_integration":
      if (!commit || !evidence) throw new Error("record_integration requires commit and verification");
      if (node.status === "committed") updates.push({ nodeId: node.id, status: "integrating" });
      else if (node.status !== "integrating" && node.status !== "conflicted" && node.status !== "integrated") {
        throw new Error(`${node.id} cannot record integration from ${node.status}`);
      }
      if (node.status !== "integrated") {
        updates.push({ nodeId: node.id, status: "integrated", mergeCommit: commit, verification: evidence });
      }
      updates.push({ nodeId: node.id, status: "completed" });
      break;
    case "record_verification":
      if (node.kind !== "manual-verification" || !commit || !evidence || !authorization) {
        throw new Error("record_verification requires a manual-verification node, commit, verification, and authorization");
      }
      if (node.status === "pending") updates.push({ nodeId: node.id, status: "running" });
      else if (node.status !== "running" && node.status !== "awaiting_manual_verification") {
        throw new Error(`${node.id} cannot record verification from ${node.status}`);
      }
      if (node.status !== "awaiting_manual_verification") {
        updates.push({ nodeId: node.id, status: "awaiting_manual_verification", verification: evidence, workerCommit: commit });
      }
      updates.push({ nodeId: node.id, status: "completed", workerCommit: commit, approval: authorization });
      break;
    case "complete":
      if (node.status === "committed") updates.push({
        nodeId: node.id,
        status: "completed",
        ...(evidence ? { verification: evidence } : {})
      });
      else if (node.status === "integrated") updates.push({
        nodeId: node.id,
        status: "completed",
        ...(evidence ? { verification: evidence } : {})
      });
      else if (node.kind === "phase" && node.status === "running") {
        if (!commit || !evidence || !authorization) {
          throw new Error("completing a running phase requires commit, verification, and authorization");
        }
        updates.push(
          { nodeId: node.id, status: "awaiting_approval", verification: evidence },
          { nodeId: node.id, status: "committed", workerCommit: commit, approval: authorization },
          { nodeId: node.id, status: "integrating" },
          { nodeId: node.id, status: "integrated", mergeCommit: commit },
          { nodeId: node.id, status: "completed" }
        );
      } else throw new Error(`${node.id} cannot complete from ${node.status}`);
      break;
    case "block":
      if (!input.blocker?.trim()) throw new Error("block requires a blocker description");
      updates.push({ nodeId: node.id, status: "blocked", blocker: input.blocker.trim() });
      break;
    case "resume":
      if (node.status !== "blocked") throw new Error(`${node.id} is not blocked`);
      updates.push({ nodeId: node.id, status: "pending" });
      break;
  }
  if (!updates.length) throw new Error(`${input.event} produced no change for ${node.id}`);
  return updates;
}

export function previewExecutionCheckpoint(input: ExecutionCheckpointInput) {
  const journal = readExecution(input.projectRoot, input.trackId, input.executionId);
  return previewExecutionNodesUpdate({
    projectRoot: input.projectRoot,
    trackId: input.trackId,
    executionId: input.executionId,
    updates: checkpointUpdates(journal, input)
  });
}

export function applyExecutionCheckpoint(input: ExecutionCheckpointInput, proposalDigest: string) {
  const journal = readExecution(input.projectRoot, input.trackId, input.executionId);
  return applyExecutionNodesUpdate({
    projectRoot: input.projectRoot,
    trackId: input.trackId,
    executionId: input.executionId,
    updates: checkpointUpdates(journal, input)
  }, proposalDigest);
}

export interface ExecutionFinishInput {
  projectRoot: string;
  trackId: string;
  executionId: string;
  headCommit: string;
  completedAt: string;
}

export type ExecutionFinishRequest = Pick<ExecutionFinishInput, "projectRoot" | "trackId" | "executionId">;

export function deriveExecutionFinishInput(input: ExecutionFinishRequest): ExecutionFinishInput {
  return {
    ...input,
    headCommit: resolveGitCommit(input.projectRoot),
    completedAt: new Date().toISOString()
  };
}

function renderCompletedPlan(planBody: string, graph: PlanGraph, journal: ExecutionJournal): string {
  const lines = planBody.split(/\r?\n/);
  for (const phase of graph.phases) {
    const phaseNode = journal.nodes[phase.id];
    const phaseCommit = phaseNode?.mergeCommit ?? phaseNode?.workerCommit;
    if (!phaseCommit) throw new Error(`${phase.id} lacks completion commit evidence`);
    for (const task of phase.tasks) {
      const taskNode = journal.nodes[task.id];
      const taskCommit = taskNode?.workerCommit ?? taskNode?.mergeCommit;
      if (!taskNode || taskNode.status !== "completed" || !taskCommit) {
        throw new Error(`${task.id} lacks completed commit evidence`);
      }
      lines[task.line - 1] = `- [x] ${task.id} ${task.title} <!-- commit: ${taskCommit} -->`;
    }
    const nextPhaseLine = graph.phases[phase.number]?.line ?? lines.length + 1;
    const commitLine = lines.findIndex(
      (line, index) => index >= phase.line - 1 && index < nextPhaseLine - 1
        && line.startsWith("- Phase completion commit:")
    );
    if (commitLine < 0) throw new Error(`${phase.id} lacks a completion commit field`);
    lines[commitLine] = `- Phase completion commit: \`${phaseCommit}\``;
  }
  return lines.join("\n");
}

export function previewExecutionFinish(input: ExecutionFinishInput): ExecutionFinishProposal {
  if (!SHA.test(input.headCommit)) throw new Error("headCommit must be a Git commit SHA");
  if (!Number.isFinite(Date.parse(input.completedAt))) throw new Error("completedAt must be an ISO timestamp");
  const { statePath, journalPath } = executionPaths(input.projectRoot, input.trackId, input.executionId);
  const stateBody = readFileSync(statePath, "utf8");
  const journalBody = readFileSync(journalPath, "utf8");
  const state = JSON.parse(stateBody) as ExecutionTrackState;
  const journal = JSON.parse(journalBody) as ExecutionJournal;
  const operation = state.operation as ExecutionOperation | null | undefined;
  if (operation?.action !== "implement" || operation.executionId !== input.executionId) {
    throw new Error("track does not point to this implementation execution");
  }
  if (!(["in_progress", "completed"] as const).includes(journal.status)) throw new Error("execution cannot be completed");
  if (journal.status === "completed"
    && (journal.headCommit !== input.headCommit || journal.completedAt !== input.completedAt)) {
    throw new Error("completed execution journal disagrees with the requested completion");
  }
  const unfinished = Object.values(journal.nodes).filter((node) => node.status !== "completed");
  if (unfinished.length) throw new Error(`execution has unfinished nodes: ${unfinished.map((node) => node.id).join(", ")}`);
  const commits = [
    input.headCommit,
    journal.baseCommit,
    journal.planCommit,
    ...Object.values(journal.nodes).flatMap((node) => [node.workerCommit, node.mergeCommit].filter(Boolean) as string[])
  ];
  const reachability = reachableGitCommits(input.projectRoot, commits);
  const unreachable = reachability
    ? commits.filter((commit) => reachability.get(commit) === false)
    : [];
  if (unreachable.length) throw new Error(`execution contains unreachable commits: ${[...new Set(unreachable)].join(", ")}`);
  const planPath = join(dirname(statePath), "plan.md");
  const planBody = readFileSync(planPath, "utf8");
  const planErrors: string[] = [];
  const graph = parsePlanContent(planBody, planPath, planErrors);
  validatePlanGraph(planPath, graph, "in_progress", planErrors);
  if (planErrors.length) throw new Error(planErrors.join("\n"));
  if (graph.digest !== journal.graphDigest || graph.planRevision !== journal.planRevision) {
    throw new Error("approved plan changed during execution");
  }
  const planContent = renderCompletedPlan(planBody, graph, journal);
  const completedPlanErrors: string[] = [];
  const completedGraph = parsePlanContent(planContent, planPath, completedPlanErrors);
  validatePlanGraph(planPath, completedGraph, "ready_for_review", completedPlanErrors);
  if (completedPlanErrors.length) throw new Error(completedPlanErrors.join("\n"));
  if (completedGraph.digest !== journal.graphDigest) throw new Error("completed plan changed the approved execution graph");
  const worktreeRoot = join(safeProjectRoot(input.projectRoot), ".cadre", ".worktrees", input.trackId, input.executionId);
  if (existsSync(worktreeRoot) && readdirSync(worktreeRoot).length) {
    throw new Error(`execution still has managed worktrees under ${worktreeRoot}`);
  }
  const completedJournal: ExecutionJournal = {
    ...journal,
    status: "completed",
    checkpoint: "completed",
    completedAt: input.completedAt,
    headCommit: input.headCommit
  };
  const completedState: ExecutionTrackState = {
    ...state,
    status: "ready_for_review",
    checkpoint: "ready_for_review",
    operation: null,
    lastExecution: {
      executionId: input.executionId,
      journal: journalRelative(input.executionId),
      approvalMode: journal.approvalMode,
      planRevision: journal.planRevision,
      graphDigest: journal.graphDigest,
      headCommit: input.headCommit,
      completedAt: input.completedAt
    }
  };
  const { tracksPath, tracksBody, tracksContent } = renderTracksWithState(
    input.projectRoot,
    statePath,
    completedState
  );
  return {
    journalPath,
    journal: completedJournal,
    statePath,
    state: completedState,
    planPath,
    planContent,
    tracksPath,
    tracksContent,
    digest: hash({
      stateBody,
      journalBody,
      planBody,
      tracksBody,
      journal: completedJournal,
      state: completedState,
      planContent,
      tracksContent
    })
  };
}

export function applyExecutionFinish(input: ExecutionFinishInput, proposalDigest: string): ExecutionFinishProposal {
  const proposal = previewExecutionFinish(input);
  if (proposal.digest !== proposalDigest) throw new Error("execution completion proposal is stale; preview it again");
  if (lstatSync(proposal.journalPath).isSymbolicLink()
    || lstatSync(proposal.statePath).isSymbolicLink()
    || lstatSync(proposal.planPath).isSymbolicLink()
    || lstatSync(proposal.tracksPath).isSymbolicLink()) {
    throw new Error("refusing to complete execution through a symbolic link");
  }
  const journalTemporaryPath = join(dirname(proposal.journalPath), `.${basename(proposal.journalPath)}.${process.pid}.${randomUUID()}.tmp`);
  const stateTemporaryPath = join(dirname(proposal.statePath), `.${basename(proposal.statePath)}.${process.pid}.${randomUUID()}.tmp`);
  const planTemporaryPath = join(dirname(proposal.planPath), `.${basename(proposal.planPath)}.${process.pid}.${randomUUID()}.tmp`);
  const tracksTemporaryPath = join(dirname(proposal.tracksPath), `.${basename(proposal.tracksPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(journalTemporaryPath, `${JSON.stringify(proposal.journal, null, 2)}\n`, { flag: "wx" });
    writeFileSync(stateTemporaryPath, `${JSON.stringify(proposal.state, null, 2)}\n`, { flag: "wx" });
    writeFileSync(planTemporaryPath, proposal.planContent, { flag: "wx" });
    writeFileSync(tracksTemporaryPath, proposal.tracksContent, { flag: "wx" });
    renameSync(journalTemporaryPath, proposal.journalPath);
    renameSync(stateTemporaryPath, proposal.statePath);
    renameSync(planTemporaryPath, proposal.planPath);
    renameSync(tracksTemporaryPath, proposal.tracksPath);
  } finally {
    if (existsSync(journalTemporaryPath)) unlinkSync(journalTemporaryPath);
    if (existsSync(stateTemporaryPath)) unlinkSync(stateTemporaryPath);
    if (existsSync(planTemporaryPath)) unlinkSync(planTemporaryPath);
    if (existsSync(tracksTemporaryPath)) unlinkSync(tracksTemporaryPath);
  }
  return proposal;
}

export function validateExecutionJournal(
  trackRoot: string,
  state: { trackId: string; status: string; operation?: Record<string, unknown> | null; lastExecution?: Record<string, unknown> | null },
  graph: PlanGraph | null,
  errors: string[]
): void {
  const operation = state.operation;
  const reference = operation?.action === "implement" ? operation : state.lastExecution;
  if (!reference) {
    if (["ready_for_review", "completed", "archived"].includes(state.status)) errors.push(`${state.trackId}: finalized track requires lastExecution`);
    return;
  }
  const relative = String(reference.journal ?? "");
  if (!/^executions\/execution-[0-9A-Za-z-]+\.json$/.test(relative)) {
    errors.push(`${state.trackId}: invalid execution journal path`);
    return;
  }
  const path = resolve(trackRoot, relative);
  if (!path.startsWith(`${resolve(trackRoot)}/`)) {
    errors.push(`${state.trackId}: execution journal escapes track root`);
    return;
  }
  if (!existsSync(path)) {
    errors.push(`${state.trackId}: missing execution journal ${relative}`);
    return;
  }
  let journal: ExecutionJournal;
  try {
    journal = JSON.parse(readFileSync(path, "utf8")) as ExecutionJournal;
  } catch (error) {
    errors.push(`${state.trackId}: invalid execution journal (${error instanceof Error ? error.message : String(error)})`);
    return;
  }
  if (journal.schemaVersion !== 1) errors.push(`${state.trackId}: unsupported execution schemaVersion`);
  if (journal.trackId !== state.trackId) errors.push(`${state.trackId}: execution journal trackId mismatch`);
  if (!EXECUTION_ID.test(journal.executionId)) errors.push(`${state.trackId}: invalid executionId`);
  if (!["parallel", "sequential"].includes(journal.requestedMode) || !["parallel", "sequential"].includes(journal.effectiveMode)) {
    errors.push(`${state.trackId}: invalid execution mode`);
  }
  if (journal.requestedMode === "sequential" && journal.effectiveMode !== "sequential") {
    errors.push(`${state.trackId}: sequential request became parallel`);
  }
  if (!EXECUTION_APPROVAL_MODES.includes(journal.approvalMode ?? "governed")) {
    errors.push(`${state.trackId}: invalid execution approval mode`);
  }
  if (!Number.isInteger(journal.maxWorkers) || journal.maxWorkers < 1 || journal.maxWorkers > 32) errors.push(`${state.trackId}: invalid maxWorkers`);
  const requireCurrentGraph = operation?.action === "implement"
    || ["ready_for_review", "completed", "archived"].includes(state.status);
  if (graph && requireCurrentGraph && (journal.graphDigest !== graph.digest || journal.planRevision !== graph.planRevision)) {
    errors.push(`${state.trackId}: execution journal does not match the current plan graph`);
  }
  if (graph && requireCurrentGraph) {
    const expected = buildNodes(graph);
    const actualIds = Object.keys(journal.nodes ?? {}).sort();
    const expectedIds = Object.keys(expected).sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
      errors.push(`${state.trackId}: execution journal nodes do not exactly match the current plan graph`);
    }
    for (const id of expectedIds) {
      const actual = journal.nodes?.[id];
      const wanted = expected[id]!;
      if (!actual) continue;
      if (actual.kind !== wanted.kind || actual.phaseId !== wanted.phaseId
        || JSON.stringify(actual.dependencies) !== JSON.stringify(wanted.dependencies)) {
        errors.push(`${state.trackId}: execution node ${id} structure does not match the current plan graph`);
      }
    }
  }
  const validStatuses = new Set<string>(EXECUTION_NODE_STATUSES);
  const completedNodes = new Set(
    Object.values(journal.nodes ?? {}).filter((node) => node.status === "completed").map((node) => node.id)
  );
  for (const [id, node] of Object.entries(journal.nodes ?? {})) {
    if (id !== node.id) errors.push(`${state.trackId}: execution node key ${id} does not match node id`);
    if (!validStatuses.has(node.status)) errors.push(`${state.trackId}: execution node ${id} has invalid status ${node.status}`);
    if (node.workerHistory != null && (!Array.isArray(node.workerHistory)
      || node.workerHistory.some((workerId) => typeof workerId !== "string" || workerId.length === 0)
      || new Set(node.workerHistory).size !== node.workerHistory.length)) {
      errors.push(`${state.trackId}: execution node ${id} has invalid worker history`);
    }
    for (const dependency of node.dependencies ?? []) {
      if (!Object.hasOwn(journal.nodes, dependency)) errors.push(`${state.trackId}: execution node ${id} has unknown dependency ${dependency}`);
      else if (!["pending", "blocked"].includes(node.status) && !completedNodes.has(dependency)) {
        errors.push(`${state.trackId}: execution node ${id} advanced before dependency ${dependency} completed`);
      }
    }
    if (node.status === "committed" && (!SHA.test(node.workerCommit ?? "") || !node.approval)) {
      errors.push(`${state.trackId}: committed execution node ${id} lacks commit or approval evidence`);
    }
    if (node.status === "integrated" && !SHA.test(node.mergeCommit ?? "")) {
      errors.push(`${state.trackId}: integrated execution node ${id} lacks merge commit evidence`);
    }
    if (node.kind === "manual-verification" && node.status === "completed" && !node.approval) {
      errors.push(`${state.trackId}: completed manual verification ${id} lacks human approval`);
    }
    if (node.kind === "phase" && node.status === "completed") {
      const incompleteTasks = Object.values(journal.nodes).filter(
        (candidate) => candidate.phaseId === id && candidate.kind !== "phase" && candidate.status !== "completed"
      );
      if (incompleteTasks.length) errors.push(`${state.trackId}: completed phase ${id} retains incomplete tasks`);
    }
  }
  for (const phase of Object.values(journal.nodes ?? {}).filter((node) => node.kind === "phase")) {
    const phaseWorker = phase.status === "running" && phase.workerId != null;
    const taskWorkers = Object.values(journal.nodes).filter(
      (node) => node.phaseId === phase.id && node.kind !== "phase"
        && node.workerId != null && node.status !== "completed"
    );
    if (phaseWorker && taskWorkers.length) {
      errors.push(`${state.trackId}: ${phase.id} has concurrent phase-worker and task-worker ownership`);
    }
  }
  if (operation?.action === "implement" && journal.status !== "in_progress") errors.push(`${state.trackId}: active implement operation requires an in-progress journal`);
  if (operation?.action === "implement") {
    if (operation.executionId !== journal.executionId
      || operation.graphDigest !== journal.graphDigest
      || operation.planRevision !== journal.planRevision
      || String(operation.approvalMode ?? "governed") !== String(journal.approvalMode ?? "governed")) {
      errors.push(`${state.trackId}: implement operation does not match its execution journal`);
    }
  } else if (state.lastExecution) {
    if (state.lastExecution.executionId !== journal.executionId
      || state.lastExecution.graphDigest !== journal.graphDigest
      || state.lastExecution.planRevision !== journal.planRevision
      || state.lastExecution.headCommit !== journal.headCommit
      || String(state.lastExecution.approvalMode ?? "governed") !== String(journal.approvalMode ?? "governed")) {
      errors.push(`${state.trackId}: lastExecution does not match its execution journal`);
    }
  }
  if (["ready_for_review", "completed", "archived"].includes(state.status)) {
    if (journal.status !== "completed") errors.push(`${state.trackId}: finalized track requires a completed execution journal`);
    const unfinished = Object.values(journal.nodes).filter((node) => node.status !== "completed");
    if (unfinished.length) errors.push(`${state.trackId}: finalized execution has unfinished nodes`);
    if (!SHA.test(journal.headCommit ?? "")) errors.push(`${state.trackId}: completed execution requires headCommit`);
    if (!journal.completedAt || !Number.isFinite(Date.parse(journal.completedAt))) {
      errors.push(`${state.trackId}: completed execution requires completedAt`);
    }
  }
}
