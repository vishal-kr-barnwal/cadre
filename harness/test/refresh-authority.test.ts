import assert from "node:assert/strict";
import test from "node:test";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { readExecution } from "../src/domain/execution.js";
import { validateProject } from "../src/domain/state.js";
import { json, git, read, write, commit, stage, fixture, finishCurrent } from "./helpers/revision-fixture.js";

const parent = ".cadre/tracks/sample/";
const refresh = (root: string, state: unknown) => ({ "project.json": read(root, ".cadre/project.json"),
  "refreshes/refresh-authority.md": "# Refresh\nPreserve existing delivery and review authority.\n", "tracks/sample/state.json": json(state) });

for (const clientName of ["codex", "claude-code", "zed"]) for (const requestedMode of ["sequential", "parallel"]) {
  test(`refresh preserves cumulative review authority through completion: ${clientName}/${requestedMode}`, async (t) => {
    const {root, call, load} = await fixture(t, clientName), scope = {projectRoot: root, trackId: "sample"};
    await call("execution_start", {...scope, approvalMode: "autonomous", requestedMode});
    const executionId = load().operation.executionId;
    await call("execution_checkpoint", {scope: {...scope, executionId, nodeId: "P1"}, action: {event: "start"}});
    write(root, "first.txt", "Verified first behavior\n"); git(root, "add", "first.txt"); git(root, "commit", "-m", "feat: first behavior");
    const firstCommit = git(root, "rev-parse", "HEAD");
    await call("execution_checkpoint", {scope: {...scope, executionId, nodeId: "T1.1"}, action: {event: "complete_group", commit: firstCommit,
      tasks: [{nodeId: "T1.1", verification: "First behavior checked", authorization: "Explicit fixture approval",
        handoff: {decisions: [], failedApproaches: [], openQuestions: [], nextAction: "Continue", sources: []}}]}});
    const original = load(), before = read(root, parent + "state.json");
    for (const change of [{originExecutionId: "forged-origin"}, {authorizedAt: "2020-01-01T00:00:00.000Z"},
      {initialBaseCommit: firstCommit}, {checkpoint: "reviewing"}, {findings: [{id: "invented", summary: "Unrecorded", status: "open", attemptExecutionIds: []}]}]) {
      assert.throws(() => previewCandidateApply(stage(root, "refresh", refresh(root, {...original,
        autonomousReview: {...original.autonomousReview, ...change}}))), /Refresh must preserve authored autonomousReview/);
    }
    assert.throws(() => previewCandidateApply(stage(root, "refresh", refresh(root, {...original, autonomousReview: undefined}))), /preserve authored autonomousReview/);
    const journal = readExecution(root, "sample", executionId);
    assert.throws(() => previewCandidateApply(stage(root, "refresh", {...refresh(root, {...original,
      operation: {...original.operation, approvalMode: "track"}}),
      ["tracks/sample/" + original.operation.journal]: json({...journal, approvalMode: "track"})})), /preserve existing Autonomous approval policy/);
    assert.equal(read(root, parent + "state.json"), before);
    const reordered = {...original, autonomousReview: Object.fromEntries(Object.entries(original.autonomousReview).reverse())};
    const input = stage(root, "refresh", refresh(root, reordered)), preview = previewCandidateApply(input);
    commit(root, applyCandidate(input, preview.digest)); assert.deepEqual(load().autonomousReview, original.autonomousReview);
    await finishCurrent(root, call, executionId);
    const state = load(); write(root, parent + "state.json", json({...state, autonomousReview: {...state.autonomousReview,
      checkpoint: "awaiting_approval", reviewedExecutionId: executionId, reviewedHead: state.lastExecution.headCommit}}));
    const review = await call("review_complete", {request: {mode: "prepare", ...scope, approval: "Explicit fixture approval of cumulative clean review"}});
    assert.equal(review.commitRange, `${original.autonomousReview.initialBaseCommit}..${state.lastExecution.headCommit}`);
    assert.ok(git(root, "rev-list", review.commitRange).split("\n").includes(firstCommit));
    commit(root, (await call("review_complete", {request: {mode: "apply", proposalToken: review.proposalToken}})).receipt);
    prepareCandidateStage(root, "archive-sample", []);
    const archive = await call("archive_batch_candidate", {request: {mode: "prepare", projectRoot: root, candidateId: "archive-sample", selectedTracks: ["sample"], updates: []}});
    commit(root, (await call("archive_batch_candidate", {request: {mode: "apply", proposalToken: archive.proposalToken}})).receipt);
    assert.deepEqual(validateProject(root).errors, []); assert.equal(git(root, "status", "--porcelain"), "");
  });
}

test("context refresh cannot erase finding attempts or bypass a persisted blocker", async (t) => {
  const {root, call, load} = await fixture(t);
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode: "parallel"});
  const original = load(), loop = {...original.autonomousReview, checkpoint: "blocked", blocker: "Requires human decision",
    findings: [{id: "stable-bug", summary: "Retained evidence", status: "open", attemptExecutionIds: ["attempt-1", "attempt-2"]}]};
  write(root, parent + "state.json", json({...original, autonomousReview: loop}));
  assert.deepEqual(validateProject(root).errors, []);
  for (const next of [{...loop, findings: []}, {...loop, findings: [{...loop.findings[0], attemptExecutionIds: []}]},
    {...loop, findings: [{...loop.findings[0], status: "resolved"}]}, {...loop, checkpoint: "implementing", blocker: undefined}]) {
    assert.throws(() => previewCandidateApply(stage(root, "refresh", refresh(root, {...original, autonomousReview: next}))), /preserve authored autonomousReview/);
  }
});

test("explicit legacy migration creates authority from verified execution evidence; context cannot invent it", async (t) => {
  const {root, call, load} = await fixture(t), scope = {projectRoot: root, trackId: "sample"};
  await call("execution_start", {...scope, approvalMode: "track", requestedMode: "sequential"});
  const initial = load(), old = readExecution(root, "sample", initial.operation.executionId);
  const migration = {executionId: old.executionId, approvalMode: "autonomous", approvedAt: "2026-10-12T00:00:00.000Z", refreshPath: "refreshes/refresh-policy.md"};
  const loop = {policyVersion: 2, originExecutionId: old.executionId, authorizedAt: migration.approvedAt,
    initialBaseCommit: old.baseCommit, specCommit: initial.commits.spec, checkpoint: "implementing", findings: []};
  assert.throws(() => previewCandidateApply(stage(root, "refresh", refresh(root, {...initial, autonomousReview: loop}))), /cannot create Autonomous authority/);
  const legacy = {...initial, operation: {...initial.operation, approvalMode: "autonomous", approvalPolicyVersion: 1}};
  write(root, parent + "state.json", json(legacy)); write(root, parent + initial.operation.journal, json({...old, approvalMode: "autonomous", approvalPolicyVersion: 1}));
  const next = {...legacy, approvalModeMigration: migration, operation: {...legacy.operation, approvalPolicyVersion: 2}, autonomousReview: loop};
  const files = {...refresh(root, next), [migration.refreshPath]: "# Policy\nExplicit fixture choice of Autonomous authority.\n",
    ["tracks/sample/" + initial.operation.journal]: json({...old, approvalMode: "autonomous", approvalPolicyVersion: 2})};
  assert.throws(() => previewCandidateApply(stage(root, "refresh", {...files,
    "tracks/sample/state.json": json({...next, autonomousReview: {...loop, initialBaseCommit: "f".repeat(40)}})})), /bind Autonomous authority/);
  const input = stage(root, "refresh", files); commit(root, applyCandidate(input, previewCandidateApply(input).digest));
  await call("execution_checkpoint", {scope: {...scope, executionId: old.executionId, nodeId: "P1"}, action: {event: "start"}});
  assert.deepEqual(load().autonomousReview, loop); assert.deepEqual(validateProject(root).errors, []);
});
