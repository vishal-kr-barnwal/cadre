import { resolveApprovalMode } from "./approval-policy.js";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { safeProjectRoot } from "./paths.js";
import { readExecution, validateExecutionJournal, type ExecutionNode } from "./execution.js";
import { contentHash, readSafeArtifact } from "./memory.js";
import { parsePlanContent, validatePlanGraph } from "./plan.js";
import { CadreError } from "./errors.js";

const SHA = /^[0-9a-f]{7,40}$/;
const TRACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXECUTION_ID = /^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/;
const PHASE_ID = /^P\d+$/;
const TASK_ID = /^T(\d+)\.(\d+)$/;

function git(cwd: string, args: string[], allowFailure = false): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  const output = { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status };
  if (!allowFailure && status !== 0) throw new Error((output.stderr || output.stdout || `git ${args[0]} failed`).trim());
  return output;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertRepository(projectRoot: string): string {
  const root = realpathSync(safeProjectRoot(projectRoot));
  const detected = realpathSync(resolve(git(root, ["rev-parse", "--show-toplevel"]).stdout.trim()));
  if (detected !== root) throw new Error(`project root ${root} is not the Git worktree root ${detected}`);
  return root;
}

function assertIds(trackId: string, executionId: string, nodeId: string, phaseId?: string | null): void {
  if (!TRACK_ID.test(trackId)) throw new Error("invalid trackId");
  if (!EXECUTION_ID.test(executionId)) throw new Error("invalid executionId");
  if (!PHASE_ID.test(nodeId) && !TASK_ID.test(nodeId)) throw new Error("nodeId must be a phase or task ID");
  if (phaseId != null && !PHASE_ID.test(phaseId)) throw new Error("invalid phaseId");
  const task = nodeId.match(TASK_ID);
  if (task && phaseId != null && phaseId !== `P${task[1]}`) throw new Error(`${nodeId} does not belong to ${phaseId}`);
  if (!task && phaseId != null && phaseId !== nodeId) throw new Error(`${nodeId} does not belong to ${phaseId}`);
}

function phaseForNode(nodeId: string): string {
  const task = nodeId.match(TASK_ID);
  return task ? `P${task[1]}` : nodeId;
}

function nodeSlug(nodeId: string): string {
  return nodeId.toLowerCase().replace(".", "-");
}

function worktreeIdentity(root: string, trackId: string, executionId: string, nodeId: string, phaseId?: string | null): {
  path: string;
  relativePath: string;
  branch: string;
} {
  assertIds(trackId, executionId, nodeId, phaseId);
  const task = TASK_ID.test(nodeId);
  const resolvedPhaseId = phaseForNode(nodeId);
  const relativePath = task
    ? `.cadre/.worktrees/${trackId}/${executionId}/tasks/${resolvedPhaseId}--${nodeSlug(nodeId)}`
    : `.cadre/.worktrees/${trackId}/${executionId}/phases/${nodeId}`;
  const branch = `cadre/${trackId}/${executionId}/${task ? "task" : "phase"}-${nodeSlug(nodeId)}`;
  return { path: join(root, relativePath), relativePath, branch };
}

function branchHead(root: string, branch: string): string | null {
  const result = git(root, ["rev-parse", "--verify", `refs/heads/${branch}`], true);
  return result.status === 0 ? result.stdout.trim() : null;
}

function registeredWorktrees(root: string): Array<{ path: string; branch: string | null; head: string }> {
  const records: Array<{ path: string; branch: string | null; head: string }> = [];
  let current: { path?: string; branch?: string | null; head?: string } = {};
  for (const line of git(root, ["worktree", "list", "--porcelain"]).stdout.split(/\r?\n/)) {
    if (!line) {
      if (current.path && current.head) records.push({ path: resolve(current.path), branch: current.branch ?? null, head: current.head });
      current = {};
    } else if (line.startsWith("worktree ")) current.path = line.slice("worktree ".length);
    else if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch refs/heads/")) current.branch = line.slice("branch refs/heads/".length);
    else if (line === "detached") current.branch = null;
  }
  if (current.path && current.head) records.push({ path: resolve(current.path), branch: current.branch ?? null, head: current.head });
  return records;
}

export interface WorktreeCreateInput {
  projectRoot: string;
  trackId: string;
  executionId: string;
  nodeId: string;
}

export function previewWorktreeCreate(input: WorktreeCreateInput): {
  projectRoot: string;
  path: string;
  relativePath: string;
  branch: string;
  baseCommit: string;
  existing: boolean;
  digest: string;
} {
  const root = assertRepository(input.projectRoot);
  const target = targetIdentity(root, input);
  const baseCommit = git(target.path, ["rev-parse", "HEAD^{commit}"]).stdout.trim();
  if (!SHA.test(baseCommit)) throw new Error("baseCommit does not resolve to a commit");
  const identity = worktreeIdentity(root, input.trackId, input.executionId, input.nodeId);
  const registered = registeredWorktrees(root).find((entry) => entry.path === resolve(identity.path));
  const existingBranchHead = branchHead(root, identity.branch);
  if (registered && (registered.branch !== identity.branch || registered.head !== existingBranchHead)) {
    throw new Error(`registered worktree disagrees at ${identity.relativePath}`);
  }
  if (!registered && existsSync(identity.path)) throw new Error(`unregistered path already exists: ${identity.path}`);
  if (existingBranchHead) {
    const basedOnExpectedCommit = git(root, ["merge-base", "--is-ancestor", baseCommit, existingBranchHead], true).status === 0;
    if (!basedOnExpectedCommit) throw new Error(`existing branch ${identity.branch} is not based on requested base commit`);
  }
  const proposal = {
    projectRoot: root,
    ...identity,
    baseCommit,
    existing: Boolean(registered)
  };
  return { ...proposal, digest: hash(proposal) };
}

export function applyWorktreeCreate(
  input: WorktreeCreateInput,
  proposalDigest: string,
  preparedProposal?: ReturnType<typeof previewWorktreeCreate>
): ReturnType<typeof previewWorktreeCreate> {
  const proposal = preparedProposal ?? previewWorktreeCreate(input);
  if (proposal.digest !== proposalDigest) throw new Error("worktree proposal is stale; preview it again");
  if (proposal.existing) return proposal;
  const existingBranch = branchHead(proposal.projectRoot, proposal.branch);
  const args = existingBranch
    ? ["worktree", "add", proposal.path, proposal.branch]
    : ["worktree", "add", proposal.path, "-b", proposal.branch, proposal.baseCommit];
  git(proposal.projectRoot, args);
  return previewWorktreeCreate(input);
}

function cleanWorktree(path: string, allowedPaths: ReadonlySet<string> = new Set()): void {
  const lines = git(path, ["status", "--porcelain", "--untracked-files=all"]).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  const unexpected = lines.filter((line) => {
    const changedPath = line.slice(3).split(" -> ").at(-1) ?? "";
    return !allowedPaths.has(changedPath);
  });
  if (unexpected.length) throw new CadreError("WORKTREE_DIRTY", `worktree is not clean: ${path}; ${unexpected.length} unexpected changes`, { pathCount: unexpected.length, paths: unexpected });
}

/** Only the bound coordinator journal/state may remain dirty in the canonical worktree. */
function ownedExecutionState(root: string, input: WorktreeIntegrationInput): Record<string, string> {
  const parent = `.cadre/tracks/${input.trackId}`;
  const statePath = `${parent}/state.json`, journalPath = `${parent}/executions/execution-${input.executionId}.json`;
  const body = readSafeArtifact(root, statePath), state = JSON.parse(body);
  if (state.trackId !== input.trackId || state.status !== "in_progress" || state.operation?.action !== "implement"
    || state.operation.executionId !== input.executionId || state.operation.journal !== `executions/execution-${input.executionId}.json`) {
    throw new CadreError("INTEGRATION_STATE_OWNERSHIP", "Canonical state is not owned by the active execution.");
  }
  const committed = git(root, ["show", `HEAD:${statePath}`], true);
  if (committed.status !== 0) throw new Error("Integration requires an approved committed track baseline");
  const previous = JSON.parse(committed.stdout);
  const stable = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !["status", "checkpoint", "operation", "autonomousReview"].includes(key)));
  if (JSON.stringify(stable(previous)) !== JSON.stringify(stable(state))) throw new CadreError("INTEGRATION_STATE_OWNERSHIP", "Unrelated canonical state changes must be reconciled before integration.");
  const activeJournal = readExecution(root, input.trackId, input.executionId);
  const expectedAuthority = activeJournal.approvalMode !== "autonomous" ? previous.autonomousReview : previous.autonomousReview
    ? { ...previous.autonomousReview, checkpoint: "implementing" }
    : { policyVersion: 2, originExecutionId: input.executionId, authorizedAt: activeJournal.startedAt,
      initialBaseCommit: activeJournal.baseCommit, specCommit: state.commits?.spec, checkpoint: "implementing", findings: [] };
  if (JSON.stringify(state.autonomousReview) !== JSON.stringify(expectedAuthority)) throw new CadreError("INTEGRATION_STATE_OWNERSHIP", "Execution authority changed outside the approved operation.");
  const errors: string[] = [];
  const graph = parsePlanContent(readSafeArtifact(root, `${parent}/plan.md`), `${parent}/plan.md`, errors);
  validatePlanGraph(`${parent}/plan.md`, graph, state.status, errors);
  validateExecutionJournal(join(root, parent), state, graph, errors);
  if (errors.length) throw new CadreError("INTEGRATION_STATE_INVALID", `Active execution state failed validation: ${errors.slice(0, 3).join("; ")}`, { errors });
  return { [statePath]: contentHash(body), [journalPath]: contentHash(readSafeArtifact(root, journalPath)) };
}

function targetIdentity(root: string, input: { trackId: string; executionId: string; nodeId: string }): {
  path: string;
  branch: string;
} {
  if (TASK_ID.test(input.nodeId)) {
    const phaseId = phaseForNode(input.nodeId);
    const phase = worktreeIdentity(root, input.trackId, input.executionId, phaseId, null);
    const phaseWorktree = registeredWorktrees(root).find((entry) => entry.path === resolve(phase.path));
    if (phaseWorktree) {
      if (phaseWorktree.branch !== phase.branch) throw new Error(`phase worktree is not on ${phase.branch}`);
      return { path: phase.path, branch: phase.branch };
    }
  }
  const branch = git(root, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
  if (!branch) throw new Error("canonical worktree must be on a branch");
  return { path: root, branch };
}

function journalNode(input: WorktreeIntegrationInput): { node: ExecutionNode; nodes: Record<string, ExecutionNode> } {
  const journal = readExecution(input.projectRoot, input.trackId, input.executionId);
  const node = journal.nodes[input.nodeId];
  if (!node) throw new Error(`execution journal has no node ${input.nodeId}`);
  assertIds(input.trackId, input.executionId, input.nodeId);
  if (node.phaseId !== phaseForNode(input.nodeId)) {
    throw new Error(`execution journal identity disagrees for ${input.nodeId}`);
  }
  return { node, nodes: journal.nodes };
}

function assertJournalAllowsIntegration(input: WorktreeIntegrationInput): void {
  const { node, nodes } = journalNode(input);
  if (!["committed", "integrating"].includes(node.status)) {
    throw new Error(`${input.nodeId} must be committed or integrating in the execution journal before integration`);
  }
  if (node.kind === "phase") {
    const incompleteTasks = Object.values(nodes)
      .filter((candidate) => candidate.phaseId === node.id && candidate.kind !== "phase" && candidate.status !== "completed")
      .map((candidate) => candidate.id);
    if (incompleteTasks.length) {
      throw new Error(`${node.id} has incomplete tasks: ${incompleteTasks.join(", ")}`);
    }
  }
}

function assertJournalAllowsCleanup(input: WorktreeIntegrationInput): void {
  const { node } = journalNode(input);
  if (!["integrated", "completed"].includes(node.status)) {
    throw new Error(`${input.nodeId} must be integrated or completed in the execution journal before cleanup`);
  }
}

export interface WorktreeIntegrationInput {
  projectRoot: string;
  trackId: string;
  executionId: string;
  nodeId: string;
}

export function previewWorktreeIntegration(input: WorktreeIntegrationInput): {
  sourcePath: string;
  sourceBranch: string;
  sourceHead: string;
  targetPath: string;
  targetBranch: string;
  targetHead: string;
  changedFiles: string[];
  alreadyIntegrated: boolean;
  ownedState: Record<string, string>;
  digest: string;
} {
  assertJournalAllowsIntegration(input);
  const root = assertRepository(input.projectRoot);
  const source = worktreeIdentity(root, input.trackId, input.executionId, input.nodeId);
  const target = targetIdentity(root, input);
  if (!existsSync(source.path)) throw new Error(`source worktree is missing: ${source.path}`);
  if (!existsSync(target.path)) throw new Error(`target worktree is missing: ${target.path}`);
  cleanWorktree(source.path);
  const ownedState = target.path === root ? ownedExecutionState(root, input) : {};
  cleanWorktree(target.path, new Set(Object.keys(ownedState)));
  const checkedSource = git(source.path, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
  const checkedTarget = git(target.path, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
  if (checkedSource !== source.branch) throw new Error(`source worktree is on ${checkedSource}, expected ${source.branch}`);
  if (checkedTarget !== target.branch) throw new Error(`target worktree is on ${checkedTarget}, expected ${target.branch}`);
  const sourceHead = git(source.path, ["rev-parse", "HEAD"]).stdout.trim();
  const targetHead = git(target.path, ["rev-parse", "HEAD"]).stdout.trim();
  const changedFiles = git(root, ["diff", "--name-only", `${targetHead}...${sourceHead}`]).stdout.split(/\r?\n/).filter(Boolean);
  if (changedFiles.some((file) => file === ".cadre" || file.startsWith(".cadre/"))) {
    throw new Error("worker branch modifies protected .cadre state");
  }
  const proposal = {
    sourcePath: source.path,
    sourceBranch: source.branch,
    sourceHead,
    targetPath: target.path,
    targetBranch: target.branch,
    targetHead,
    changedFiles,
    ownedState,
    alreadyIntegrated: git(root, ["merge-base", "--is-ancestor", sourceHead, targetHead], true).status === 0
  };
  return { ...proposal, digest: hash(proposal) };
}

export function applyWorktreeIntegration(
  input: WorktreeIntegrationInput,
  proposalDigest: string,
  preparedProposal?: ReturnType<typeof previewWorktreeIntegration>
): {
  status: "integrated" | "conflicted";
  mergeCommit: string | null;
  conflicts: string[];
  targetPath: string;
  integrationKind: "fast-forward" | "merge" | "already-integrated";
} {
  // Re-read ownership and Git heads even when transport supplies its preview.
  const proposal = previewWorktreeIntegration(input);
  if (proposal.digest !== proposalDigest) throw new Error("integration proposal is stale; preview it again");
  if (proposal.alreadyIntegrated) {
    return { status: "integrated", mergeCommit: proposal.targetHead, conflicts: [], targetPath: proposal.targetPath, integrationKind: "already-integrated" };
  }
  const fastForward = git(proposal.targetPath, ["merge-base", "--is-ancestor", proposal.targetHead, proposal.sourceHead], true).status === 0;
  const integrationKind = fastForward ? "fast-forward" : "merge";
  const merge = git(proposal.targetPath, ["merge", fastForward ? "--ff-only" : "--no-ff", "--no-edit", proposal.sourceHead], true);
  for (const [path, expected] of Object.entries(proposal.ownedState)) {
    if (contentHash(readSafeArtifact(proposal.targetPath, path)) !== expected) throw new CadreError("INTEGRATION_STATE_CHANGED", "Owned execution state changed across integration; stop and reconcile.", { path });
  }
  if (merge.status !== 0) {
    const conflicts = git(proposal.targetPath, ["diff", "--name-only", "--diff-filter=U"], true).stdout.split(/\r?\n/).filter(Boolean);
    if (!conflicts.length) throw new Error((merge.stderr || merge.stdout || "git merge failed").trim());
    return { status: "conflicted", mergeCommit: null, conflicts, targetPath: proposal.targetPath, integrationKind };
  }
  return {
    status: "integrated",
    integrationKind,
    mergeCommit: git(proposal.targetPath, ["rev-parse", "HEAD"]).stdout.trim(),
    conflicts: [],
    targetPath: proposal.targetPath
  };
}

export function previewWorktreeCleanup(input: WorktreeIntegrationInput): {
  path: string;
  branch: string;
  targetPath: string;
  targetBranch: string;
  head: string;
  alreadyRemoved: boolean;
  digest: string;
} {
  assertJournalAllowsCleanup(input);
  const root = assertRepository(input.projectRoot);
  const source = worktreeIdentity(root, input.trackId, input.executionId, input.nodeId);
  const target = targetIdentity(root, input);
  if (!existsSync(source.path)) {
    const branch = branchHead(root, source.branch);
    const targetHead = git(target.path, ["rev-parse", "HEAD"]).stdout.trim();
    if (branch && git(root, ["merge-base", "--is-ancestor", branch, target.branch], true).status !== 0) {
      throw new Error(`${source.branch} is not integrated into ${target.branch}`);
    }
    const proposal = {
      path: source.path,
      branch: source.branch,
      targetPath: target.path,
      targetBranch: target.branch,
      head: branch ?? targetHead,
      alreadyRemoved: true
    };
    return { ...proposal, digest: hash(proposal) };
  }
  if (lstatSync(source.path).isSymbolicLink()) throw new Error("refusing to clean up a symbolic-link worktree");
  cleanWorktree(source.path);
  const head = git(source.path, ["rev-parse", "HEAD"]).stdout.trim();
  const ancestor = git(root, ["merge-base", "--is-ancestor", source.branch, target.branch], true);
  if (ancestor.status !== 0) throw new Error(`${source.branch} is not integrated into ${target.branch}`);
  const proposal = {
    path: source.path,
    branch: source.branch,
    targetPath: target.path,
    targetBranch: target.branch,
    head,
    alreadyRemoved: false
  };
  return { ...proposal, digest: hash(proposal) };
}

export function applyWorktreeCleanup(
  input: WorktreeIntegrationInput,
  proposalDigest: string,
  preparedProposal?: ReturnType<typeof previewWorktreeCleanup>
): {
  removedPath: string;
  removedBranch: string;
} {
  const proposal = preparedProposal ?? previewWorktreeCleanup(input);
  if (proposal.digest !== proposalDigest) throw new Error("cleanup proposal is stale; preview it again");
  const root = assertRepository(input.projectRoot);
  if (!proposal.alreadyRemoved) git(root, ["worktree", "remove", proposal.path]);
  if (branchHead(root, proposal.branch)) git(proposal.targetPath, ["branch", "-d", proposal.branch]);
  const managedRoot = join(root, ".cadre", ".worktrees");
  let directory = dirname(proposal.path);
  while (directory.startsWith(`${managedRoot}/`)) {
    if (!existsSync(directory) || readdirSync(directory).length) break;
    rmdirSync(directory);
    directory = dirname(directory);
  }
  return { removedPath: proposal.path, removedBranch: proposal.branch };
}

export function integrationRequiresApproval(input: WorktreeIntegrationInput): boolean {
  return resolveApprovalMode(readExecution(input.projectRoot, input.trackId, input.executionId)) === "governed";
}

export function managedWorktreeStatus(projectRoot: string): {
  worktrees: Array<{ path: string; branch: string | null; head: string; managed: boolean }>;
  orphanedDirectories: string[];
} {
  const root = assertRepository(projectRoot);
  const managedRoot = join(root, ".cadre", ".worktrees");
  const worktrees = registeredWorktrees(root).map((entry) => ({
    ...entry,
    managed: relative(managedRoot, entry.path) !== "" && !relative(managedRoot, entry.path).startsWith("..")
  }));
  const registered = new Set(worktrees.filter((entry) => entry.managed).map((entry) => entry.path));
  const orphanedDirectories: string[] = [];
  function walk(directory: string): void {
    if (!existsSync(directory)) return;
    if (registered.has(resolve(directory))) return;
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === ".git")) {
      orphanedDirectories.push(directory);
      return;
    }
    for (const entry of entries) if (entry.isDirectory()) walk(join(directory, entry.name));
    if (!entries.length && resolve(directory) !== resolve(managedRoot)) orphanedDirectories.push(directory);
  }
  walk(managedRoot);
  return { worktrees, orphanedDirectories };
}
