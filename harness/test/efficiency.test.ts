import { validateStagedState } from "../src/domain/staged-state.js";
import { executionBuildCache } from "../src/domain/build-cache.js";
import { retainedSources, issueContextToken } from "../src/domain/context-retention.js";
import { applyWorktreeCreate, previewWorktreeCreate, applyWorktreeIntegration, previewWorktreeIntegration } from "../src/domain/worktrees.js";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promoteOperation, receiptHash, reconcileOperation, resolveOperation, resumeOperation } from "../src/domain/operation-receipts.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { previewProjectInitCandidate, applyProjectInitCandidate } from "../src/domain/init.js";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { dependencySources, inspectDependencyContext } from "../src/domain/dependency-context.js";
import { readExecution, executionSchedulerView, applyExecutionStart, previewExecutionStart, previewExecutionCheckpoint, applyExecutionCheckpoint, previewExecutionFinish, applyExecutionFinish } from "../src/domain/execution.js";
import { deriveReviewCompleteInput, previewReviewComplete, applyReviewComplete, deriveArchiveBatchCandidateInput, previewArchiveBatchCandidate, applyArchiveBatchCandidate } from "../src/domain/governance.js";
import { validateProject } from "../src/domain/state.js";
import { CadreError, readDiagnostic, serializeCadreError } from "../src/domain/errors.js";
import { createResultFormatter } from "../src/mcp/results.js";
import { readContext } from "../src/domain/context.js";
import { parsePlanContent, validatePlanGraph } from "../src/domain/plan.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCadreServer } from "../src/mcp/server.js";
import { describeTemplate, getTemplate } from "../src/domain/templates.js";
import { renderTracksWithState } from "../src/domain/tracks-index.js";
import { CADRE_RUNTIME_VERSION, isCompatibleRuntimeVersion } from "../src/domain/version.js";

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
function write(root: string, path: string, body: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
function git(root: string, ...args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "cadre-efficiency-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Cadre Fixture"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "commit.gpgsign", "false");
  return root;
}
function commitReceipt(root: string, result: { operationId: string; trailers: string[] }) {
  git(root, "add", ".cadre"); git(root, "commit", "-m", `cadre: ${result.operationId}`, "-m", result.trailers.join("\n"));
  const before = git(root, "status", "--porcelain");
  assert.equal(reconcileOperation(root, result.operationId), git(root, "rev-parse", "HEAD"));
  assert.equal(git(root, "status", "--porcelain"), before);
}
function initialize(root: string) {
  const stagedFiles = ["product.md", "guidelines.md", "tech-stack.md"];
  prepareCandidateStage(root, "create", stagedFiles);
  for (const file of stagedFiles) write(root, `.cadre/stage/create/${file}`, `# ${file}\nRequired: preserve authorization and verification.\n`);
  const input = { projectRoot: root, projectName: "Synthetic lifecycle", context: "greenfield" as const, gitDisposition: "initialize" as const, baseCommit: null, approvedAt: "2026-09-25T00:00:00.000Z", stagedFiles, styleguideIds: ["project/styleguides/general"] };
  const result = applyProjectInitCandidate(input, previewProjectInitCandidate(input).digest);
  assert.equal(result.receipt?.status, "commit_pending"); assert.match(validateProject(root).errors.join("\n"), /commit_pending/);
  commitReceipt(root, result.receipt!); assert.deepEqual(validateProject(root).errors, []);
}
function plan(grouped = false) {
  return `# Plan\n- Spec revision: 1\n- Plan revision: 1\n## Phase 1: Deliver\n- Phase dependencies: none\n- [ ] T1.1 First behavior\n  - Task dependencies: none\n  - Commit group: behavior\n${grouped ? "- [ ] T1.2 Second behavior\n  - Task dependencies: T1.1\n  - Commit group: behavior\n" : ""}- [ ] T1.${grouped ? 3 : 2} User Manual Verification\n- Phase completion commit: pending\n## Phase 2: Track-level User Manual Verification\n- [ ] T2.1 User Manual Verification\n- Phase completion commit: pending\n`;
}

for (const runtimeVersion of ["3.9.0", "3.9.1"]) test(`${runtimeVersion} projects continue through the patch upgrade without refresh or project mutation`, async (t) => {
  const root = fixture(t); initialize(root);
  const projectPath = join(root, ".cadre/project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.runtimeVersion = runtimeVersion;
  write(root, ".cadre/project.json", json(project));
  git(root, "add", ".cadre/project.json"); git(root, "commit", "-m", `fixture: existing ${runtimeVersion} project`);
  track(root);
  const before = readFileSync(projectPath, "utf8"), validation = validateProject(root);
  assert.deepEqual(validation.errors, []);
  assert.ok(!validation.warnings.some((warning) => warning.startsWith("PROJECT_REFRESH_REQUIRED:")));
  assert.equal(isCompatibleRuntimeVersion(CADRE_RUNTIME_VERSION), true);
  for (const version of ["3.8.0", "3.9.3", "3.9.0+unapproved", undefined]) assert.equal(isCompatibleRuntimeVersion(version), false);
  const server = createCadreServer(), client = new Client({ name: "codex", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  t.after(async () => { await client.close(); await server.close(); });
  for (const args of [{ projectRoot: root, view: "project" }, { projectRoot: root, trackId: "sample", view: "track" }]) {
    const result = await client.callTool({ name: "project_status", arguments: args });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { upgradeRequired: boolean }).upgradeRequired, false);
  }
  const start = await client.callTool({ name: "execution_start", arguments: {
    projectRoot: root, trackId: "sample", approvalMode: "track", requestedMode: "sequential"
  } });
  assert.equal(start.isError, undefined, JSON.stringify(start));
  assert.equal(readFileSync(projectPath, "utf8"), before);
  assert.deepEqual(validateProject(root).errors, []);
});
function track(root: string, grouped = false, planBody = plan(grouped)) {
  const files = {
    "spec.md": "# Specification\n## Functional Requirements\nImplement behavior.\n## Non-Functional Requirements\nPreserve evidence.\n## Acceptance Criteria\nTests pass.\n## Dependencies\nNone.\n## Additional Information\nNone.\n## Dependent-track impact\nNone.\n",
    "plan.md": planBody,
    "learning.md": '# Learning\n<!-- cadre:pattern-seed:start -->\n## Pattern Seed\n<!-- cadre:memory:start -->\n{"schemaVersion":1,"specRevision":1,"planRevision":1,"patterns":[]}\n<!-- cadre:memory:end -->\nNo applicable patterns.\n<!-- cadre:pattern-seed:end -->\n## Phase 1: Deliver\nPreserve authorization and verification.\n',
    "dependency-context.json": json({ schemaVersion: 1, specRevision: 1, planRevision: 1, dependencies: [], ...dependencySources(root, []), constraints: [] }),
    "state.json": json({ schemaVersion: 2, trackId: "sample", title: "Sample", type: "feature", status: "planned", checkpoint: "ready", revision: 1, dependencies: [], commits: { spec: null, plan: null }, artifactProgress: [], operation: null, lastExecution: null, reviewCycles: [], history: [] })
  };
  prepareCandidateStage(root, "track-sample", Object.keys(files));
  for (const [path, content] of Object.entries(files)) write(root, `.cadre/stage/track-sample/${path}`, content);
  const input = { projectRoot: root, candidateId: "track-sample", workflow: "track" as const, files: Object.keys(files) };
  const preview = previewCandidateApply(input), derived = JSON.parse(files["state.json"]);
  for (const change of preview.stateChanges.find((item) => item.path === ".cadre/tracks/sample/state.json")!.changes) {
    if (change.action === "append") derived[change.field].push(...change.value as unknown[]);
    else derived[change.field] = change.value;
  }
  assert.equal(receiptHash(json(derived)), preview.manifest.find((file) => file.path === ".cadre/tracks/sample/state.json")!.sha256);
  commitReceipt(root, applyCandidate(input, preview.digest)); assert.deepEqual(validateProject(root).errors, []);
}
const handoff = { decisions: ["Preserve required constraints"], failedApproaches: [], openQuestions: [], nextAction: "Verify", sources: [] };
test("stale dependency errors expose the exact repairable source fingerprint", (t) => {
  const root = fixture(t); initialize(root); track(root);
  const expected = dependencySources(root, ["sample"]);
  const body = json({ schemaVersion: 1, specRevision: 1, planRevision: 1, dependencies: ["sample"],
    graphHash: "0".repeat(64), sources: [], constraints: [] });
  assert.throws(() => inspectDependencyContext(root, body, ["sample"], 1, 1), (error: unknown) => {
    assert.ok(error instanceof CadreError); assert.equal(error.code, "DEPENDENCY_CONTEXT_STALE");
    assert.equal(error.details?.expectedGraphHash, expected.graphHash);
    assert.deepEqual(error.details?.expectedSources, expected.sources);
    const corrected = { ...JSON.parse(body), ...expected,
      constraints: expected.sources.map((source, index) => ({ id: `source-${index}`, text: "Preserve behavior and evidence", sources: [source.path] })) };
    assert.doesNotThrow(() => inspectDependencyContext(root, json(corrected), ["sample"], 1, 1));
    return true;
  });
});
test("committed candidate approvals replay after stage removal without changing history", (t) => {
  const root = fixture(t); initialize(root); track(root);
  const receiptFile = readdirSync(join(root, ".cadre/receipts")).find((file) => file.startsWith("track-"))!;
  const receipt = JSON.parse(readFileSync(join(root, ".cadre/receipts", receiptFile), "utf8"));
  const input = { projectRoot: root, candidateId: "track-sample", workflow: "track" as const,
    files: ["spec.md", "plan.md", "learning.md", "dependency-context.json", "state.json"] };
  rmSync(join(root, ".cadre/stage/track-sample"), { recursive: true });
  const head = git(root, "rev-parse", "HEAD"), state = readFileSync(join(root, ".cadre/tracks/sample/state.json"), "utf8");
  const replay = applyCandidate(input, receipt.approvalDigest);
  assert.equal(replay.status, "committed"); assert.equal(replay.operationId, receipt.operationId);
  assert.deepEqual(replay.changedPaths, []); assert.equal(replay.changedCount, 0);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(readFileSync(join(root, ".cadre/tracks/sample/state.json"), "utf8"), state);
});
test("candidate promotion rejects incomplete specifications before approval or canonical mutation", (t) => {
  const root = fixture(t); initialize(root); track(root);
  const before = readFileSync(join(root, ".cadre/tracks/sample/spec.md"), "utf8"), head = git(root, "rev-parse", "HEAD");
  prepareCandidateStage(root, "revise-sample", ["spec.md"]);
  write(root, ".cadre/stage/revise-sample/spec.md", before.replace("## Additional Information", "## Notes"));
  const input = { projectRoot: root, candidateId: "revise-sample", workflow: "revise" as const, files: ["spec.md"] };
  assert.throws(() => previewCandidateApply(input), /missing ## Additional Information/);
  assert.throws(() => validateStagedState(root, "revise-sample", [{ path: "spec.md", absolutePath: "unused", content: "# Specification\n" }]), /missing ## Functional Requirements/);
  assert.equal(readFileSync(join(root, ".cadre/tracks/sample/spec.md"), "utf8"), before);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});
test("v5 one-task lifecycle has six commits and zero verification-start calls", (t) => {
  const started = performance.now(), root = fixture(t); initialize(root); track(root);
  const scope = { projectRoot: root, trackId: "sample", executionId: "fixture-run" };
  const start = { ...scope, requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: git(root, "rev-parse", "HEAD"), approvedAt: "2026-09-25T01:00:00.000Z" };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  let calls = 0;
  const checkpoint = (nodeId: string, action: Omit<Parameters<typeof previewExecutionCheckpoint>[0], keyof typeof scope | "nodeId">) => {
    const input = { ...scope, nodeId, ...action }; calls++; return applyExecutionCheckpoint(input, previewExecutionCheckpoint(input).digest);
  };
  checkpoint("P1", { event: "start" });
  write(root, "behavior.txt", "verified behavior\n"); git(root, "add", "behavior.txt"); git(root, "commit", "-m", "feat: cohesive behavior");
  const head = git(root, "rev-parse", "HEAD"), evidence = { commit: head, verification: "behavior verified", authorization: "fixture explicitly authorizes track verification" };
  checkpoint("T1.1", { event: "complete_group", commit: head, tasks: [{ nodeId: "T1.1", verification: evidence.verification, authorization: evidence.authorization, handoff }] });
  checkpoint("T1.2", { event: "record_verification", ...evidence }); checkpoint("P1", { event: "complete", ...evidence });
  checkpoint("P2", { event: "start" }); checkpoint("T2.1", { event: "record_verification", ...evidence }); checkpoint("P2", { event: "complete", ...evidence });
  const finish = { ...scope, headCommit: head, completedAt: "2026-09-25T02:00:00.000Z" };
  commitReceipt(root, applyExecutionFinish(finish, previewExecutionFinish(finish).digest).receipt!); assert.deepEqual(validateProject(root).errors, []);
  const review = deriveReviewCompleteInput({ projectRoot: root, trackId: "sample", approval: "Fixture explicitly approves clean completion" });
  const reviewed = applyReviewComplete(review, previewReviewComplete(review).digest); assert.ok("receipt" in reviewed); commitReceipt(root, reviewed.receipt);
  const candidateId = "archive-fixture"; prepareCandidateStage(root, candidateId, ["patterns/index.md"]);
  write(root, `.cadre/stage/${candidateId}/patterns/index.md`, readFileSync(join(root, ".cadre/patterns/index.md"), "utf8"));
  const archive = deriveArchiveBatchCandidateInput({ projectRoot: root, candidateId, selectedTracks: ["sample"], updates: [{ kind: "pattern_index" }] });
  const archivePreview = previewArchiveBatchCandidate(archive), archiveDigest = archivePreview.digest;
  const archiveExpected = archivePreview.stateChanges.map((item) => {
    const derived = JSON.parse(readFileSync(item.sourcePath, "utf8"));
    for (const change of item.changes) {
      if (change.action === "append") derived[change.field].push(...change.value as unknown[]);
      else derived[change.field] = change.value;
    }
    const body = json(derived); assert.equal(receiptHash(body), item.sha256);
    return { path: item.path, body };
  });
  assert.equal(archiveExpected.length, 2);
  const archived = applyArchiveBatchCandidate(archive, archiveDigest); assert.ok("receipt" in archived); commitReceipt(root, archived.receipt);
  for (const item of archiveExpected) assert.equal(readFileSync(item.path, "utf8"), item.body);
  rmSync(join(root, ".cadre/stage", candidateId), { recursive: true });
  const replayed = applyArchiveBatchCandidate(archive, archiveDigest);
  assert.ok("receipt" in replayed); assert.equal(replayed.receipt.status, "committed");
  assert.deepEqual(replayed.writes, []); assert.equal(replayed.receipt.operationId, archived.receipt.operationId);
  assert.throws(() => applyArchiveBatchCandidate(archive, "0".repeat(64)), /approval digest differs/);
  assert.deepEqual(validateProject(root).errors, []); assert.equal(Number(git(root, "rev-list", "--count", "HEAD")), 6); assert.equal(git(root, "status", "--porcelain"), "");
  t.diagnostic(JSON.stringify({ commits: 6, checkpointCalls: calls, verificationStartCalls: 0, elapsedMs: performance.now() - started, clientTokens: null }));
});

test("operation receipts recover every promotion boundary without duplicate commits", (t) => {
  for (let crash = 0; crash < 4; crash++) {
    const root = fixture(t); write(root, ".cadre/.gitignore", "/stage/\n");
    const input = { operationId: `track-crash-${crash}`, kind: "track" as const, approvalDigest: "a".repeat(64), baseCommit: null };
    const files = [{ path: ".cadre/evidence/one.json", content: json({ schemaVersion: 2 }) }, { path: ".cadre/evidence/two.md", content: "Approved evidence" }];
    let step = 0;
    assert.throws(() => promoteOperation(root, input, files, () => { if (step++ === crash) throw new Error("crash"); }), /crash/);
    const result = resumeOperation(root, input.operationId, input.approvalDigest); assert.equal(result.status, "commit_pending");
    git(root, "add", ".cadre"); git(root, "commit", "-m", "approved operation", "-m", result.trailers.join("\n"));
    assert.equal(resumeOperation(root, input.operationId, input.approvalDigest).status, "committed");
    assert.equal(Number(git(root, "rev-list", "--count", "HEAD")), 1); assert.equal(git(root, "status", "--porcelain"), "");
    assert.equal(reconcileOperation(root, input.operationId), git(root, "rev-parse", "HEAD"));
  }
});

test("receipts reject forged, missing, ambiguous and unreachable references", (t) => {
  const root = fixture(t); write(root, ".cadre/.gitignore", "/stage/\n");
  const input = { operationId: "track-evidence", kind: "track" as const, approvalDigest: "a".repeat(64), baseCommit: null };
  const result = promoteOperation(root, input, [{ path: ".cadre/spec.md", content: "approved" }]);
  assert.throws(() => resolveOperation(root, "op:track-evidence"), /commit_pending/);
  write(root, ".cadre/spec.md", "forged"); git(root, "add", "."); git(root, "commit", "-m", "forged artifacts", "-m", result.trailers.join("\n"));
  assert.throws(() => resolveOperation(root, "op:track-evidence"), /differs from the receipt/);
  git(root, "commit", "--allow-empty", "-m", "duplicate claim", "-m", result.trailers.join("\n"));
  assert.throws(() => resolveOperation(root, "op:track-evidence"), /Multiple reachable/);
  assert.throws(() => resolveOperation(root, "op:track-unreachable"), /commit_pending/);
  git(root, "commit", "--allow-empty", "-m", "missing receipt", "-m", "Cadre-Operation: track-missing\nCadre-Receipt: " + "0".repeat(64));
  assert.throws(() => resolveOperation(root, "op:track-missing"), /no receipt/);
});

test("Dhivon-shaped dirty cache errors stay under 8 KiB with complete diagnostic pages", () => {
  const paths = Array.from({ length: 6113 }, (_, i) => `.cadre/.build-cache/unowned/artifact-${i}/${"cache".repeat(20)}`);
  const error = new CadreError("WORKTREE_DIRTY", "Unexpected untracked files", { paths });
  assert.ok(Buffer.byteLength(JSON.stringify(createResultFormatter(() => "structured").failure(error))) <= 8192);
  const compact = serializeCadreError(error); assert.equal(compact.details?.pathCount, 6113);
  let offset: number | null = 0, body = "";
  do { const page = readDiagnostic(String(compact.details?.diagnosticId), offset); body += page.content; offset = page.nextOffset; } while (offset !== null);
  assert.deepEqual(JSON.parse(body).details.paths, paths);
});

test("commit groups reject collapsed dependency cycles", () => {
  const body = plan(true).replace("Task dependencies: T1.1", "Task dependencies: T1.3")
    .replace("- [ ] T1.3 User Manual Verification", "- [ ] T1.3 Bridge\n  - Task dependencies: T1.1\n  - Commit group: bridge\n- [ ] T1.4 User Manual Verification");
  const errors: string[] = [], graph = parsePlanContent(body, "fixture", errors); validatePlanGraph("fixture", graph, "planned", errors);
  assert.match(errors.join("\n"), /commit groups: dependency cycle/);
});

test("retention tokens require complete retrieval, expire safely and reset after compaction", (t) => {
  const root = fixture(t); initialize(root); track(root);
  let cursor: string | undefined, token: string | undefined;
  do { const page = readContext({ projectRoot: root, trackId: "sample", maxBytes: 4096, ...(cursor ? { cursor } : {}) });
    if (!page.complete) assert.equal(page.retainedContextToken, undefined);
    token = page.retainedContextToken; cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.ok(token);
  const retained = readContext({ projectRoot: root, trackId: "sample", retainedContextToken: token });
  assert.equal(retained.contextReady, true); assert.ok(retained.excerpts.every((source) => source.reused));
  assert.throws(() => readContext({ projectRoot: root, trackId: "sample", retainedContextToken: "cadre_ctx1_" + "x".repeat(32) }), /expired/);
  assert.throws(() => readContext({ projectRoot: root, trackId: "sample", cursor: Buffer.from(JSON.stringify({ snapshot: retained.snapshot, source: 99, offset: 0 })).toString("base64url") }), /Invalid or expired/);
  assert.ok(readContext({ projectRoot: root, trackId: "sample" }).excerpts.some((source) => !source.reused));
});

function startExecution(root: string, id = "group-run") {
  const scope = { projectRoot: root, trackId: "sample", executionId: id };
  const input = { ...scope, requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: git(root, "rev-parse", "HEAD"), approvedAt: "2026-09-25T01:00:00.000Z" };
  applyExecutionStart(input, previewExecutionStart(input).digest);
  const checkpoint = (nodeId: string, action: Omit<Parameters<typeof previewExecutionCheckpoint>[0], keyof typeof scope | "nodeId">) => {
    const input = { ...scope, nodeId, ...action }; return applyExecutionCheckpoint(input, previewExecutionCheckpoint(input).digest);
  };
  checkpoint("P1", { event: "start" }); return { scope, checkpoint };
}

test("shared commit completion is atomic, ordered, recoverable and requires whole-group revert evidence", (t) => {
  const root = fixture(t); initialize(root); track(root, true);
  const { scope, checkpoint } = startExecution(root);
  assert.deepEqual(executionSchedulerView(readExecution(root, "sample", scope.executionId)).readyGroups, [{ id: "behavior", phaseId: "P1", tasks: ["T1.1", "T1.2"] }]);
  write(root, "behavior.txt", "two verified behaviors\n"); git(root, "add", "behavior.txt"); git(root, "commit", "-m", "feat: grouped behavior");
  const commit = git(root, "rev-parse", "HEAD"), tasks = ["T1.2", "T1.1"].map((nodeId) => ({ nodeId, verification: `verified ${nodeId}`, authorization: "fixture approved", handoff }));
  const path = `.cadre/tracks/sample/executions/execution-${scope.executionId}.json`;
  const before = readFileSync(join(root, path), "utf8");
  assert.throws(() => checkpoint("T1.1", { event: "complete_group", commit, tasks: tasks.slice(1) }), /every task/);
  assert.equal(readFileSync(join(root, path), "utf8"), before);
  checkpoint("T1.1", { event: "complete_group", commit, tasks });
  const completed = readFileSync(join(root, path), "utf8");
  checkpoint("T1.1", { event: "complete_group", commit, tasks });
  assert.equal(readFileSync(join(root, path), "utf8"), completed);
  const journal = JSON.parse(completed), state = readFileSync(join(root, ".cadre/tracks/sample/state.json"), "utf8");
  const reset = (id: string) => { Object.assign(journal.nodes[id], { status: "pending", workerCommit: null, mergeCommit: null, verification: null, approval: null }); delete journal.nodes[id].handoff; };
  reset("T1.1");
  const candidates = () => [{ path: "state.json", absolutePath: "unused", content: state }, { path: `executions/execution-${scope.executionId}.json`, absolutePath: "unused", content: json(journal) }, { path: "reverts/revert-group-execution-before.json", absolutePath: "unused", content: completed }, { path: "reverts/revert-group.json", absolutePath: "unused", content: json({ sharedCommit: commit, affectedTaskIds: ["T1.1", "T1.2"] }) }];
  assert.throws(() => validateStagedState(root, "revert-sample", candidates()), /whole group/);
  reset("T1.2"); assert.doesNotThrow(() => validateStagedState(root, "revert-sample", candidates()));
});

test("FRM and Dhivon owned journal changes integrate by fast-forward while unrelated changes stay blocked", (t) => {
  const root = fixture(t); initialize(root); track(root);
  const { scope, checkpoint } = startExecution(root, "integration-run"), input = { ...scope, nodeId: "T1.1" };
  const worker = applyWorktreeCreate(input, previewWorktreeCreate(input).digest);
  checkpoint("T1.1", { event: "start", worktreePath: worker.path, branch: worker.branch, workerId: "fixture" });
  write(worker.path, "behavior.txt", "verified\n"); git(worker.path, "add", "behavior.txt"); git(worker.path, "commit", "-m", "feat: worker behavior");
  const commit = git(worker.path, "rev-parse", "HEAD");
  checkpoint("T1.1", { event: "record_commit", commit, verification: "verified", authorization: "fixture approved" });
  const state = readFileSync(join(root, ".cadre/tracks/sample/state.json"), "utf8"), path = `.cadre/tracks/sample/executions/execution-${scope.executionId}.json`, journal = readFileSync(join(root, path), "utf8");
  write(root, "unrelated.txt", "must not be adopted"); assert.throws(() => previewWorktreeIntegration(input), /not clean/); rmSync(join(root, "unrelated.txt"));
  const indexPath = ".cadre/tracks.md", index = renderTracksWithState(root, join(root, ".cadre/tracks/sample/state.json"), JSON.parse(state)).tracksContent;
  write(root, indexPath, index + "Unapproved edit\n"); assert.throws(() => previewWorktreeIntegration(input), /not clean/);
  write(root, indexPath, index);
  const approved = previewWorktreeIntegration(input);
  write(root, indexPath, index + "Changed after preview\n");
  assert.throws(() => applyWorktreeIntegration(input, approved.digest, approved), /not clean|changed|stale|ownership/i);
  write(root, indexPath, index);
  const cache = executionBuildCache(root, "sample", "integration-run"); write(root, `${cache.slice(root.length + 1)}/build.txt`, "ignored owned output");
  const result = applyWorktreeIntegration(input, previewWorktreeIntegration(input).digest);
  assert.equal(result.integrationKind, "fast-forward"); assert.equal(git(root, "rev-parse", "HEAD"), commit);
  assert.equal(readFileSync(join(root, path), "utf8"), journal); assert.equal(readFileSync(join(root, ".cadre/tracks/sample/state.json"), "utf8"), state);
  assert.equal(readFileSync(join(root, indexPath), "utf8"), index);
  assert.equal(Number(git(root, "rev-list", "--count", "--merges", "HEAD")), 0);
});

test("owned cache rejects symlink descendants and unowned content", (t) => {
  const root = fixture(t); initialize(root);
  write(root, ".cadre/.build-cache/cadre/unowned", "unknown");
  assert.throws(() => executionBuildCache(root, "sample", "cache-run"), /unowned/); rmSync(join(root, ".cadre/.build-cache/cadre/unowned"));
  executionBuildCache(root, "sample", "cache-run");
  symlinkSync(root, join(root, ".cadre/.build-cache/cadre/escape"));
  assert.throws(() => executionBuildCache(root, "escape", "cache-run"), /symbolic|symlink/i);
});

test("context checks approval, section identity, real expiry and Unicode page/error budgets", (t) => {
  const root = fixture(t); initialize(root); track(root);
  const first = readContext({ projectRoot: root, trackId: "sample" }); assert.equal(first.dependencyContext?.mode, "approved");
  const path = ".cadre/tracks/sample/dependency-context.json", body = readFileSync(join(root, path), "utf8");
  write(root, path, body + "\n"); assert.equal(readContext({ projectRoot: root, trackId: "sample" }).dependencyContext?.mode, "full-source-fallback"); write(root, path, body);
  const originalNow = Date.now;
  try { const token = issueContextToken("test", []); Date.now = () => originalNow() + 31 * 60_000; assert.throws(() => retainedSources(token, "test"), /expired/); } finally { Date.now = originalNow; }
  const { scope } = startExecution(root);
  let page = readContext({ projectRoot: root, trackId: "sample", executionId: scope.executionId, nodeId: "T1.1" });
  assert.ok(page.retainedContextToken);
  const learningPath = ".cadre/tracks/sample/learning.md";
  write(root, learningPath, readFileSync(join(root, learningPath), "utf8") + "## Phase 99: Unrelated\nUnrelated journal-era notes.\n");
  page = readContext({ projectRoot: root, trackId: "sample", executionId: scope.executionId, nodeId: "T1.1", retainedContextToken: page.retainedContextToken });
  assert.ok(page.excerpts.filter((item) => item.path === learningPath).every((item) => item.reused));
  const adversarial = new CadreError("\u0001".repeat(9000), "\u0001".repeat(9000), { paths: Array(100).fill("\u0001".repeat(9000)) });
  assert.ok(Buffer.byteLength(JSON.stringify(createResultFormatter(() => "text").failure(adversarial))) <= 8192);
  let cursor: string | undefined;
  do { const part = readContext({ projectRoot: root, trackId: "sample", maxBytes: 4096, ...(cursor ? { cursor } : {}) }); assert.ok(Buffer.byteLength(JSON.stringify(part)) <= 4096); cursor = part.nextCursor ?? undefined; } while (cursor);
});

test("legacy refresh migrates once at quiescence and preserves execution and historical evidence", (t) => {
  const root = fixture(t); initialize(root); track(root);
  const projectPath = ".cadre/project.json", statePath = ".cadre/tracks/sample/state.json";
  const project = JSON.parse(readFileSync(join(root, projectPath), "utf8")), state = JSON.parse(readFileSync(join(root, statePath), "utf8"));
  project.schemaVersion = 1; project.templateSetVersion = "v4";
  project.setup.commit = resolveOperation(root, project.setup.commit); state.schemaVersion = 1;
  for (const key of Object.keys(state.commits)) state.commits[key] = resolveOperation(root, state.commits[key]);
  write(root, projectPath, json(project)); write(root, statePath, json(state));
  git(root, "add", ".cadre"); git(root, "commit", "-m", "test: legacy state baseline");
  const { scope } = startExecution(root, "legacy-run");
  const journalPath = `.cadre/tracks/sample/executions/execution-${scope.executionId}.json`, journalBefore = readFileSync(join(root, journalPath), "utf8");
  assert.equal(JSON.parse(journalBefore).executionContract, undefined);
  const files = ["project.json", "tracks/sample/state.json", "tracks/sample/dependency-context.json", "refreshes/refresh-migration.md"];
  prepareCandidateStage(root, "refresh-migration", files);
  for (const path of files) write(root, `.cadre/stage/refresh-migration/${path}`, path === "refreshes/refresh-migration.md"
    ? "# Approved migration\nPreserve execution and historical evidence.\n" : readFileSync(join(root, ".cadre", path), "utf8"));
  const input = { projectRoot: root, candidateId: "refresh-migration", workflow: "refresh" as const, files };
  const preview = previewCandidateApply(input), explained = structuredClone(project);
  for (const change of preview.stateChanges.find((item) => item.path === projectPath)!.changes) {
    if (change.action === "append") explained[change.field].push(...change.value as unknown[]);
    else explained[change.field] = change.value;
  }
  assert.equal(receiptHash(json(explained)), preview.manifest.find((file) => file.path === projectPath)!.sha256);
  commitReceipt(root, applyCandidate(input, preview.digest));
  const migrated = JSON.parse(readFileSync(join(root, projectPath), "utf8"));
  assert.equal(migrated.templateSetVersion, "v5"); assert.equal(migrated.schemaVersion, 2); assert.deepEqual(migrated.setup, project.setup);
  assert.deepEqual(migrated.history.slice(0, -1), project.history); assert.equal(readFileSync(join(root, journalPath), "utf8"), journalBefore);
  assert.deepEqual(validateProject(root).errors, []);
});

test("archive rebases approved active dependency context without rewriting historical learning", (t) => {
  const root = fixture(t); initialize(root); track(root);
  const { scope, checkpoint } = startExecution(root, "archive-run");
  write(root, "behavior.txt", "verified\n"); git(root, "add", "behavior.txt"); git(root, "commit", "-m", "feat: behavior");
  const commit = git(root, "rev-parse", "HEAD"), evidence = { commit, verification: "verified", authorization: "fixture approved" };
  checkpoint("T1.1", { event: "complete_group", commit, tasks: [{ nodeId: "T1.1", verification: "verified", authorization: "fixture approved", handoff }] });
  checkpoint("T1.2", { event: "record_verification", ...evidence }); checkpoint("P1", { event: "complete", ...evidence });
  checkpoint("P2", { event: "start" }); checkpoint("T2.1", { event: "record_verification", ...evidence }); checkpoint("P2", { event: "complete", ...evidence });
  const finish = { ...scope, headCommit: commit, completedAt: "2026-09-25T02:00:00.000Z" };
  commitReceipt(root, applyExecutionFinish(finish, previewExecutionFinish(finish).digest).receipt!);
  const review = deriveReviewCompleteInput({ projectRoot: root, trackId: "sample", approval: "fixture clean approval" });
  const reviewed = applyReviewComplete(review, previewReviewComplete(review).digest); assert.ok("receipt" in reviewed); commitReceipt(root, reviewed.receipt);
  const historical = readFileSync(join(root, ".cadre/tracks/sample/learning.md"), "utf8");
  const context = dependencySources(root, ["sample"]);
  const files = ["spec.md", "plan.md", "learning.md", "state.json", "dependency-context.json"];
  prepareCandidateStage(root, "track-consumer", files);
  for (const path of ["spec.md", "learning.md"]) write(root, `.cadre/stage/track-consumer/${path}`, readFileSync(join(root, ".cadre/stage/track-sample", path), "utf8"));
  write(root, ".cadre/stage/track-consumer/plan.md", plan());
  write(root, ".cadre/stage/track-consumer/state.json", json({ schemaVersion: 2, trackId: "consumer", title: "Consumer", type: "feature", status: "planned", checkpoint: "ready", revision: 1, dependencies: ["sample"], commits: {}, artifactProgress: [], operation: null, lastExecution: null, reviewCycles: [], history: [] }));
  write(root, ".cadre/stage/track-consumer/dependency-context.json", json({ schemaVersion: 1, specRevision: 1, planRevision: 1, dependencies: ["sample"], ...context, constraints: context.sources.map((source, i) => ({ id: `required-${i}`, text: "Preserve authorization and verification", sources: [source.path] })) }));
  const candidate = { projectRoot: root, candidateId: "track-consumer", workflow: "track" as const, files };
  commitReceipt(root, applyCandidate(candidate, previewCandidateApply(candidate).digest));
  prepareCandidateStage(root, "archive-dependency", []);
  const input = deriveArchiveBatchCandidateInput({ projectRoot: root, candidateId: "archive-dependency", selectedTracks: ["sample"], updates: [] });
  const preview = previewArchiveBatchCandidate(input);
  assert.ok(preview.writes.some((file) => file.path === "tracks/consumer/dependency-context.json"));
  const archived = applyArchiveBatchCandidate(input, preview.digest); assert.ok("receipt" in archived); commitReceipt(root, archived.receipt);
  assert.equal(readFileSync(join(root, ".cadre/archive/sample/learning.md"), "utf8"), historical);
  assert.equal(readContext({ projectRoot: root, trackId: "consumer" }).dependencyContext?.mode, "approved");
  assert.deepEqual(validateProject(root).errors, []);
});

test("operation resolution excludes unreachable branches and accepts separately paragraphed trailers", (t) => {
  const root = fixture(t); write(root, ".cadre/.gitignore", "/stage/\n"); git(root, "add", ".cadre"); git(root, "commit", "-m", "fixture base");
  const base = git(root, "rev-parse", "HEAD"); git(root, "switch", "-c", "codex/receipt-fixture");
  const result = promoteOperation(root, { operationId: "track-unreachable", kind: "track", approvalDigest: "a".repeat(64), baseCommit: base }, [{ path: ".cadre/spec.md", content: "approved" }]);
  git(root, "add", ".cadre"); git(root, "commit", "-m", "approved", ...result.trailers.flatMap((line) => ["-m", line]));
  assert.equal(resolveOperation(root, "op:track-unreachable"), git(root, "rev-parse", "HEAD"));
  git(root, "switch", "main"); assert.throws(() => resolveOperation(root, "op:track-unreachable"), /commit_pending/);
});

test("independent groups remain schedulable while group dependencies block delivery", (t) => {
  const root = fixture(t); initialize(root);
  const body = plan(true).replace("- [ ] T1.3 User Manual Verification", "- [ ] T1.3 Independent\n  - Task dependencies: none\n  - Commit group: independent\n- [ ] T1.4 Downstream\n  - Task dependencies: T1.2, T1.3\n  - Commit group: downstream\n- [ ] T1.5 User Manual Verification");
  track(root, true, body); const { scope, checkpoint } = startExecution(root, "parallel-groups");
  const ready = () => executionSchedulerView(readExecution(root, "sample", scope.executionId)).readyGroups?.map((group) => group.id);
  assert.deepEqual(ready(), ["behavior", "independent"]);
  write(root, "independent.txt", "verified\n"); git(root, "add", "independent.txt"); git(root, "commit", "-m", "feat: independent group");
  const evidence = (nodeId: string) => ({ nodeId, verification: "verified", authorization: "fixture approved", handoff });
  checkpoint("T1.3", { event: "complete_group", commit: git(root, "rev-parse", "HEAD"), tasks: [evidence("T1.3")] });
  assert.deepEqual(ready(), ["behavior"]);
  assert.throws(() => checkpoint("T1.4", { event: "complete_group", commit: git(root, "rev-parse", "HEAD"), tasks: [evidence("T1.4")] }), /dependencies|dependency/);
  write(root, "behavior.txt", "verified\n"); git(root, "add", "behavior.txt"); git(root, "commit", "-m", "feat: cohesive behavior group");
  checkpoint("T1.1", { event: "complete_group", commit: git(root, "rev-parse", "HEAD"), tasks: [evidence("T1.2"), evidence("T1.1")] });
  assert.deepEqual(ready(), ["downstream"]);
});

function completeAutonomousNodes(root: string, executionId: string) {
  const scope = { projectRoot: root, trackId: "sample", executionId };
  const start = { ...scope, approvalMode: "autonomous" as const, requestedMode: "sequential" as const,
    effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: git(root, "rev-parse", "HEAD"), approvedAt: new Date().toISOString() };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  const checkpoint = (nodeId: string, action: Omit<Parameters<typeof previewExecutionCheckpoint>[0], keyof typeof scope | "nodeId">) => {
    const input = { ...scope, nodeId, ...action }; return applyExecutionCheckpoint(input, previewExecutionCheckpoint(input).digest);
  };
  const journal = readExecution(root, "sample", executionId);
  for (const phase of Object.values(journal.nodes).filter((node) => node.kind === "phase" && node.status !== "completed")) {
    checkpoint(phase.id, { event: "start" });
    for (const node of Object.values(journal.nodes).filter((node) => node.phaseId === phase.id && node.kind !== "phase" && node.status !== "completed")) {
      if (node.kind === "task") {
        write(root, "behavior.txt", `${executionId}/${node.id}\n`); git(root, "add", "behavior.txt");
        git(root, "commit", "-m", `feat: ${executionId} ${node.id}`);
        checkpoint(node.id, { event: "complete_group", commit: git(root, "rev-parse", "HEAD"), tasks: [{ nodeId: node.id,
          verification: "Focused regression passed", authorization: "persisted Autonomous mode", handoff }] });
      } else checkpoint(node.id, { event: "record_verification", commit: git(root, "rev-parse", "HEAD"),
        verification: "Verification passed", authorization: "persisted Autonomous mode" });
    }
    checkpoint(phase.id, { event: "complete", commit: git(root, "rev-parse", "HEAD"),
      verification: "Integrated verification passed", authorization: "persisted Autonomous mode" });
  }
  return scope;
}

for (const name of ["codex", "claude-code", "zed"]) {
  test(`v5 ${name} Autonomous promotes its snapshot and resumes without bookkeeping commit loops`, async (t) => {
    const root = fixture(t); initialize(root); track(root);
    const server = createCadreServer(), client = new Client({ name, version: "2.1.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
    t.after(async () => { await client.close(); await server.close(); });
    const call = async (tool: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name: tool, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return (result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>).at(-1)!.text)) as Record<string, any>;
    };
    const scope = completeAutonomousNodes(root, "original");
    const finished = await call("execution_finish", scope);
    assert.equal(finished.receipt.status, "commit_pending");
    assert.equal(finished.nextStep.skill, "review", JSON.stringify(finished.nextStep));
    assert.equal(finished.nextStep.prerequisite, "implementation_bookkeeping_commit");
    commitReceipt(root, finished.receipt);
    const count = git(root, "rev-list", "--count", "HEAD"), head = git(root, "rev-parse", "HEAD");
    const retried = await call("execution_finish", scope);
    assert.equal(retried.receipt.status, "committed");
    assert.equal(retried.receipt.receiptHash, finished.receipt.receiptHash);
    assert.deepEqual(retried.changedPaths, []); assert.equal(retried.changedCount, 0);
    assert.equal(retried.nextStep.skill, "review"); assert.equal(retried.nextStep.prerequisite, null);
    assert.notEqual(retried.headCommit, head, "retain verified product HEAD across bookkeeping commits");
    assert.equal(git(root, "rev-list", "--count", "HEAD"), count); assert.equal(git(root, "status", "--porcelain"), "");
    const parent = ".cadre/tracks/sample", load = () => JSON.parse(readFileSync(join(root, parent, "state.json"), "utf8"));
    const state = load(), originalLoop = structuredClone(state.autonomousReview), originalJournal = readExecution(root, "sample", "original");
    const originalPlan = readFileSync(join(root, parent, "plan.md"), "utf8");
    const planBody = originalPlan.replace("Plan revision: 1", "Plan revision: 2")
      + "\n## Phase 3: Repair precision\n- Phase dependencies: P2\n- [ ] T3.1 Repair numeric precision\n  - Task dependencies: none\n  - Commit group: precision\n- [ ] T3.2 User Manual Verification\n- Phase completion commit: pending\n\n## Phase 4: Track-level User Manual Verification\n- [ ] T4.1 User Manual Verification\n- Phase completion commit: pending\n";
    const loop = { ...originalLoop, checkpoint: "remediating", reviewedExecutionId: "original", reviewedHead: state.lastExecution.headCommit,
      findings: [{ id: "numeric-precision", summary: "Large search values lose precision", status: "open", attemptExecutionIds: [] }] };
    const files = { "plan.md": planBody,
      "learning.md": readFileSync(join(root, parent, "learning.md"), "utf8").replace('"planRevision":1', '"planRevision":2'),
      "dependency-context.json": json({ ...JSON.parse(readFileSync(join(root, parent, "dependency-context.json"), "utf8")), planRevision: 2 }),
      "bugs/review-1.md": "# Numeric precision\n- Evidence: reproduced large-value rounding.\n- Acceptance: preserve exact integers.\n- Authorization: originating Autonomous mode.\n",
      "reviews/loop-1.json": json(loop) };
    const candidate = { projectRoot: root, candidateId: "review-sample", workflow: "review" as const, files: Object.keys(files) };
    prepareCandidateStage(root, candidate.candidateId, candidate.files);
    for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/review-sample/${path}`, body);
    const inspect = await call("candidate_inspect", { projectRoot: root, candidateId: candidate.candidateId, files: candidate.files,
      planValidations: [{ path: "plan.md", targetStatus: "in_progress" }] });
    assert.equal(inspect.plans[0].valid, true);
    assert.equal(describeTemplate(getTemplate("track/bug")).artifactPath, "bugs/review-<cycle>.md");
    const stage = join(root, ".cadre/stage/review-sample");
    renameSync(join(stage, "bugs/review-1.md"), join(stage, "bugs.md"));
    assert.throws(() => previewCandidateApply({ ...candidate, files: candidate.files.map((file) => file === "bugs/review-1.md" ? "bugs.md" : file) }), /review bug artifacts must use bugs\/review-<cycle>\.md/);
    renameSync(join(stage, "bugs.md"), join(stage, "bugs/review-1.md"));
    // This manifest intentionally omits state.json, matching the installed skill's procedure.
    const prepared = await call("candidate_apply", { request: { mode: "prepare", ...candidate } });
    assert.equal(load().status, "ready_for_review"); assert.equal(load().operation, null);
    assert.ok(prepared.files.some((file: { path: string }) => file.path === `${parent}/state.json`));
    const explainedState = structuredClone(state);
    for (const change of prepared.stateChanges.find((item: { path: string }) => item.path === `${parent}/state.json`).changes) {
      if (change.action === "append") explainedState[change.field].push(...change.value);
      else explainedState[change.field] = change.value;
    }
    assert.equal(receiptHash(json(explainedState)), prepared.files.find((file: { path: string }) => file.path === `${parent}/state.json`).sha256);
    write(root, "behavior.txt", "Unreviewed product drift\n");
    assert.throws(() => previewCandidateApply(candidate), /Product content changed/);
    write(root, "behavior.txt", "original/T1.1\n");
    write(root, ".cadre/stage/review-sample/plan.md", planBody.replace("- [x] T2.1", "- [ ] T2.1"));
    assert.throws(() => previewCandidateApply(candidate), /preserve every completed phase|pending task T2.1|incomplete P2/);
    write(root, ".cadre/stage/review-sample/plan.md", files["plan.md"]);
    write(root, ".cadre/stage/review-sample/learning.md", files["learning.md"] + "\nChanged candidate evidence.\n");
    assert.throws(() => applyCandidate(candidate, prepared.digest), /changed after approval/);
    write(root, ".cadre/stage/review-sample/learning.md", files["learning.md"]);
    // The apply token binds the exact snapshot and canonical authority.
    write(root, ".cadre/stage/review-sample/reviews/loop-1.json", json({ ...loop, originExecutionId: "forged" }));
    const rejected = await client.callTool({ name: "candidate_apply", arguments: { request: { mode: "apply", proposalToken: prepared.proposalToken } } });
    assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected), /cannot change originExecutionId/);
    write(root, ".cadre/stage/review-sample/reviews/loop-1.json", files["reviews/loop-1.json"]);
    const applied = await call("candidate_apply", { request: { mode: "apply", proposalToken: prepared.proposalToken } });
    assert.equal(applied.status, "commit_pending");
    assert.throws(() => completeAutonomousNodes(root, "premature"), /pending operations/);
    // Recovery uses the original receipt and authority, without another promotion or state-clearing commit.
    const resumed = await call("candidate_apply", { request: { mode: "resume", projectRoot: root,
      operationId: applied.operationId, approvalDigest: prepared.digest } });
    assert.equal(resumed.receiptHash, applied.receiptHash);
    commitReceipt(root, { operationId: resumed.operationId, trailers: resumed.trailers });
    const promotedHead = git(root, "rev-parse", "HEAD"), promotedState = readFileSync(join(root, parent, "state.json"), "utf8");
    const candidateReplay = await call("candidate_apply", { request: { mode: "apply", proposalToken: prepared.proposalToken } });
    assert.equal(candidateReplay.operationId, applied.operationId); assert.equal(candidateReplay.status, "committed");
    assert.deepEqual(candidateReplay.changedPaths, []); assert.equal(candidateReplay.changedCount, 0);
    assert.equal(git(root, "rev-parse", "HEAD"), promotedHead);
    assert.equal(readFileSync(join(root, parent, "state.json"), "utf8"), promotedState);
    const promoted = load();
    assert.equal(promoted.status, "in_progress"); assert.equal(promoted.operation, null);
    assert.equal(promoted.autonomousReview.originExecutionId, originalLoop.originExecutionId);
    assert.deepEqual(promoted.lastExecution, state.lastExecution);
    assert.equal(promoted.reviewCycles.length, 1); assert.deepEqual(promoted.reviewCycles[0].attemptedFindingIds, ["numeric-precision"]);
    assert.equal(promoted.reviewCycles[0].approvalConfirmation, undefined);
    const status = await call("project_status", { projectRoot: root, trackId: "sample", view: "implementation" });
    assert.equal(status.nextStep.skill, "implement"); assert.equal(status.nextStep.prerequisite, null);
    const remediation = completeAutonomousNodes(root, "fix-1");
    const inherited = readExecution(root, "sample", "fix-1");
    assert.equal(inherited.nodes["T2.1"]!.workerCommit, originalJournal.nodes["T2.1"]!.workerCommit);
    commitReceipt(root, (await call("execution_finish", remediation)).receipt);
    assert.deepEqual(validateProject(root).errors, []);
    const clean = load();
    clean.autonomousReview = { ...clean.autonomousReview, checkpoint: "awaiting_approval", reviewedExecutionId: "fix-1",
      reviewedHead: clean.lastExecution.headCommit, findings: [{ ...loop.findings[0], status: "resolved", attemptExecutionIds: ["fix-1"] }] };
    write(root, `${parent}/state.json`, json(clean));
    const review = await call("review_complete", { request: { mode: "prepare", projectRoot: root, trackId: "sample", approval: "Precision regression and cumulative review passed" } });
    assert.equal(review.commitRange, `${originalLoop.initialBaseCommit}..${clean.lastExecution.headCommit}`);
    assert.equal(load().status, "ready_for_review", "clean proposal still needs explicit final approval");
    const completed = await call("review_complete", { request: { mode: "apply", proposalToken: review.proposalToken } });
    commitReceipt(root, completed.receipt);
    const completionCount = git(root, "rev-list", "--count", "HEAD");
    const completionRetry = await call("review_complete", { request: { mode: "apply", proposalToken: review.proposalToken } });
    assert.equal(completionRetry.receipt.status, "committed");
    assert.equal(completionRetry.receipt.receiptHash, completed.receipt.receiptHash);
    assert.deepEqual(completionRetry.changedPaths, []);
    assert.equal(git(root, "rev-list", "--count", "HEAD"), completionCount);
    assert.equal(load().reviewCycles.length, 2); assert.deepEqual(validateProject(root).errors, []);
    assert.equal(git(root, "status", "--porcelain"), "");
  });
}
