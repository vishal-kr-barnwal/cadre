import assert from "node:assert/strict";
import { prepareCandidateStage } from "../../src/domain/staging.js";
import { validateProject } from "../../src/domain/state.js";
import { fixture, json, read, write, commit } from "./revision-fixture.js";

export async function reviewAndArchive({root, call}: Awaited<ReturnType<typeof fixture>>, trackId = "sample") {
  const state = JSON.parse(read(root, `.cadre/tracks/${trackId}/state.json`)), scope = {projectRoot: root, trackId};
  if (state.autonomousReview) write(root, `.cadre/tracks/${trackId}/state.json`, json({...state, autonomousReview: {...state.autonomousReview,
    checkpoint: "awaiting_approval", reviewedExecutionId: state.lastExecution.executionId, reviewedHead: state.lastExecution.headCommit}}));
  const review = await call("review_complete", {request: {mode: "prepare", ...scope, approval: "Explicit fixture approval of verified cumulative review"}});
  commit(root, (await call("review_complete", {request: {mode: "apply", proposalToken: review.proposalToken}})).receipt);
  prepareCandidateStage(root, `archive-${trackId}`, []);
  const archive = await call("archive_batch_candidate", {request: {mode: "prepare", projectRoot: root, candidateId: `archive-${trackId}`, selectedTracks: [trackId], updates: []}});
  commit(root, (await call("archive_batch_candidate", {request: {mode: "apply", proposalToken: archive.proposalToken}})).receipt);
  assert.deepEqual(validateProject(root).errors, []);
}
