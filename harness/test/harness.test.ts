import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync,
  unlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { formatStatus, renderTracksPreview, validateProject, writeTracks } from "../src/domain/state.js";
import { parsePlan, parsePlanContent, validatePlanGraph } from "../src/domain/plan.js";
import {
  applyExecutionCheckpoint, applyExecutionFinish, applyExecutionNodeUpdate, applyExecutionNodesUpdate,
  applyExecutionStart, compactExecutionStatus, executionStatus, previewExecutionCheckpoint, previewExecutionFinish,
  previewExecutionNodeUpdate, previewExecutionNodesUpdate, previewExecutionStart,
  type ExecutionJournal, type ExecutionNodeStatus
} from "../src/domain/execution.js";
import {
  applyWorktreeCleanup, applyWorktreeCreate, applyWorktreeIntegration, managedWorktreeStatus,
  previewWorktreeCleanup, previewWorktreeCreate, previewWorktreeIntegration
} from "../src/domain/worktrees.js";
import {
  applyArchiveBatchCandidate, applyArchiveBatchRecord, applyReviewComplete,
  previewArchiveBatchCandidate, previewArchiveBatchRecord, previewReviewComplete
} from "../src/domain/governance.js";
import {
  CLAUDE_APPROVAL,
  CLAUDE_SERVER_APPROVAL,
  configureClaudeMcpApproval,
  configureCodexMcpApproval
} from "../scripts/permissions.js";
import { TEMPLATE_IDS } from "../src/domain/templates.js";
import {
  buildWorkflowElicitation,
  normalizeWorkflowElicitation,
  supportsFormElicitation
} from "../src/mcp/elicitation.js";
import { ProposalTokenStore } from "../src/mcp/proposals.js";
import {
  applyProjectInitCandidate, previewProjectInitCandidate, recordGitInitialized, recordSetupCommit
} from "../src/domain/init.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(root, "templates", "v1", "init");
const providerRoot = join(root, "templates", "v1");

function childEnvironment(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter((entry): entry is [string, string] => entry[1] != null)
  );
}

function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-test-"));
  cpSync(templateRoot, join(projectRoot, ".cadre"), { recursive: true });
  renameSync(
    join(projectRoot, ".cadre", "gitignore.template"),
    join(projectRoot, ".cadre", ".gitignore")
  );
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.runtimeVersion = "3.3.0";
  project.templateSetVersion = "v1";
  project.project.name = "Fixture";
  project.project.context = "brownfield";
  project.setup = {
    status: "completed",
    checkpoint: "completed",
    commit: "1111111",
    artifactProgress: [],
    operation: null
  };
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  return projectRoot;
}

function runState(projectRoot: string, command: "render" | "validate" | "status", expectFailure = false) {
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    if (command === "render") {
      const preview = renderTracksPreview(projectRoot);
      writeTracks(projectRoot, preview.digest);
      stdout = `${preview.path}\n`;
    } else if (command === "validate") {
      const validation = validateProject(projectRoot);
      status = validation.errors.length ? 1 : 0;
      stdout = status ? "" : "Cadre state is valid\n";
      stderr = status ? `${validation.errors.join("\n")}\n` : "";
    } else stdout = formatStatus(projectRoot).text;
  } catch (error) {
    status = 1;
    stderr = `${error instanceof Error ? error.message : String(error)}\n`;
  }
  if (!expectFailure && status !== 0) throw new Error(stderr || stdout);
  return { status, stdout, stderr };
}

test("proposal tokens remain compact and bind server-retained input by kind", () => {
  const proposalRoot = join(mkdtempSync(join(tmpdir(), "cadre-proposals-")), "runtime", "proposals");
  let now = new Date("2026-08-08T00:00:00.000Z");
  const options = { root: proposalRoot, now: () => now };
  const proposals = new ProposalTokenStore(options);
  const input = { content: "x".repeat(512 * 1024), nested: { approved: true } };
  const digest = "a".repeat(64);
  const token = proposals.issue("large_proposal", input, digest);

  assert.ok(token.length < 64, `expected a compact proposal token, got ${token.length} characters`);
  assert.deepEqual(new ProposalTokenStore(options).resolve("large_proposal", token), { input, digest });
  assert.throws(() => proposals.resolve("other_proposal", token), /large_proposal, not other_proposal/);
  assert.throws(
    () => new ProposalTokenStore({ root: join(dirname(proposalRoot), "other") }).resolve("large_proposal", token),
    /unknown or no longer retained/
  );

  const symlinkToken = proposals.issue("large_proposal", input, digest);
  const symlinkPath = join(proposalRoot, `${symlinkToken}.json`);
  unlinkSync(symlinkPath);
  symlinkSync(join(proposalRoot, `${token}.json`), symlinkPath);
  assert.throws(() => proposals.resolve("large_proposal", symlinkToken), /symbolic link/);

  now = new Date("2026-08-16T00:00:00.000Z");
  assert.throws(() => proposals.resolve("large_proposal", token), /expired/);
  assert.equal(existsSync(join(proposalRoot, `${token}.json`)), false);
});

test("compact execution status scales with scheduling state instead of journal size", () => {
  const nodes: ExecutionJournal["nodes"] = {
    P1: {
      id: "P1", kind: "phase", phaseId: "P1", dependencies: [], status: "running",
      workerId: null, worktreePath: null, branch: null, workerCommit: null, mergeCommit: null,
      verification: null, approval: null, blocker: null
    }
  };
  for (let number = 1; number <= 49; number += 1) {
    const id = `T1.${number}`;
    nodes[id] = {
      id, kind: "task", phaseId: "P1", dependencies: [], status: "pending",
      workerId: null, worktreePath: null, branch: null, workerCommit: null, mergeCommit: null,
      verification: null, approval: null, blocker: null
    };
  }
  const journal: ExecutionJournal = {
    schemaVersion: 1,
    executionId: "large-1",
    trackId: "large-track",
    status: "in_progress",
    checkpoint: "P1:running",
    requestedMode: "parallel",
    effectiveMode: "parallel",
    approvalMode: "phase",
    maxWorkers: 3,
    planRevision: 1,
    planCommit: "1111111",
    graphDigest: "a".repeat(64),
    baseCommit: "1111111",
    startedAt: "2026-08-08T00:00:00.000Z",
    completedAt: null,
    headCommit: null,
    nodes
  };

  const compact = compactExecutionStatus(journal);
  assert.equal(compact.derivedStatus.readyTasks.length, 49);
  assert.deepEqual(compact.actionableNodes.map((node) => node.id), ["P1"]);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 8 * 1024);
  const focused = compactExecutionStatus(journal, "T1.1");
  assert.equal(focused.node?.id, "T1.1");
  assert.equal(focused.derivedStatus.eventGuidance["T1.1"]?.currentStatus, "pending");
});

function writePlannedTrack(projectRoot: string, trackId = "parallel-track"): string {
  const trackRoot = join(projectRoot, ".cadre", "tracks", trackId);
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "spec.md"), `# Specification: Parallel track

## Functional Requirements
- FR-001: Execute approved work.
## Non-Functional Requirements
- NFR-001: Preserve deterministic state.
## Acceptance Criteria
- AC-001: The execution can resume.
## Dependencies
None.
## Additional Information
None.
## Dependent-track impact
None.
`);
  writeFileSync(join(trackRoot, "plan.md"), `# Plan: Parallel track

- Spec revision: 1
- Plan revision: 1

## Phase 1: Deliver
- Phase dependencies: none

- [ ] T1.1 Implement
  - Task dependencies: none
- [ ] T1.2 User Manual Verification
- Phase completion commit: pending

## Phase 2: Track-level User Manual Verification
- [ ] T2.1 User Manual Verification
- Phase completion commit: pending
`);
  writeFileSync(join(trackRoot, "learning.md"), `# Incremental Learning

<!-- cadre:pattern-seed:start -->
## Pattern Seed
No existing pattern is relevant.
<!-- cadre:pattern-seed:end -->
`);
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId,
    title: "Parallel track",
    type: "feature",
    status: "planned",
    checkpoint: "ready",
    revision: 1,
    dependencies: [],
    commits: { spec: "aaaaaaa", plan: "bbbbbbb" },
    artifactProgress: [],
    operation: null,
    lastExecution: null,
    reviewCycles: [],
    history: []
  }, null, 2)}\n`);
  return trackRoot;
}

function writeFinalizedTrack(
  projectRoot: string,
  trackId: string,
  status: "ready_for_review" | "completed"
): string {
  const trackRoot = join(projectRoot, ".cadre", "tracks", trackId);
  mkdirSync(join(trackRoot, "executions"), { recursive: true });
  writeFileSync(join(trackRoot, "spec.md"), `# Specification: ${trackId}

## Functional Requirements
- FR-001: Finish.
## Non-Functional Requirements
- NFR-001: Preserve evidence.
## Acceptance Criteria
- AC-001: The work is complete.
## Dependencies
None.
## Additional Information
None.
## Dependent-track impact
None.
`);
  const planPath = join(trackRoot, "plan.md");
  writeFileSync(planPath, `# Plan: ${trackId}

- Spec revision: 1
- Plan revision: 1

## Phase 1: Deliver
- Phase dependencies: none

- [x] T1.1 Implement <!-- commit: abcdef1 -->
  - Task dependencies: none
- [x] T1.2 User Manual Verification <!-- commit: abcdef2 -->
- Phase completion commit: \`abcdef2\`

## Phase 2: Track-level User Manual Verification
- [x] T2.1 User Manual Verification <!-- commit: abcdef3 -->
- Phase completion commit: \`abcdef3\`
`);
  writeFileSync(join(trackRoot, "learning.md"), `# Incremental Learning

<!-- cadre:pattern-seed:start -->
## Pattern Seed
No existing pattern is relevant.
<!-- cadre:pattern-seed:end -->
`);
  const graph = parsePlan(planPath);
  const executionId = `${trackId}-execution`;
  writeFileSync(join(trackRoot, "executions", `execution-${executionId}.json`), `${JSON.stringify({
    schemaVersion: 1,
    executionId,
    trackId,
    status: "completed",
    checkpoint: "completed",
    requestedMode: "sequential",
    effectiveMode: "sequential",
    maxWorkers: 1,
    planRevision: 1,
    planCommit: "bbbbbbb",
    graphDigest: graph.digest,
    baseCommit: "1111111",
    startedAt: "2026-07-27T00:00:00Z",
    completedAt: "2026-07-27T01:00:00Z",
    headCommit: "ccccccc",
    nodes: Object.fromEntries([
      ["P1", "phase", "P1", []],
      ["T1.1", "task", "P1", []],
      ["T1.2", "manual-verification", "P1", ["T1.1"]],
      ["P2", "phase", "P2", ["P1"]],
      ["T2.1", "manual-verification", "P2", ["P1"]]
    ].map(([id, kind, phaseId, dependencies]) => [id, {
      id, kind, phaseId, dependencies, status: "completed", workerId: null,
      worktreePath: null, branch: null, workerCommit: null, mergeCommit: null,
      verification: "passed", approval: "approved", blocker: null
    }]))
  }, null, 2)}\n`);
  const cleanReview = {
    cycle: 1,
    reviewedAt: "2026-07-27T01:30:00Z",
    outcome: "clean",
    executionId,
    planRevision: 1,
    graphDigest: graph.digest,
    reviewedHead: "ccccccc",
    commitRange: "bbbbbbb..ccccccc",
    approval: "approved"
  };
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId,
    title: trackId,
    type: "feature",
    status,
    checkpoint: status,
    revision: 1,
    dependencies: [],
    commits: { spec: "aaaaaaa", plan: "bbbbbbb" },
    artifactProgress: [],
    operation: null,
    lastExecution: {
      executionId,
      journal: `executions/execution-${executionId}.json`,
      planRevision: 1,
      graphDigest: graph.digest,
      headCommit: "ccccccc",
      completedAt: "2026-07-27T01:00:00Z"
    },
    reviewCycles: status === "completed" ? [cleanReview] : [],
    history: []
  }, null, 2)}\n`);
  return trackRoot;
}

function gitText(projectRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function gitFixture(): { projectRoot: string; head: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-worktree-"));
  mkdirSync(join(projectRoot, ".cadre"), { recursive: true });
  writeFileSync(join(projectRoot, ".cadre", ".gitignore"), "/.worktrees/\n/wisps/\n");
  writeFileSync(join(projectRoot, ".cadre", "workflow.md"), "# Workflow\n");
  writeFileSync(join(projectRoot, "app.txt"), "base\n");
  execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot });
  gitText(projectRoot, ["config", "user.name", "Cadre Test"]);
  gitText(projectRoot, ["config", "user.email", "cadre@example.test"]);
  gitText(projectRoot, ["config", "commit.gpgsign", "false"]);
  gitText(projectRoot, ["add", "."]);
  gitText(projectRoot, ["commit", "-m", "chore: initialize fixture"]);
  return { projectRoot, head: gitText(projectRoot, ["rev-parse", "HEAD"]) };
}

function writeWorktreeJournal(
  projectRoot: string,
  trackId: string,
  executionId: string,
  phaseStatus: ExecutionNodeStatus,
  taskStatus: ExecutionNodeStatus,
  approvalMode?: "governed" | "phase" | "autonomous"
): void {
  const path = join(projectRoot, ".cadre", "tracks", trackId, "executions", `execution-${executionId}.json`);
  mkdirSync(dirname(path), { recursive: true });
  const node = (
    id: string,
    kind: "phase" | "task",
    phaseId: string,
    status: ExecutionNodeStatus
  ) => ({
    id, kind, phaseId, dependencies: [], status, workerId: null, worktreePath: null, branch: null,
    workerCommit: status === "committed" || status === "completed" ? "abcdef1" : null,
    mergeCommit: status === "integrated" || status === "completed" ? "abcdef2" : null,
    verification: null, approval: status === "committed" || status === "completed" ? "approved" : null,
    blocker: null
  });
  writeFileSync(path, `${JSON.stringify({
    schemaVersion: 1,
    executionId,
    trackId,
    status: "in_progress",
    checkpoint: "test",
    requestedMode: "parallel",
    effectiveMode: "parallel",
    ...(approvalMode ? { approvalMode } : {}),
    maxWorkers: 2,
    planRevision: 1,
    planCommit: "aaaaaaa",
    graphDigest: "test",
    baseCommit: "bbbbbbb",
    startedAt: "2026-07-28T00:00:00.000Z",
    completedAt: null,
    headCommit: null,
    nodes: {
      P1: node("P1", "phase", "P1", phaseStatus),
      "T1.1": node("T1.1", "task", "P1", taskStatus)
    }
  }, null, 2)}\n`);
  const relativePath = relative(projectRoot, path);
  if (gitText(projectRoot, ["ls-files", "--", relativePath]) !== relativePath) {
    gitText(projectRoot, ["add", relativePath]);
    gitText(projectRoot, ["commit", "-m", `cadre(test): seed ${trackId} journal`]);
  }
}

test("empty initialized project validates", () => {
  const projectRoot = fixture();
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
});

test("setup commit recording verifies the approved file manifest against Git", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-candidate-commit-"));
  const files = [
    ["product.md", "# Product\n"],
    ["guidelines.md", "# Guidelines\n"],
    ["tech-stack.md", "# Tech Stack\n- TypeScript\n"],
    ["workflow.md", readFileSync(join(templateRoot, "workflow.md"), "utf8")],
    ["styleguides/general.md", "# General Styleguide\n"]
  ] as const;
  for (const [relativePath, content] of files) {
    const path = join(projectRoot, ".cadre-stage", "create", relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const input = {
    projectRoot,
    projectName: "Commit manifest fixture",
    context: "greenfield" as const,
    gitDisposition: "initialize" as const,
    baseCommit: null,
    approvedAt: "2026-08-26T00:00:00.000Z",
    stagedFiles: files.map(([path]) => path)
  };
  assert.throws(
    () => previewProjectInitCandidate({
      ...input,
      stagedFiles: input.stagedFiles.map((path) => path === "product.md" ? "init/product.md" : path)
    }),
    /use product\.md instead of init\/product\.md/
  );
  const preview = previewProjectInitCandidate(input);
  applyProjectInitCandidate(input, preview.digest);
  execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot });
  gitText(projectRoot, ["config", "user.name", "Cadre Test"]);
  gitText(projectRoot, ["config", "user.email", "cadre@example.test"]);
  gitText(projectRoot, ["config", "commit.gpgsign", "false"]);
  recordGitInitialized(projectRoot);
  writeFileSync(join(projectRoot, ".cadre", "product.md"), "# Changed product\n");
  gitText(projectRoot, ["add", ".cadre"]);
  gitText(projectRoot, ["commit", "-m", "cadre(create): initialize wrong content"]);
  assert.throws(
    () => recordSetupCommit(projectRoot, gitText(projectRoot, ["rev-parse", "HEAD"])),
    /Approved setup artifact changed/
  );
  writeFileSync(join(projectRoot, ".cadre", "product.md"), "# Product\n");
  gitText(projectRoot, ["add", ".cadre/product.md"]);
  gitText(projectRoot, ["commit", "-m", "cadre(create): initialize project harness"]);
  const approvedCommit = gitText(projectRoot, ["rev-parse", "HEAD"]);
  recordSetupCommit(projectRoot, approvedCommit);
  const state = JSON.parse(readFileSync(join(projectRoot, ".cadre", "project.json"), "utf8"));
  assert.equal(state.setup.commit, approvedCommit);
  assert.equal(state.setup.operation, null);
});

test("stale tracks index is repairable derived drift, not an invariant failure", () => {
  const projectRoot = fixture();
  writePlannedTrack(projectRoot, "derived-drift");
  const validation = validateProject(projectRoot);
  assert.equal(validation.errors.length, 0);
  assert.deepEqual(validation.warnings, [
    "TRACKS_INDEX_STALE: tracks.md is stale; regenerate it after approved state changes"
  ]);
  assert.equal(formatStatus(projectRoot).text.includes("derived=1 warning(s)"), true);

  const preview = renderTracksPreview(projectRoot);
  writeTracks(projectRoot, preview.digest);
  assert.deepEqual(validateProject(projectRoot).warnings, []);
});

test("central validation rejects syntactically valid but unreachable provenance", () => {
  const projectRoot = fixture();
  execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot });
  gitText(projectRoot, ["config", "user.name", "Cadre Test"]);
  gitText(projectRoot, ["config", "user.email", "cadre@example.test"]);
  gitText(projectRoot, ["add", "."]);
  gitText(projectRoot, ["commit", "-m", "chore: initialize fixture"]);
  const validation = validateProject(projectRoot);
  assert.ok(validation.errors.some((error) =>
    error.includes("project.json.setup.commit: commit is not reachable: 1111111")
  ));
});

test("plan DAG validation derives manual barriers and rejects dependency cycles", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-plan-"));
  const planPath = join(projectRoot, "plan.md");
  writeFileSync(planPath, `# Plan: DAG

- Spec revision: 1
- Plan revision: 1

## Phase 1: First
- Phase dependencies: P2
- [ ] T1.1 First task
  - Task dependencies: none
- [ ] T1.2 User Manual Verification
- Phase completion commit: pending

## Phase 2: Second
- Phase dependencies: P1
- [ ] T2.1 Second task
  - Task dependencies: none
- [ ] T2.2 User Manual Verification
- Phase completion commit: pending

## Phase 3: Track-level User Manual Verification
- [ ] T3.1 User Manual Verification
- Phase completion commit: pending
`);
  const errors: string[] = [];
  const graph = parsePlan(planPath, errors);
  validatePlanGraph(planPath, graph, "planned", errors);
  assert.ok(errors.some((error) => error.includes("dependency cycle")));
  assert.deepEqual(graph.phases[0]!.tasks.at(-1)!.dependencies, ["T1.1"]);
  assert.deepEqual(graph.phases.at(-1)!.dependencies, ["P1", "P2"]);
});

test("draft plan content validation is file-free and uses the intended target status", () => {
  const planMarkdown = `# Plan: Draft

- Spec revision: 1
- Plan revision: 2

## Phase 1: Deliver
- Phase dependencies: none
- [ ] T1.1 Implement
  - Task dependencies: none
- [ ] T1.2 User Manual Verification
- Phase completion commit: pending

## Phase 2: Track-level User Manual Verification
- [ ] T2.1 User Manual Verification
- Phase completion commit: pending
`;
  const plannedErrors: string[] = [];
  const plannedGraph = parsePlanContent(planMarkdown, "proposed-plan.md", plannedErrors);
  validatePlanGraph("proposed-plan.md", plannedGraph, "planned", plannedErrors);
  assert.deepEqual(plannedErrors, []);
  assert.deepEqual(plannedGraph.phases[0]!.tasks.at(-1)!.dependencies, ["T1.1"]);
  assert.deepEqual(plannedGraph.phases.at(-1)!.dependencies, ["P1"]);

  const reviewErrors: string[] = [];
  const reviewGraph = parsePlanContent(planMarkdown, "review-remediation.md", reviewErrors);
  validatePlanGraph("review-remediation.md", reviewGraph, "ready_for_review", reviewErrors);
  assert.ok(reviewErrors.some((error) => error.includes("ready_for_review track has 3 pending task(s)")));
});

test("execution journal gates tasks behind their running phase and validates persisted graph identity", () => {
  const projectRoot = fixture();
  const trackRoot = writePlannedTrack(projectRoot);
  runState(projectRoot, "render");
  const input = {
    projectRoot,
    trackId: "parallel-track",
    executionId: "20260728T010000Z",
    requestedMode: "parallel" as const,
    effectiveMode: "parallel" as const,
    maxWorkers: 3,
    baseCommit: "1111111",
    approvedAt: "2026-07-28T01:00:00.000Z"
  };
  const preview = previewExecutionStart(input);
  assert.equal(preview.journal.approvalMode, "phase");
  assert.equal((preview.state.operation as { approvalMode?: string }).approvalMode, "phase");
  const governedPreview = previewExecutionStart({ ...input, approvalMode: "governed" });
  assert.equal(governedPreview.journal.approvalMode, "governed");
  assert.notEqual(governedPreview.digest, preview.digest);
  assert.throws(() => previewExecutionStart({
    ...input,
    approvalMode: "invalid" as never
  }), /approvalMode must be governed, phase, or autonomous/);
  const started = applyExecutionStart(input, preview.digest);
  assert.deepEqual(started.derivedStatus.readyPhases, ["P1"]);
  const initialStatus = executionStatus(projectRoot, input.trackId, input.executionId);
  assert.deepEqual(initialStatus.readyPhases, ["P1"]);
  assert.deepEqual(initialStatus.readyTasks, []);
  assert.deepEqual(initialStatus.eventGuidance.P1, {
    currentStatus: "pending",
    allowed: [
      { event: "start", requiredFields: [] },
      { event: "block", requiredFields: ["blocker"] }
    ]
  });
  assert.throws(() => previewExecutionNodeUpdate({
    projectRoot, trackId: input.trackId, executionId: input.executionId, nodeId: "T1.1", status: "running"
  }), /until phase P1 is running/);

  const phaseUpdate = {
    projectRoot, trackId: input.trackId, executionId: input.executionId, nodeId: "P1", status: "running" as const
  };
  const phasePreview = previewExecutionNodeUpdate(phaseUpdate);
  const phaseApplied = applyExecutionNodeUpdate(phaseUpdate, phasePreview.digest);
  assert.deepEqual(phaseApplied.derivedStatus.readyTasks, ["T1.1"]);
  assert.deepEqual(executionStatus(projectRoot, input.trackId, input.executionId).readyTasks, ["T1.1"]);
  assert.throws(() => previewExecutionNodeUpdate({
    projectRoot, trackId: input.trackId, executionId: input.executionId, nodeId: "P1", status: "awaiting_approval"
  }), /P1 has incomplete tasks: T1.1, T1.2/);

  const journalPath = join(trackRoot, "executions", `execution-${input.executionId}.json`);
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.approvalMode = "invalid";
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  assert.ok(validateProject(projectRoot).errors.some((error) => error.includes("invalid execution approval mode")));
  journal.approvalMode = "phase";
  delete journal.nodes["T1.2"];
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  assert.ok(validateProject(projectRoot).errors.some((error) => error.includes("do not exactly match")));

  assert.throws(() => previewExecutionStart({
    ...input,
    executionId: "another-execution",
    requestedMode: "sequential",
    effectiveMode: "parallel"
  }), /cannot become parallel/);
  assert.throws(() => previewExecutionStart({
    ...input,
    executionId: "execution-prefixed"
  }), /must omit the execution- journal filename prefix/);
});

test("a phase can hand off between phase and task workers at clean checkpoints", () => {
  const projectRoot = fixture();
  writePlannedTrack(projectRoot, "hybrid-track");
  runState(projectRoot, "render");
  const scope = { projectRoot, trackId: "hybrid-track", executionId: "hybrid-1" };
  const startInput = {
    ...scope,
    requestedMode: "parallel" as const,
    effectiveMode: "parallel" as const,
    maxWorkers: 3,
    baseCommit: "1111111",
    approvedAt: "2026-07-28T01:15:00.000Z"
  };
  const start = previewExecutionStart(startInput);
  applyExecutionStart(startInput, start.digest);

  const transition = (update: Parameters<typeof previewExecutionNodeUpdate>[0]) => {
    const preview = previewExecutionNodeUpdate(update);
    return applyExecutionNodeUpdate(update, preview.digest);
  };
  transition({ ...scope, nodeId: "P1", status: "running", workerId: "phase-worker-1" });

  assert.throws(() => previewExecutionNodeUpdate({
    ...scope, nodeId: "T1.1", status: "running", workerId: "task-worker-1"
  }), /active phase worker/);
  assert.throws(() => previewExecutionNodeUpdate({
    ...scope, nodeId: "P1", status: "running", workerId: null
  }), /clean-checkpoint verification/);

  transition({
    ...scope,
    nodeId: "P1",
    status: "running",
    workerId: null,
    verification: "phase worktree clean at abcdef0"
  });
  transition({ ...scope, nodeId: "T1.1", status: "running", workerId: "task-worker-1" });
  assert.throws(() => previewExecutionNodeUpdate({
    ...scope, nodeId: "P1", status: "running", workerId: "phase-worker-2"
  }), /task workers are active/);

  transition({ ...scope, nodeId: "T1.1", status: "awaiting_approval", verification: "focused checks passed" });
  transition({
    ...scope,
    nodeId: "T1.1",
    status: "committed",
    workerCommit: "abcdef1",
    approval: "approved"
  });
  transition({ ...scope, nodeId: "T1.1", status: "integrating" });
  transition({ ...scope, nodeId: "T1.1", status: "integrated", mergeCommit: "abcdef2" });
  transition({ ...scope, nodeId: "T1.1", status: "completed" });
  const reassigned = transition({
    ...scope, nodeId: "P1", status: "running", workerId: "phase-worker-2"
  });

  assert.deepEqual(reassigned.journal.nodes.P1?.workerHistory, ["phase-worker-1", "phase-worker-2"]);
  assert.deepEqual(reassigned.journal.nodes["T1.1"]?.workerHistory, ["task-worker-1"]);
  assert.equal(validateProject(projectRoot).errors.length, 0);
});

test("execution transitions require distinct task commits and clear resolved blockers", () => {
  const projectRoot = fixture();
  const trackRoot = writePlannedTrack(projectRoot, "provenance-track");
  writeFileSync(join(trackRoot, "plan.md"), `# Plan: Provenance track

- Spec revision: 1
- Plan revision: 1

## Phase 1: Deliver
- Phase dependencies: none

- [ ] T1.1 First implementation task
  - Task dependencies: none
- [ ] T1.2 Second implementation task
  - Task dependencies: none
- [ ] T1.3 User Manual Verification
- Phase completion commit: pending

## Phase 2: Track-level User Manual Verification
- [ ] T2.1 User Manual Verification
- Phase completion commit: pending
`);
  runState(projectRoot, "render");
  const input = {
    projectRoot,
    trackId: "provenance-track",
    executionId: "provenance-1",
    requestedMode: "sequential" as const,
    effectiveMode: "sequential" as const,
    maxWorkers: 1,
    baseCommit: "1111111",
    approvedAt: "2026-07-28T01:30:00.000Z"
  };
  const start = previewExecutionStart(input);
  applyExecutionStart(input, start.digest);
  const journalPath = join(trackRoot, "executions", "execution-provenance-1.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.nodes.P1.status = "running";
  journal.nodes["T1.1"].status = "awaiting_approval";
  journal.nodes["T1.1"].blocker = "resolved dependency issue";
  journal.nodes["T1.2"].status = "completed";
  journal.nodes["T1.2"].workerCommit = "abcdef1";
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  assert.throws(() => previewExecutionNodeUpdate({
    projectRoot,
    trackId: input.trackId,
    executionId: input.executionId,
    nodeId: "T1.1",
    status: "committed",
    workerCommit: "abcdef1",
    approval: "approved"
  }), /distinct worker commit from T1.2/);

  const proposal = previewExecutionNodeUpdate({
    projectRoot,
    trackId: input.trackId,
    executionId: input.executionId,
    nodeId: "T1.1",
    status: "committed",
    workerCommit: "abcdef2",
    approval: "approved"
  });
  assert.equal(proposal.journal.nodes["T1.1"]?.blocker, null);
});

test("ordered execution-node batches are atomic, digest-gated, and preserve legal transitions", () => {
  const projectRoot = fixture();
  const trackRoot = writePlannedTrack(projectRoot, "batch-track");
  runState(projectRoot, "render");
  const scope = { projectRoot, trackId: "batch-track", executionId: "batch-1" };
  const startInput = {
    ...scope,
    requestedMode: "sequential" as const,
    effectiveMode: "sequential" as const,
    maxWorkers: 1,
    baseCommit: "1111111",
    approvedAt: "2026-07-28T01:45:00.000Z"
  };
  const start = previewExecutionStart(startInput);
  applyExecutionStart(startInput, start.digest);

  const begin = { ...scope, updates: [
    { nodeId: "P1", status: "running" as const },
    { nodeId: "T1.1", status: "running" as const }
  ] };
  const beginPreview = previewExecutionNodesUpdate(begin);
  applyExecutionNodesUpdate(begin, beginPreview.digest);

  const journalPath = join(trackRoot, "executions", "execution-batch-1.json");
  const beforeInvalidBatch = readFileSync(journalPath, "utf8");
  assert.throws(() => previewExecutionNodesUpdate({ ...scope, updates: [
    { nodeId: "T1.1", status: "awaiting_approval", verification: "passed" },
    { nodeId: "T1.1", status: "completed" }
  ] }), /illegal execution transition awaiting_approval -> completed/);
  assert.equal(readFileSync(journalPath, "utf8"), beforeInvalidBatch);

  const approvalStep = { ...scope, updates: [
    { nodeId: "T1.1", status: "awaiting_approval" as const, verification: "passed" }
  ] };
  const stale = previewExecutionNodesUpdate(approvalStep);
  writeFileSync(journalPath, `${beforeInvalidBatch.trimEnd()}\n\n`);
  assert.throws(() => applyExecutionNodesUpdate(approvalStep, stale.digest), /proposal is stale/);
  const fresh = previewExecutionNodesUpdate(approvalStep);
  applyExecutionNodesUpdate(approvalStep, fresh.digest);

  const finishPhase = { ...scope, updates: [
    { nodeId: "T1.1", status: "committed" as const, workerCommit: "abcdef1", approval: "approved" },
    { nodeId: "T1.1", status: "integrating" as const },
    { nodeId: "T1.1", status: "integrated" as const, mergeCommit: "abcdef2" },
    { nodeId: "T1.1", status: "completed" as const },
    { nodeId: "T1.2", status: "running" as const },
    { nodeId: "T1.2", status: "awaiting_manual_verification" as const },
    { nodeId: "T1.2", status: "completed" as const, approval: "approved" },
    { nodeId: "P1", status: "awaiting_approval" as const, verification: "passed" },
    { nodeId: "P1", status: "committed" as const, workerCommit: "abcdef3", approval: "approved" },
    { nodeId: "P1", status: "integrating" as const },
    { nodeId: "P1", status: "integrated" as const, mergeCommit: "abcdef4" },
    { nodeId: "P1", status: "completed" as const }
  ] };
  const finishPreview = previewExecutionNodesUpdate(finishPhase);
  const finished = applyExecutionNodesUpdate(finishPhase, finishPreview.digest);
  assert.deepEqual(finished.derivedStatus.readyPhases, ["P2"]);
  assert.equal(finished.journal.checkpoint, "P1:completed");
});

test("semantic execution checkpoints expand and apply complete transition sequences", () => {
  const projectRoot = fixture();
  writePlannedTrack(projectRoot, "semantic-track");
  const startInput = {
    projectRoot,
    trackId: "semantic-track",
    executionId: "semantic-1",
    requestedMode: "sequential" as const,
    effectiveMode: "sequential" as const,
    maxWorkers: 1,
    baseCommit: "1111111",
    approvedAt: "2026-07-28T01:00:00.000Z"
  };
  const start = previewExecutionStart(startInput);
  applyExecutionStart(startInput, start.digest);
  const checkpoint = (nodeId: string, event: "start" | "record_commit" | "complete", extra = {}) => {
    const input = { projectRoot, trackId: "semantic-track", executionId: "semantic-1", nodeId, event, ...extra };
    const preview = previewExecutionCheckpoint(input);
    return applyExecutionCheckpoint(input, preview.digest);
  };
  checkpoint("P1", "start");
  checkpoint("T1.1", "start");
  const committed = checkpoint("T1.1", "record_commit", {
    commit: "abcdef1",
    verification: "focused tests passed",
    authorization: "autonomous mode"
  });
  assert.equal(committed.journal.nodes["T1.1"]?.status, "committed");
  const completed = checkpoint("T1.1", "complete");
  assert.equal(completed.journal.nodes["T1.1"]?.status, "completed");
});

test("replacement executions carry completed plan provenance forward", () => {
  const projectRoot = fixture();
  const trackRoot = writePlannedTrack(projectRoot, "remediation-track");
  writeFileSync(join(trackRoot, "plan.md"), `# Plan: Remediation track

- Spec revision: 1
- Plan revision: 2

## Phase 1: Original delivery
- Phase dependencies: none
- [x] T1.1 Implement <!-- commit: abcdef1 -->
  - Task dependencies: none
- [x] T1.2 User Manual Verification <!-- commit: abcdef2 -->
- Phase completion commit: \`abcdef2\`

## Phase 2: Remediate review findings
- Phase dependencies: P1
- [ ] T2.1 Fix finding
  - Task dependencies: none
- [ ] T2.2 User Manual Verification
- Phase completion commit: pending

## Phase 3: Track-level User Manual Verification
- [ ] T3.1 User Manual Verification
- Phase completion commit: pending
`);
  const input = {
    projectRoot,
    trackId: "remediation-track",
    executionId: "review-cycle-2",
    requestedMode: "parallel" as const,
    effectiveMode: "parallel" as const,
    maxWorkers: 3,
    baseCommit: "1111111",
    approvedAt: "2026-07-28T02:00:00.000Z"
  };
  const preview = previewExecutionStart(input);
  applyExecutionStart(input, preview.digest);
  const status = executionStatus(projectRoot, input.trackId, input.executionId);
  assert.equal(status.journal.nodes.P1?.status, "completed");
  assert.equal(status.journal.nodes["T1.1"]?.workerCommit, "abcdef1");
  assert.equal(status.journal.nodes["T1.2"]?.approval?.startsWith("carried forward"), true);
  assert.deepEqual(status.readyPhases, ["P2"]);
  assert.deepEqual(status.readyTasks, []);
});

test("execution start and finish resume while keeping the derived index current", () => {
  const projectRoot = fixture();
  const trackRoot = writePlannedTrack(projectRoot, "checkpoint-track");
  writeFileSync(join(trackRoot, "plan.md"), `# Plan: Checkpoint track

- Spec revision: 1
- Plan revision: 1

## Phase 1: Deliver
- Phase dependencies: none
- [ ] T1.1 Implement
  - Task dependencies: none
- [ ] T1.2 User Manual Verification
- Phase completion commit: pending

## Phase 2: Track-level User Manual Verification
- [ ] T2.1 User Manual Verification
- Phase completion commit: pending
`);
  const startInput = {
    projectRoot,
    trackId: "checkpoint-track",
    executionId: "checkpoint-1",
    requestedMode: "sequential" as const,
    effectiveMode: "sequential" as const,
    maxWorkers: 1,
    baseCommit: "1111111",
    approvedAt: "2026-07-28T03:00:00.000Z"
  };
  const start = previewExecutionStart(startInput);
  mkdirSync(dirname(start.journalPath), { recursive: true });
  applyExecutionStart(startInput, start.digest);
  const completedJournal = JSON.parse(readFileSync(start.journalPath, "utf8"));
  for (const [nodeId, commit] of [["T1.1", "abcdef1"], ["T1.2", "abcdef2"], ["P1", "abcdef2"],
    ["T2.1", "abcdef3"], ["P2", "abcdef3"]] as const) {
    completedJournal.nodes[nodeId].status = "completed";
    completedJournal.nodes[nodeId].workerCommit = commit;
    completedJournal.nodes[nodeId].mergeCommit = nodeId.startsWith("P") ? commit : null;
    completedJournal.nodes[nodeId].verification = "verified";
    completedJournal.nodes[nodeId].approval = "authorized";
  }
  writeFileSync(start.journalPath, `${JSON.stringify(completedJournal, null, 2)}\n`);

  const finishInput = {
    projectRoot,
    trackId: startInput.trackId,
    executionId: startInput.executionId,
    headCommit: "ccccccc",
    completedAt: "2026-07-28T04:00:00.000Z"
  };
  const finish = previewExecutionFinish(finishInput);
  assert.match(finish.tracksContent, /checkpoint-track.*ready_for_review/);
  writeFileSync(finish.journalPath, `${JSON.stringify(finish.journal, null, 2)}\n`);
  const resumedFinish = previewExecutionFinish(finishInput);
  const currentTracks = readFileSync(resumedFinish.tracksPath, "utf8");
  writeFileSync(resumedFinish.tracksPath, `${currentTracks}\n`);
  assert.throws(() => applyExecutionFinish(finishInput, resumedFinish.digest), /proposal is stale/);
  writeFileSync(resumedFinish.tracksPath, currentTracks);
  const freshFinish = previewExecutionFinish(finishInput);
  applyExecutionFinish(finishInput, freshFinish.digest);
  assert.match(readFileSync(join(trackRoot, "plan.md"), "utf8"), /\[x\] T2\.1.*commit: abcdef3/);
  const state = JSON.parse(readFileSync(join(trackRoot, "state.json"), "utf8"));
  assert.equal(state.status, "ready_for_review");
  assert.equal(state.operation, null);
  assert.equal(state.lastExecution.executionId, startInput.executionId);
  assert.deepEqual(validateProject(projectRoot).warnings, []);
});

test("clean review completion previews and applies its exact state and derived index together", () => {
  const projectRoot = fixture();
  const trackRoot = writeFinalizedTrack(projectRoot, "reviewed-track", "ready_for_review");
  runState(projectRoot, "render");
  const input = {
    projectRoot,
    trackId: "reviewed-track",
    reviewedAt: "2026-07-28T02:00:00.000Z",
    reviewedHead: "ccccccc",
    commitRange: "bbbbbbb..ccccccc",
    approval: "Human rejected F1 and approved clean completion with the risk accepted.",
    acceptedRisks: ["F1: accepted bounded compatibility risk"]
  };
  const preview = previewReviewComplete(input);
  assert.equal(preview.state.status, "completed");
  assert.match(preview.tracksContent, /reviewed-track.*completed/);
  assert.deepEqual(preview.state.reviewCycles?.at(-1)?.acceptedRisks, input.acceptedRisks);
  writeFileSync(preview.tracksPath, `${readFileSync(preview.tracksPath, "utf8")}\n`);
  assert.throws(() => applyReviewComplete(input, preview.digest), /proposal is stale/);
  runState(projectRoot, "render");
  const fresh = previewReviewComplete(input);
  applyReviewComplete(input, fresh.digest);
  assert.equal(JSON.parse(readFileSync(join(trackRoot, "state.json"), "utf8")).status, "completed");
  assert.equal(runState(projectRoot, "validate").status, 0);
});

test("archive candidate proposals reject changed content and record provenance", () => {
  const projectRoot = fixture();
  writeFinalizedTrack(projectRoot, "archive-candidate", "completed");
  runState(projectRoot, "render");
  const candidateId = "archive-candidate-proposal";
  const candidateRoot = join(projectRoot, ".cadre-stage", candidateId);
  mkdirSync(join(candidateRoot, "patterns"), { recursive: true });
  const patternPath = join(candidateRoot, "patterns", "candidate-pattern.md");
  const indexPath = join(candidateRoot, "patterns", "index.md");
  const pattern = "# Pattern: Candidate pattern\n\n## Provenance\n- Track: `archive-candidate`\n";
  const index = "# Pattern Catalog\n\n- [Candidate pattern](candidate-pattern.md)\n";
  writeFileSync(patternPath, pattern);
  writeFileSync(indexPath, index);
  const input = {
    projectRoot,
    candidateId,
    batchId: "archive-candidate-batch",
    selectedTracks: ["archive-candidate"],
    baseCommit: "ddddddd",
    approvedAt: "2026-07-28T02:00:00.000Z",
    updates: [
      { kind: "pattern" as const, slug: "candidate-pattern" },
      { kind: "pattern_index" as const }
    ]
  };
  const preview = previewArchiveBatchCandidate(input);
  assert.deepEqual(
    preview.writes.map((write) => write.path),
    ["patterns/candidate-pattern.md", "patterns/index.md"]
  );
  writeFileSync(patternPath, `${pattern}\nchanged after preview\n`);
  assert.throws(
    () => applyArchiveBatchCandidate(input, preview.digest),
    /proposal is stale/
  );
  writeFileSync(patternPath, pattern);
  const fresh = previewArchiveBatchCandidate(input);
  applyArchiveBatchCandidate(input, fresh.digest);
  const canonicalPatternPath = join(projectRoot, ".cadre", "patterns", "candidate-pattern.md");
  assert.equal(readFileSync(canonicalPatternPath, "utf8"), pattern);
  writeFileSync(canonicalPatternPath, `${pattern}\ntampered after promotion\n`);
  assert.ok(validateProject(projectRoot).errors.some((error) => (
    error.includes("promoted artifact differs from its approved hash: patterns/candidate-pattern.md")
  )));
  writeFileSync(canonicalPatternPath, pattern);
  assert.equal(existsSync(candidateRoot), true, "candidate files remain available through the commit checkpoint");
  const recordInput = { projectRoot, batchId: input.batchId, archiveCommit: "eeeeeee" };
  const record = previewArchiveBatchRecord(recordInput);
  applyArchiveBatchRecord(recordInput, record.digest);
  const state = JSON.parse(readFileSync(
    join(projectRoot, ".cadre", "archive", "archive-candidate", "state.json"),
    "utf8"
  ));
  assert.equal(state.commits.archive, "eeeeeee");
  assert.equal(runState(projectRoot, "validate").status, 0);
});

test("worktree tools integrate task-to-phase and phase-to-main, then clean up safely", () => {
  const { projectRoot, head } = gitFixture();
  writeWorktreeJournal(projectRoot, "parallel-track", "run-1", "running", "committed");
  const phaseInput = {
    projectRoot, trackId: "parallel-track", executionId: "run-1", nodeId: "P1"
  };
  const phasePreview = previewWorktreeCreate(phaseInput);
  const phase = applyWorktreeCreate(phaseInput, phasePreview.digest);
  const taskInput = {
    projectRoot, trackId: "parallel-track", executionId: "run-1", nodeId: "T1.1"
  };
  const taskPreview = previewWorktreeCreate(taskInput);
  const task = applyWorktreeCreate(taskInput, taskPreview.digest);
  writeFileSync(join(task.path, "app.txt"), "implemented by task\n");
  gitText(task.path, ["add", "app.txt"]);
  gitText(task.path, ["commit", "-m", "feat: implement task"]);

  const taskIntegration = previewWorktreeIntegration(taskInput);
  assert.deepEqual(taskIntegration.changedFiles, ["app.txt"]);
  assert.equal(applyWorktreeIntegration(taskInput, taskIntegration.digest).status, "integrated");
  writeWorktreeJournal(projectRoot, "parallel-track", "run-1", "running", "integrated");
  const taskCleanup = previewWorktreeCleanup(taskInput);
  applyWorktreeCleanup(taskInput, taskCleanup.digest);
  assert.equal(existsSync(task.path), false);

  const phaseIntegrationInput = {
    projectRoot, trackId: "parallel-track", executionId: "run-1", nodeId: "P1"
  };
  assert.throws(() => previewWorktreeIntegration(phaseIntegrationInput), /must be committed or integrating/);
  writeWorktreeJournal(projectRoot, "parallel-track", "run-1", "completed", "completed");
  assert.throws(() => previewWorktreeCleanup(phaseIntegrationInput), /is not integrated into/);
  writeWorktreeJournal(projectRoot, "parallel-track", "run-1", "committed", "completed");
  const phaseIntegration = previewWorktreeIntegration(phaseIntegrationInput);
  assert.equal(applyWorktreeIntegration(phaseIntegrationInput, phaseIntegration.digest).status, "integrated");
  writeWorktreeJournal(projectRoot, "parallel-track", "run-1", "completed", "completed");
  writeFileSync(join(phase.path, "dirty.txt"), "dirty\n");
  assert.throws(() => previewWorktreeCleanup(phaseIntegrationInput), /worktree is not clean/);
  unlinkSync(join(phase.path, "dirty.txt"));
  const phaseCleanup = previewWorktreeCleanup(phaseIntegrationInput);
  applyWorktreeCleanup(phaseIntegrationInput, phaseCleanup.digest);

  assert.equal(readFileSync(join(projectRoot, "app.txt"), "utf8"), "implemented by task\n");
  assert.match(gitText(projectRoot, ["status", "--porcelain"]), /execution-run-1\.json/);
  const status = managedWorktreeStatus(projectRoot);
  assert.equal(status.worktrees.filter((worktree) => worktree.managed).length, 0);
  assert.deepEqual(status.orphanedDirectories, []);
  assert.equal(existsSync(phase.path), false);
});

test("a main-coordinated task worker integrates directly into the canonical worktree", () => {
  const { projectRoot, head } = gitFixture();
  writeWorktreeJournal(projectRoot, "main-phase", "run-1", "running", "committed");
  const input = {
    projectRoot, trackId: "main-phase", executionId: "run-1", nodeId: "T1.1"
  };
  const create = previewWorktreeCreate(input);
  const worker = applyWorktreeCreate(input, create.digest);
  writeFileSync(join(worker.path, "app.txt"), "main-coordinated task\n");
  gitText(worker.path, ["add", "app.txt"]);
  gitText(worker.path, ["commit", "-m", "feat: implement main-coordinated task"]);

  const integration = previewWorktreeIntegration(input);
  assert.equal(integration.targetPath, realpathSync(projectRoot));
  assert.equal(applyWorktreeIntegration(input, integration.digest).status, "integrated");
  writeWorktreeJournal(projectRoot, "main-phase", "run-1", "running", "integrated");
  const cleanup = previewWorktreeCleanup(input);
  applyWorktreeCleanup(input, cleanup.digest);
  assert.equal(readFileSync(join(projectRoot, "app.txt"), "utf8"), "main-coordinated task\n");
});

test("worktree integration reports conflicts without resolving them", () => {
  const { projectRoot, head } = gitFixture();
  writeWorktreeJournal(projectRoot, "conflict-track", "run-1", "committed", "completed");
  const input = {
    projectRoot, trackId: "conflict-track", executionId: "run-1", nodeId: "P1"
  };
  const create = previewWorktreeCreate(input);
  const worker = applyWorktreeCreate(input, create.digest);
  writeFileSync(join(worker.path, "app.txt"), "worker version\n");
  gitText(worker.path, ["add", "app.txt"]);
  gitText(worker.path, ["commit", "-m", "feat: change worker version"]);

  writeFileSync(join(projectRoot, "app.txt"), "main version\n");
  gitText(projectRoot, ["add", "app.txt"]);
  gitText(projectRoot, ["commit", "-m", "feat: change main version"]);
  const integration = previewWorktreeIntegration(input);
  const result = applyWorktreeIntegration(input, integration.digest);
  assert.equal(result.status, "conflicted");
  assert.deepEqual(result.conflicts, ["app.txt"]);
  assert.match(readFileSync(join(projectRoot, "app.txt"), "utf8"), /<<<<<<< HEAD/);
  assert.throws(() => previewWorktreeCleanup(input), /must be integrated or completed in the execution journal/);
});

test("worker branches cannot integrate protected Cadre state", () => {
  const { projectRoot, head } = gitFixture();
  writeWorktreeJournal(projectRoot, "protected-track", "run-1", "committed", "completed");
  const input = {
    projectRoot, trackId: "protected-track", executionId: "run-1", nodeId: "P1"
  };
  const create = previewWorktreeCreate(input);
  const worker = applyWorktreeCreate(input, create.digest);
  writeFileSync(join(worker.path, ".cadre", "workflow.md"), "# Worker changed workflow\n");
  gitText(worker.path, ["add", ".cadre/workflow.md"]);
  gitText(worker.path, ["commit", "-m", "chore: change protected state"]);
  assert.throws(() => previewWorktreeIntegration(input), /modifies protected \.cadre state/);
});

test("approved create operation remains valid before its artifact commit", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-setup-resume-"));
  cpSync(templateRoot, join(projectRoot, ".cadre"), { recursive: true });
  renameSync(
    join(projectRoot, ".cadre", "gitignore.template"),
    join(projectRoot, ".cadre", ".gitignore")
  );
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.runtimeVersion = "3.3.0";
  project.templateSetVersion = "v1";
  project.project.name = "Interrupted setup";
  project.project.context = "greenfield";
  project.setup.operation.baseCommit = null;
  project.setup.operation.approvedArtifacts = ["product.md", "guidelines.md", "tech-stack.md", "workflow.md"];
  delete project.setup.operation.approvedArtifactHashes;
  project.setup.operation.approvedAt = "2026-07-27T00:00:00Z";
  project.setup.artifactProgress = ["product.md", "guidelines.md"];
  project.setup.checkpoint = "context-writing";
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
  const status = runState(projectRoot, "status");
  assert.match(status.stdout, /Setup: in_progress; checkpoint=context-writing; operation=create/);
});

test("completed track requires manual verification, commits, and a clean review", () => {
  const projectRoot = fixture();
  const cadreRoot = join(projectRoot, ".cadre");
  const trackRoot = join(cadreRoot, "tracks", "example");
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "spec.md"), `# Specification: Example

## Functional Requirements
- FR-001: Work.
## Non-Functional Requirements
- NFR-001: Be reliable.
## Acceptance Criteria
- AC-001: It works.
## Dependencies
None.
## Additional Information
None.
## Dependent-track impact
None.
`);
  const planPath = join(trackRoot, "plan.md");
  writeFileSync(planPath, `# Plan: Example

- Spec revision: 1
- Plan revision: 1

## Phase 1: Deliver
- Phase dependencies: none

- [x] T1.1 Implement <!-- commit: abcdef1 -->
  - Task dependencies: none
- [x] T1.2 User Manual Verification <!-- commit: abcdef2 -->
- Phase completion commit: \`abcdef2\`

## Phase 2: Track-level User Manual Verification
- [x] T2.1 User Manual Verification <!-- commit: abcdef3 -->
- Phase completion commit: \`abcdef3\`
`);
  writeFileSync(join(trackRoot, "learning.md"), `# Incremental Learning

<!-- cadre:pattern-seed:start -->
## Pattern Seed
No existing pattern is relevant.
<!-- cadre:pattern-seed:end -->
`);
  const graph = parsePlan(planPath);
  mkdirSync(join(trackRoot, "executions"), { recursive: true });
  writeFileSync(join(trackRoot, "executions", "execution-example.json"), `${JSON.stringify({
    schemaVersion: 1,
    executionId: "example",
    trackId: "example",
    status: "completed",
    checkpoint: "completed",
    requestedMode: "parallel",
    effectiveMode: "sequential",
    maxWorkers: 3,
    planRevision: 1,
    planCommit: "bbbbbbb",
    graphDigest: graph.digest,
    baseCommit: "1111111",
    startedAt: "2026-07-27T00:00:00Z",
    completedAt: "2026-07-27T01:00:00Z",
    headCommit: "ccccccc",
    nodes: Object.fromEntries([
      ["P1", "phase", "P1", []],
      ["T1.1", "task", "P1", []],
      ["T1.2", "manual-verification", "P1", ["T1.1"]],
      ["P2", "phase", "P2", ["P1"]],
      ["T2.1", "manual-verification", "P2", ["P1"]]
    ].map(([id, kind, phaseId, dependencies]) => [id, {
      id, kind, phaseId, dependencies, status: "completed", workerId: null,
      worktreePath: null, branch: null, workerCommit: null, mergeCommit: null,
      verification: "passed", approval: "approved", blocker: null
    }]))
  }, null, 2)}\n`);
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId: "example",
    title: "Example",
    type: "feature",
    status: "completed",
    checkpoint: "ready",
    revision: 1,
    dependencies: [],
    commits: { spec: "aaaaaaa", plan: "bbbbbbb" },
    artifactProgress: [],
    operation: null,
    lastExecution: {
      executionId: "example",
      journal: "executions/execution-example.json",
      planRevision: 1,
      graphDigest: graph.digest,
      headCommit: "ccccccc",
      completedAt: "2026-07-27T01:00:00Z"
    },
    reviewCycles: [{
      cycle: 1,
      outcome: "clean",
      executionId: "example",
      planRevision: 1,
      graphDigest: graph.digest,
      reviewedHead: "ccccccc"
    }],
    history: []
  }, null, 2)}\n`);
  runState(projectRoot, "render");
  assert.equal(runState(projectRoot, "validate").status, 0);

  const statePath = join(trackRoot, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.status = "archived";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const archiveRoot = join(cadreRoot, "archive", "example");
  renameSync(trackRoot, archiveRoot);
  runState(projectRoot, "render");
  assert.equal(runState(projectRoot, "validate").status, 0);
  assert.match(readFileSync(join(cadreRoot, "tracks.md"), "utf8"), /example.*archived/);

  const archivedPlanPath = join(archiveRoot, "plan.md");
  writeFileSync(archivedPlanPath, readFileSync(archivedPlanPath, "utf8").replace(" <!-- commit: abcdef2 -->", ""));
  const invalid = runState(projectRoot, "validate", true);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /completed task T1\.2 has no commit marker/);
});

test("drafting-plan track remains valid while its approved spec commit is pending", () => {
  const projectRoot = fixture();
  const cadreRoot = join(projectRoot, ".cadre");
  const trackRoot = join(cadreRoot, "tracks", "interrupted");
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "spec.md"), `# Specification: Interrupted

## Functional Requirements
- FR-001: Resume.
## Non-Functional Requirements
- NFR-001: Preserve work.
## Acceptance Criteria
- AC-001: Continue from checkpoint.
## Dependencies
None.
## Additional Information
None.
## Dependent-track impact
None.
`);
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId: "interrupted",
    title: "Interrupted",
    type: "bug",
    status: "drafting-plan",
    checkpoint: "commit-pending",
    revision: 1,
    dependencies: [],
    commits: { spec: null, plan: null },
    artifactProgress: ["spec.md"],
    operation: {
      action: "specify",
      baseCommit: "1111111",
      expectedCommit: "cadre(track): specify interrupted",
      approvedArtifacts: ["spec.md"],
      approvedAt: "2026-07-27T00:00:00Z"
    },
    reviewCycles: [],
    history: []
  }, null, 2)}\n`);
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
  const status = runState(projectRoot, "status");
  assert.match(status.stdout, /checkpoint=commit-pending; operation=specify/);
});

test("approved active track revision is resumable and terminal history is not revisable", () => {
  const projectRoot = fixture();
  const trackRoot = join(projectRoot, ".cadre", "tracks", "revisable");
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "spec.md"), `# Specification: Revisable

## Functional Requirements
- FR-001: Preserve an approved baseline.
## Non-Functional Requirements
- NFR-001: Resume safely.
## Acceptance Criteria
- AC-001: The revision is recorded.
## Dependencies
None.
## Additional Information
None.
## Dependent-track impact
None.
`);
  const statePath = join(trackRoot, "state.json");
  const state = {
    schemaVersion: 1,
    trackId: "revisable",
    title: "Revisable",
    type: "feature",
    status: "drafting-plan",
    checkpoint: "revision-approved",
    revision: 1,
    dependencies: [],
    commits: { spec: "aaaaaaa", plan: null },
    artifactProgress: [],
    operation: {
      action: "revise",
      checkpoint: "approved",
      baseCommit: "1111111",
      expectedCommit: "cadre(revise): update revisable",
      approvedArtifacts: ["revisions/revision-20260728T000000Z.md", "spec.md"],
      artifactProgress: [],
      approvedAt: "2026-07-28T00:00:00Z",
      sourceStatus: "drafting-plan",
      targetStatus: "drafting-plan",
      revisionPath: "revisions/revision-20260728T000000Z.md",
      previousRevision: 1,
      newRevision: 2
    },
    reviewCycles: [],
    history: []
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  runState(projectRoot, "render");
  assert.equal(runState(projectRoot, "validate").status, 0);
  assert.match(runState(projectRoot, "status").stdout, /operation=revise/);

  state.operation.sourceStatus = "completed";
  state.operation.targetStatus = "completed";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const invalid = runState(projectRoot, "validate", true);
  assert.match(invalid.stderr, /revise sourceStatus must have an approved active baseline/);
});

test("approved refresh and revert operations remain valid while interrupted", () => {
  const projectRoot = fixture();
  const refreshId = "refresh-20260728T000000Z";
  const refreshPath = `refreshes/${refreshId}.md`;
  const refreshOperationPath = join(projectRoot, ".cadre", "operations", `${refreshId}.json`);
  writeFileSync(refreshOperationPath, `${JSON.stringify({
    schemaVersion: 1,
    action: "refresh",
    operationId: refreshId,
    status: "in_progress",
    checkpoint: "context-writing",
    baseCommit: "1111111",
    expectedCommit: "cadre(refresh): update project context",
    refreshPath,
    approvedArtifacts: [refreshPath, "product.md"],
    artifactProgress: [refreshPath],
    approvedAt: "2026-07-28T00:00:00Z",
    refreshCommit: null
  }, null, 2)}\n`);

  const trackRoot = writePlannedTrack(projectRoot, "revertable");
  const statePath = join(trackRoot, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.checkpoint = "reverting";
  state.operation = {
    action: "revert",
    checkpoint: "git-revert",
    baseCommit: "1111111",
    expectedCommit: "cadre(revert): reconcile revertable",
    approvedArtifacts: ["plan.md", "learning.md", "state.json"],
    artifactProgress: [],
    approvedAt: "2026-07-28T00:00:00Z",
    targetKind: "task",
    targetId: "T1.1",
    commits: ["aaaaaaa"],
    revertCommits: ["bbbbbbb"]
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  runState(projectRoot, "render");
  assert.equal(runState(projectRoot, "validate").status, 0);
  assert.match(runState(projectRoot, "status").stdout, /operation=revert/);

  state.operation.expectedCommit = "cadre(revert): reconcile another-track";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const invalid = runState(projectRoot, "validate", true);
  assert.match(invalid.stderr, /revert expectedCommit must target revertable/);

  const refresh = JSON.parse(readFileSync(refreshOperationPath, "utf8"));
  refresh.status = "completed";
  writeFileSync(refreshOperationPath, `${JSON.stringify(refresh, null, 2)}\n`);
  assert.match(runState(projectRoot, "validate", true).stderr, /completed refresh requires a refresh commit SHA/);
});

test("installer prepares a dual-product user plugin marketplace", async () => {
  const parent = mkdtempSync(join(tmpdir(), "cadre-install-"));
  const target = join(parent, "cadre");
  execFileSync(process.execPath, [
    join(root, "dist", "cadre-cli.mjs"), "install", "--agent", "all", "--prepare-only",
    "--marketplace-root", target, "--cachebuster", "test-build"
  ]);

  const pluginRoot = join(target, "plugins", "cadre");
  assert.ok(existsSync(join(pluginRoot, "skills", "track", "SKILL.md")));
  const codexManifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const claudeManifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(codexManifest.version, "3.3.0+codex.test-build");
  assert.equal(claudeManifest.version, "3.3.0+claude.test-build");
  assert.ok(existsSync(join(pluginRoot, "dist", "cadre-mcp.mjs")));
  assert.ok(existsSync(join(pluginRoot, "templates", "v1", "track", "spec.md")));
  assert.ok(existsSync(join(pluginRoot, "templates", "v1", "init", "gitignore.template")));
  assert.ok(existsSync(join(pluginRoot, "agents", "cadre-phase-worker.md")));
  assert.ok(existsSync(join(pluginRoot, "agents", "cadre-task-worker.md")));
  assert.equal(existsSync(join(pluginRoot, "scripts")), false);

  const codexMcp = JSON.parse(readFileSync(join(pluginRoot, ".mcp.codex.json"), "utf8"));
  const codexServer = codexMcp.mcpServers.cadre;
  assert.equal(codexManifest.mcpServers, "./.mcp.codex.json");
  assert.deepEqual(codexServer, {
    command: "node",
    args: ["./dist/cadre-mcp.mjs"],
    cwd: "."
  });
  const claudeMcp = JSON.parse(readFileSync(join(pluginRoot, ".mcp.json"), "utf8"));
  assert.equal(claudeMcp.mcpServers.cadre.args[0], "${CLAUDE_PLUGIN_ROOT}/dist/cadre-mcp.mjs");

  const client = new Client({ name: "cadre-packaged-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: codexServer.command,
    args: codexServer.args,
    cwd: resolve(pluginRoot, codexServer.cwd)
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 25);
    assert.ok(tools.tools.some((tool) => tool.name === "project_status"));
    const catalog = await client.callTool({ name: "template_catalog", arguments: {} });
    assert.deepEqual(
      (catalog.structuredContent as { templates?: Array<{ id?: string }> }).templates?.map((template) => template.id),
      [...TEMPLATE_IDS]
    );
  } finally {
    await client.close();
  }

  const codexMarketplace = JSON.parse(readFileSync(join(target, ".agents", "plugins", "marketplace.json"), "utf8"));
  const claudeMarketplace = JSON.parse(readFileSync(join(target, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(codexMarketplace.plugins[0].source.path, "./plugins/cadre");
  assert.equal(claudeMarketplace.plugins[0].source, "./plugins/cadre");

  execFileSync(process.execPath, [
    join(root, "dist", "cadre-cli.mjs"), "install", "--agent", "all", "--prepare-only",
    "--marketplace-root", target, "--cachebuster", "second-build"
  ]);
  const backups = readdirSync(parent).filter((entry) => entry.startsWith("cadre.backup-"));
  assert.equal(backups.length, 1);
  const previousManifest = JSON.parse(readFileSync(
    join(parent, backups[0]!, "plugins", "cadre", ".codex-plugin", "plugin.json"), "utf8"
  ));
  assert.equal(previousManifest.version, "3.3.0+codex.test-build");
  const updatedManifest = JSON.parse(readFileSync(join(target, "plugins", "cadre", ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(updatedManifest.version, "3.3.0+codex.second-build");
});

test("installer permission helpers narrowly pre-approve the Cadre MCP server and tools", () => {
  const directory = mkdtempSync(join(tmpdir(), "cadre-permissions-"));
  const codexConfig = join(directory, "codex", "config.toml");
  mkdirSync(dirname(codexConfig), { recursive: true });
  writeFileSync(codexConfig, "# Preserve this comment\nmodel = \"gpt-5\"\n");

  const codexFirst = configureCodexMcpApproval(codexConfig);
  assert.equal(codexFirst.changed, true);
  const codexBody = readFileSync(codexConfig, "utf8");
  assert.match(codexBody, /# Preserve this comment/);
  assert.match(codexBody, /\[plugins\."cadre@cadre"\.mcp_servers\.cadre\]/);
  assert.match(codexBody, /default_tools_approval_mode = "approve"/);
  assert.equal(configureCodexMcpApproval(codexConfig).changed, false);

  writeFileSync(codexConfig, `${codexBody.replace(
    "default_tools_approval_mode = \"approve\"",
    "default_tools_approval_mode = \"prompt\""
  )}`);
  assert.equal(configureCodexMcpApproval(codexConfig).changed, true);
  assert.match(readFileSync(codexConfig, "utf8"), /default_tools_approval_mode = "approve"/);

  const claudeSettings = join(directory, "claude", "settings.json");
  mkdirSync(dirname(claudeSettings), { recursive: true });
  writeFileSync(claudeSettings, `{
  // Preserve this comment
  "enabledMcpjsonServers": ["memory"],
  "permissions": {
    "allow": ["Read"]
  }
}
`);
  const claudeFirst = configureClaudeMcpApproval(claudeSettings);
  assert.equal(claudeFirst.changed, true);
  const claudeBody = readFileSync(claudeSettings, "utf8");
  assert.match(claudeBody, /\/\/ Preserve this comment/);
  assert.match(claudeBody, new RegExp(CLAUDE_APPROVAL.replaceAll("*", "\\*")));
  const claudeParsed = JSON.parse(claudeBody.replace(/\/\/.*\n/g, ""));
  assert.deepEqual(claudeParsed.enabledMcpjsonServers, ["memory", CLAUDE_SERVER_APPROVAL]);
  assert.equal(configureClaudeMcpApproval(claudeSettings).changed, false);

  const toolOnlySettings = join(directory, "claude-tool-only.json");
  writeFileSync(toolOnlySettings, `{"permissions":{"allow":["${CLAUDE_APPROVAL}"]}}\n`);
  assert.equal(configureClaudeMcpApproval(toolOnlySettings).changed, true);
  assert.deepEqual(
    JSON.parse(readFileSync(toolOnlySettings, "utf8")).enabledMcpjsonServers,
    [CLAUDE_SERVER_APPROVAL]
  );

  const deniedSettings = join(directory, "claude-denied.json");
  writeFileSync(deniedSettings, '{"permissions":{"deny":["mcp__cadre__*"]}}\n');
  assert.throws(
    () => configureClaudeMcpApproval(deniedSettings),
    /deny rule.*blocks Cadre MCP tools/
  );
});

test("workflow elicitation builds bounded approval and clarification forms", () => {
  assert.equal(supportsFormElicitation(undefined), false);
  assert.equal(supportsFormElicitation({ elicitation: {} }), true);
  assert.equal(supportsFormElicitation({ elicitation: { form: {} } }), true);
  assert.equal(supportsFormElicitation({ elicitation: { url: {} } }), false);

  const approval = buildWorkflowElicitation({
    kind: "approval",
    message: "Approve the summarized proposal?",
    binding: "digest:abc123"
  });
  assert.match(approval.message, /Approval binding: digest:abc123/);
  assert.deepEqual(approval.requestedSchema.required, ["decision"]);
  assert.deepEqual(
    (approval.requestedSchema.properties.decision as { oneOf?: Array<{ const?: string }> }).oneOf
      ?.map((option) => option.const),
    ["approve", "request_changes", "cancel"]
  );
  assert.throws(
    () => buildWorkflowElicitation({ kind: "approval", message: "Approve?" }),
    /requires a proposal or checkpoint binding/
  );

  const clarification = buildWorkflowElicitation({
    kind: "clarification",
    message: "Choose the execution settings.",
    questions: [
      {
        id: "approval_mode",
        type: "single_select",
        label: "Approval mode",
        required: true,
        options: [
          { value: "phase", label: "Phase" },
          { value: "governed", label: "Governed" },
          { value: "autonomous", label: "Autonomous" }
        ],
        default: "phase"
      },
      {
        id: "parallel",
        type: "boolean",
        label: "Run independent tasks in parallel",
        default: true
      }
    ]
  });
  assert.deepEqual(clarification.requestedSchema.required, ["approval_mode"]);
  assert.equal(clarification.requestedSchema.properties.parallel!.type, "boolean");
  assert.throws(
    () => buildWorkflowElicitation({
      kind: "clarification",
      message: "Choose.",
      questions: [
        {
          id: "mode",
          type: "single_select",
          label: "Mode",
          options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
          default: "c"
        }
      ]
    }),
    /default must match an option value/
  );

  assert.deepEqual(
    normalizeWorkflowElicitation(
      { kind: "approval", message: "Approve?", binding: "digest:abc123" },
      { action: "accept", content: { decision: "approve", notes: "Looks good" } }
    ),
    {
      kind: "approval",
      status: "approved",
      binding: "digest:abc123",
      answers: { decision: "approve", notes: "Looks good" }
    }
  );
});

test("compiled MCP exposes versioned templates and initializes projects without copied runtime", async () => {
  const proposalHome = mkdtempSync(join(tmpdir(), "cadre-mcp-home-"));
  const client = new Client({ name: "cadre-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "cadre-mcp.mjs")],
    env: childEnvironment({ CADRE_HOME: proposalHome })
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    for (const name of [
      "workflow_elicit", "template_catalog", "template_get", "template_get_many", "styleguide_resolve", "project_status",
      "state_validate", "artifact_candidate_manifest", "project_init_candidate",
      "setup_record_git_initialized", "setup_record_commit", "tracks_render",
      "execution_graph_validate", "execution_graph_validate_candidate",
      "review_complete", "archive_batch_record", "archive_batch_candidate",
      "execution_start", "execution_checkpoint", "execution_status", "execution_finish", "worktree_create",
      "integration", "worktree_cleanup", "worktree_status"
    ]) {
      assert.ok(tools.tools.some((tool) => tool.name === name), `missing MCP tool ${name}`);
    }
    const fallback = await client.callTool({
      name: "workflow_elicit",
      arguments: {
        kind: "clarification",
        message: "Choose a mode.",
        questions: [{
          id: "mode",
          type: "single_select",
          label: "Mode",
          options: [{ value: "phase", label: "Phase" }, { value: "governed", label: "Governed" }]
        }]
      }
    });
    assert.equal(
      (fallback.structuredContent as { status?: string }).status,
      "fallback_required"
    );
    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "cadre://templates/v1/track/spec"));
    assert.ok(resources.resources.some(
      (resource) => resource.uri === "cadre://templates/v1/track/revise-operation"
    ));
    assert.ok(resources.resources.some(
      (resource) => resource.uri === "cadre://templates/v1/project/refresh-operation"
    ));
    assert.ok(resources.resources.some(
      (resource) => resource.uri === "cadre://templates/v1/project/gitignore"
    ));
    assert.ok(resources.resources.some(
      (resource) => resource.uri === "cadre://templates/v1/track/revert-operation"
    ));

    const workflow = await client.callTool({ name: "template_get", arguments: { id: "project/workflow" } });
    assert.equal(workflow.isError, undefined);
    const workflowTemplate = workflow.structuredContent as {
      id?: string;
      artifactPath?: string;
      relativePath?: string;
    };
    assert.equal(workflowTemplate.id, "project/workflow");
    assert.equal(workflowTemplate.artifactPath, "workflow.md");
    assert.equal(workflowTemplate.relativePath, undefined);

    const bundle = await client.callTool({
      name: "template_get_many",
      arguments: { ids: ["track/spec", "track/state"] }
    });
    assert.equal(bundle.isError, undefined);
    assert.deepEqual(
      (bundle.structuredContent as { templates?: Array<{ id?: string }> }).templates?.map((template) => template.id),
      ["track/spec", "track/state"]
    );

    const untouchedRoot = mkdtempSync(join(tmpdir(), "cadre-draft-validator-"));
    const sentinelPath = join(untouchedRoot, "sentinel.txt");
    writeFileSync(sentinelPath, "unchanged\n");
    const draftPlan = `# Plan: MCP draft

- Spec revision: 1
- Plan revision: 1

## Phase 1: Deliver
- Phase dependencies: none
- [ ] T1.1 Implement
  - Task dependencies: none
- [ ] T1.2 User Manual Verification
- Phase completion commit: pending

## Phase 2: Track-level User Manual Verification
- [ ] T2.1 User Manual Verification
- Phase completion commit: pending
`;
    const candidateId = "review-proposal";
    const candidatePlanPath = join(untouchedRoot, ".cadre-stage", candidateId, "plan.md");
    mkdirSync(dirname(candidatePlanPath), { recursive: true });
    writeFileSync(candidatePlanPath, draftPlan);
    const candidateValidation = await client.callTool({
      name: "execution_graph_validate_candidate",
      arguments: {
        projectRoot: untouchedRoot,
        candidateId,
        targetStatus: "in_progress",
        sourceLabel: "review-proposal.md"
      }
    });
    assert.equal(candidateValidation.isError, undefined);
    assert.equal((candidateValidation.structuredContent as { valid?: boolean }).valid, true);
    assert.match(
      (candidateValidation.structuredContent as { sha256?: string }).sha256 ?? "",
      /^[0-9a-f]{64}$/
    );
    assert.equal(readFileSync(sentinelPath, "utf8"), "unchanged\n");
    writeFileSync(candidatePlanPath, "x".repeat((256 * 1024) + 1));
    const oversizedCandidate = await client.callTool({
      name: "execution_graph_validate_candidate",
      arguments: { projectRoot: untouchedRoot, candidateId, targetStatus: "planned" }
    });
    assert.equal(oversizedCandidate.isError, true);
    writeFileSync(candidatePlanPath, draftPlan);
    const candidateManifest = await client.callTool({
      name: "artifact_candidate_manifest",
      arguments: { projectRoot: untouchedRoot, candidateId, files: ["plan.md"] }
    });
    assert.equal(candidateManifest.isError, undefined);
    assert.match(
      (candidateManifest.structuredContent as { digest?: string }).digest ?? "",
      /^[0-9a-f]{64}$/
    );
    assert.equal(Object.hasOwn(candidateManifest.structuredContent ?? {}, "content"), false);
    symlinkSync(candidatePlanPath, join(untouchedRoot, ".cadre-stage", "linked-plan"));
    const linkedValidation = await client.callTool({
      name: "execution_graph_validate_candidate",
      arguments: { projectRoot: untouchedRoot, candidateId: "linked-plan", targetStatus: "planned" }
    });
    assert.equal(linkedValidation.isError, true);

    const transitionRoot = fixture();
    writePlannedTrack(transitionRoot, "mcp-transition");
    runState(transitionRoot, "render");
    const transitionStartInput = {
      projectRoot: transitionRoot,
      trackId: "mcp-transition",
      executionId: "mcp-transition-1",
      requestedMode: "sequential" as const,
      effectiveMode: "sequential" as const,
      maxWorkers: 1,
      baseCommit: "1111111",
      approvedAt: "2026-07-28T00:00:00.000Z"
    };
    const transitionStart = previewExecutionStart(transitionStartInput);
    applyExecutionStart(transitionStartInput, transitionStart.digest);
    const illegalTransition = await client.callTool({
      name: "execution_checkpoint",
      arguments: {
        projectRoot: transitionRoot,
        trackId: "mcp-transition",
        executionId: "mcp-transition-1",
        nodeId: "P1",
        event: "complete"
      }
    });
    assert.equal(illegalTransition.isError, true);
    assert.match(
      (illegalTransition.structuredContent as { error?: { message?: string } }).error?.message ?? "",
      /cannot complete from pending/
    );
    const checkpointApply = await client.callTool({
      name: "execution_checkpoint",
      arguments: {
        projectRoot: transitionRoot,
        trackId: "mcp-transition",
        executionId: "mcp-transition-1",
        nodeId: "P1",
        event: "start"
      }
    });
    assert.equal(checkpointApply.isError, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(checkpointApply)) < 4 * 1024);
    assert.equal(Object.hasOwn(checkpointApply.structuredContent ?? {}, "journal"), false);
    assert.equal(Object.hasOwn(checkpointApply.structuredContent ?? {}, "proposalToken"), false);
    assert.equal((checkpointApply.structuredContent as { commandStatus?: string }).commandStatus, "applied");
    assert.equal(
      (checkpointApply.structuredContent as { transition?: { to?: string } }).transition?.to,
      "running"
    );
    const compactStatus = await client.callTool({
      name: "execution_status",
      arguments: {
        projectRoot: transitionRoot,
        trackId: "mcp-transition",
        executionId: "mcp-transition-1"
      }
    });
    assert.equal(compactStatus.isError, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(compactStatus)) < 8 * 1024);
    assert.equal(Object.hasOwn(compactStatus.structuredContent ?? {}, "journal"), false);

    const archiveRoot = fixture();
    const archivedTrackRoot = writeFinalizedTrack(archiveRoot, "mcp-archive-candidate", "completed");
    runState(archiveRoot, "render");
    execFileSync("git", ["init", "-b", "main"], { cwd: archiveRoot });
    gitText(archiveRoot, ["config", "user.name", "Cadre Test"]);
    gitText(archiveRoot, ["config", "user.email", "cadre@example.test"]);
    gitText(archiveRoot, ["config", "commit.gpgsign", "false"]);
    gitText(archiveRoot, ["add", ".cadre"]);
    gitText(archiveRoot, ["commit", "-m", "chore: initialize archive fixture"]);
    const archiveBase = gitText(archiveRoot, ["rev-parse", "HEAD"]);
    gitText(archiveRoot, ["commit", "--allow-empty", "-m", "feat: archive task one"]);
    const archiveTaskOne = gitText(archiveRoot, ["rev-parse", "HEAD"]);
    gitText(archiveRoot, ["commit", "--allow-empty", "-m", "feat: archive task two"]);
    const archiveTaskTwo = gitText(archiveRoot, ["rev-parse", "HEAD"]);
    gitText(archiveRoot, ["commit", "--allow-empty", "-m", "test: archive verification"]);
    const archiveHead = gitText(archiveRoot, ["rev-parse", "HEAD"]);
    const archiveProjectPath = join(archiveRoot, ".cadre", "project.json");
    const archiveProject = JSON.parse(readFileSync(archiveProjectPath, "utf8"));
    archiveProject.setup.commit = archiveBase;
    writeFileSync(archiveProjectPath, `${JSON.stringify(archiveProject, null, 2)}\n`);
    const archivedStatePath = join(archivedTrackRoot, "state.json");
    const archivedState = JSON.parse(readFileSync(archivedStatePath, "utf8"));
    archivedState.commits.spec = archiveBase;
    archivedState.commits.plan = archiveBase;
    archivedState.lastExecution.headCommit = archiveHead;
    archivedState.reviewCycles[0].reviewedHead = archiveHead;
    archivedState.reviewCycles[0].commitRange = `${archiveBase}..${archiveHead}`;
    writeFileSync(archivedStatePath, `${JSON.stringify(archivedState, null, 2)}\n`);
    const archivedPlanPath = join(archivedTrackRoot, "plan.md");
    const archivedPlan = readFileSync(archivedPlanPath, "utf8")
      .replaceAll("abcdef1", archiveTaskOne)
      .replaceAll("abcdef2", archiveTaskTwo)
      .replaceAll("abcdef3", archiveHead);
    writeFileSync(archivedPlanPath, archivedPlan);
    const archivedJournalPath = join(
      archivedTrackRoot, "executions", "execution-mcp-archive-candidate-execution.json"
    );
    const archivedJournal = JSON.parse(readFileSync(archivedJournalPath, "utf8"));
    archivedJournal.planCommit = archiveBase;
    archivedJournal.baseCommit = archiveBase;
    archivedJournal.headCommit = archiveHead;
    archivedJournal.nodes["T1.1"].workerCommit = archiveTaskOne;
    archivedJournal.nodes["T1.2"].workerCommit = archiveTaskTwo;
    archivedJournal.nodes.P1.workerCommit = archiveTaskTwo;
    archivedJournal.nodes["T2.1"].workerCommit = archiveHead;
    archivedJournal.nodes.P2.workerCommit = archiveHead;
    writeFileSync(archivedJournalPath, `${JSON.stringify(archivedJournal, null, 2)}\n`);
    gitText(archiveRoot, ["add", ".cadre"]);
    gitText(archiveRoot, ["commit", "-m", "cadre(test): record reachable archive provenance"]);
    const archiveCandidateId = "archive-mcp-proposal";
    const archivePattern = "# Pattern: MCP staged pattern\n\n## Provenance\n- Track: `mcp-archive-candidate`\n";
    const archiveIndex = "# Pattern Catalog\n\n- [MCP staged pattern](mcp-staged-pattern.md)\n";
    const archivePatternPath = join(
      archiveRoot, ".cadre-stage", archiveCandidateId, "patterns", "mcp-staged-pattern.md"
    );
    const archiveIndexPath = join(archiveRoot, ".cadre-stage", archiveCandidateId, "patterns", "index.md");
    mkdirSync(dirname(archivePatternPath), { recursive: true });
    writeFileSync(archivePatternPath, archivePattern);
    writeFileSync(archiveIndexPath, archiveIndex);
    const archiveCandidatePreview = await client.callTool({
      name: "archive_batch_candidate",
      arguments: {
        projectRoot: archiveRoot,
        candidateId: archiveCandidateId,
        selectedTracks: ["mcp-archive-candidate"],
        updates: [
          { kind: "pattern", slug: "mcp-staged-pattern" },
          { kind: "pattern_index" }
        ]
      }
    });
    assert.equal(
      archiveCandidatePreview.isError,
      undefined,
      JSON.stringify(archiveCandidatePreview.structuredContent)
    );
    assert.equal(
      (archiveCandidatePreview.structuredContent as { commandStatus?: string }).commandStatus,
      "approval_required"
    );
    const archiveCandidateToken = (
      archiveCandidatePreview.structuredContent as { proposalToken?: string }
    ).proposalToken;
    assert.ok(archiveCandidateToken);
    const archiveProposalRecord = readFileSync(
      join(proposalHome, "runtime", "proposals", `${archiveCandidateToken}.json`),
      "utf8"
    );
    assert.doesNotMatch(archiveProposalRecord, /MCP staged pattern/);
    assert.doesNotMatch(archiveProposalRecord, /"content"/);
    const archiveCandidateApply = await client.callTool({
      name: "archive_batch_candidate",
      arguments: { proposalToken: archiveCandidateToken }
    });
    assert.equal(archiveCandidateApply.isError, undefined);
    assert.equal(
      (archiveCandidateApply.structuredContent as { commandStatus?: string }).commandStatus,
      "applied"
    );
    assert.equal(
      readFileSync(join(archiveRoot, ".cadre", "patterns", "mcp-staged-pattern.md"), "utf8"),
      archivePattern
    );

    const projectRoot = mkdtempSync(join(tmpdir(), "cadre-mcp-init-"));
    const files = [
      ["product.md", "# Product\n"],
      ["guidelines.md", "# Guidelines\n"],
      ["tech-stack.md", "# Tech Stack\n- TypeScript\n"],
      ["workflow.md", readFileSync(join(templateRoot, "workflow.md"), "utf8")],
      ["styleguides/general.md", "# General Styleguide\n"]
    ].map(([path, content]) => ({ path: path!, content: content! }));

    for (const file of files) {
      const path = join(projectRoot, ".cadre-stage", "create", file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content);
    }
    const input = {
      projectRoot,
      projectName: "MCP fixture",
      context: "greenfield",
      gitDisposition: "existing",
      baseCommit: null,
      approvedAt: "2026-07-28T00:00:00.000Z",
      stagedFiles: files.map((file) => file.path)
    };
    const unexpectedCandidatePath = join(projectRoot, ".cadre-stage", "create", "unexpected.md");
    writeFileSync(unexpectedCandidatePath, "unexpected\n");
    const unexpectedPreview = await client.callTool({
      name: "project_init_candidate",
      arguments: input
    });
    assert.equal(unexpectedPreview.isError, true);
    unlinkSync(unexpectedCandidatePath);
    const preview = await client.callTool({ name: "project_init_candidate", arguments: input });
    assert.equal(preview.isError, undefined);
    assert.equal((preview.structuredContent as { commandStatus?: string }).commandStatus, "approval_required");
    const digest = (preview.structuredContent as { digest?: string }).digest;
    assert.match(digest ?? "", /^[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(preview.structuredContent ?? {}, "proposalDigest"), false);
    const approvedAt = "2026-07-28T00:05:00.000Z";
    const refreshedPreview = await client.callTool({
      name: "project_init_candidate",
      arguments: { ...input, approvedAt }
    });
    assert.equal(refreshedPreview.isError, undefined);
    assert.equal((refreshedPreview.structuredContent as { digest?: string }).digest, digest);
    const proposalToken = (refreshedPreview.structuredContent as { proposalToken?: string }).proposalToken;
    assert.ok(proposalToken);
    assert.ok(
      proposalToken.length < 64,
      `expected a compact project initialization token, got ${proposalToken.length} characters`
    );
    const proposalRecord = readFileSync(
      join(proposalHome, "runtime", "proposals", `${proposalToken}.json`),
      "utf8"
    );
    assert.doesNotMatch(proposalRecord, /# Workflow/);
    assert.doesNotMatch(proposalRecord, /"content"/);
    assert.match(proposalRecord, /"stagedFiles"/);
    const wrongApply = await client.callTool({
      name: "archive_batch_candidate",
      arguments: { proposalToken }
    });
    assert.equal(wrongApply.isError, true);
    const productCandidatePath = join(projectRoot, ".cadre-stage", "create", "product.md");
    writeFileSync(productCandidatePath, "# Product\n\nChanged after preview.\n");
    const staleApply = await client.callTool({
      name: "project_init_candidate",
      arguments: { proposalToken }
    });
    assert.equal(staleApply.isError, true);
    assert.equal(existsSync(join(projectRoot, ".cadre")), false);
    writeFileSync(productCandidatePath, "# Product\n");
    const finalPreview = await client.callTool({
      name: "project_init_candidate",
      arguments: { ...input, approvedAt }
    });
    const finalProposalToken = (finalPreview.structuredContent as { proposalToken?: string }).proposalToken;
    assert.ok(finalProposalToken);
    const restartedClient = new Client({ name: "cadre-restart-test", version: "1.0.0" });
    const restartedTransport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist", "cadre-mcp.mjs")],
      env: childEnvironment({ CADRE_HOME: proposalHome })
    });
    await restartedClient.connect(restartedTransport);
    try {
      const applied = await restartedClient.callTool({
        name: "project_init_candidate",
        arguments: { proposalToken: finalProposalToken }
      });
      assert.equal(applied.isError, undefined);
      assert.equal((applied.structuredContent as { commandStatus?: string }).commandStatus, "applied");
      assert.equal(Object.hasOwn(applied.structuredContent ?? {}, "content"), false);
    } finally {
      await restartedClient.close();
    }
    assert.ok(existsSync(join(projectRoot, ".cadre", "project.json")));
    const initializedProject = JSON.parse(readFileSync(join(projectRoot, ".cadre", "project.json"), "utf8"));
    assert.equal(initializedProject.setup.operation.approvedAt, approvedAt);
    assert.equal(initializedProject.setup.operation.approvedArtifactHashes.length, files.length);
    assert.equal(
      readFileSync(join(projectRoot, ".cadre", ".gitignore"), "utf8"),
      "# Cadre-managed temporary execution worktrees\n/.worktrees/\n\n# Disposable Wisp output\n/wisps/\n"
    );
    assert.equal(existsSync(join(projectRoot, ".cadre", "wisps")), false);
    assert.equal(existsSync(join(projectRoot, ".cadre", "bin")), false);
    assert.equal(existsSync(join(projectRoot, ".cadre", "templates")), false);
  } finally {
    await client.close();
  }
});

test("compiled MCP integration pauses only when the execution is governed", async () => {
  const client = new Client({ name: "cadre-adaptive-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "cadre-mcp.mjs")],
    env: childEnvironment({ CADRE_HOME: mkdtempSync(join(tmpdir(), "cadre-adaptive-home-")) })
  });
  await client.connect(transport);
  try {
    for (const approvalMode of ["phase", "governed"] as const) {
      const { projectRoot } = gitFixture();
      const trackId = `adaptive-${approvalMode}`;
      const executionId = "run-1";
      writeWorktreeJournal(projectRoot, trackId, executionId, "running", "committed", approvalMode);
      const scope = { projectRoot, trackId, executionId, nodeId: "T1.1" };
      const created = await client.callTool({ name: "worktree_create", arguments: scope });
      assert.equal(created.isError, undefined, JSON.stringify(created.structuredContent));
      assert.equal((created.structuredContent as { commandStatus?: string }).commandStatus, "applied");
      assert.equal(Object.hasOwn(created.structuredContent ?? {}, "proposalToken"), false);
      const workerPath = (created.structuredContent as { path?: string }).path;
      assert.ok(workerPath);
      writeFileSync(join(workerPath, "app.txt"), `${approvalMode} integration\n`);
      gitText(workerPath, ["add", "app.txt"]);
      gitText(workerPath, ["commit", "-m", `feat: ${approvalMode} integration`]);

      const first = await client.callTool({ name: "integration", arguments: scope });
      assert.equal(first.isError, undefined, JSON.stringify(first.structuredContent));
      if (approvalMode === "phase") {
        assert.equal((first.structuredContent as { commandStatus?: string }).commandStatus, "applied");
        assert.equal(Object.hasOwn(first.structuredContent ?? {}, "proposalToken"), false);
      } else {
        assert.equal(
          (first.structuredContent as { commandStatus?: string }).commandStatus,
          "approval_required"
        );
        assert.equal(readFileSync(join(projectRoot, "app.txt"), "utf8"), "base\n");
        const proposalToken = (first.structuredContent as { proposalToken?: string }).proposalToken;
        assert.ok(proposalToken);
        const applied = await client.callTool({ name: "integration", arguments: { proposalToken } });
        assert.equal(applied.isError, undefined, JSON.stringify(applied.structuredContent));
        assert.equal((applied.structuredContent as { commandStatus?: string }).commandStatus, "applied");
      }
      assert.equal(readFileSync(join(projectRoot, "app.txt"), "utf8"), `${approvalMode} integration\n`);
    }
  } finally {
    await client.close();
  }
});

test("compiled MCP presents and normalizes a client-native workflow form", async () => {
  const client = new Client(
    { name: "cadre-elicitation-test", version: "1.0.0" },
    { capabilities: { elicitation: { form: {} } } }
  );
  let requestedMessage = "";
  let requestedProperties: Record<string, unknown> = {};
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    if (request.params.mode !== "form") throw new Error("expected form elicitation");
    requestedMessage = request.params.message;
    requestedProperties = request.params.requestedSchema.properties;
    return {
      action: "accept",
      content: { decision: "approve", notes: "Verified in the native form" }
    };
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "cadre-mcp.mjs")]
  });
  await client.connect(transport);
  try {
    const response = await client.callTool({
      name: "workflow_elicit",
      arguments: {
        kind: "approval",
        message: "Approve the concise phase verification summary?",
        binding: "execution:run-1/node:T1.2/head:abcdef1"
      }
    });
    assert.match(requestedMessage, /execution:run-1\/node:T1\.2\/head:abcdef1/);
    assert.deepEqual(Object.keys(requestedProperties), ["decision", "notes"]);
    assert.deepEqual(response.structuredContent, {
      kind: "approval",
      status: "approved",
      binding: "execution:run-1/node:T1.2/head:abcdef1",
      answers: { decision: "approve", notes: "Verified in the native form" }
    });
  } finally {
    await client.close();
  }
});

test("plugin namespace is not repeated in skill identities", () => {
  for (const skill of [
    "create", "track", "implement", "review", "revise",
    "archive", "refresh", "revert", "status", "wisp"
  ]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.ok(body.startsWith(`---\nname: ${skill}\n`));
    assert.equal(existsSync(join(root, "skills", `cadre-${skill}`)), false);
  }
});

test("every post-create command loads the shared workflow", () => {
  for (const skill of [
    "track", "implement", "review", "revise", "archive",
    "refresh", "revert", "status", "wisp"
  ]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /\.cadre\/workflow\.md/, `${skill} must load the shared workflow`);
  }
});

test("interactive workflows prefer bounded client-native forms with one chat fallback", () => {
  for (const skill of [
    "create", "track", "implement", "review", "revise",
    "archive", "refresh", "revert", "wisp"
  ]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /workflow_elicit/, `${skill} must prefer the shared form tool`);
    assert.match(body, /fallback_required/, `${skill} must preserve chat fallback`);
    assert.match(body, /approval policy `never`/, `${skill} must detect non-interactive host policy`);
    assert.match(body, /skip the form and ask the same short question once in chat/,
      `${skill} must bypass elicitation under non-interactive host policy`);
    assert.match(body, /policy rejection, not a human decline/,
      `${skill} must not misreport automatic policy rejection as human input`);
    assert.match(body, /never request secrets|never request secrets or retry the form/i,
      `${skill} must forbid secret collection`);
  }

  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");
  assert.match(workflow, /Human interaction forms/);
  assert.match(workflow, /bind it to the current preview digest or an immutable checkpoint/);
  assert.match(workflow, /Do not print a complete unchanged workflow/);
  assert.match(workflow, /ask the same short question once in chat and do not retry the form/);
  assert.match(workflow, /approval policy `never`, including Codex Full Access/);
  assert.match(workflow, /do not report it as a human decline/);
});

test("proposal workflows validate staged plan files without transporting their content", () => {
  for (const skill of ["track", "review", "revise"]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /execution_graph_validate_candidate/, `${skill} must validate staged plan Markdown`);
    assert.match(body, /artifact_candidate_manifest/, `${skill} must bind approval to staged hashes`);
    assert.match(body, /\.cadre-stage/, `${skill} must use the project-local candidate stage`);
    assert.match(body, /temporary project copy/, `${skill} must prohibit the filesystem workaround`);
    assert.match(body, /do not pass the plan Markdown through MCP|without transporting/i);
  }

  const track = readFileSync(join(root, "skills", "track", "SKILL.md"), "utf8");
  const review = readFileSync(join(root, "skills", "review", "SKILL.md"), "utf8");
  const implement = readFileSync(join(root, "skills", "implement", "SKILL.md"), "utf8");
  assert.match(track, /target status `planned`/);
  assert.match(review, /target status `in_progress`/);
  assert.match(implement, /execution_graph_validate/);
  assert.doesNotMatch(implement, /execution_graph_validate_candidate/);
});

test("implementation guidance preserves approval, permission, semantic checkpoints, and task-commit boundaries", () => {
  const implement = readFileSync(join(root, "skills", "implement", "SKILL.md"), "utf8");
  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");
  const executionTemplate = JSON.parse(readFileSync(join(providerRoot, "track", "execution.json"), "utf8"));
  const phaseWorker = readFileSync(join(root, "agents", "cadre-phase-worker.md"), "utf8");
  const taskWorker = readFileSync(join(root, "agents", "cadre-task-worker.md"), "utf8");

  for (const body of [implement, workflow]) {
    assert.match(body, /host security permission/i);
    assert.match(body, /execution_checkpoint/);
    assert.match(body, /evidence (?:does not yet exist|exists|before it exists)/i);
    assert.match(body, /distinct recorded SHA|distinct SHA/);
    assert.match(body, /`governed`/);
    assert.match(body, /`phase` \(default\)|`phase` is the default/);
    assert.match(body, /Track-level User Manual Verification/);
    assert.match(body, /global tool catalog/);
    assert.match(body, /proposalToken|proposal token/);
    assert.match(body, /state-machine probe|probe (?:previews|commands) to (?:learn legal transitions|rediscover declared contracts)/);
    assert.match(body, /independent read-only .* parallel/i);
    assert.match(body, /\.cadre\/\*\*.*does not invalidate product verification/);
  }
  assert.match(implement, /pause once for each phase's final `User Manual Verification` task/i);
  assert.match(implement, /run all regular work inside a phase autonomously/);
  assert.match(implement, /Pause only for the `Track-level User Manual Verification` task/);
  assert.match(implement, /Do not add an execution-start approval prompt outside `governed`/);
  assert.match(implement, /Keep the phase node `integrated`, clean its worktree, and only then mark the phase `completed`/);
  assert.match(implement, /already-`completed` node as interruption recovery/);
  assert.match(implement, /Do not repair markers or the index separately/);
  assert.match(workflow, /deterministic worktree, clean integration, cleanup, journal, index, and bookkeeping mutations/);
  assert.match(workflow, /does not require a separate approval prompt/);
  assert.equal(executionTemplate.approvalMode, "{{governed|phase|autonomous}}");
  assert.match(phaseWorker, /one regular task at a time/);
  assert.match(phaseWorker, /commit only that task/i);
  assert.match(phaseWorker, /unexpected host permission/);
  assert.match(taskWorker, /unexpected host permission/);
});

test("review and archive guidance coalesces exact approval decisions", () => {
  const review = readFileSync(join(root, "skills", "review", "SKILL.md"), "utf8");
  const archive = readFileSync(join(root, "skills", "archive", "SKILL.md"), "utf8");
  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");

  assert.match(review, /One response may approve both the finding disposition and the unchanged exact artifacts/);
  assert.match(review, /reject all findings while explicitly accepting their risks and approve clean completion/);
  assert.match(archive, /server selects every eligible completed track in dependency order/);
  assert.match(archive, /Expected human decision count is one for the complete batch/);
  assert.match(archive, /generated index/);
  assert.match(workflow, /Combine related decisions whenever their complete artifacts and consequences are available together/);
  assert.match(review, /review_complete/);
  assert.match(review, /Do not inspect the installed runtime/);
  assert.match(archive, /archive_batch_candidate/);
  assert.match(archive, /do not call `template_catalog`/);
  assert.match(archive, /(?:needs no second approval|without another approval)/);
  assert.doesNotMatch(archive, /call `tracks_render`/);
  assert.match(review, /Expected human decision count is one per review cycle/);
  assert.match(archive, /Expected human decision count is one for the complete batch/);
  assert.match(workflow, /same approval\/content digest/);
});

test("commands reuse status validation and batch related template reads", () => {
  for (const skill of [
    "track", "implement", "review", "revise", "archive",
    "refresh", "revert", "status"
  ]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /project_status/, `${skill} must read project status once at entry`);
    assert.match(body, /embedded[^;\n]*validation|validation embedded/, `${skill} must reuse status validation`);
    assert.match(body, /do not repeat `state_validate`|do not repeat `state_validate` at command entry/,
      `${skill} must not repeat full validation at entry`);
  }

  for (const skill of ["create", "track", "review", "revise", "archive", "refresh", "revert"]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /template_get_many/, `${skill} must batch related template reads`);
    assert.doesNotMatch(body, /`template_get`(?!_many)/, `${skill} must not request templates one at a time`);
  }

  const initialization = readFileSync(join(root, "src", "domain", "init.ts"), "utf8");
  assert.match(initialization, /getTemplates\(\[/);
  assert.doesNotMatch(initialization, /getTemplate\(/);
});

test("create classifies project context and ambiguous planning commands must clarify", () => {
  const create = readFileSync(join(root, "skills", "create", "SKILL.md"), "utf8");
  assert.match(create, /greenfield/);
  assert.match(create, /brownfield/);
  assert.match(create, /blocking question/);

  for (const skill of ["track", "revise", "refresh"]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /clarification gate/, `${skill} must apply the clarification gate`);
    assert.match(body, /Ask|ask/, `${skill} must ask when material ambiguity remains`);
  }
});

test("revise routes every lifecycle state without rewriting terminal history", () => {
  const revise = readFileSync(join(root, "skills", "revise", "SKILL.md"), "utf8");
  for (const status of [
    "drafting-spec", "drafting-plan", "planned", "in_progress",
    "ready_for_review", "completed", "archived"
  ]) {
    assert.match(revise, new RegExp(`\\b${status}\\b`));
  }
  assert.match(revise, /do not create a revision artifact/);
  assert.match(revise, /Route a defect through `review`/);
  assert.match(revise, /successor feature or bug track/);
  assert.match(revise, /track\/revise-operation/);
  assert.match(revise, /Resume a matching `revise` operation/);

  const revision = readFileSync(join(providerRoot, "track", "revision.md"), "utf8");
  assert.match(revision, /Source status/);
  assert.match(revision, /Affected work and provenance/);
  assert.match(revision, /Review and verification impact/);

  const operation = JSON.parse(readFileSync(join(providerRoot, "track", "revise-operation.json"), "utf8"));
  assert.equal(operation.action, "revise");
  assert.equal(operation.checkpoint, "approved");
  assert.ok(Array.isArray(operation.artifactProgress));
  assert.equal(operation.newRevision, operation.previousRevision + 1);
});

test("create bootstraps Git only when no worktree exists", () => {
  const create = readFileSync(join(root, "skills", "create", "SKILL.md"), "utf8");
  assert.match(create, /git rev-parse --show-toplevel/);
  assert.match(create, /git init/);
  assert.match(create, /never initialize a nested repository/);
  assert.match(create, /setup_record_git_initialized/);

  const project = JSON.parse(readFileSync(join(templateRoot, "project.json"), "utf8"));
  assert.ok(project.setup.operation.repositoryRoot);
  assert.ok(project.setup.operation.gitDisposition);
});

test("create uses one final configuration and initialization approval envelope", () => {
  const create = readFileSync(join(root, "skills", "create", "SKILL.md"), "utf8");
  assert.match(create, /Do not print the complete unchanged bundled workflow unless the human asks/);
  assert.match(create, /Expected human decision count is one/);
  assert.match(create, /do not ask the human to accept each default guide/i);
  assert.match(create, /do not add later approval prompts/i);
  assert.match(create, /project_init_candidate/);
  assert.match(create, /Never make these two calls consecutively without the human decision/);
  assert.match(create, /do not .*pass artifact bodies through MCP/i);
  assert.match(create, /\.cadre-stage\/create/);
  assert.match(create, /\.cadre-stage\/create\/product\.md/);
  assert.match(create, /Never create .*\.cadre\/init\//);

  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");
  assert.match(workflow, /Create-time configuration envelope/);
  assert.match(workflow, /Do not create separate workflow, styleguide-selection, manifest, Git-initialization, validation, or commit approvals/);
});

test("semantic authorization envelopes remove deterministic follow-up approvals", () => {
  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");
  const track = readFileSync(join(root, "skills", "track", "SKILL.md"), "utf8");
  const revise = readFileSync(join(root, "skills", "revise", "SKILL.md"), "utf8");
  const refresh = readFileSync(join(root, "skills", "refresh", "SKILL.md"), "utf8");
  const revert = readFileSync(join(root, "skills", "revert", "SKILL.md"), "utf8");
  const wisp = readFileSync(join(root, "skills", "wisp", "SKILL.md"), "utf8");
  const trackState = JSON.parse(readFileSync(join(providerRoot, "track", "state.json"), "utf8"));

  assert.match(workflow, /One approval creates an authorization envelope/);
  assert.match(workflow, /Those mechanics do not become separate human decisions/);
  assert.match(track, /Expected human decision count is one for a clear new track/);
  assert.match(track, /do not create a specification-only approval prompt/);
  assert.match(track, /Copy all three exact staged artifacts into the durable/);
  assert.deepEqual(trackState.operation.approvedArtifacts, ["spec.md", "plan.md", "learning.md"]);
  assert.match(revise, /Expected human decision count is one/);
  assert.match(revise, /without another prompt/);
  assert.match(refresh, /Expected human decision count is one/);
  assert.match(refresh, /instead of starting separate approval cycles/);
  assert.match(revert, /Expected human decision count is one on the clean path/);
  assert.match(revert, /Do not turn these deterministic consequences into a second approval/);
  assert.match(wisp, /Standard Wisp has zero approval prompts/);
});

test("default styleguide catalog covers the supported stack", () => {
  const styleguideRoot = join(providerRoot, "styleguides");
  const expected = [
    "go", "java", "kotlin", "maven", "gradle", "javascript", "typescript",
    "react", "html-css", "flutter", "dart", "swift", "swiftui", "python"
  ];
  for (const name of expected) {
    const body = readFileSync(join(styleguideRoot, `${name}.md`), "utf8");
    assert.match(body, /^# /);
    assert.match(body, /## Sources/);
  }
});

test("archive supports a resumable multi-track batch", () => {
  const archive = readFileSync(join(root, "skills", "archive", "SKILL.md"), "utf8");
  assert.match(archive, /one or more `completed` tracks in a single batch/);
  assert.match(archive, /all completed/);
  assert.match(archive, /Reject the batch without partial mutation/);
  assert.match(archive, /archive_batch_candidate/);
  assert.match(archive, /Commit all approved moves and derived changes together/i);

  const operation = JSON.parse(readFileSync(join(providerRoot, "project", "archive-operation.json"), "utf8"));
  assert.equal(operation.action, "archive");
  assert.ok(Array.isArray(operation.selectedTracks));
  assert.ok(Array.isArray(operation.completedTracks));

  const projectRoot = fixture();
  const invalidOperation = {
    ...operation,
    batchId: "archive-invalid",
    baseCommit: "1111111",
    expectedCommit: "cadre(archive): archive missing",
    selectedTracks: ["missing"],
    approvedArtifacts: ["archive/missing"],
    approvedAt: "2026-07-27T00:00:00Z"
  };
  writeFileSync(
    join(projectRoot, ".cadre", "operations", "archive-invalid.json"),
    `${JSON.stringify(invalidOperation, null, 2)}\n`
  );
  const invalid = runState(projectRoot, "validate", true);
  assert.match(invalid.stderr, /unknown selected track missing/);
});

test("track state is canonical and generated tracks omit paths and dependencies", () => {
  const projectRoot = fixture();
  const cadreRoot = join(projectRoot, ".cadre");
  const trackRoot = join(cadreRoot, "tracks", "local-state");
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId: "local-state",
    title: "Local state",
    type: "feature",
    status: "drafting-spec",
    checkpoint: "approved",
    revision: 1,
    dependencies: [],
    commits: { spec: null, plan: null },
    artifactProgress: ["state.json"],
    operation: {
      action: "specify",
      baseCommit: "1111111",
      expectedCommit: "cadre(track): specify local-state",
      approvedArtifacts: ["spec.md"],
      approvedAt: "2026-07-27T00:00:00Z"
    },
    reviewCycles: [],
    history: []
  }, null, 2)}\n`);

  runState(projectRoot, "render");
  const tracks = readFileSync(join(cadreRoot, "tracks.md"), "utf8");
  assert.match(tracks, /`local-state` Local state/);
  assert.doesNotMatch(tracks, /Dependencies|Path/);

  const statePath = join(trackRoot, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.dependencies = ["missing-dependency"];
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const invalid = runState(projectRoot, "validate", true);
  assert.match(invalid.stderr, /unknown dependency missing-dependency/);
  const project = JSON.parse(readFileSync(join(cadreRoot, "project.json"), "utf8"));
  assert.equal(Object.hasOwn(project, "tracks"), false);
});
