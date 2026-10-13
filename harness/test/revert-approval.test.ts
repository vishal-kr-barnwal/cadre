import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { promoteOperation, resumeOperation, receiptHash } from "../src/domain/operation-receipts.js";
import { validateProject } from "../src/domain/state.js";
import { readExecution } from "../src/domain/execution.js";
import { revertFixture } from "./helpers/revert-fixture.js";
import { read, write, json, git, commit, finishCurrent } from "./helpers/revision-fixture.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";

for (const clientName of ["codex", "claude-code", "zed"]) for (const mode of ["sequential", "parallel"]) {
  test(`revert preserves its original artifact approval: ${clientName}/${mode}`, async (t) => {
    const f = await revertFixture(t, clientName, mode), {root, files, path, stage} = f;
    const before = read(root, ".cadre/tracks/sample/state.json"), original = files[path]!;
    const drift = JSON.parse(original); drift.nodes["T2.1"].status = "blocked"; drift.nodes["T2.1"].blocker = "Not approved";
    files[path] = json(drift);
    assert.throws(() => previewCandidateApply(stage()), /artifact differs from its original approval/);
    assert.equal(read(root, ".cadre/tracks/sample/state.json"), before); files[path] = original;
    files["learning.md"] = read(root, ".cadre/tracks/sample/learning.md");
    assert.throws(() => previewCandidateApply(stage()), /outside its original approval/); delete files["learning.md"];
    const note = files["reverts/revert-task.md"]!; delete files["reverts/revert-task.md"];
    assert.throws(() => previewCandidateApply(stage()), /artifact differs from its original approval/); files["reverts/revert-task.md"] = note;
    const incomplete = {...f.operation, approvedArtifactHashes: f.operation.approvedArtifactHashes.slice(1)};
    const temporary = JSON.parse(before); temporary.operation = incomplete; write(root, ".cadre/tracks/sample/state.json", json(temporary));
    assert.throws(() => previewCandidateApply(stage()), /complete approved artifact hashes/);
    write(root, ".cadre/tracks/sample/state.json", before);
    const input = stage(), p = previewCandidateApply(input); commit(root, applyCandidate(input, p.digest));
    await finishCurrent(root, f.call, f.id); await reviewAndArchive(f); assert.deepEqual(validateProject(root).errors, []);
  });
  test(`revert rejects unrelated Git commits before promotion: ${clientName}/${mode}`, async (t) => {
    const f = await revertFixture(t, clientName, mode, {empty: true});
    const before = read(f.root, ".cadre/tracks/sample/state.json"), head = git(f.root, "rev-parse", "HEAD"), index = git(f.root, "write-tree");
    assert.throws(() => previewCandidateApply(f.stage()), /Actual reversal does not match/);
    assert.equal(read(f.root, ".cadre/tracks/sample/state.json"), before);
    assert.equal(git(f.root, "rev-parse", "HEAD"), head); assert.equal(git(f.root, "write-tree"), index);
    assert.equal(read(f.root, "first.txt"), "First product\n");
  });
  test(`revert resumes approval proof after state promotion: ${clientName}/${mode}`, async (t) => {
    const f = await revertFixture(t, clientName, mode), input = f.stage(), p = previewCandidateApply(input);
    assert.throws(() => promoteOperation(f.root, {operationId: p.operationId, kind: "revert", approvalDigest: p.digest,
      baseCommit: p.baseCommit, inputs: p.recoveryInputs}, p.files, (path) => {if (path.endsWith("/state.json")) throw Error("fixture crash");}), /fixture crash/);
    rmSync(join(f.root, ".cadre/stage/revert-sample"), {recursive: true}); // Recovery must be self-contained.
    const intentPath = `.cadre/stage/operations/${p.operationId}.json`, intent = read(f.root, intentPath);
    write(f.root, "drift.txt", "Unapproved product change\n");
    assert.throws(() => resumeOperation(f.root, p.operationId, p.digest), /Product content changed/);
    assert.equal(read(f.root, intentPath), intent); rmSync(join(f.root, "drift.txt"));
    commit(f.root, resumeOperation(f.root, p.operationId, p.digest));
    assert.equal(applyCandidate(input, p.digest).changedCount, 0);
    await finishCurrent(f.root, f.call, f.id); await reviewAndArchive(f);
    assert.deepEqual(validateProject(f.root).errors, []); assert.equal(git(f.root, "status", "--porcelain"), "");
  });
}
test("legacy pending revert validates original hashes and retains an upgraded proof", async (t) => {
  const f = await revertFixture(t), p = previewCandidateApply(f.stage());
  const receipt = {schemaVersion: 1, status: "completed", operationId: p.operationId, kind: "revert", approvalDigest: p.digest,
    baseCommit: p.baseCommit, artifacts: p.manifest.slice().sort((a, b) => a.path.localeCompare(b.path))};
  const files = p.files.map((file) => ({...file, before: existsSync(join(f.root, file.path)) ? receiptHash(read(f.root, file.path)) : null}));
  const intent = {receipt, inputs: p.recoveryInputs, files}, path = `.cadre/stage/operations/${p.operationId}.json`;
  const journalFile = files.find((file) => file.path.endsWith(f.path))!, saved = journalFile.content!;
  const drift = JSON.parse(saved); drift.nodes["T2.1"].status = "blocked"; drift.nodes["T2.1"].blocker = "Not approved";
  journalFile.content = json(drift);
  receipt.artifacts.find((item) => item.path === journalFile.path)!.sha256 = receiptHash(journalFile.content);
  write(f.root, path, json(intent)); const invalid = read(f.root, path), before = read(f.root, ".cadre/tracks/sample/state.json");
  assert.throws(() => resumeOperation(f.root, p.operationId, p.digest), /artifact differs from its original approval/);
  assert.equal(read(f.root, path), invalid); assert.equal(read(f.root, ".cadre/tracks/sample/state.json"), before);
  // A separate fixture below exercises valid old intent; never rewrite invalid approval evidence to resume it.
});
test("valid legacy revert intent obtains self-contained proof before writing state", async (t) => {
  const f = await revertFixture(t), p = previewCandidateApply(f.stage());
  assert.throws(() => promoteOperation(f.root, {operationId: p.operationId, kind: "revert", approvalDigest: p.digest,
    baseCommit: p.baseCommit}, p.files, () => {throw Error("fixture crash");}), /fixture crash/);
  const path = `.cadre/stage/operations/${p.operationId}.json`, old = JSON.parse(read(f.root, path)); delete old.revertApproval;
  write(f.root, path, json(old)); // Simulate an older runtime's original valid schema.
  const resumed = resumeOperation(f.root, p.operationId, p.digest);
  assert.ok(JSON.parse(read(f.root, path)).revertApproval); commit(f.root, resumed);
  await finishCurrent(f.root, f.call, f.id); await reviewAndArchive(f);
});
test("approved blocked revert retains its prerequisite", async (t) => {
  const f = await revertFixture(t, "codex", "sequential", {blocked: true}), input = f.stage(), p = previewCandidateApply(input);
  commit(f.root, applyCandidate(input, p.digest)); assert.equal(f.load().autonomousReview.checkpoint, "blocked");
  assert.equal(readExecution(f.root, "sample", f.id).nodes["T1.1"]!.status, "pending");
});
