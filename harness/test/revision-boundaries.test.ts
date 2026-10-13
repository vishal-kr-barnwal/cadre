import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyCandidate, previewCandidateApply } from "../src/domain/candidate-apply.js";
import { promoteOperation, resumeOperation, receiptHash, type ReceiptFile } from "../src/domain/operation-receipts.js";
import { validateProject } from "../src/domain/state.js";
import { fixture, read, write, json, git, commit, stage, revisedFiles, finishCurrent } from "./helpers/revision-fixture.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";
const parent = ".cadre/tracks/sample/";
function oldIntent(root: string, kind: "revise" | "track", files: ReceiptFile[]) {
  const operationId = `${kind}-older-boundary`, approvalDigest = receiptHash("Explicit synthetic historical approval");
  const receipt = {schemaVersion: 1, operationId, kind, status: "completed", approvalDigest,
    baseCommit: git(root, "rev-parse", "HEAD"), artifacts: files.map((f) => ({path: f.path,
      sha256: f.content === null ? null : receiptHash(f.content)})).sort((a, b) => a.path.localeCompare(b.path))};
  const path = `.cadre/stage/operations/${operationId}.json`;
  write(root, path, json({receipt, files: files.map((f) => ({...f, before: existsSync(join(root, f.path)) ? receiptHash(read(root, f.path)) : null}))}));
  return {operationId, approvalDigest, path};
}
const snapshot = (root: string, files: ReceiptFile[]) => files.map((f) => existsSync(join(root, f.path)) ? read(root, f.path) : null);
for (const clientName of ["codex", "claude-code", "zed"]) test(`revision preview rejects empty checkpoints before canonical corruption: ${clientName}`, async (t) => {
  const {root, call, load} = await fixture(t, clientName), before = read(root, parent + "state.json");
  const record = "# Metadata revision\n- Previous track revision: 1\n- New track revision: 2\n- Previous spec revision: 1\n- New spec revision: 1\n- Previous plan revision: 1\n- New plan revision: 1\n";
  for (const checkpoint of ["", " ", null]) {
    const input = stage(root, "revise", {"state.json": json({...load(), revision: 2, checkpoint}), "revisions/revision-2.md": record});
    await assert.rejects(call("candidate_apply", {request: {mode: "prepare", ...input}}), /state checkpoint is required/);
    assert.equal(read(root, parent + "state.json"), before);
  }
});
for (const probe of ["missing-record", "stale-track-counter", "overwrite-record", "record-counter", "erased-history"] as const)
for (const partial of [false, true]) test(`old revision recovery preserves invalid ${probe}/${partial ? "partial" : "intent"}`, async (t) => {
  const {root, load} = await fixture(t), p = previewCandidateApply(stage(root, "revise", revisedFiles(root, load())));
  let files = p.files.map((f) => ({...f}));
  if (probe === "missing-record") files = files.filter((f) => !f.path.includes("/revisions/"));
  else if (probe === "stale-track-counter") {
    const state = files.find((f) => f.path === parent + "state.json")!; state.content = json({...JSON.parse(state.content!), revision: 1});
  } else if (probe === "overwrite-record") write(root, parent + "revisions/revision-2.md", "# Earlier approved record\n");
  else if (probe === "erased-history") {const state = files.find((f) => f.path === parent + "state.json")!; state.content = json({...JSON.parse(state.content!), history: []});}
  else {const record = files.find((f) => f.path.includes("/revisions/"))!; record.content = record.content!.replace("New spec revision: 2", "New spec revision: 9");}
  const intent = oldIntent(root, "revise", files), beforeIntent = read(root, intent.path);
  if (partial) for (const file of files) if (file.content !== null) write(root, file.path, file.content);
  const before = snapshot(root, files);
  assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /Revision changes require|Preserve existing revision records|Revision record must declare|preserve original history/);
  assert.equal(read(root, intent.path), beforeIntent); assert.deepEqual(snapshot(root, files), before);
});
test("older spec-only revision cannot bypass counters by omitting its state", async (t) => {
  const {root} = await fixture(t), files = [{path: parent + "spec.md", content: read(root, parent + "spec.md") + "\nChanged scope\n"}];
  const intent = oldIntent(root, "revise", files), before = snapshot(root, files);
  assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /requires its proposed state/);
  assert.deepEqual(snapshot(root, files), before);
});
for (const clientName of ["codex", "claude-code", "zed"]) test(`draft counter is approval-bound through dirty drafts and partial recovery: ${clientName}`, async (t) => {
  const f = await fixture(t, clientName), {root, load, call} = f;
  const draft = {...load(), status: "drafting-plan", checkpoint: "drafting-plan", commits: {...load().commits, plan: null}};
  write(root, parent + "state.json", json(draft)); git(root, "add", parent + "state.json"); git(root, "commit", "-m", "fixture: imported approved specification");
  const files = Object.fromEntries(["spec.md", "plan.md", "learning.md", "dependency-context.json", "state.json"].map((p) => [p, read(root, parent + p)]));
  const altered = {...files, "plan.md": files["plan.md"]!.replace("Spec revision: 1", "Spec revision: 9"),
    "learning.md": files["learning.md"]!.replace('"specRevision":1', '"specRevision":9'),
    "dependency-context.json": json({...JSON.parse(files["dependency-context.json"]!), specRevision: 9})};
  // The unapproved on-disk draft is not an authority source for the specification counter.
  write(root, parent + "plan.md", altered["plan.md"]);
  await assert.rejects(call("candidate_apply", {request: {mode: "prepare", ...stage(root, "track", altered)}}), /approved specification revision counter/);
  const input = stage(root, "track", files), p = previewCandidateApply(input);
  assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: "track", approvalDigest: p.digest, baseCommit: p.baseCommit,
    inputs: p.recoveryInputs}, p.files, (path) => {if (path.endsWith("state.json")) throw Error("fixture crash");}), /fixture crash/);
  rmSync(join(root, ".cadre/stage", input.candidateId), {recursive: true});
  commit(root, resumeOperation(root, p.operationId, p.digest)); assert.equal(applyCandidate(input, p.digest).changedCount, 0);
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous"});
  await finishCurrent(root, call, load().operation.executionId); await reviewAndArchive(f); assert.deepEqual(validateProject(root).errors, []);
});
for (const partial of [false, true]) test(`older draft counter recovery rejects changed approval counter/${partial ? "partial" : "intent"}`, async (t) => {
  const {root, load} = await fixture(t);
  write(root, parent + "state.json", json({...load(), status: "drafting-plan", checkpoint: "drafting-plan", commits: {...load().commits, plan: null}}));
  git(root, "add", parent + "state.json"); git(root, "commit", "-m", "fixture: retained imported draft approval");
  const input = stage(root, "track", Object.fromEntries(["spec.md", "plan.md", "learning.md", "dependency-context.json", "state.json"].map((p) => [p, read(root, parent + p)])));
  const files = previewCandidateApply(input).files.map((file) => ({...file}));
  for (const file of files) {
    if (file.path === parent + "plan.md") file.content = file.content!.replace("Spec revision: 1", "Spec revision: 9");
    if (file.path === parent + "learning.md") file.content = file.content!.replace('"specRevision":1', '"specRevision":9');
    if (file.path === parent + "dependency-context.json") file.content = json({...JSON.parse(file.content!), specRevision: 9});
  }
  const intent = oldIntent(root, "track", files), originalIntent = read(root, intent.path);
  if (partial) for (const file of files) write(root, file.path, file.content!);
  const before = snapshot(root, files);
  assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /approved specification revision counter/);
  assert.equal(read(root, intent.path), originalIntent); assert.deepEqual(snapshot(root, files), before);
});
