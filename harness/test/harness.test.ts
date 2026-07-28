import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { formatStatus, renderTracksPreview, validateProject, writeTracks } from "../src/domain/state.js";
import { parsePlan, validatePlanGraph } from "../src/domain/plan.js";
import {
  applyExecutionFinish, applyExecutionNodeUpdate, applyExecutionStart, executionStatus,
  previewExecutionFinish, previewExecutionNodeUpdate, previewExecutionStart
} from "../src/domain/execution.js";
import {
  applyWorktreeCleanup, applyWorktreeCreate, applyWorktreeIntegration, managedWorktreeStatus,
  previewWorktreeCleanup, previewWorktreeCreate, previewWorktreeIntegration
} from "../src/domain/worktrees.js";
import {
  CLAUDE_APPROVAL,
  configureClaudeMcpApproval,
  configureCodexMcpApproval
} from "../scripts/permissions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(root, "templates", "v1", "init");
const providerRoot = join(root, "templates", "v1");

function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-test-"));
  cpSync(templateRoot, join(projectRoot, ".cadre"), { recursive: true });
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.runtimeVersion = "0.3.0";
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

test("empty initialized project validates", () => {
  const projectRoot = fixture();
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
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
  applyExecutionStart(input, preview.digest);
  assert.deepEqual(executionStatus(projectRoot, input.trackId, input.executionId).readyPhases, ["P1"]);
  assert.deepEqual(executionStatus(projectRoot, input.trackId, input.executionId).readyTasks, []);
  assert.throws(() => previewExecutionNodeUpdate({
    projectRoot, trackId: input.trackId, executionId: input.executionId, nodeId: "T1.1", status: "running"
  }), /until phase P1 is running/);

  const phaseUpdate = {
    projectRoot, trackId: input.trackId, executionId: input.executionId, nodeId: "P1", status: "running" as const
  };
  const phasePreview = previewExecutionNodeUpdate(phaseUpdate);
  applyExecutionNodeUpdate(phaseUpdate, phasePreview.digest);
  assert.deepEqual(executionStatus(projectRoot, input.trackId, input.executionId).readyTasks, ["T1.1"]);

  const journalPath = join(trackRoot, "executions", `execution-${input.executionId}.json`);
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  delete journal.nodes["T1.2"];
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  assert.ok(validateProject(projectRoot).errors.some((error) => error.includes("do not exactly match")));

  assert.throws(() => previewExecutionStart({
    ...input,
    executionId: "another-execution",
    requestedMode: "sequential",
    effectiveMode: "parallel"
  }), /cannot become parallel/);
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

test("execution start and finish resume across their two-file checkpoints", () => {
  const projectRoot = fixture();
  const trackRoot = writePlannedTrack(projectRoot, "checkpoint-track");
  writeFileSync(join(trackRoot, "plan.md"), `# Plan: Checkpoint track

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
  writeFileSync(start.journalPath, `${JSON.stringify(start.journal, null, 2)}\n`);
  applyExecutionStart(startInput, start.digest);

  const finishInput = {
    projectRoot,
    trackId: startInput.trackId,
    executionId: startInput.executionId,
    headCommit: "ccccccc",
    completedAt: "2026-07-28T04:00:00.000Z"
  };
  const finish = previewExecutionFinish(finishInput);
  writeFileSync(finish.journalPath, `${JSON.stringify(finish.journal, null, 2)}\n`);
  const resumedFinish = previewExecutionFinish(finishInput);
  applyExecutionFinish(finishInput, resumedFinish.digest);
  const state = JSON.parse(readFileSync(join(trackRoot, "state.json"), "utf8"));
  assert.equal(state.status, "ready_for_review");
  assert.equal(state.operation, null);
  assert.equal(state.lastExecution.executionId, startInput.executionId);
});

test("worktree tools integrate task-to-phase and phase-to-main, then clean up safely", () => {
  const { projectRoot, head } = gitFixture();
  const phaseInput = {
    projectRoot, trackId: "parallel-track", executionId: "run-1", nodeId: "P1", baseCommit: head
  };
  const phasePreview = previewWorktreeCreate(phaseInput);
  const phase = applyWorktreeCreate(phaseInput, phasePreview.digest);
  const taskInput = {
    projectRoot, trackId: "parallel-track", executionId: "run-1", nodeId: "T1.1", phaseId: "P1", baseCommit: head
  };
  const taskPreview = previewWorktreeCreate(taskInput);
  const task = applyWorktreeCreate(taskInput, taskPreview.digest);
  writeFileSync(join(task.path, "app.txt"), "implemented by task\n");
  gitText(task.path, ["add", "app.txt"]);
  gitText(task.path, ["commit", "-m", "feat: implement task"]);

  const taskIntegration = previewWorktreeIntegration(taskInput);
  assert.deepEqual(taskIntegration.changedFiles, ["app.txt"]);
  assert.equal(applyWorktreeIntegration(taskInput, taskIntegration.digest).status, "integrated");
  const taskCleanup = previewWorktreeCleanup(taskInput);
  applyWorktreeCleanup(taskInput, taskCleanup.digest);
  assert.equal(existsSync(task.path), false);

  const phaseIntegrationInput = {
    projectRoot, trackId: "parallel-track", executionId: "run-1", nodeId: "P1"
  };
  const phaseIntegration = previewWorktreeIntegration(phaseIntegrationInput);
  assert.equal(applyWorktreeIntegration(phaseIntegrationInput, phaseIntegration.digest).status, "integrated");
  const phaseCleanup = previewWorktreeCleanup(phaseIntegrationInput);
  applyWorktreeCleanup(phaseIntegrationInput, phaseCleanup.digest);

  assert.equal(readFileSync(join(projectRoot, "app.txt"), "utf8"), "implemented by task\n");
  assert.equal(gitText(projectRoot, ["status", "--porcelain"]), "");
  const status = managedWorktreeStatus(projectRoot);
  assert.equal(status.worktrees.filter((worktree) => worktree.managed).length, 0);
  assert.deepEqual(status.orphanedDirectories, []);
  assert.equal(existsSync(phase.path), false);
});

test("a main-coordinated task worker integrates directly into the canonical worktree", () => {
  const { projectRoot, head } = gitFixture();
  const input = {
    projectRoot, trackId: "main-phase", executionId: "run-1", nodeId: "T1.1", phaseId: "P1", baseCommit: head
  };
  const create = previewWorktreeCreate(input);
  const worker = applyWorktreeCreate(input, create.digest);
  writeFileSync(join(worker.path, "app.txt"), "main-coordinated task\n");
  gitText(worker.path, ["add", "app.txt"]);
  gitText(worker.path, ["commit", "-m", "feat: implement main-coordinated task"]);

  const integration = previewWorktreeIntegration(input);
  assert.equal(integration.targetPath, realpathSync(projectRoot));
  assert.equal(applyWorktreeIntegration(input, integration.digest).status, "integrated");
  const cleanup = previewWorktreeCleanup(input);
  applyWorktreeCleanup(input, cleanup.digest);
  assert.equal(readFileSync(join(projectRoot, "app.txt"), "utf8"), "main-coordinated task\n");
});

test("worktree integration reports conflicts without resolving them", () => {
  const { projectRoot, head } = gitFixture();
  const input = {
    projectRoot, trackId: "conflict-track", executionId: "run-1", nodeId: "P1", baseCommit: head
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
  assert.throws(() => previewWorktreeCleanup(input), /not integrated/);
});

test("worker branches cannot integrate protected Cadre state", () => {
  const { projectRoot, head } = gitFixture();
  const input = {
    projectRoot, trackId: "protected-track", executionId: "run-1", nodeId: "P1", baseCommit: head
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
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.runtimeVersion = "0.3.0";
  project.templateSetVersion = "v1";
  project.project.name = "Interrupted setup";
  project.project.context = "greenfield";
  project.setup.operation.baseCommit = null;
  project.setup.operation.approvedArtifacts = ["product.md", "guidelines.md", "tech-stack.md", "workflow.md"];
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

test("installer prepares a dual-product user plugin marketplace", async () => {
  const parent = mkdtempSync(join(tmpdir(), "cadre-install-"));
  const target = join(parent, "cadre");
  execFileSync(process.execPath, [
    "--import", "tsx", join(root, "scripts", "install.ts"), "--agent", "all", "--prepare-only",
    "--marketplace-root", target, "--cachebuster", "test-build"
  ]);

  const pluginRoot = join(target, "plugins", "cadre");
  assert.ok(existsSync(join(pluginRoot, "skills", "track", "SKILL.md")));
  const codexManifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const claudeManifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(codexManifest.version, "0.3.0+codex.test-build");
  assert.equal(claudeManifest.version, "0.3.0+claude.test-build");
  assert.ok(existsSync(join(pluginRoot, "dist", "cadre-mcp.mjs")));
  assert.ok(existsSync(join(pluginRoot, "templates", "v1", "track", "spec.md")));
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
    assert.ok(tools.tools.some((tool) => tool.name === "project_status"));
  } finally {
    await client.close();
  }

  const codexMarketplace = JSON.parse(readFileSync(join(target, ".agents", "plugins", "marketplace.json"), "utf8"));
  const claudeMarketplace = JSON.parse(readFileSync(join(target, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(codexMarketplace.plugins[0].source.path, "./plugins/cadre");
  assert.equal(claudeMarketplace.plugins[0].source, "./plugins/cadre");

  execFileSync(process.execPath, [
    "--import", "tsx", join(root, "scripts", "install.ts"), "--agent", "all", "--prepare-only",
    "--marketplace-root", target, "--cachebuster", "second-build"
  ]);
  const backups = readdirSync(parent).filter((entry) => entry.startsWith("cadre.backup-"));
  assert.equal(backups.length, 1);
  const previousManifest = JSON.parse(readFileSync(
    join(parent, backups[0]!, "plugins", "cadre", ".codex-plugin", "plugin.json"), "utf8"
  ));
  assert.equal(previousManifest.version, "0.3.0+codex.test-build");
  const updatedManifest = JSON.parse(readFileSync(join(target, "plugins", "cadre", ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(updatedManifest.version, "0.3.0+codex.second-build");
});

test("installer permission helpers narrowly pre-approve Cadre MCP tools", () => {
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
  assert.equal(configureClaudeMcpApproval(claudeSettings).changed, false);

  const deniedSettings = join(directory, "claude-denied.json");
  writeFileSync(deniedSettings, '{"permissions":{"deny":["mcp__cadre__*"]}}\n');
  assert.throws(
    () => configureClaudeMcpApproval(deniedSettings),
    /deny rule.*blocks Cadre MCP tools/
  );
});

test("compiled MCP exposes versioned templates and initializes projects without copied runtime", async () => {
  const client = new Client({ name: "cadre-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "cadre-mcp.mjs")]
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    for (const name of [
      "template_catalog", "template_get", "template_get_many", "styleguide_resolve", "project_status",
      "state_validate", "project_init_preview", "project_init_apply",
      "setup_record_git_initialized", "setup_record_commit", "tracks_render_preview", "tracks_render_apply",
      "execution_graph_validate", "execution_start_preview", "execution_start_apply",
      "execution_node_preview", "execution_node_apply", "execution_status",
      "execution_finish_preview", "execution_finish_apply", "worktree_create_preview",
      "worktree_create_apply", "integration_preview", "integration_apply",
      "worktree_cleanup_preview", "worktree_cleanup_apply", "worktree_status"
    ]) {
      assert.ok(tools.tools.some((tool) => tool.name === name), `missing MCP tool ${name}`);
    }
    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "cadre://templates/v1/track/spec"));
    assert.ok(resources.resources.some(
      (resource) => resource.uri === "cadre://templates/v1/track/revise-operation"
    ));

    const workflow = await client.callTool({ name: "template_get", arguments: { id: "project/workflow" } });
    assert.equal(workflow.isError, undefined);
    assert.equal((workflow.structuredContent as { id?: string }).id, "project/workflow");

    const bundle = await client.callTool({
      name: "template_get_many",
      arguments: { ids: ["track/spec", "track/state"] }
    });
    assert.equal(bundle.isError, undefined);
    assert.deepEqual(
      (bundle.structuredContent as { templates?: Array<{ id?: string }> }).templates?.map((template) => template.id),
      ["track/spec", "track/state"]
    );

    const projectRoot = mkdtempSync(join(tmpdir(), "cadre-mcp-init-"));
    const files = [
      ["product.md", "# Product\n"],
      ["guidelines.md", "# Guidelines\n"],
      ["tech-stack.md", "# Tech Stack\n- TypeScript\n"],
      ["workflow.md", "# Workflow\nRead before edit.\n"],
      ["styleguides/general.md", "# General Styleguide\n"]
    ].map(([path, content]) => ({ path: path!, content: content! }));
    const input = {
      projectRoot,
      projectName: "MCP fixture",
      context: "greenfield",
      gitDisposition: "existing",
      baseCommit: null,
      approvedAt: "2026-07-28T00:00:00.000Z",
      files
    };
    const preview = await client.callTool({ name: "project_init_preview", arguments: input });
    assert.equal(preview.isError, undefined);
    const digest = (preview.structuredContent as { digest?: string }).digest;
    assert.match(digest ?? "", /^[0-9a-f]{64}$/);
    const applied = await client.callTool({
      name: "project_init_apply",
      arguments: { ...input, proposalDigest: digest }
    });
    assert.equal(applied.isError, undefined);
    assert.ok(existsSync(join(projectRoot, ".cadre", "project.json")));
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

test("create requires separate workflow and styleguide acceptance", () => {
  const create = readFileSync(join(root, "skills", "create", "SKILL.md"), "utf8");
  assert.match(create, /whether the default workflow is acceptable or the human wants changes/);
  assert.match(create, /use the default, amend it, or use a user-provided replacement/);

  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");
  assert.match(workflow, /Create-time workflow and styleguide acceptance/);
  assert.match(workflow, /Do not infer workflow acceptance/);
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
  assert.match(archive, /project\/archive-operation/);
  assert.match(archive, /commit all approved archive moves and derived changes together/);

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
