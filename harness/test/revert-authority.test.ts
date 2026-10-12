import assert from "node:assert/strict";
import test from "node:test";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { readExecution } from "../src/domain/execution.js";
import { validateProject } from "../src/domain/state.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";
import { fixture, read, write, json, git, commit, finishCurrent } from "./helpers/revision-fixture.js";

for (const clientName of ["codex", "claude-code", "zed"]) for (const requestedMode of ["sequential", "parallel"]) for (const targetKind of ["task", "phase", "track"]) {
  test(`additive revert preserves review authority: ${clientName}/${requestedMode}/${targetKind}`, async (t) => {
    const f = await fixture(t, clientName), {root, call, load} = f;
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode});
    const state = load(), id = state.operation.executionId, base = state.autonomousReview.initialBaseCommit;
    const scope = {projectRoot: root, trackId: "sample", executionId: id};
    await call("execution_checkpoint", {scope: {...scope, nodeId: "P1"}, action: {event: "start"}});
    write(root, "first.txt", "First product\n"); git(root, "add", "first.txt"); git(root, "commit", "-m", "feat: first product");
    const product = git(root, "rev-parse", "HEAD");
    await call("execution_checkpoint", {scope: {...scope, nodeId: "T1.1"}, action: {event: "complete_group", commit: product,
      tasks: [{nodeId: "T1.1", verification: "Checked product", authorization: "Fixture approval", handoff: {
        decisions: [], failedApproaches: [], openQuestions: [], nextAction: "Continue", sources: []}}]}});
    const original = load(), path = original.operation.journal, before = read(root, `.cadre/tracks/sample/${path}`), journal = readExecution(root, "sample", id);
    const reset = structuredClone(journal);
    Object.assign(reset.nodes["T1.1"]!, {status: "pending", workerCommit: null, mergeCommit: null, verification: null, approval: null, blocker: null});
    const targetId = targetKind === "task" ? "T1.1" : targetKind === "phase" ? "P1" : "sample";
    if (targetKind !== "task") reset.nodes.P1!.status = "pending";
    reset.checkpoint = `reverted:${targetId}`;
    const files: Record<string, string> = {"state.json": json(original), [path]: json(reset),
      "reverts/revert-task-execution-before.json": before, "reverts/revert-task.md": "# Approved additive reversal\nTarget T1.1; retain the original journal and scope.\n"};
    const stage = () => {
      prepareCandidateStage(root, "revert-sample", Object.keys(files));
      for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/revert-sample/${path}`, body);
      return {projectRoot: root, candidateId: "revert-sample", workflow: "revert" as const, files: Object.keys(files)};
    };
    assert.throws(() => previewCandidateApply(stage()), /persisted approved reversal/);
    const inspected = await call("candidate_inspect", {projectRoot: root, candidateId: "revert-sample", files: Object.keys(files)});
    const operation = {action: "revert", checkpoint: "approved", targetKind, targetId, baseCommit: product,
      expectedCommit: "cadre(revert): reconcile sample", commits: [product], revertCommits: [] as string[],
      originalExecutionPath: "reverts/revert-task-execution-before.json", approvedArtifacts: Object.keys(files),
      approvedArtifactHashes: inspected.manifest, artifactProgress: [], approvalDigest: inspected.digest, approvedAt: new Date().toISOString()};
    const temporary = {...original, operation, lastExecution: {executionId: id, journal: path, planRevision: journal.planRevision,
      graphDigest: journal.graphDigest, headCommit: journal.headCommit, completedAt: journal.completedAt,
      approvalMode: journal.approvalMode, approvalPolicyVersion: journal.approvalPolicyVersion}};
    write(root, ".cadre/tracks/sample/state.json", json(temporary));
    git(root, "revert", "--no-edit", product); operation.revertCommits.push(git(root, "rev-parse", "HEAD"));
    write(root, ".cadre/tracks/sample/state.json", json({...temporary, operation}));
    files["reverts/revert-task.json"] = json({...operation, reconciliationCommit: null});
    for (const patch of [{initialBaseCommit: product}, {originExecutionId: "replacement"}, {authorizedAt: "2026-10-01T00:00:00Z"},
      {findings: [{id: "forgotten", summary: "Invented replacement", status: "open", attemptExecutionIds: []}]}]) {
      files["state.json"] = json({...original, autonomousReview: {...original.autonomousReview, ...patch}});
      assert.throws(() => previewCandidateApply(stage()), /Revert must preserve authored autonomousReview/);
      assert.equal(load().autonomousReview.initialBaseCommit, base);
    }
    files["state.json"] = json(original);
    if (clientName === "codex" && requestedMode === "sequential" && targetKind === "track") {
      const blocked = {...original.autonomousReview, checkpoint: "blocked", blocker: "Retain external prerequisite"};
      write(root, ".cadre/tracks/sample/state.json", json({...temporary, operation, autonomousReview: blocked}));
      files["state.json"] = json({...original, autonomousReview: blocked});
      const blockedPreview = previewCandidateApply(stage());
      assert.equal(JSON.parse(blockedPreview.files.find((file) => file.path === ".cadre/tracks/sample/state.json")!.content!).autonomousReview.checkpoint, "blocked");
      write(root, ".cadre/tracks/sample/state.json", json({...temporary, operation})); files["state.json"] = json(original);
    }
    const record = files["reverts/revert-task.json"]!;
    files["reverts/revert-task.json"] = json({...operation, revertCommits: [product], reconciliationCommit: null});
    assert.throws(() => previewCandidateApply(stage()), /exact durable reversal record/); files["reverts/revert-task.json"] = record;
    const input = stage(), p = previewCandidateApply(input); commit(root, applyCandidate(input, p.digest));
    assert.equal(load().autonomousReview.initialBaseCommit, base);
    assert.equal(read(root, ".cadre/tracks/sample/reverts/revert-task-execution-before.json"), before);
    await finishCurrent(root, call, id); await reviewAndArchive(f);
    const archived = JSON.parse(read(root, ".cadre/archive/sample/state.json"));
    assert.ok(archived.reviewCycles.at(-1).commitRange.startsWith(base + ".."));
    assert.deepEqual(validateProject(root).errors, []); assert.equal(git(root, "status", "--porcelain"), "");
  });
}
