import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promoteOperation, receiptHash, resumeOperation } from "../src/domain/operation-receipts.js";
import { parsePlanContent } from "../src/domain/plan.js";
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

for (const workflow of ["revise", "refresh"] as const) test(`an approved first specification supports ${workflow} before its draft plan exists`, async (t) => {
  const {root, draftState} = await draftFixture(t); rmSync(root + "/" + parent + "plan.md");
  const files = revisedFiles(root, draftState());
  files["plan.md"] = files["plan.md"].replace("Plan revision: 2", "Plan revision: 1");
  files["learning.md"] = files["learning.md"].replace('"planRevision":2', '"planRevision":1');
  files["dependency-context.json"] = json({...JSON.parse(files["dependency-context.json"]), planRevision: 1});
  files["revisions/revision-2.md"] = files["revisions/revision-2.md"].replace("Previous plan revision: 1", "Previous plan revision: 0").replace("New plan revision: 2", "New plan revision: 1");
  const input = stage(root, workflow, {...nested(files), ...(workflow === "refresh" ? {"project.json": read(root, ".cadre/project.json"),
    "refreshes/refresh-first-draft.md": "# Refresh\nRevise the first specification before drafting its plan.\n"} : {})});
  commit(root, applyCandidate(input, previewCandidateApply(input).digest));
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

for (const workflow of ["revise", "refresh"] as const) test(`draft ${workflow} refuses an unapproved specification counter`, async (t) => {
  const {root, draftState} = await draftFixture(t), files = revisedFiles(root, draftState());
  write(root, parent + "plan.md", read(root, parent + "plan.md").replace("Spec revision: 1", "Spec revision: 9"));
  files["plan.md"] = files["plan.md"].replace("Spec revision: 2", "Spec revision: 10");
  files["learning.md"] = files["learning.md"].replace('"specRevision":2', '"specRevision":10');
  files["dependency-context.json"] = json({...JSON.parse(files["dependency-context.json"]), specRevision: 10});
  files["revisions/revision-2.md"] = files["revisions/revision-2.md"].replace("Previous spec revision: 1", "Previous spec revision: 9").replace("New spec revision: 2", "New spec revision: 10");
  const proposed = {...nested(files), ...(workflow === "refresh" ? {"project.json": read(root, ".cadre/project.json"),
    "refreshes/refresh-counter.md": "# Refresh\nRevise the imported specification.\n"} : {})};
  const before = read(root, parent + "state.json"), draft = read(root, parent + "plan.md");
  assert.throws(() => previewCandidateApply(stage(root, workflow, proposed)), /approved specification revision counter/);
  assert.equal(read(root, parent + "state.json"), before); assert.equal(read(root, parent + "plan.md"), draft);
});

for (const workflow of ["revise", "refresh"] as const) for (const partial of [false, true]) {
  test(`older draft ${workflow} recovery cannot approve its unfinished plan/${partial ? "partial" : "intent"}`, async (t) => {
    const {root, draftState} = await draftFixture(t);
    const input = stage(root, workflow, {...nested(revisedFiles(root, draftState())), ...(workflow === "refresh" ? {
      "project.json": read(root, ".cadre/project.json"), "refreshes/refresh-scope.md": "# Refresh\nChanged draft scope.\n"} : {})});
    const p = previewCandidateApply(input), files = p.files.map((file) => ({...file, before: existsSync(join(root, file.path)) ? receiptHash(read(root, file.path)) : null}));
    const stateFile = files.find((file) => file.path === parent + "state.json")!;
    const next = JSON.parse(stateFile.content!);
    stateFile.content = json({...next, status: "planned", checkpoint: "ready", commits: {...next.commits, plan: `op:${p.operationId}`}});
    const receipt = {schemaVersion: 1, operationId: p.operationId, kind: workflow, status: "completed", approvalDigest: p.digest,
      baseCommit: p.baseCommit, artifacts: files.map((f) => ({path: f.path, sha256: receiptHash(f.content!)})).sort((a, b) => a.path.localeCompare(b.path))};
    const intent = `.cadre/stage/operations/${p.operationId}.json`;
    write(root, intent, json({receipt, files}));
    if (partial) for (const file of files) write(root, file.path, file.content!);
    const before = files.map((file) => existsSync(join(root, file.path)) ? read(root, file.path) : null), originalIntent = read(root, intent);
    assert.throws(() => resumeOperation(root, p.operationId, p.digest), /Draft revision must preserve its unapproved plan/);
    assert.deepEqual(files.map((file) => existsSync(join(root, file.path)) ? read(root, file.path) : null), before);
    assert.equal(read(root, intent), originalIntent);
  });
}

for (const first of ["revise", "refresh"] as const) for (const second of ["revise", "refresh"] as const) {
  test(`repeated draft ${first}/${second} retains approval through interrupted promotion`, async (t) => {
    const {root, draftState} = await draftFixture(t);
    for (const workflow of [first, second]) {
      const state = draftState(), oldPlan = read(root, parent + "plan.md"), graph = parsePlanContent(oldPlan, parent + "plan.md");
      const specRevision = graph.specRevision! + 1, planRevision = graph.planRevision! + 1, revision = state.revision + 1;
      const files = nested({"state.json": json({...state, revision}), "spec.md": read(root, parent + "spec.md") + `\nApproved scope ${revision}.\n`,
        "plan.md": oldPlan.replace(`Spec revision: ${graph.specRevision}`, `Spec revision: ${specRevision}`).replace(`Plan revision: ${graph.planRevision}`, `Plan revision: ${planRevision}`),
        "learning.md": read(root, parent + "learning.md").replace(`"specRevision":${graph.specRevision}`, `"specRevision":${specRevision}`).replace(`"planRevision":${graph.planRevision}`, `"planRevision":${planRevision}`),
        "dependency-context.json": json({...JSON.parse(read(root, parent + "dependency-context.json")), specRevision, planRevision}),
        [`revisions/revision-${revision}.md`]: `# Revision\n- Previous track revision: ${state.revision}\n- New track revision: ${revision}\n- Previous spec revision: ${graph.specRevision}\n- New spec revision: ${specRevision}\n- Previous plan revision: ${graph.planRevision}\n- New plan revision: ${planRevision}\n`});
      const input = stage(root, workflow, {...files, ...(workflow === "refresh" ? {"project.json": read(root, ".cadre/project.json"),
        [`refreshes/refresh-draft-${revision}.md`]: "# Refresh\nApprove changed draft scope.\n"} : {})});
      const p = previewCandidateApply(input);
      assert.throws(() => promoteOperation(root, {operationId: p.operationId, kind: workflow, approvalDigest: p.digest, baseCommit: p.baseCommit,
        inputs: p.recoveryInputs}, p.files, (path) => {if (path === parent + "spec.md") throw Error("fixture crash");}), /fixture crash/);
      rmSync(join(root, ".cadre/stage", input.candidateId), {recursive: true});
      commit(root, resumeOperation(root, p.operationId, p.digest));
      assert.equal(applyCandidate(input, p.digest).changedCount, 0);
      assert.equal(draftState().status, "drafting-plan"); assert.equal(draftState().commits.plan, null);
      assert.equal(draftState().revision, revision); assert.equal(draftState().history.at(-1).previousSpecCommit, state.commits.spec);
      assert.deepEqual(validateProject(root).errors, []);
    }
  });
}
