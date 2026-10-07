import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCadreServer } from "../src/mcp/server.js";
import { previewProjectInitCandidate, applyProjectInitCandidate } from "../src/domain/init.js";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { dependencySources } from "../src/domain/dependency-context.js";
import { reconcileOperation, promoteOperation, resolveOperation, receiptHash } from "../src/domain/operation-receipts.js";
import { validateProject } from "../src/domain/state.js";
import { readExecution, executionSchedulerView } from "../src/domain/execution.js";
import { readContext } from "../src/domain/context.js";

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
function write(root: string, path: string, body: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
function commit(root: string, receipt: { operationId: string; trailers: string[] }) {
  git(root, "add", ".cadre"); git(root, "commit", "-m", receipt.operationId, "-m", receipt.trailers.join("\n"));
  reconcileOperation(root, receipt.operationId);
}
function stage(root: string, workflow: "track" | "revise", files: Record<string, string>) {
  const candidate = { projectRoot: root, candidateId: `${workflow}-sample`, workflow, files: Object.keys(files) };
  prepareCandidateStage(root, candidate.candidateId, candidate.files);
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/${candidate.candidateId}/${path}`, body);
  return candidate;
}
const originalPlan = "# Plan\n- Spec revision: 1\n- Plan revision: 1\n## Phase 1: Deliver\n- Phase dependencies: none\n- [ ] T1.1 First behavior\n  - Task dependencies: none\n  - Commit group: first\n- [ ] T1.2 User Manual Verification\n- Phase completion commit: pending\n## Phase 2: Track-level User Manual Verification\n- [ ] T2.1 User Manual Verification\n- Phase completion commit: pending\n";
async function fixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const root = mkdtempSync(join(tmpdir(), "cadre-revision-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Revision Fixture"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "commit.gpgsign", "false");
  const stagedFiles = ["product.md", "guidelines.md", "tech-stack.md"];
  prepareCandidateStage(root, "create", stagedFiles);
  for (const file of stagedFiles) write(root, `.cadre/stage/create/${file}`, `# ${file}\nPreserve evidence.\n`);
  const init = { projectRoot: root, projectName: "Revision", context: "greenfield" as const, gitDisposition: "initialize" as const, baseCommit: null, approvedAt: "2026-10-06T00:00:00.000Z", stagedFiles, styleguideIds: ["project/styleguides/general"] };
  commit(root, applyProjectInitCandidate(init, previewProjectInitCandidate(init).digest).receipt!);
  const candidate = stage(root, "track", {
    "spec.md": "# Specification\n## Functional Requirements\nFirst behavior.\n## Non-Functional Requirements\nPreserve evidence.\n## Acceptance Criteria\nChecks pass.\n## Dependencies\nNone.\n## Additional Information\nNone.\n## Dependent-track impact\nNone.\n",
    "plan.md": originalPlan,
    "learning.md": '# Learning\n<!-- cadre:pattern-seed:start -->\n## Pattern Seed\n<!-- cadre:memory:start -->\n{"schemaVersion":1,"specRevision":1,"planRevision":1,"patterns":[]}\n<!-- cadre:memory:end -->\nNo applicable patterns.\n<!-- cadre:pattern-seed:end -->\n',
    "dependency-context.json": json({ schemaVersion: 1, specRevision: 1, planRevision: 1, dependencies: [], ...dependencySources(root, []), constraints: [] }),
    "state.json": json({ schemaVersion: 2, trackId: "sample", title: "Sample", type: "feature", status: "planned", checkpoint: "ready", revision: 1, dependencies: [], commits: {}, artifactProgress: [], operation: null, lastExecution: null, reviewCycles: [], history: [] })
  });
  commit(root, applyCandidate(candidate, previewCandidateApply(candidate).digest));
  const server = createCadreServer(), client = new Client({ name: "codex", version: "1.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return result.structuredContent as Record<string, any>;
  };
  return { root, call, load: () => JSON.parse(read(root, ".cadre/tracks/sample/state.json")) };
}
function revisedFiles(root: string, state: Record<string, unknown>, productHead?: string) {
  const prefix = ".cadre/tracks/sample/";
  return {
    "state.json": json({ ...state, revision: 2 }),
    "spec.md": read(root, prefix + "spec.md").replace("First behavior.", "First and second behaviors."),
    "plan.md": originalPlan.replace("Spec revision: 1", "Spec revision: 2").replace("Plan revision: 1", "Plan revision: 2")
      .replace("- [ ] T1.1 First behavior", productHead ? `- [x] T1.1 First behavior <!-- commit: ${productHead} -->` : "- [ ] T1.1 First behavior")
      .replace("- [ ] T1.2 User Manual Verification", "- [ ] T1.2 Second behavior\n  - Task dependencies: T1.1\n  - Commit group: second\n- [ ] T1.3 User Manual Verification"),
    "learning.md": read(root, prefix + "learning.md").replace('"specRevision":1', '"specRevision":2').replace('"planRevision":1', '"planRevision":2'),
    "dependency-context.json": json({ ...JSON.parse(read(root, prefix + "dependency-context.json")), specRevision: 2, planRevision: 2 }),
    "revisions/revision-2.md": "# Revision 2\n- Previous track revision: 1\n- New track revision: 2\n- Previous spec revision: 1\n- New spec revision: 2\n- Previous plan revision: 1\n- New plan revision: 2\n## Requested change\nAdd second behavior, preserving the first.\n## Approval\nExplicit fixture approval of this exact digest.\n"
  };
}
async function finishCurrent(root: string, call: (name: string, args: Record<string, unknown>) => Promise<Record<string, any>>, executionId: string) {
  const scope = { projectRoot: root, trackId: "sample", executionId }, journal = readExecution(root, "sample", executionId);
  const checkpoint = (nodeId: string, event: string, extra = {}) => call("execution_checkpoint", { scope: { ...scope, nodeId }, action: { event, ...extra } });
  for (const phase of Object.values(journal.nodes).filter((node) => node.kind === "phase" && node.status !== "completed")) {
    await checkpoint(phase.id, "start");
    for (const node of Object.values(journal.nodes).filter((node) => node.phaseId === phase.id && node.kind !== "phase" && node.status !== "completed")) {
      if (node.kind === "task") {
        write(root, "second.txt", `${node.id}: second behavior\n`); git(root, "add", "second.txt"); git(root, "commit", "-m", "feat: second behavior");
        await checkpoint(node.id, "complete_group", { commit: git(root, "rev-parse", "HEAD"), tasks: [{ nodeId: node.id, verification: "Second behavior checked", authorization: "Explicit fixture approval", handoff: { decisions: [], failedApproaches: [], openQuestions: [], nextAction: "Review", sources: [] } }] });
      } else await checkpoint(node.id, "record_verification", { commit: git(root, "rev-parse", "HEAD"), verification: "Both behaviors checked", authorization: "Explicit fixture approval" });
    }
    await checkpoint(phase.id, "complete", { commit: git(root, "rev-parse", "HEAD"), verification: "Both behaviors checked", authorization: "Explicit fixture approval" });
  }
  commit(root, (await call("execution_finish", scope)).receipt);
}

test("revision rejects a scope-only promotion before it strands Autonomous authority", async (t) => {
  const { root, call } = await fixture(t);
  await call("execution_start", { projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode: "sequential" });
  const before = read(root, ".cadre/tracks/sample/state.json");
  const candidate = stage(root, "revise", { "spec.md": read(root, ".cadre/tracks/sample/spec.md").replace("First behavior.", "Second behavior.") });
  assert.throws(() => previewCandidateApply(candidate), /Revision requires proposed state.json/);
  assert.equal(read(root, ".cadre/tracks/sample/state.json"), before);
});

test("revision rejects stale revisions, altered authority/history and unfinished task work without mutation", async (t) => {
  const { root, call, load } = await fixture(t), scope = { projectRoot: root, trackId: "sample" };
  await call("execution_start", { ...scope, approvalMode: "autonomous", requestedMode: "sequential" });
  const original = load(), files = revisedFiles(root, original), before = read(root, ".cadre/tracks/sample/state.json");
  const badStates = [
    [{ ...original, revision: 1 }, /increment.*exactly once/],
    [{ ...original, revision: 2, operation: null }, /preserve authored operation/],
    [{ ...original, revision: 2, autonomousReview: { ...original.autonomousReview, originExecutionId: "forged" } }, /preserve authored autonomousReview/],
    [{ ...original, revision: 2, history: [] }, /Preserve historical state evidence/],
    [{ ...original, revision: 2, commits: { ...original.commits, spec: git(root, "rev-parse", "HEAD") } }, /preserve authored commit references/]
  ] as const;
  for (const [state, error] of badStates) assert.throws(() => previewCandidateApply(stage(root, "revise", { ...files, "state.json": json(state) })), error);
  const missingRecord = { ...files }; delete (missingRecord as Partial<typeof files>)["revisions/revision-2.md"];
  assert.throws(() => previewCandidateApply(stage(root, "revise", missingRecord)), /exactly one.*revision-/);
  assert.equal(read(root, ".cadre/tracks/sample/state.json"), before);
  const preparedCandidate = stage(root, "revise", files), preview = previewCandidateApply(preparedCandidate);
  const checkpoint = (nodeId: string) => call("execution_checkpoint", { scope: { ...scope, executionId: original.operation.executionId, nodeId }, action: { event: "start" } });
  await checkpoint("P1"); await checkpoint("T1.1");
  const liveBefore = read(root, ".cadre/tracks/sample/state.json");
  assert.throws(() => previewCandidateApply(preparedCandidate), /quiescent execution/);
  assert.throws(() => applyCandidate(preparedCandidate, preview.digest), /quiescent execution/);
  assert.equal(read(root, ".cadre/tracks/sample/state.json"), liveBefore);
});

for (const readyForReview of [false, true]) {
  test(`revision from ${readyForReview ? "ready_for_review" : "planned"} retains its baseline and starts revised delivery`, async (t) => {
    const { root, call, load } = await fixture(t), scope = { projectRoot: root, trackId: "sample" };
    if (readyForReview) {
      await call("execution_start", { ...scope, approvalMode: "autonomous", requestedMode: "sequential" });
      await finishCurrent(root, call, load().operation.executionId);
    }
    const previous = load(), files = revisedFiles(root, previous);
    if (readyForReview) files["plan.md"] = read(root, ".cadre/tracks/sample/plan.md")
      .replace("Spec revision: 1", "Spec revision: 2").replace("Plan revision: 1", "Plan revision: 2")
      + "\n## Phase 3: Extend\n- Phase dependencies: P2\n- [ ] T3.1 Second behavior\n  - Task dependencies: none\n  - Commit group: second\n- [ ] T3.2 User Manual Verification\n- Phase completion commit: pending\n## Phase 4: Track-level User Manual Verification\n- [ ] T4.1 User Manual Verification\n- Phase completion commit: pending\n";
    const candidate = stage(root, "revise", files), preview = previewCandidateApply(candidate);
    commit(root, applyCandidate(candidate, preview.digest));
    assert.equal(load().revision, 2); assert.equal(load().status, readyForReview ? "in_progress" : "planned");
    assert.deepEqual(load().lastExecution, previous.lastExecution);
    await call("execution_start", scope);
    const journal = readExecution(root, "sample", load().operation.executionId);
    if (readyForReview) assert.equal(journal.nodes["P2"]!.status, "completed");
    assert.deepEqual(validateProject(root).errors, []);
  });
}

test("an active Autonomous revision can return to planned and still route to its approved new execution", async (t) => {
  const { root, call, load } = await fixture(t), scope = { projectRoot: root, trackId: "sample" };
  await call("execution_start", { ...scope, approvalMode: "autonomous", requestedMode: "sequential" });
  const previous = load(), files = revisedFiles(root, previous);
  files["state.json"] = json({ ...previous, revision: 2, status: "planned" });
  const candidate = stage(root, "revise", files);
  commit(root, applyCandidate(candidate, previewCandidateApply(candidate).digest));
  assert.equal(load().status, "planned");
  const status = await call("project_status", { ...scope, view: "implementation" });
  assert.equal(status.nextStep.skill, "implement"); assert.equal(status.nextStep.prerequisite, null);
  await call("execution_start", scope);
  assert.equal(load().operation.approvalMode, "autonomous"); assert.deepEqual(validateProject(root).errors, []);
});

for (const driftedGraph of [false, true]) {
  test(`an approved repair recovers legacy partial revision with ${driftedGraph ? "graph and scope" : "scope"} drift while preserving its receipt`, async (t) => {
    const { root, call, load } = await fixture(t), scope = { projectRoot: root, trackId: "sample" };
    await call("execution_start", { ...scope, approvalMode: "autonomous", requestedMode: "sequential" });
    const original = load(), oldJournal = readExecution(root, "sample", original.operation.executionId);
    // Emulate the already committed incomplete promotion reported by the user, never repair it by hand.
    const legacyId = "revise-legacy-partial", prefix = ".cadre/tracks/sample/", proposed = revisedFiles(root, original);
    const broken = { ...original, history: [...original.history, { action: "revise", commit: `op:${legacyId}` }], commits: { ...original.commits, spec: `op:${legacyId}`,
      ...(driftedGraph ? { plan: `op:${legacyId}` } : {}) } };
    const files = [{ path: prefix + "spec.md", content: proposed["spec.md"] }, { path: prefix + "state.json", content: json(broken) }, { path: prefix + "revisions/revision-2.md", content: proposed["revisions/revision-2.md"] }];
    if (driftedGraph) for (const file of ["plan.md", "learning.md", "dependency-context.json"] as const) files.push({ path: prefix + file, content: proposed[file] });
    commit(root, promoteOperation(root, { operationId: legacyId, kind: "revise", approvalDigest: "a".repeat(64), baseCommit: git(root, "rev-parse", "HEAD") }, files));
    const oldReceipt = read(root, `.cadre/receipts/${legacyId}.json`), oldCommit = resolveOperation(root, `op:${legacyId}`);
    assert.equal(load().revision, 1);
    assert.ok(validateProject(root).errors.some((error) => error.includes("Autonomous scope reference")));
    reconcileOperation(root, legacyId); reconcileOperation(root, legacyId);
    assert.equal(load().revision, 1); assert.equal(load().autonomousReview.specCommit, original.autonomousReview.specCommit);
    const repair = revisedFiles(root, load());
    const repairedFiles = () => { const result = { ...repair, "revisions/revision-repair-2.md": repair["revisions/revision-2.md"] }; delete (result as Partial<typeof result>)["revisions/revision-2.md"]; return result; };
    if (driftedGraph) {
      repair["plan.md"] = repair["plan.md"].replace("Spec revision: 2", "Spec revision: 3").replace("Plan revision: 2", "Plan revision: 3");
      repair["learning.md"] = proposed["learning.md"].replace('"specRevision":2', '"specRevision":3').replace('"planRevision":2', '"planRevision":3');
      repair["dependency-context.json"] = json({ ...JSON.parse(proposed["dependency-context.json"]), specRevision: 3, planRevision: 3 });
      repair["revisions/revision-2.md"] = repair["revisions/revision-2.md"].replace("Previous spec revision: 1", "Previous spec revision: 2").replace("New spec revision: 2", "New spec revision: 3").replace("Previous plan revision: 1", "Previous plan revision: 2").replace("New plan revision: 2", "New plan revision: 3");
      assert.throws(() => previewCandidateApply(stage(root, "revise", repairedFiles())), /repair requires Recovery evidence/);
      repair["revisions/revision-2.md"] += `\n## Recovery evidence\n- Previous execution graph: ${oldJournal.graphDigest}\n- Previous execution plan commit: ${oldJournal.planCommit}\n`;
    }
    const candidate = stage(root, "revise", repairedFiles()), preview = previewCandidateApply(candidate);
    const explained = JSON.parse(repair["state.json"]);
    for (const change of preview.stateChanges.find((item) => item.path === prefix + "state.json")!.changes) {
      if (change.action === "append") explained[change.field].push(...change.value as unknown[]);
      else explained[change.field] = change.value;
    }
    assert.equal(receiptHash(json(explained)), preview.manifest.find((file) => file.path === prefix + "state.json")!.sha256);
    commit(root, applyCandidate(candidate, preview.digest));
    assert.equal(load().revision, 2); assert.equal(load().autonomousReview.specCommit, load().commits.spec);
    assert.equal(read(root, `.cadre/receipts/${legacyId}.json`), oldReceipt); assert.equal(resolveOperation(root, `op:${legacyId}`), oldCommit);
    assert.equal(read(root, prefix + "revisions/revision-2.md"), proposed["revisions/revision-2.md"]);
    assert.deepEqual(readExecution(root, "sample", oldJournal.executionId).nodes, oldJournal.nodes);
    await call("execution_start", scope); await finishCurrent(root, call, load().operation.executionId);
    assert.equal(load().status, "ready_for_review"); assert.deepEqual(validateProject(root).errors, []);
  });
}

for (const approvalMode of ["governed", "phase", "track", "autonomous"] as const) {
  for (const requestedMode of ["sequential", "parallel"] as const) {
    test(`active revision resumes ${approvalMode}/${requestedMode} without losing completed work`, async (t) => {
      const { root, call, load } = await fixture(t), scope = { projectRoot: root, trackId: "sample" };
      await call("execution_start", { ...scope, approvalMode, requestedMode });
      const oldState = load(), oldId = oldState.operation.executionId;
      const checkpoint = (nodeId: string, event: string, extra = {}) => call("execution_checkpoint", { scope: { ...scope, executionId: oldId, nodeId }, action: { event, ...extra } });
      await checkpoint("P1", "start");
      write(root, "first.txt", "first behavior\n"); git(root, "add", "first.txt"); git(root, "commit", "-m", "feat: first behavior");
      const productHead = git(root, "rev-parse", "HEAD");
      await checkpoint("T1.1", "complete_group", { commit: productHead, tasks: [{ nodeId: "T1.1", verification: "First behavior checked", authorization: "Explicit fixture approval", handoff: { decisions: ["Preserve first behavior"], failedApproaches: [], openQuestions: [], nextAction: "Revise", sources: [] } }] });
      const oldJournal = readExecution(root, "sample", oldId), previous = load();
      const files = revisedFiles(root, previous, productHead);
      assert.throws(() => previewCandidateApply(stage(root, "revise", { ...files,
        "plan.md": files["plan.md"].replace("Commit group: second", "Commit group: first") })), /cannot add tasks to a completed commit group/);
      const candidate = stage(root, "revise", files);
      const prepared = await call("candidate_apply", { request: { mode: "prepare", ...candidate } });
      assert.deepEqual(load(), previous, "prepare does not mutate canonical state");
      const result = await call("candidate_apply", { request: { mode: "apply", proposalToken: prepared.proposalToken } });
      commit(root, result as { operationId: string; trailers: string[] });
      assert.equal(load().revision, 2); assert.equal(load().operation, null);
      assert.deepEqual(readExecution(root, "sample", oldId).nodes, oldJournal.nodes);
      assert.equal(readExecution(root, "sample", oldId).status, "superseded");
      assert.deepEqual(executionSchedulerView(readExecution(root, "sample", oldId)).readyTasks, []);
      assert.deepEqual(validateProject(root).errors, []);
      assert.deepEqual(readContext({ ...scope, nodeId: "T1.2" }).errors, []);
      const status = await call("project_status", { ...scope, view: "implementation" });
      if (approvalMode === "autonomous") {
        assert.equal(status.nextStep.action, "invoke_skill"); assert.equal(status.nextStep.skill, "implement");
        assert.equal(status.nextStep.prerequisite, null);
        assert.equal(load().autonomousReview.specCommit, load().commits.spec);
        assert.equal(load().autonomousReview.originExecutionId, previous.autonomousReview.originExecutionId);
      }
      await call("execution_start", scope);
      const newId = load().operation.executionId;
      assert.notEqual(newId, oldId);
      assert.equal(load().operation.approvalMode, approvalMode);
      assert.equal(load().operation.mode, requestedMode);
      assert.equal(readExecution(root, "sample", newId).nodes["T1.1"]!.status, "completed");
      assert.deepEqual(readExecution(root, "sample", newId).nodes["T1.1"]!.handoff, oldJournal.nodes["T1.1"]!.handoff);
      assert.deepEqual(validateProject(root).errors, []);
      const count = git(root, "rev-list", "--count", "HEAD");
      const replay = await call("candidate_apply", { request: { mode: "apply", proposalToken: prepared.proposalToken } });
      assert.equal(replay.status, "committed"); assert.equal(replay.changedCount, 0);
      assert.equal(git(root, "rev-list", "--count", "HEAD"), count); assert.equal(load().revision, 2);
      await finishCurrent(root, call, newId);
      assert.equal(load().status, "ready_for_review"); assert.deepEqual(validateProject(root).errors, []);
      const clean = load();
      if (approvalMode === "autonomous") {
        clean.autonomousReview = { ...clean.autonomousReview, checkpoint: "awaiting_approval", reviewedExecutionId: newId, reviewedHead: clean.lastExecution.headCommit };
        write(root, ".cadre/tracks/sample/state.json", json(clean));
      }
      const review = await call("review_complete", { request: { mode: "prepare", ...scope, approval: "Both behaviors and cumulative review passed" } });
      assert.equal(load().status, "ready_for_review");
      commit(root, (await call("review_complete", { request: { mode: "apply", proposalToken: review.proposalToken } })).receipt);
      assert.equal(load().status, "completed"); assert.deepEqual(validateProject(root).errors, []);
      assert.equal(read(root, "first.txt"), "first behavior\n"); assert.equal(git(root, "status", "--porcelain"), "");
    });
  }
}
