import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { promoteOperation, resumeOperation } from "../src/domain/operation-receipts.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { contentHash } from "../src/domain/memory.js";
import { dependencySources } from "../src/domain/dependency-context.js";
import { validateProject } from "../src/domain/state.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";
import { fixture, json, read, write, git, commit, stage, revisedFiles, finishCurrent } from "./helpers/revision-fixture.js";

const patternPath = ".cadre/patterns/evidence.md", pattern = "# Evidence\nPreserve original authorization.\n";
function seed(root: string) {
  write(root, patternPath, pattern);
  write(root, ".cadre/tracks/sample/learning.md", read(root, ".cadre/tracks/sample/learning.md")
    .replace('"patterns":[]', `"patterns":[{"path":"patterns/evidence.md","sha256":"${contentHash(pattern)}"}]`)
    .replace("No applicable patterns.", "Apply patterns/evidence.md to preserve authorization."));
  git(root, "add", ".cadre"); git(root, "commit", "-m", "fixture: approved applicable pattern");
}
const snapshot = (root: string, paths: string[]) => paths.map((path) => [path, existsSync(root + "/" + path) ? read(root, path) : null]);

let caseIndex = 0;
for (const clientName of ["codex", "claude-code", "zed"]) for (const approvalMode of ["governed", "phase", "track", "autonomous"])
for (const requestedMode of ["sequential", "parallel"]) {
  const boundary = caseIndex++ % 4;
  test(`recovery guards approval inputs and completes: ${clientName}/${approvalMode}/${requestedMode}`, async (t) => {
    const f = await fixture(t, clientName), {root, call, load} = f;
    seed(root);
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode, requestedMode});
    const input = stage(root, "revise", revisedFiles(root, load())), p = previewCandidateApply(input);
    assert.ok(p.recoveryInputs.some((entry) => entry.path === patternPath && entry.sha256 === contentHash(pattern)));
    const crashAt = [0, 1, p.files.length, p.files.length + 1][boundary]!, paths = p.files.map((file) => file.path);
    let step = 0;
    assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: "revise", approvalDigest: p.digest,
      baseCommit: p.baseCommit, inputs: p.recoveryInputs}, p.files, () => {if (step++ === crashAt) throw new Error("fixture crash");}), /fixture crash/);
    const journalPath = `.cadre/stage/operations/${p.operationId}.json`, beforeJournal = read(root, journalPath), before = snapshot(root, paths);
    write(root, patternPath, pattern + "\nDifferent constraints from another session.\n");
    await assert.rejects(call("candidate_apply", {request: {mode: "resume", projectRoot: root, operationId: p.operationId, approvalDigest: p.digest}}), /OPERATION_INPUT_DRIFT/);
    assert.equal(read(root, journalPath), beforeJournal); assert.deepEqual(snapshot(root, paths), before);
    // Deliberate fixture restoration, never an automatic overwrite of the unrelated change.
    write(root, patternPath, pattern);
    const resumed = resumeOperation(root, p.operationId, p.digest); commit(root, resumed);
    assert.equal(load().revision, 2); assert.deepEqual(validateProject(root).errors, []);
    const beforeReplay = git(root, "rev-parse", "HEAD"); write(root, patternPath, pattern + "\nLater guidance.\n");
    assert.equal(applyCandidate(input, p.digest).changedCount, 0); assert.equal(git(root, "rev-parse", "HEAD"), beforeReplay);
    write(root, patternPath, pattern);
    await call("execution_start", {projectRoot: root, trackId: "sample"});
    assert.equal(load().operation.approvalMode, approvalMode);
    await finishCurrent(root, call, load().operation.executionId); await reviewAndArchive(f);
    assert.equal(git(root, "status", "--porcelain"), "");
  });
}

test("older pending receipts retain their identity and enforce recorded pattern fingerprints", async (t) => {
  const {root, load} = await fixture(t); seed(root);
  const input = stage(root, "revise", revisedFiles(root, load())), p = previewCandidateApply(input);
  assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: "revise", approvalDigest: p.digest, baseCommit: p.baseCommit}, p.files, () => {throw Error("legacy crash");}), /legacy crash/);
  const path = `.cadre/stage/operations/${p.operationId}.json`, legacy = JSON.parse(read(root, path));
  // The older serialized contract predates recovery inputs; no published receipt is edited.
  delete legacy.inputs; write(root, path, json(legacy)); const original = read(root, path);
  write(root, patternPath, pattern + "\nChanged input.\n");
  assert.throws(() => resumeOperation(root, p.operationId, p.digest), /Required inputs changed after approval/);
  assert.equal(read(root, path), original);
  write(root, patternPath, pattern); const result = resumeOperation(root, p.operationId, p.digest);
  assert.equal(JSON.parse(read(root, `.cadre/receipts/${p.operationId}.json`)).inputs, undefined);
  commit(root, result); assert.equal(applyCandidate(input, p.digest).operationId, p.operationId);
});

test("dependency drift blocks recovery without writes while unrelated product edits remain intact", async (t) => {
  const {root, load} = await fixture(t);
  const files = Object.fromEntries(["spec.md", "plan.md", "learning.md", "dependency-context.json"].map((path) => [path, read(root, ".cadre/tracks/sample/" + path)]));
  files["state.json"] = json({...load(), trackId: "other", title: "Other", commits: {}, history: []});
  const track = {projectRoot: root, candidateId: "track-other", workflow: "track" as const, files: Object.keys(files)};
  prepareCandidateStage(root, track.candidateId, track.files);
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/${track.candidateId}/${path}`, body);
  commit(root, applyCandidate(track, previewCandidateApply(track).digest));
  const proposed = revisedFiles(root, load()), sources = dependencySources(root, ["other"]);
  proposed["state.json"] = json({...load(), revision: 2, dependencies: ["other"]});
  proposed["dependency-context.json"] = json({schemaVersion: 1, specRevision: 2, planRevision: 2, dependencies: ["other"], ...sources,
    constraints: sources.sources.map((source, i) => ({id: `source-${i}`, text: "Preserve inherited evidence", sources: [source.path]}))});
  const input = stage(root, "revise", proposed), p = previewCandidateApply(input);
  assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: "revise", approvalDigest: p.digest, baseCommit: p.baseCommit,
    inputs: p.recoveryInputs}, p.files, () => {throw Error("fixture crash");}), /fixture crash/);
  const before = snapshot(root, p.files.map((file) => file.path));
  for (const source of sources.sources) {
    const original = read(root, source.path); write(root, source.path, original + "\nChanged inherited requirement.\n");
    assert.throws(() => resumeOperation(root, p.operationId, p.digest), /Required inputs changed after approval/);
    assert.deepEqual(snapshot(root, p.files.map((file) => file.path)), before); write(root, source.path, original);
  }
  write(root, "unrelated.txt", "Preserve unrelated dirty product edit\n");
  commit(root, resumeOperation(root, p.operationId, p.digest));
  assert.equal(read(root, "unrelated.txt"), "Preserve unrelated dirty product edit\n"); assert.deepEqual(validateProject(root).errors, []);
});

test("recovery rejects missing and unsafe approval inputs before promotion", async (t) => {
  const {root} = await fixture(t), operationId = "revise-input-safety", file = {path: ".cadre/safety.md", content: "Approved"};
  for (const path of [".cadre/../escape", ".cadre/missing.md"]) {
    assert.throws(() => promoteOperation(root, {operationId, kind: "revise", approvalDigest: "a".repeat(64), baseCommit: git(root, "rev-parse", "HEAD"),
      inputs: [{path, sha256: "b".repeat(64)}]}, [file]), /Unsafe|Required inputs changed/);
    assert.equal(existsSync(root + "/.cadre/safety.md"), false);
    assert.equal(existsSync(root + `/.cadre/stage/operations/${operationId}.json`), false);
  }
});
