import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { readExecution } from "../src/domain/execution.js";
import { requireQuiescentExecution } from "../src/domain/execution-quiescence.js";
import { managedWorktreeStatus } from "../src/domain/worktrees.js";
import { parsePlanContent } from "../src/domain/plan.js";
import { validateProject } from "../src/domain/state.js";
import { json, git, read, write, commit, stage, fixture, finishCurrent, revisedFiles } from "./helpers/revision-fixture.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
const evidence = "Explicit synthetic fixture approval; behavior and cumulative evidence checked";
const handoff = { decisions: ["Preserve verified work"], failedApproaches: [], openQuestions: [], nextAction: "Continue", sources: [] };
const trackPath = ".cadre/tracks/sample/";

async function promote({root, call}: Fixture, workflow: "revise" | "refresh", files: Record<string, string>) {
  const candidate = stage(root, workflow, files);
  const proposal = await call("candidate_apply", {request: {mode: "prepare", ...candidate}});
  const result = await call("candidate_apply", {request: {mode: "apply", proposalToken: proposal.proposalToken}});
  commit(root, {operationId: result.operationId, trailers: result.trailers});
  const before = git(root, "rev-parse", "HEAD");
  assert.equal((await call("candidate_apply", {request: {mode: "apply", proposalToken: proposal.proposalToken}})).changedCount, 0);
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.deepEqual(validateProject(root).errors, []);
}

function scopeRevision({root, load}: Fixture, extend: boolean): Record<string, string> {
  const previous = load(), oldPlan = read(root, trackPath + "plan.md"), graph = parsePlanContent(oldPlan, "plan.md");
  const revision = previous.revision + 1, spec = graph.specRevision! + 1, plan = graph.planRevision! + 1;
  let nextPlan = oldPlan.replace(`Spec revision: ${graph.specRevision}`, `Spec revision: ${spec}`)
    .replace(`Plan revision: ${graph.planRevision}`, `Plan revision: ${plan}`);
  const journal = readExecution(root, "sample", previous.operation.executionId);
  if (journal.nodes["T1.1"]!.status === "completed") nextPlan = nextPlan.replace(
    /- \[[ x]\] T1\.1 First behavior(?: <!-- commit: [^>]+ -->)?/,
    `- [x] T1.1 First behavior <!-- commit: ${journal.nodes["T1.1"]!.workerCommit} -->`);
  if (extend) nextPlan = nextPlan.replace("- [ ] T1.2 User Manual Verification",
    "- [ ] T1.2 Second behavior\n  - Task dependencies: T1.1\n  - Commit group: second\n- [ ] T1.3 User Manual Verification");
  return {
    "state.json": json({...previous, revision}), "spec.md": read(root, trackPath + "spec.md") + `\nApproved scope revision ${spec}.\n`,
    "plan.md": nextPlan,
    "learning.md": read(root, trackPath + "learning.md").replace(`"specRevision":${graph.specRevision}`, `"specRevision":${spec}`)
      .replace(`"planRevision":${graph.planRevision}`, `"planRevision":${plan}`),
    "dependency-context.json": json({...JSON.parse(read(root, trackPath + "dependency-context.json")), specRevision: spec, planRevision: plan}),
    [`revisions/revision-${revision}.md`]: `# Revision ${revision}\n- Previous track revision: ${previous.revision}\n- New track revision: ${revision}\n- Previous spec revision: ${graph.specRevision}\n- New spec revision: ${spec}\n- Previous plan revision: ${graph.planRevision}\n- New plan revision: ${plan}\n## Requested change\nPreserve evidence and extend scope.\n## Approval\n${evidence}\n`
  };
}

function refreshFiles(root: string, nested: Record<string, string> = {}): Record<string, string> {
  let number = 1;
  while (existsSync(root + `/.cadre/refreshes/refresh-sample-${number}.md`)) number++;
  return {"project.json": read(root, ".cadre/project.json"),
    [`refreshes/refresh-sample-${number}.md`]: "# Refresh\nPreserve approved history and reassess affected scope.\n",
    ...Object.fromEntries(Object.entries(nested).map(([path, body]) => [`tracks/sample/${path}`, body]))};
}

async function workerDelivery(f: Fixture, approvalMode: string) {
  const {root, call, load} = f, id = load().operation.executionId;
  const scope = {projectRoot: root, trackId: "sample", executionId: id, nodeId: "T1.1"};
  await call("execution_checkpoint", {scope: {...scope, nodeId: "P1"}, action: {event: "start"}});
  const worker = await call("worktree_create", scope);
  write(worker.path, "first.txt", "first behavior\n"); git(worker.path, "add", "first.txt");
  git(worker.path, "commit", "-m", "feat: first behavior in worker");
  const workerCommit = git(worker.path, "rev-parse", "HEAD");
  await call("execution_checkpoint", {scope, action: {event: "record_commit", commit: workerCommit, verification: evidence, authorization: evidence, handoff}});
  const integration = await call("integration", {request: {mode: "prepare", ...scope}});
  if (approvalMode === "governed") {
    assert.equal(integration.commandStatus, "approval_required");
    await call("integration", {request: {mode: "apply", proposalToken: integration.proposalToken}});
  }
  return {scope, worker, workerCommit, id};
}

async function reviewAndArchive({root, call, load}: Fixture) {
  const state = load();
  // The fixture supplies evidence an agent records before the final approval gate.
  if (state.autonomousReview) write(root, trackPath + "state.json", json({...state, autonomousReview: {...state.autonomousReview,
    checkpoint: "awaiting_approval", reviewedExecutionId: state.lastExecution.executionId, reviewedHead: state.lastExecution.headCommit}}));
  const scope = {projectRoot: root, trackId: "sample"};
  const proposal = await call("review_complete", {request: {mode: "prepare", ...scope, approval: evidence}});
  assert.equal(load().status, "ready_for_review");
  commit(root, (await call("review_complete", {request: {mode: "apply", proposalToken: proposal.proposalToken}})).receipt);
  assert.equal(load().status, "completed");
  assert.equal((await call("review_complete", {request: {mode: "apply", proposalToken: proposal.proposalToken}})).receipt.status, "committed");
  prepareCandidateStage(root, "archive-sample", []);
  const archive = await call("archive_batch_candidate", {request: {mode: "prepare", projectRoot: root, candidateId: "archive-sample", selectedTracks: ["sample"], updates: []}});
  commit(root, (await call("archive_batch_candidate", {request: {mode: "apply", proposalToken: archive.proposalToken}})).receipt);
  assert.equal((await call("archive_batch_candidate", {request: {mode: "apply", proposalToken: archive.proposalToken}})).receipt.status, "committed");
  assert.equal(JSON.parse(read(root, ".cadre/archive/sample/state.json")).status, "archived");
  assert.deepEqual(validateProject(root).errors, []);
}

for (const clientName of ["codex", "claude-code", "zed"]) for (const approvalMode of ["governed", "phase", "track", "autonomous"])
for (const requestedMode of ["sequential", "parallel"]) {
  test(`cleaned worker revises, refreshes scope and archives: ${clientName}/${approvalMode}/${requestedMode}`, async (t) => {
    const f = await fixture(t, clientName), {root, call, load} = f, scope = {projectRoot: root, trackId: "sample"};
    await call("execution_start", {...scope, approvalMode, requestedMode});
    const {worker, workerCommit, id, scope: workerScope} = await workerDelivery(f, approvalMode);
    await call("worktree_cleanup", workerScope);
    assert.equal(existsSync(worker.path), false);
    assert.equal(managedWorktreeStatus(root).worktrees.filter((w) => w.managed).length, 0);
    const before = read(root, trackPath + load().operation.journal), originalOperation = load().operation;
    const oldNode = readExecution(root, "sample", id).nodes["T1.1"]!;
    assert.equal(oldNode.branch, worker.branch); assert.equal(oldNode.worktreePath, worker.path);
    // Identical scope files must not rebind Autonomous scope authority during context refresh.
    await promote(f, "refresh", {...refreshFiles(root, {"state.json": json(load()), "spec.md": read(root, trackPath + "spec.md"),
      "plan.md": read(root, trackPath + "plan.md"), "dependency-context.json": read(root, trackPath + "dependency-context.json")}),
      "guidelines.md": read(root, ".cadre/guidelines.md") + "\nContext-only clarification.\n"});
    assert.equal(read(root, trackPath + load().operation.journal), before);
    assert.deepEqual(load().operation, originalOperation);
    await promote(f, "revise", scopeRevision(f, true));
    assert.equal(load().revision, 2); assert.equal(load().operation, null);
    assert.deepEqual(readExecution(root, "sample", id).nodes["T1.1"], oldNode);
    await call("execution_start", scope);
    const secondId = load().operation.executionId;
    assert.equal(load().operation.approvalMode, approvalMode);
    assert.equal(readExecution(root, "sample", secondId).nodes["T1.1"]!.workerCommit, workerCommit);
    const beforeScopeRefresh = readExecution(root, "sample", secondId);
    await promote(f, "refresh", refreshFiles(root, scopeRevision(f, false)));
    assert.equal(load().revision, 3); assert.equal(load().operation, null);
    const superseded = readExecution(root, "sample", secondId);
    assert.equal(superseded.status, "superseded"); assert.deepEqual(superseded.nodes, beforeScopeRefresh.nodes);
    await call("execution_start", scope);
    assert.equal(load().operation.approvalMode, approvalMode);
    assert.equal(readExecution(root, "sample", load().operation.executionId).nodes["T1.1"]!.status, "completed");
    await finishCurrent(root, call, load().operation.executionId);
    await reviewAndArchive(f);
  });
}

for (const approvalMode of ["governed", "phase", "track", "autonomous"]) for (const requestedMode of ["sequential", "parallel"]) {
  test(`record-only revision cannot promote: ${approvalMode}/${requestedMode}`, async (t) => {
    const {root, call, load} = await fixture(t);
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode, requestedMode});
    const before = read(root, trackPath + "state.json"), record = revisedFiles(root, load())["revisions/revision-2.md"];
    for (const files of [{"revisions/revision-2.md": record}, {"tracks/sample/revisions/revision-2.md": record}]) {
      assert.throws(() => previewCandidateApply(stage(root, "revise", files)), /Revision requires proposed state.json/);
    }
    assert.equal(read(root, trackPath + "state.json"), before);
    assert.equal(existsSync(root + "/" + trackPath + "revisions/revision-2.md"), false);
  });
}

test("cleanup gates reject registered, orphaned, retained-branch and symlink activity, including after preview", async (t) => {
  const f = await fixture(t), {root, call, load} = f;
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode: "parallel"});
  const {worker, scope, id} = await workerDelivery(f, "autonomous");
  const candidate = stage(root, "revise", scopeRevision(f, true));
  assert.throws(() => previewCandidateApply(candidate), /quiescent execution/);
  assert.throws(() => previewCandidateApply(stage(root, "refresh", refreshFiles(root))), /quiescent execution/);
  await call("worktree_cleanup", scope);
  const before = read(root, trackPath + "state.json");
  stage(root, "revise", scopeRevision(f, true));
  const proposal = previewCandidateApply(candidate);
  git(root, "branch", worker.branch);
  assert.throws(() => applyCandidate(candidate, proposal.digest), /quiescent execution/);
  git(root, "branch", "-d", worker.branch);
  mkdirSync(worker.path, {recursive: true});
  assert.throws(() => previewCandidateApply(candidate), /quiescent execution/);
  rmSync(worker.path, {recursive: true});
  mkdirSync(dirname(worker.path), {recursive: true}); symlinkSync(root, worker.path, "dir");
  assert.throws(() => previewCandidateApply(candidate), /symbolic-link|quiescent execution/);
  rmSync(worker.path);
  rmSync(dirname(worker.path), {recursive: true});
  rmSync(dirname(dirname(worker.path)), {recursive: true});
  const journal = readExecution(root, "sample", id);
  assert.throws(() => requireQuiescentExecution(root, {...journal, executionId: "../escape"}), /Unsafe.*identity/);
  assert.throws(() => requireQuiescentExecution(root, {...journal, nodes: {...journal.nodes,
    "T1.1": {...journal.nodes["T1.1"]!, worktreePath: root}}}), /outside its owned track/);
  assert.equal(read(root, trackPath + "state.json"), before);
  commit(root, applyCandidate(candidate, previewCandidateApply(candidate).digest));
  assert.equal(load().revision, 2);
});

test("refresh scope revision rejects incomplete or manually rewritten authority before promotion", async (t) => {
  const f = await fixture(t), {root, call, load} = f;
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode: "sequential"});
  const files = refreshFiles(root, scopeRevision(f, true)), journal = readExecution(root, "sample", load().operation.executionId);
  const before = read(root, trackPath + "state.json"), missing = {...files}; delete missing["tracks/sample/revisions/revision-2.md"];
  assert.throws(() => previewCandidateApply(stage(root, "refresh", missing)), /exactly one.*revision-/);
  assert.throws(() => previewCandidateApply(stage(root, "refresh", {...files,
    ["tracks/sample/" + load().operation.journal]: json({...journal, status: "superseded"})})), /preserve the original execution contract/);
  assert.throws(() => previewCandidateApply(stage(root, "refresh", {...files,
    "tracks/sample/state.json": json({...load(), revision: 2, operation: null})})), /preserve authored operation|preserve existing Autonomous approval policy/);
  assert.equal(read(root, trackPath + "state.json"), before);
});

test("plan-only refresh retains copied spec authority and learning-only revise remains legal", async (t) => {
  const f = await fixture(t), {root, call, load} = f;
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode: "sequential"});
  const original = load(), next = scopeRevision(f, true);
  next["spec.md"] = read(root, trackPath + "spec.md");
  next["plan.md"] = next["plan.md"]!.replace("Spec revision: 2", "Spec revision: 1");
  next["learning.md"] = next["learning.md"]!.replace('"specRevision":2', '"specRevision":1');
  next["dependency-context.json"] = json({...JSON.parse(next["dependency-context.json"]!), specRevision: 1});
  next["revisions/revision-2.md"] = next["revisions/revision-2.md"]!.replace("New spec revision: 2", "New spec revision: 1");
  await promote(f, "refresh", refreshFiles(root, next));
  assert.equal(load().commits.spec, original.commits.spec);
  assert.equal(load().autonomousReview.specCommit, original.autonomousReview.specCommit);
  await call("execution_start", {projectRoot: root, trackId: "sample"});
  await promote(f, "revise", {"learning.md": read(root, trackPath + "learning.md") + "\nReassessed existing guidance.\n"});
  assert.equal(load().revision, 2);
});


test("revision counters must match even when a revision leaves the graph unchanged", async (t) => {
  const {root, load} = await fixture(t), state = load();
  const record = revisedFiles(root, state)["revisions/revision-2.md"];
  const before = read(root, trackPath + "state.json");
  assert.throws(() => previewCandidateApply(stage(root, "revise", {
    "state.json": json({...state, revision: 2}), "revisions/revision-2.md": record
  })), /Revision record must declare New spec revision: 1/);
  assert.throws(() => previewCandidateApply(stage(root, "refresh", refreshFiles(root, {
    "state.json": json({...state, revision: 2})
  }))), /Context-only refresh must preserve the track revision/);
  assert.equal(read(root, trackPath + "state.json"), before);
});

test("multi-track scope refresh approves both revisions atomically and rejects an incomplete cascade", async (t) => {
  const f = await fixture(t), {root, load} = f;
  const files = Object.fromEntries(["spec.md", "plan.md", "learning.md", "dependency-context.json"]
    .map((file) => [file, read(root, trackPath + file)]));
  files["state.json"] = json({...load(), trackId: "other", title: "Other", commits: {}, history: []});
  const track = {projectRoot: root, candidateId: "track-other", workflow: "track" as const, files: Object.keys(files)};
  prepareCandidateStage(root, track.candidateId, track.files);
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/${track.candidateId}/${path}`, body);
  commit(root, applyCandidate(track, previewCandidateApply(track).digest));
  const otherPath = ".cadre/tracks/other/state.json", otherBefore = read(root, otherPath), sampleBefore = read(root, trackPath + "state.json");
  const refresh = refreshFiles(root, revisedFiles(root, load()));
  for (const [path, body] of Object.entries(revisedFiles(root, JSON.parse(otherBefore)))) refresh[`tracks/other/${path}`] = body;
  const incomplete = {...refresh}; delete incomplete["tracks/other/revisions/revision-2.md"];
  assert.throws(() => previewCandidateApply(stage(root, "refresh", incomplete)), /exactly one.*revision-/);
  assert.equal(read(root, otherPath), otherBefore); assert.equal(read(root, trackPath + "state.json"), sampleBefore);
  await promote(f, "refresh", refresh);
  assert.equal(load().revision, 2); assert.equal(JSON.parse(read(root, otherPath)).revision, 2);
  assert.ok(existsSync(root + "/.cadre/tracks/other/revisions/revision-2.md"));
});
