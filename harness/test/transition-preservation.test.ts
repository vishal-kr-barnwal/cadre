import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyCandidate, previewCandidateApply, type CandidateApplyInput } from "../src/domain/candidate-apply.js";
import { promoteOperation, resumeOperation, receiptHash, type ReceiptFile } from "../src/domain/operation-receipts.js";
import { readExecution } from "../src/domain/execution.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { validateProject } from "../src/domain/state.js";
import { fixture, read, write, json, git, commit, finishCurrent, originalPlan, revisedFiles } from "./helpers/revision-fixture.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";

const parent = ".cadre/tracks/sample/";
function candidate(root: string, workflow: CandidateApplyInput["workflow"], files: Record<string, string>): CandidateApplyInput {
  const candidateId = `${workflow}-sample`;
  prepareCandidateStage(root, candidateId, Object.keys(files));
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/${candidateId}/${path}`, body);
  return {projectRoot: root, candidateId, workflow, files: Object.keys(files)};
}
function reviewFiles(root: string, state: ReturnType<Awaited<ReturnType<typeof fixture>>["load"]>): Record<string, string> {
  const cycle = state.reviewCycles.length + 1, priorPlan = read(root, parent + "plan.md");
  const files: Record<string, string> = {
    "plan.md": priorPlan.replace("Plan revision: 1", "Plan revision: 2") + "\n## Phase 3: Remediate\n- Phase dependencies: P2\n- [ ] T3.1 Fix verified finding\n  - Task dependencies: none\n  - Commit group: fix\n- [ ] T3.2 User Manual Verification\n- Phase completion commit: pending\n## Phase 4: Track-level User Manual Verification\n- [ ] T4.1 User Manual Verification\n- Phase completion commit: pending\n",
    "learning.md": read(root, parent + "learning.md").replace('"planRevision":1', '"planRevision":2'),
    "dependency-context.json": json({...JSON.parse(read(root, parent + "dependency-context.json")), planRevision: 2}),
    [`bugs/review-${cycle}.md`]: "# Finding\nVerified in-scope defect.\n"
  };
  if (state.autonomousReview) files[`reviews/loop-${cycle}.json`] = json({...state.autonomousReview, checkpoint: "remediating",
    reviewedExecutionId: state.lastExecution.executionId, reviewedHead: state.lastExecution.headCommit,
    findings: [{id: "verified-defect", summary: "In-scope defect", status: "open", attemptExecutionIds: []}]});
  else files["state.json"] = json({...state, status: "in_progress", checkpoint: "ready", reviewCycles: [...state.reviewCycles, {
    cycle, outcome: "changes_requested", executionId: state.lastExecution.executionId, planRevision: state.lastExecution.planRevision,
    graphDigest: state.lastExecution.graphDigest, reviewedHead: state.lastExecution.headCommit, approval: "Explicit fixture approval"
  }]});
  return files;
}
function oldIntent(root: string, kind: "review" | "refresh", files: ReceiptFile[]) {
  const operationId = `${kind}-legacy-unsafe`, approvalDigest = receiptHash("Synthetic approval recorded by an older runtime");
  const original = files.map((file) => ({...file, before: existsSync(join(root, file.path)) ? receiptHash(read(root, file.path)) : null}));
  const receipt = {schemaVersion: 1, operationId, kind, status: "completed", approvalDigest, baseCommit: git(root, "rev-parse", "HEAD"),
    artifacts: files.map((file) => ({path: file.path, sha256: file.content === null ? null : receiptHash(file.content)})).sort((a, b) => a.path.localeCompare(b.path))};
  const path = `.cadre/stage/operations/${operationId}.json`;
  write(root, path, json({receipt, files: original}));
  return {operationId, approvalDigest, path};
}

for (const approvalMode of ["governed", "phase", "track", "autonomous"]) for (const requestedMode of ["sequential", "parallel"]) {
  test(`review preservation and interrupted recovery: ${approvalMode}/${requestedMode}`, async (t) => {
    const f = await fixture(t), {root, call, load} = f;
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode, requestedMode});
    const id = load().operation.executionId; await finishCurrent(root, call, id);
    const original = readExecution(root, "sample", id), files = reviewFiles(root, load());
    if (files["state.json"]) {
      const state = JSON.parse(files["state.json"]);
      for (const change of [{dependencies: ["invented"]}, {lastExecution: null}, {reviewCycles: []}, {revision: state.revision + 1}]) {
        assert.throws(() => previewCandidateApply(candidate(root, "review", {...files, "state.json": json({...state, ...change})})));
      }
    }
    for (const badPlan of [originalPlan.replace("Plan revision: 1", "Plan revision: 2"),
      files["plan.md"]!.replace("First behavior", "Replaced completed behavior"),
      files["plan.md"]!.replace("Spec revision: 1", "Spec revision: 2"),
      files["plan.md"]!.replace("Plan revision: 2", "Plan revision: 3")]) {
      assert.throws(() => previewCandidateApply(candidate(root, "review", {...files, "plan.md": badPlan})), /append remediation|preserve every completed|dependency context|revisions/i);
    }
    const input = candidate(root, "review", files), p = previewCandidateApply(input);
    assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: "review", approvalDigest: p.digest,
      baseCommit: p.baseCommit, inputs: p.recoveryInputs}, p.files, (path) => {if (path.endsWith("/state.json")) throw Error("crash");}), /crash/);
    const intent = JSON.parse(read(root, `.cadre/stage/operations/${p.operationId}.json`));
    assert.equal(intent.transitionBefore.length, 2);
    if (approvalMode === "autonomous") {
      // Previous builds retained dirty review authority separately; reuse that exact proof.
      delete intent.transitionBefore;
      write(root, `.cadre/stage/operations/${p.operationId}.json`, json(intent));
    }
    rmSync(join(root, ".cadre/stage/review-sample"), {recursive: true});
    commit(root, resumeOperation(root, p.operationId, p.digest));
    await call("execution_start", {projectRoot: root, trackId: "sample"}); const next = load().operation.executionId;
    for (const [key, node] of Object.entries(original.nodes)) assert.deepEqual(readExecution(root, "sample", next).nodes[key], node);
    await finishCurrent(root, call, next);
    if (load().autonomousReview) {const state = load(); state.autonomousReview.findings[0].status = "resolved"; write(root, parent + "state.json", json(state));}
    await reviewAndArchive(f); assert.deepEqual(validateProject(root).errors, []);
  });
}

for (const partial of [false, true]) test(`older unsafe ordinary review cannot resume (${partial ? "partial" : "intent"})`, async (t) => {
  const f = await fixture(t), {root, call, load} = f;
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "track"}); await finishCurrent(root, call, load().operation.executionId);
  const p = previewCandidateApply(candidate(root, "review", reviewFiles(root, load())));
  const files = p.files.map((file) => file.path.endsWith("/plan.md") ? {...file, content: originalPlan.replace("Plan revision: 1", "Plan revision: 2")} : file);
  const intent = oldIntent(root, "review", files), before = read(root, intent.path);
  if (partial) for (const file of files.filter((file) => /\/(?:state\.json|plan\.md)$/.test(file.path))) write(root, file.path, file.content!);
  const snapshot = files.map((file) => existsSync(join(root, file.path)) ? read(root, file.path) : null);
  assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /append remediation/);
  assert.equal(read(root, intent.path), before);
  assert.deepEqual(files.map((file) => existsSync(join(root, file.path)) ? read(root, file.path) : null), snapshot);
});

for (const approvalMode of ["governed", "phase", "track", "autonomous"]) {
  test(`refresh protects completed journal and resumes unchanged copy: ${approvalMode}`, async (t) => {
    const f = await fixture(t), {root, call, load} = f;
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode}); await finishCurrent(root, call, load().operation.executionId);
    const state = load(), path = `tracks/sample/${state.lastExecution.journal}`, before = read(root, `.cadre/${path}`), journal = JSON.parse(before);
    const files = {"project.json": read(root, ".cadre/project.json"), "refreshes/refresh-preserve.md": "# Refresh\nRetain evidence.\n", [path]: before};
    for (const field of ["verification", "approval", "handoff", "workerCommit", "status"]) {
      const changed = structuredClone(journal); changed.nodes["T1.1"][field] = field === "handoff" ? {decisions: ["invented"]} : "rewritten";
      assert.throws(() => previewCandidateApply(candidate(root, "refresh", {...files, [path]: json(changed)})), /preserve historical/);
    }
    assert.throws(() => previewCandidateApply(candidate(root, "refresh", {...files, "tracks/sample/executions/execution-invented.json": before})), /missing|Missing|ENOENT/);
    const input = candidate(root, "refresh", files), p = previewCandidateApply(input);
    assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: "refresh", approvalDigest: p.digest,
      baseCommit: p.baseCommit, inputs: p.recoveryInputs}, p.files, (written) => {if (written.endsWith("/state.json")) throw Error("crash");}), /crash/);
    rmSync(join(root, ".cadre/stage/refresh-sample"), {recursive: true});
    commit(root, resumeOperation(root, p.operationId, p.digest)); assert.equal(read(root, `.cadre/${path}`), before);
    await reviewAndArchive(f);
  });
}

for (const partial of [false, true]) test(`older unsafe refresh cannot resume (${partial ? "partial" : "intent"})`, async (t) => {
  const {root, call, load} = await fixture(t);
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "track"}); await finishCurrent(root, call, load().operation.executionId);
  const state = load(), path = parent + state.lastExecution.journal, journal = JSON.parse(read(root, path));
  journal.nodes["T1.1"].verification = "forged";
  const files = [{path, content: json(journal)}, {path: parent + "state.json", content: json(state)}];
  const intent = oldIntent(root, "refresh", files), before = read(root, intent.path);
  if (partial) write(root, path, json(journal));
  const original = read(root, path);
  assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /preserve historical/);
  assert.equal(read(root, intent.path), before); assert.equal(read(root, path), original);
});

test("refresh protects superseded journals and forbids modern mode rewrites", async (t) => {
  const {root, call, load} = await fixture(t);
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "track"});
  const original = load(), path = `tracks/sample/${original.operation.journal}`, before = read(root, `.cadre/${path}`);
  const files = {"project.json": read(root, ".cadre/project.json"), "refreshes/refresh-policy.md": "# Refresh\nPreserve modern authority.\n",
    "tracks/sample/state.json": json({...original, operation: {...original.operation, approvalMode: "phase"}}),
    [path]: json({...JSON.parse(before), approvalMode: "phase"})};
  assert.throws(() => previewCandidateApply(candidate(root, "refresh", files)), /explicit supported legacy migration/);
  const revision = candidate(root, "revise", revisedFiles(root, original)); commit(root, applyCandidate(revision, previewCandidateApply(revision).digest));
  const superseded = read(root, `.cadre/${path}`), journal = JSON.parse(superseded);
  assert.equal(journal.status, "superseded");
  assert.throws(() => previewCandidateApply(candidate(root, "refresh", {"project.json": read(root, ".cadre/project.json"),
    "refreshes/refresh-evidence.md": "# Preserve superseded evidence\n", [path]: json({...journal, checkpoint: "invented"})})), /preserve historical/);
});
