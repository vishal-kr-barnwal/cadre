import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, unlinkSync } from "node:fs";
import { ProposalTokenStore } from "../src/mcp/proposals.js";
import { previewReviewComplete, type ReviewCompleteInput } from "../src/domain/governance.js";
import { promoteOperation } from "../src/domain/operation-receipts.js";
import { validateProject } from "../src/domain/state.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { fixture, finishCurrent, read, write, git, commit, json } from "./helpers/revision-fixture.js";

let boundary = 0;
for (const clientName of ["codex", "claude-code", "zed"]) for (const approvalMode of ["governed", "phase", "track", "autonomous"])
for (const requestedMode of ["sequential", "parallel"]) {
  const crashAt = boundary++ % 4;
  test(`clean review rejects changed product and interrupted drift: ${clientName}/${approvalMode}/${requestedMode}`, async (t) => {
    const {root, call, load} = await fixture(t, clientName);
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode, requestedMode});
    await finishCurrent(root, call, load().operation.executionId);
    const path = ".cadre/tracks/sample/state.json", state = load();
    if (state.autonomousReview) write(root, path, json({...state, autonomousReview: {...state.autonomousReview,
      checkpoint: "awaiting_approval", reviewedExecutionId: state.lastExecution.executionId, reviewedHead: state.lastExecution.headCommit}}));
    const proposal = await call("review_complete", {request: {mode: "prepare", projectRoot: root, trackId: "sample", approval: "Verified fixture review"}});
    const before = read(root, path), product = read(root, "second.txt"), policy = read(root, ".cadre/guidelines.md");
    for (const drift of ["dirty", "staged", "committed", "untracked", "policy"]) {
      const target = drift === "policy" ? ".cadre/guidelines.md" : drift === "untracked" ? "new-product.txt" : "second.txt";
      write(root, target, (drift === "policy" ? policy : product) + "\nUnreviewed change\n");
      if (drift === "staged" || drift === "committed") git(root, "add", target);
      if (drift === "committed") git(root, "commit", "-m", "fixture: concurrent product change");
      await assert.rejects(call("review_complete", {request: {mode: "apply", proposalToken: proposal.proposalToken}}), /Product content changed/);
      assert.equal(read(root, path), before);
      if (drift === "committed") git(root, "revert", "--no-edit", "HEAD");
      else if (drift === "untracked") unlinkSync(root + "/" + target);
      else { write(root, target, drift === "policy" ? policy : product); if (drift === "staged") git(root, "add", target); }
    }
    const approved = new ProposalTokenStore().resolve<ReviewCompleteInput>("review_complete", proposal.proposalToken);
    const preview = previewReviewComplete(approved.input);
    preview.state.reviewCycles!.at(-1)!.approvalConfirmation = {status: "approved", proposalDigest: proposal.digest,
      confirmedAt: new Date().toISOString(), method: "explicit-apply"};
    const operationId = (preview.state.history as Array<{commit: string}>).at(-1)!.commit.slice(3);
    const files = [{path, content: json(preview.state)}, {path: ".cadre/tracks.md", content: preview.tracksContent}];
    const journalPath = `.cadre/stage/operations/${operationId}.json`;
    write(root, "second.txt", product + "Unreviewed\n");
    assert.throws(() => promoteOperation(root, {operationId, kind: "review", approvalDigest: proposal.digest,
      baseCommit: git(root, "rev-parse", "HEAD")}, files), /Product content changed/);
    assert.equal(existsSync(root + "/" + journalPath), false); write(root, "second.txt", product);
    let step = 0;
    assert.throws(() => promoteOperation(root, {operationId, kind: "review", approvalDigest: proposal.digest,
      baseCommit: git(root, "rev-parse", "HEAD")}, files, () => {if (step++ === crashAt) throw Error("fixture crash");}), /fixture crash/);
    const intent = read(root, journalPath), snapshot = files.map((file) => read(root, file.path));
    write(root, "second.txt", product + "Unreviewed during interruption\n");
    await assert.rejects(call("candidate_apply", {request: {mode: "resume", projectRoot: root, operationId, approvalDigest: proposal.digest}}), /Product content changed/);
    assert.equal(read(root, journalPath), intent); assert.deepEqual(files.map((file) => read(root, file.path)), snapshot);
    write(root, "second.txt", product);
    const resumed = await call("candidate_apply", {request: {mode: "resume", projectRoot: root, operationId, approvalDigest: proposal.digest}});
    commit(root, {operationId: resumed.operationId, trailers: resumed.trailers});
    assert.equal(load().status, "completed");
    write(root, "second.txt", product + "Later product change\n");
    assert.equal((await call("review_complete", {request: {mode: "apply", proposalToken: proposal.proposalToken}})).receipt.status, "committed");
    assert.equal(read(root, "second.txt"), product + "Later product change\n"); write(root, "second.txt", product);
    prepareCandidateStage(root, "archive-sample", []);
    const archive = await call("archive_batch_candidate", {request: {mode: "prepare", projectRoot: root, candidateId: "archive-sample", updates: []}});
    commit(root, (await call("archive_batch_candidate", {request: {mode: "apply", proposalToken: archive.proposalToken}})).receipt);
    assert.deepEqual(validateProject(root).errors, []); assert.equal(git(root, "status", "--porcelain"), "");
  });
}
