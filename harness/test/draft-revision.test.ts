import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { previewCandidateApply, applyCandidate } from "../src/domain/candidate-apply.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { validateProject } from "../src/domain/state.js";
import { fixture, json, read, write, git, commit, stage, revisedFiles, finishCurrent } from "./helpers/revision-fixture.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";

const parent = ".cadre/tracks/draft/";
async function draftFixture(t: Parameters<typeof fixture>[0], schemaVersion = 1, clientName = "codex") {
  const f = await fixture(t, clientName), {root, load} = f;
  write(root, parent + "spec.md", read(root, ".cadre/tracks/sample/spec.md"));
  git(root, "add", parent + "spec.md"); git(root, "commit", "-m", "cadre(track): approve imported draft specification");
  const specCommit = git(root, "rev-parse", "HEAD"), state = {...load(), schemaVersion, trackId: "draft", title: "Imported draft", status: "drafting-plan",
    checkpoint: "drafting-plan", commits: {spec: specCommit, plan: null}, history: [{action: "specify", commit: specCommit}]};
  write(root, parent + "state.json", json(state));
  for (const file of ["plan.md", "learning.md", "dependency-context.json"]) write(root, parent + file, read(root, ".cadre/tracks/sample/" + file));
  git(root, "add", ".cadre/tracks/draft"); git(root, "commit", "-m", "fixture: retain unapproved legacy draft plan");
  const files = {"project.json": read(root, ".cadre/project.json"), "refreshes/refresh-draft.md": "# Refresh\nPreserve imported draft approval.\n",
    "tracks/draft/state.json": json(state), "tracks/draft/dependency-context.json": read(root, parent + "dependency-context.json")};
  const input = stage(root, "refresh", files); commit(root, applyCandidate(input, previewCandidateApply(input).digest));
  assert.deepEqual(validateProject(root).errors, []);
  return {...f, specCommit, draftState: () => JSON.parse(read(root, parent + "state.json"))};
}
const nested = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, body]) => [`tracks/draft/${path}`, body]));

for (const clientName of ["codex", "claude-code", "zed"]) for (const schemaVersion of [1, 2]) {
  test(`imported draft revises its spec then plans and completes: ${clientName}/schema-${schemaVersion}`, async (t) => {
    const f = await draftFixture(t, schemaVersion, clientName), {root, call, draftState, specCommit} = f;
    const files = revisedFiles(root, draftState()), input = stage(root, "revise", nested(files));
    const p = previewCandidateApply(input); commit(root, applyCandidate(input, p.digest));
    const state = draftState();
    assert.equal(state.status, "drafting-plan"); assert.equal(state.revision, 2); assert.equal(state.commits.plan, null);
    assert.equal(state.history.at(-1).previousSpecCommit, specCommit); assert.equal(state.commits.spec, `op:${p.operationId}`);
    assert.equal(applyCandidate(input, p.digest).changedCount, 0);
    const planningFiles = Object.fromEntries(["spec.md", "plan.md", "learning.md", "dependency-context.json", "state.json"].map((file) => [file, read(root, parent + file)]));
    const track = {projectRoot: root, candidateId: "track-draft", workflow: "track" as const, files: Object.keys(planningFiles)};
    prepareCandidateStage(root, track.candidateId, track.files);
    for (const [path, body] of Object.entries(planningFiles)) write(root, `.cadre/stage/${track.candidateId}/${path}`, body);
    commit(root, applyCandidate(track, previewCandidateApply(track).digest)); assert.equal(draftState().status, "planned");
    await call("execution_start", {projectRoot: root, trackId: "draft", approvalMode: "autonomous", requestedMode: schemaVersion === 1 ? "sequential" : "parallel"});
    await finishCurrent(root, call, draftState().operation.executionId, "draft"); await reviewAndArchive(f, "draft");
    assert.deepEqual(validateProject(root).errors, []); assert.equal(git(root, "status", "--porcelain"), "");
  });
}

test("draft revision keeps authority unapproved and rejects plan-only edits or stale counters", async (t) => {
  const {root, draftState} = await draftFixture(t), state = draftState(), files = revisedFiles(root, state), before = read(root, parent + "state.json");
  for (const [change, error] of [
    [{"state.json": json({...state, revision: 2, status: "planned"})}, /requires drafting-plan/],
    [{"spec.md": read(root, parent + "spec.md")}, /draft-plan-only edits/],
    [{"plan.md": files["plan.md"].replace("Plan revision: 2", "Plan revision: 3")}, /increment spec and draft-plan counters/]
  ] as const) assert.throws(() => previewCandidateApply(stage(root, "revise", nested({...files, ...change}))), error);
  assert.equal(read(root, parent + "state.json"), before);
});

test("an approved first specification can be revised before its draft plan exists", async (t) => {
  const {root, draftState} = await draftFixture(t); rmSync(root + "/" + parent + "plan.md");
  const files = revisedFiles(root, draftState());
  files["plan.md"] = files["plan.md"].replace("Plan revision: 2", "Plan revision: 1");
  files["learning.md"] = files["learning.md"].replace('"planRevision":2', '"planRevision":1');
  files["dependency-context.json"] = json({...JSON.parse(files["dependency-context.json"]), planRevision: 1});
  files["revisions/revision-2.md"] = files["revisions/revision-2.md"].replace("Previous plan revision: 1", "Previous plan revision: 0").replace("New plan revision: 2", "New plan revision: 1");
  const input = stage(root, "revise", nested(files)); commit(root, applyCandidate(input, previewCandidateApply(input).digest));
  assert.equal(draftState().status, "drafting-plan"); assert.equal(draftState().commits.plan, null); assert.deepEqual(validateProject(root).errors, []);
});


test("draft specification approval uses the committed baseline even when requested edits are already on disk", async (t) => {
  const {root, draftState} = await draftFixture(t), files = revisedFiles(root, draftState());
  write(root, parent + "spec.md", files["spec.md"]);
  const input = stage(root, "revise", nested(files)); commit(root, applyCandidate(input, previewCandidateApply(input).digest));
  assert.equal(draftState().revision, 2); assert.equal(draftState().commits.plan, null);
  assert.deepEqual(validateProject(root).errors, []);
});

test("draft revision refuses an unreachable specification approval before mutation", async (t) => {
  const {root, draftState} = await draftFixture(t), state = {...draftState(), commits: {...draftState().commits, spec: "f".repeat(40)}};
  write(root, parent + "state.json", json(state)); const before = read(root, parent + "state.json");
  assert.throws(() => previewCandidateApply(stage(root, "revise", nested(revisedFiles(root, state)))), /Git commit is not reachable/);
  assert.equal(read(root, parent + "state.json"), before);
});
