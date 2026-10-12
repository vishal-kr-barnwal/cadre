import assert from "node:assert/strict";
import test from "node:test";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { previewCandidateApply } from "../src/domain/candidate-apply.js";
import { requireReviewProgress, validateAutonomousRemediation } from "../src/domain/autonomous-review.js";
import { validateProject } from "../src/domain/state.js";
import { parsePlanContent } from "../src/domain/plan.js";
import { promoteOperation } from "../src/domain/operation-receipts.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";
import { fixture, finishCurrent, read, write, git, commit, json } from "./helpers/revision-fixture.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
const parent = ".cadre/tracks/sample/";
async function retry(f: Fixture, reason: string) {
  const {root, call, load} = f, state = load(), refreshPath = "refreshes/refresh-retry.md";
  const files = {"project.json": read(root, ".cadre/project.json"), "tracks/sample/state.json": json(state),
    [refreshPath]: `# Explicit human instruction\n${reason}\nPreserve all prior finding, attempt, and cumulative baseline evidence.\n`};
  prepareCandidateStage(root, "refresh-retry", Object.keys(files));
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/refresh-retry/${path}`, body);
  const input = {projectRoot: root, candidateId: "refresh-retry", workflow: "refresh" as const, files: Object.keys(files),
    reviewRetry: {trackId: "sample", refreshPath, reason}};
  return {input, proposal: await call("candidate_apply", {request: {mode: "prepare", ...input}})};
}
for (const clientName of ["codex", "claude-code", "zed"]) for (const requestedMode of ["sequential", "parallel"]) {
  test(`explicit blocked review retry retains history and completes: ${clientName}/${requestedMode}`, async (t) => {
    const f = await fixture(t, clientName), {root, call, load} = f;
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode});
    await finishCurrent(root, call, load().operation.executionId);
    const state = load(), blocked = {...state.autonomousReview, checkpoint: "blocked", blocker: "External human check unavailable"};
    write(root, parent + "state.json", json({...state, autonomousReview: blocked}));
    git(root, "add", ".cadre"); git(root, "commit", "-m", "cadre: record verified blocker");
    const {input, proposal} = await retry(f, "The external check is now available; resume review under explicit human approval.");
    assert.throws(() => previewCandidateApply({...input, workflow: "revise"}), /requires the refresh workflow/);
    const before = read(root, parent + "state.json");
    write(root, parent + "state.json", json({...load(), title: "Changed concurrent input"}));
    await assert.rejects(call("candidate_apply", {request: {mode: "apply", proposalToken: proposal.proposalToken}}), /unchanged current track state/);
    assert.equal(load().title, "Changed concurrent input"); write(root, parent + "state.json", before);
    const applied = await call("candidate_apply", {request: {mode: "apply", proposalToken: proposal.proposalToken}});
    commit(root, {operationId: applied.operationId, trailers: applied.trailers});
    const next = load(); assert.equal(next.autonomousReview.checkpoint, "reviewing");
    assert.equal(next.autonomousReview.initialBaseCommit, blocked.initialBaseCommit);
    assert.deepEqual(next.history.at(-1).reviewRetry.previousLoop, blocked);
    assert.equal((await call("project_status", {projectRoot: root, trackId: "sample", view: "track"})).nextStep.skill, "review");
    assert.equal((await call("candidate_apply", {request: {mode: "apply", proposalToken: proposal.proposalToken}})).changedCount, 0);
    await assert.rejects(retry(f, "Repeat the already renewed budget"), /blocked or stalled/);
    await reviewAndArchive(f); assert.deepEqual(validateProject(root).errors, []);
  });
}
async function remediation(f: Fixture, interrupted = false) {
  const {root, call, load} = f, state = load(), graph = parsePlanContent(read(root, parent + "plan.md"), "plan.md");
  const n = graph.phases.length + 1, revision = graph.planRevision! + 1;
  const loop = {...state.autonomousReview, checkpoint: "remediating", reviewedExecutionId: state.lastExecution.executionId,
    reviewedHead: state.lastExecution.headCommit};
  const files = {"plan.md": read(root, parent + "plan.md").replace(`Plan revision: ${graph.planRevision}`, `Plan revision: ${revision}`)
    + `\n## Phase ${n}: Fix finding\n- Phase dependencies: P${n - 1}\n- [ ] T${n}.1 Fix persistent finding\n  - Task dependencies: none\n  - Commit group: fix-${n}\n- [ ] T${n}.2 User Manual Verification\n- Phase completion commit: pending\n## Phase ${n + 1}: Track-level User Manual Verification\n- [ ] T${n + 1}.1 User Manual Verification\n- Phase completion commit: pending\n`,
    "learning.md": read(root, parent + "learning.md").replace(`"planRevision":${graph.planRevision}`, `"planRevision":${revision}`),
    "dependency-context.json": json({...JSON.parse(read(root, parent + "dependency-context.json")), planRevision: revision}),
    [`bugs/review-${state.reviewCycles.length + 1}.md`]: "# Finding\nPersistent verified in-scope defect.\n",
    [`reviews/loop-${state.reviewCycles.length + 1}.json`]: json(loop)};
  prepareCandidateStage(root, "review-sample", Object.keys(files));
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/review-sample/${path}`, body);
  const p = await call("candidate_apply", {request: {mode: "prepare", projectRoot: root, candidateId: "review-sample", workflow: "review", files: Object.keys(files)}});
  let a;
  if (interrupted) {
    const preview = previewCandidateApply({projectRoot: root, candidateId: "review-sample", workflow: "review", files: Object.keys(files)});
    assert.throws(() => promoteOperation(root, {operationId: preview.operationId, kind: "review", approvalDigest: preview.digest,
      baseCommit: preview.baseCommit, inputs: preview.recoveryInputs}, preview.files, () => {throw Error("fixture crash");}), /fixture crash/);
    const original = read(root, "second.txt"), intentPath = `.cadre/stage/operations/${preview.operationId}.json`, intent = read(root, intentPath);
    write(root, "second.txt", original + "Unreviewed during remediation recovery\n");
    await assert.rejects(call("candidate_apply", {request: {mode: "resume", projectRoot: root, operationId: preview.operationId, approvalDigest: preview.digest}}), /Product content changed/);
    assert.equal(read(root, intentPath), intent); write(root, "second.txt", original);
    a = await call("candidate_apply", {request: {mode: "resume", projectRoot: root, operationId: preview.operationId, approvalDigest: preview.digest}});
  } else a = await call("candidate_apply", {request: {mode: "apply", proposalToken: p.proposalToken}});
  commit(root, {operationId: a.operationId, trailers: a.trailers});
  await call("execution_start", {projectRoot: root, trackId: "sample"}); const id = load().operation.executionId;
  await finishCurrent(root, call, id); const done = load();
  done.autonomousReview.findings[0].attemptExecutionIds.push(id); write(root, parent + "state.json", json(done));
  return id;
}
test("explicit stalled retry grants two new attempts without losing the first two", async (t) => {
  const f = await fixture(t), {root, call, load} = f;
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode: "parallel"});
  await finishCurrent(root, call, load().operation.executionId);
  const state = load(); state.autonomousReview.findings = [{id: "persistent", summary: "Verified defect", status: "open", attemptExecutionIds: []}];
  write(root, parent + "state.json", json(state));
  const first = await remediation(f), second = await remediation(f), stalled = load();
  assert.throws(() => requireReviewProgress(stalled.autonomousReview), /two remediation attempts/);
  stalled.autonomousReview.checkpoint = "blocked"; stalled.autonomousReview.blocker = "Two actual remediation executions failed";
  write(root, parent + "state.json", json(stalled)); git(root, "add", ".cadre"); git(root, "commit", "-m", "cadre: persist stalled review evidence");
  const {proposal} = await retry(f, "Approve another bounded attempt budget for this same verified defect.");
  const applied = await call("candidate_apply", {request: {mode: "apply", proposalToken: proposal.proposalToken}});
  commit(root, {operationId: applied.operationId, trailers: applied.trailers});
  assert.deepEqual(load().autonomousReview.findings[0].attemptExecutionIds, [first, second]);
  assert.doesNotThrow(() => requireReviewProgress(load().autonomousReview));
  const loop = load().autonomousReview;
  assert.throws(() => validateAutonomousRemediation(loop, {...loop, checkpoint: "remediating", retryAuthorization: {
    ...loop.retryAuthorization, attemptBaseline: [{id: "persistent", attemptExecutionIds: [first]}]
  }}, load().lastExecution), /retry authority/);
  await remediation(f); assert.doesNotThrow(() => requireReviewProgress(load().autonomousReview));
  await remediation(f); assert.throws(() => requireReviewProgress(load().autonomousReview), /two remediation attempts/);
  assert.equal(load().autonomousReview.findings[0].attemptExecutionIds.length, 4);
  const resolved = load(); resolved.autonomousReview.findings[0].status = "resolved"; write(root, parent + "state.json", json(resolved));
  await reviewAndArchive(f); assert.deepEqual(validateProject(root).errors, []);
});

test("finding-bearing review recovery checks the reviewed product before promotion", async (t) => {
  const f = await fixture(t), {root, call, load} = f;
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode: "sequential"});
  await finishCurrent(root, call, load().operation.executionId);
  const state = load(); state.autonomousReview.findings = [{id: "persistent", summary: "Verified defect", status: "open", attemptExecutionIds: []}];
  write(root, parent + "state.json", json(state)); await remediation(f, true);
  const resolved = load(); resolved.autonomousReview.findings[0].status = "resolved"; write(root, parent + "state.json", json(resolved));
  await reviewAndArchive(f); assert.deepEqual(validateProject(root).errors, []);
});
