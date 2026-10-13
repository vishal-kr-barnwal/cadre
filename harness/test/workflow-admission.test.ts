import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyCandidate, previewCandidateApply, type CandidateApplyInput } from "../src/domain/candidate-apply.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { promoteOperation, resumeOperation, receiptHash, type ReceiptFile } from "../src/domain/operation-receipts.js";
import { validateProject } from "../src/domain/state.js";
import { fixture, read, write, json, git, commit, finishCurrent } from "./helpers/revision-fixture.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";
const parent = ".cadre/tracks/sample/";
function candidate(root: string, workflow: CandidateApplyInput["workflow"], files: Record<string, string>, owner = "sample"): CandidateApplyInput {
  const candidateId = `${workflow}-${owner}`;
  prepareCandidateStage(root, candidateId, Object.keys(files));
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/${candidateId}/${path}`, body);
  return {projectRoot: root, workflow, candidateId, files: Object.keys(files)};
}
function trackFiles(root: string, state: unknown): Record<string, string> {
  return {...Object.fromEntries(["spec.md", "plan.md", "learning.md", "dependency-context.json"].map((p) => [p, read(root, parent + p)])), "state.json": json(state)};
}
const refresh = (root: string, extra = {}) => candidate(root, "refresh", {"project.json": read(root, ".cadre/project.json"), "refreshes/refresh-next.md": "# Approved refresh\nRetain context evidence.\n", ...extra});
test("refresh binds an explicitly selected primary record and retains all fresh migration records", async (t) => {
  const {root} = await fixture(t);
  const project = JSON.parse(read(root, ".cadre/project.json"));
  project.lastRefresh = {...project.lastRefresh, refreshPath: "refreshes/z-context.md"};
  const input = candidate(root, "refresh", {"project.json": json(project),
    "refreshes/a-policy.md": "# Approved policy migration\n",
    "refreshes/z-context.md": "# Approved project context\n"});
  const preview = previewCandidateApply(input);
  commit(root, applyCandidate(input, preview.digest));
  const after = JSON.parse(read(root, ".cadre/project.json"));
  assert.equal(after.lastRefresh.refreshPath, "refreshes/z-context.md");
  assert.equal(after.history.at(-1).refreshPath, after.lastRefresh.refreshPath);
  assert.equal(read(root, ".cadre/refreshes/a-policy.md"), "# Approved policy migration\n");
  assert.equal(applyCandidate(input, preview.digest).changedCount, 0);
});
function oldIntent(root: string, kind: "refresh" | "revise" | "track", files: ReceiptFile[]) {
  const operationId = `${kind}-older-routing`, approvalDigest = receiptHash("Exact synthetic older approval");
  const receipt = {schemaVersion: 1, operationId, kind, status: "completed", approvalDigest, baseCommit: git(root, "rev-parse", "HEAD"), artifacts: files.map((f) => ({path: f.path, sha256: f.content === null ? null : receiptHash(f.content)})).sort((a, b) => a.path.localeCompare(b.path))};
  const path = `.cadre/stage/operations/${operationId}.json`;
  write(root, path, json({receipt, files: files.map((f) => ({...f, before: existsSync(join(root, f.path)) ? receiptHash(read(root, f.path)) : null}))}));
  return {operationId, approvalDigest, path};
}
function interrupted(root: string, input: CandidateApplyInput, stop: string) {
  const p = previewCandidateApply(input);
  assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: input.workflow, approvalDigest: p.digest, baseCommit: p.baseCommit, inputs: p.recoveryInputs}, p.files, (path) => {if (path.endsWith(stop)) throw Error("fixture crash");}), /fixture crash/);
  rmSync(join(root, ".cadre/stage", input.candidateId), {recursive: true});
  commit(root, resumeOperation(root, p.operationId, p.digest));
  assert.equal(applyCandidate(input, p.digest).changedCount, 0);
}
for (const approvalMode of ["governed", "phase", "track", "autonomous"]) for (const requestedMode of ["sequential", "parallel"]) test(`fresh refresh record survives partial recovery: ${approvalMode}/${requestedMode}`, async (t) => {
  const f = await fixture(t), {root, call, load} = f;
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode, requestedMode});
  assert.throws(() => previewCandidateApply(candidate(root, "refresh", {"project.json": read(root, ".cadre/project.json")})), /fresh refresh record/);
  assert.throws(() => previewCandidateApply(refresh(root, {"refreshes/refresh-next.md": " "})), /fresh refresh record/);
  interrupted(root, refresh(root), "refresh-next.md");
  const project = JSON.parse(read(root, ".cadre/project.json"));
  assert.equal(project.lastRefresh.refreshPath, "refreshes/refresh-next.md"); assert.equal(project.history.at(-1).refreshPath, project.lastRefresh.refreshPath);
  assert.throws(() => previewCandidateApply(refresh(root)), /Preserve existing refresh records/);
  const fresh = candidate(root, "refresh", {"project.json": read(root, ".cadre/project.json"), "refreshes/refresh-second.md": "# Second approval\n"});
  commit(root, applyCandidate(fresh, previewCandidateApply(fresh).digest));
  await finishCurrent(root, call, load().operation.executionId); await reviewAndArchive(f); assert.deepEqual(validateProject(root).errors, []);
});
for (const clientName of ["codex", "claude-code", "zed"]) test(`revision cannot create a track and planning retains approved draft scope: ${clientName}`, async (t) => {
  const f = await fixture(t, clientName), {root, call, load} = f;
  const state = {...load(), trackId: "draft", title: "Draft", commits: {}, history: []}, files = trackFiles(root, state);
  const nested = Object.fromEntries(Object.entries(files).map(([p, b]) => [`tracks/draft/${p}`, b]));
  await assert.rejects(call("candidate_apply", {request: {mode: "prepare", ...candidate(root, "revise", nested)}}), /existing approved baseline/);
  assert.equal(existsSync(join(root, ".cadre/tracks/draft")), false);
  write(root, ".cadre/tracks/draft/spec.md", files["spec.md"]!); git(root, "add", ".cadre"); git(root, "commit", "-m", "fixture: approved draft specification");
  Object.assign(state, {status: "drafting-plan", checkpoint: "drafting-plan", commits: {spec: git(root, "rev-parse", "HEAD"), plan: null}});
  write(root, ".cadre/tracks/draft/state.json", json(state));
  for (const change of [{"spec.md": files["spec.md"]!.replace("First behavior.", "Replaced behavior.")}, {"state.json": json({...state, revision: 2})}]) {
    assert.throws(() => previewCandidateApply(candidate(root, "track", {...files, "state.json": json(state), ...change}, "draft")), /Planning must preserve/);
  }
  write(root, ".cadre/tracks/draft/spec.md", files["spec.md"]! + "\nUnapproved dirty replacement");
  assert.throws(() => previewCandidateApply(candidate(root, "track", {...files, "spec.md": read(root, ".cadre/tracks/draft/spec.md"), "state.json": json(state)}, "draft")), /committed approved specification/);
  interrupted(root, candidate(root, "track", {...files, "state.json": json(state)}, "draft"), "state.json");
  assert.equal(read(root, ".cadre/tracks/draft/spec.md"), files["spec.md"]);
  await call("execution_start", {projectRoot: root, trackId: "draft", approvalMode: "track"});
  const draft = JSON.parse(read(root, ".cadre/tracks/draft/state.json"));
  await finishCurrent(root, call, draft.operation.executionId, "draft"); await reviewAndArchive(f, "draft");
});
for (const probe of ["missing-record", "overwrite-record", "new-revision", "replace-draft"] as const) for (const partial of [false, true]) test(`older workflow admission recovery ${probe}/${partial ? "partial" : "intent"}`, async (t) => {
  const {root, load} = await fixture(t); let kind: "refresh" | "revise" | "track", files: ReceiptFile[];
  if (probe === "missing-record" || probe === "overwrite-record") {
    kind = "refresh"; const p = previewCandidateApply(refresh(root));
    if (probe === "missing-record") files = p.files.filter((f) => !f.path.endsWith("refresh-next.md"));
    else {write(root, ".cadre/refreshes/refresh-next.md", "# Older approval\n"); files = p.files;}
  } else {
    const state = {...load(), trackId: "draft", commits: {}, history: []};
    if (probe === "replace-draft") {
      kind = "track"; write(root, ".cadre/tracks/draft/spec.md", read(root, parent + "spec.md")); git(root, "add", ".cadre"); git(root, "commit", "-m", "fixture: approved draft spec");
      Object.assign(state, {status: "drafting-plan", checkpoint: "drafting-plan", commits: {spec: git(root, "rev-parse", "HEAD"), plan: null}}); write(root, ".cadre/tracks/draft/state.json", json(state));
      git(root, "add", ".cadre/tracks/draft/state.json"); git(root, "commit", "-m", "fixture: retain original draft state for old recovery");
    } else kind = "revise";
    const staged = trackFiles(root, {...state, status: "planned", checkpoint: "ready"}); staged["spec.md"] += "\nUnauthorized replacement\n";
    files = Object.entries(staged).map(([p, content]) => ({path: `.cadre/tracks/draft/${p}`, content}));
  }
  const intent = oldIntent(root, kind, files), beforeIntent = read(root, intent.path);
  if (partial) for (const file of files) if (file.content !== null) write(root, file.path, file.content);
  const before = files.map((f) => existsSync(join(root, f.path)) ? read(root, f.path) : null);
  assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /fresh refresh record|existing refresh records|existing approved baseline|Planning must preserve/);
  assert.equal(read(root, intent.path), beforeIntent); assert.deepEqual(files.map((f) => existsSync(join(root, f.path)) ? read(root, f.path) : null), before);
});
