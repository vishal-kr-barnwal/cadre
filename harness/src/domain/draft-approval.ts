import { isGitAncestor, readGitBlobs, readGitFileAtCommit, resolveGitCommit } from "./git.js";
import { parsePlanContent } from "./plan.js";
import type { TrackState } from "./state.js";

/** A working draft cannot establish the approved specification's revision. */
export function draftSpecificationApproval(root: string, state: TrackState) {
  if (!state.commits?.spec) throw new Error("Restore specification approval before continuing the draft");
  const commit = resolveGitCommit(root, state.commits.spec);
  if (!isGitAncestor(root, commit)) throw new Error("Restore reachable specification approval before continuing the draft");
  const parent = `.cadre/tracks/${state.trackId}/`, request = `${commit}:${parent}plan.md`;
  const plan = readGitBlobs(root, [request]).get(request);
  const specRevision = plan ? parsePlanContent(plan, parent + "plan.md").specRevision : state.revision;
  if (!Number.isInteger(specRevision) || Number(specRevision) < 1) throw new Error("Restore the approved specification revision counter");
  return {content: readGitFileAtCommit(root, commit, parent + "spec.md"), specRevision: Number(specRevision)};
}
