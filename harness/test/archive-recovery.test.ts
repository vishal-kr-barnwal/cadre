import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { ProposalTokenStore } from "../src/mcp/proposals.js";
import { previewArchiveBatchCandidate, type ArchiveBatchCandidateInput } from "../src/domain/governance.js";
import { promoteOperation, type ReceiptFile } from "../src/domain/operation-receipts.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { validateProject } from "../src/domain/state.js";
import { fixture, finishCurrent, read, write, json, git, commit } from "./helpers/revision-fixture.js";

for (const clientName of ["codex", "claude-code", "zed"]) for (const requestedMode of ["sequential", "parallel"])
for (const boundary of ["intent", "partial"]) {
  test(`archive resumes original intent without a second approval: ${clientName}/${requestedMode}/${boundary}`, async (t) => {
    const {root, call, load} = await fixture(t, clientName);
    await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode});
    await finishCurrent(root, call, load().operation.executionId);
    const state = load(); write(root, ".cadre/tracks/sample/state.json", json({...state, autonomousReview: {...state.autonomousReview,
      checkpoint: "awaiting_approval", reviewedExecutionId: state.lastExecution.executionId, reviewedHead: state.lastExecution.headCommit}}));
    const review = await call("review_complete", {request: {mode: "prepare", projectRoot: root, trackId: "sample", approval: "Fixture approved clean review"}});
    commit(root, (await call("review_complete", {request: {mode: "apply", proposalToken: review.proposalToken}})).receipt);
    prepareCandidateStage(root, "archive-sample", []);
    const p = await call("archive_batch_candidate", {request: {mode: "prepare", projectRoot: root, candidateId: "archive-sample", updates: []}});
    const approved = new ProposalTokenStore().resolve<ArchiveBatchCandidateInput>("archive_batch_candidate", p.proposalToken);
    const preview = previewArchiveBatchCandidate(approved.input), files: ReceiptFile[] = [];
    for (const move of preview.moves) {
      const visit = (directory: string) => {
        for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) visit(path);
          else {const pathInTrack = relative(move.sourcePath, path); files.push({path: `.cadre/archive/${move.trackId}/${pathInTrack}`,
            content: pathInTrack === "state.json" ? json(preview.promotion!.states.get(move.trackId)) : readFileSync(path, "utf8")},
            {path: `.cadre/tracks/${move.trackId}/${pathInTrack}`, content: null});}
        }
      }; visit(move.sourcePath);
    }
    for (const update of preview.writes) files.push({path: ".cadre/" + update.path, content: update.content});
    files.push({path: ".cadre/project.json", content: json(preview.promotion!.project)}, {path: ".cadre/tracks.md", content: preview.tracksContent});
    const operationId = preview.promotion!.operationId, crashAt = boundary === "intent" ? 0 : Math.floor(files.length / 2);
    let n = 0;
    assert.throws(() => promoteOperation(root, {operationId, kind: "archive", approvalDigest: p.digest,
      baseCommit: approved.input.baseCommit, inputs: preview.recoveryInputs}, files, () => {if (n++ === crashAt) throw Error("fixture crash");}), /fixture crash/);
    await assert.rejects(call("archive_batch_candidate", {request: {mode: "apply", proposalToken: p.proposalToken}}), /COMMIT_PENDING/);
    const result = await call("candidate_apply", {request: {mode: "resume", projectRoot: root, operationId, approvalDigest: p.digest}});
    commit(root, {operationId: result.operationId, trailers: result.trailers});
    assert.equal((await call("archive_batch_candidate", {request: {mode: "apply", proposalToken: p.proposalToken}})).changedCount, 0);
    assert.equal(git(root, "log", "--format=%H", `--grep=Cadre-Operation: ${operationId}`).split("\n").length, 1);
    assert.equal(JSON.parse(read(root, ".cadre/archive/sample/state.json")).status, "archived");
    assert.deepEqual(validateProject(root).errors, []); assert.equal(git(root, "status", "--porcelain"), "");
  });
}
test("archive guidance routes pending promotion to resume and committed receipt to replay", () => {
  const skill = readFileSync(new URL("../skills/archive/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /mode: "resume", projectRoot, operationId, approvalDigest/);
  assert.match(skill, /zero-change replay after commit\/reconciliation/);
  assert.doesNotMatch(skill, /If interrupted, reuse the same approved apply token/);
});
