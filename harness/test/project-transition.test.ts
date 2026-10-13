import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { previewCandidateApply, applyCandidate, type CandidateApplyInput } from "../src/domain/candidate-apply.js";
import { promoteOperation, resumeOperation, receiptHash, type ReceiptFile } from "../src/domain/operation-receipts.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { validateProject } from "../src/domain/state.js";
import { dependencySources } from "../src/domain/dependency-context.js";
import { fixture, read, write, json, git, commit, finishCurrent } from "./helpers/revision-fixture.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";

const parent = ".cadre/tracks/sample/";
function stage(root: string, workflow: CandidateApplyInput["workflow"], files: Record<string, string>, owner = "sample"): CandidateApplyInput {
  const candidateId = `${workflow}-${owner}`;
  prepareCandidateStage(root, candidateId, Object.keys(files));
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/${candidateId}/${path}`, body);
  return {projectRoot: root, workflow, candidateId, files: Object.keys(files)};
}
const trackFiles = (root: string) => Object.fromEntries(["state.json", "spec.md", "plan.md", "learning.md", "dependency-context.json"].map((path) => [path, read(root, parent + path)]));
const refresh = (root: string, state: unknown, extra = {}) => stage(root, "refresh", {
  "project.json": read(root, ".cadre/project.json"), "refreshes/refresh-context.md": "# Refresh\nExact fixture approval.\n",
  "tracks/sample/state.json": json(state), ...extra
});
function legacyIntent(root: string, kind: "refresh" | "track", files: ReceiptFile[]) {
  const operationId = `${kind}-older-pending`, approvalDigest = receiptHash("Exact synthetic approval recorded by an older runtime");
  const receipt = {schemaVersion: 1, operationId, kind, status: "completed", approvalDigest, baseCommit: git(root, "rev-parse", "HEAD"),
    artifacts: files.map((file) => ({path: file.path, sha256: file.content === null ? null : receiptHash(file.content)})).sort((a, b) => a.path.localeCompare(b.path))};
  const path = `.cadre/stage/operations/${operationId}.json`;
  write(root, path, json({receipt, files: files.map((file) => ({...file, before: existsSync(join(root, file.path)) ? receiptHash(read(root, file.path)) : null}))}));
  return {path, operationId, approvalDigest};
}

for (const approvalMode of ["governed", "phase", "track", "autonomous"]) for (const requestedMode of ["sequential", "parallel"]) {
  test(`refresh lifecycle invariant and valid recovery: ${approvalMode}/${requestedMode}`, async (t) => {
    const f = await fixture(t), {root, call, load} = f;
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode, requestedMode});
    await finishCurrent(root, call, load().operation.executionId);
    const before = read(root, parent + "state.json"), state = load();
    for (const status of ["completed", "archived", "planned", "in_progress"]) {
      assert.throws(() => previewCandidateApply(refresh(root, {...state, status, checkpoint: status})), /preserve status|terminal track|archived|completed autonomous/);
      assert.equal(read(root, parent + "state.json"), before);
    }
    assert.throws(() => previewCandidateApply(refresh(root, {...state, commits: {...state.commits, spec: git(root, "rev-parse", "HEAD")}})), /preserve authored commit/);
    const input = refresh(root, state), p = previewCandidateApply(input);
    assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: "refresh", approvalDigest: p.digest, baseCommit: p.baseCommit,
      inputs: p.recoveryInputs}, p.files, (path) => {if (path.endsWith("/state.json")) throw Error("fixture interruption");}), /fixture interruption/);
    rmSync(join(root, ".cadre/stage", input.candidateId), {recursive: true});
    commit(root, resumeOperation(root, p.operationId, p.digest));
    assert.equal(load().status, state.status); assert.deepEqual(load().lastExecution, state.lastExecution);
    await reviewAndArchive(f);
  });
}

test("archived identity is reserved while a distinct successor remains legal", async (t) => {
  const f = await fixture(t), {root, call, load} = f, files = trackFiles(root);
  files["state.json"] = json({...JSON.parse(files["state.json"]!), commits: {}, history: []});
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "track"});
  await finishCurrent(root, call, load().operation.executionId); await reviewAndArchive(f);
  const before = read(root, ".cadre/archive/sample/state.json");
  assert.throws(() => previewCandidateApply(stage(root, "track", files)), /duplicate track state/);
  assert.equal(existsSync(join(root, parent)), false); assert.equal(read(root, ".cadre/archive/sample/state.json"), before);
  files["state.json"] = json({...JSON.parse(files["state.json"]!), trackId: "successor"});
  const input = stage(root, "track", files, "successor"); commit(root, applyCandidate(input, previewCandidateApply(input).digest));
  assert.deepEqual(validateProject(root).errors, []);
});

for (const running of [false, true]) test(`dependency edits require revision and whole-project readiness (${running ? "active" : "planned"})`, async (t) => {
  const {root, call, load} = await fixture(t), files = trackFiles(root);
  files["state.json"] = json({...JSON.parse(files["state.json"]!), trackId: "other", commits: {}, history: []});
  const other = stage(root, "track", files, "other"); commit(root, applyCandidate(other, previewCandidateApply(other).digest));
  if (running) await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "track"});
  const before = load(), sources = dependencySources(root, ["other"]);
  const context = {schemaVersion: 1, specRevision: 1, planRevision: 1, dependencies: ["other"], ...sources,
    constraints: sources.sources.map((source, index) => ({id: `assessment-${index}`, text: "No additional constraints apply in this fixture.", sources: [source.path]}))};
  const extra = {"tracks/sample/dependency-context.json": json(context)};
  assert.throws(() => previewCandidateApply(refresh(root, {...before, dependencies: ["other"]}, extra)), /Revision must increment/);
  const revision = refresh(root, {...before, revision: 2, dependencies: ["other"]}, {...extra,
    "tracks/sample/revisions/revision-2.md": "# Revision\n- Previous track revision: 1\n- New track revision: 2\n- Previous spec revision: 1\n- New spec revision: 1\n- Previous plan revision: 1\n- New plan revision: 1\n## Change\nAdd the dependency.\n"});
  if (running) assert.throws(() => previewCandidateApply(revision), /incomplete dependency other/);
  else {commit(root, applyCandidate(revision, previewCandidateApply(revision).digest)); assert.equal(load().revision, 2); assert.deepEqual(validateProject(root).errors, []);}
});

for (const kind of ["refresh", "track"] as const) for (const partial of [false, true]) test(`unsafe older ${kind} intent cannot resume (${partial ? "partial" : "intent"})`, async (t) => {
  const f = await fixture(t), {root, call, load} = f, initial = trackFiles(root);
  initial["state.json"] = json({...JSON.parse(initial["state.json"]!), commits: {}, history: []});
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "track"}); await finishCurrent(root, call, load().operation.executionId);
  let files: ReceiptFile[];
  if (kind === "track") {await reviewAndArchive(f); files = Object.entries(initial).map(([path, content]) => ({path: parent + path, content}));}
  else files = [{path: parent + "state.json", content: json({...load(), status: "completed", checkpoint: "completed"})}];
  const intent = legacyIntent(root, kind, files), original = read(root, intent.path);
  if (partial) for (const file of files) write(root, file.path, file.content!);
  const snapshot = files.map((file) => existsSync(join(root, file.path)) ? read(root, file.path) : null);
  assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /duplicate track state|lacks a final clean review/);
  assert.equal(read(root, intent.path), original);
  assert.deepEqual(files.map((file) => existsSync(join(root, file.path)) ? read(root, file.path) : null), snapshot);
});

for (const field of ["context", "ignore"]) {
  test(`refresh rejects invalid project ${field} before mutation`, async (t) => {
    const {root, load} = await fixture(t), before = read(root, ".cadre/project.json"), ignore = read(root, ".cadre/.gitignore");
    const project = JSON.parse(before);
    if (field === "context") project.project.context = "unsupported";
    const input = refresh(root, load(), {"project.json": json(project), ...(field === "ignore" ? {".gitignore": "/stage/\n"} : {})});
    assert.throws(() => previewCandidateApply(input), /project context|must ignore/);
    assert.equal(read(root, ".cadre/project.json"), before); assert.equal(read(root, ".cadre/.gitignore"), ignore);
  });
  for (const partial of [false, true]) test(`older invalid project ${field} recovery preserves intent (${partial ? "partial" : "intent"})`, async (t) => {
    const {root} = await fixture(t), project = JSON.parse(read(root, ".cadre/project.json"));
    project.project.context = "unsupported";
    const files = field === "context" ? [{path: ".cadre/project.json", content: json(project)}]
      : [{path: ".cadre/.gitignore", content: "/stage/\n"}];
    const intent = legacyIntent(root, "refresh", files), before = read(root, intent.path);
    if (partial) for (const file of files) write(root, file.path, file.content);
    const current = files.map((file) => read(root, file.path));
    assert.throws(() => resumeOperation(root, intent.operationId, intent.approvalDigest), /project context|must ignore/);
    assert.equal(read(root, intent.path), before); assert.deepEqual(files.map((file) => read(root, file.path)), current);
  });
}
