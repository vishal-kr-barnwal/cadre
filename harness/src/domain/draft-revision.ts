import { existsSync } from "node:fs";
import { join } from "node:path";
import { isCommitRef } from "./operation-receipts.js";
import { draftSpecificationApproval } from "./draft-approval.js";
import { parsePlanContent, validatePlanGraph } from "./plan.js";
import type { TrackState } from "./state.js";

/** Revise an approved specification without approving its unfinished plan. */
export function deriveDraftRevision(root: string, previous: TrackState, proposed: TrackState,
  artifacts: Map<string, string>, reference: string, read: (path: string) => string, record: string): TrackState {
  const parent = `tracks/${previous.trackId}`;
  if (proposed.status !== "drafting-plan" || !isCommitRef(previous.commits?.spec) || previous.commits?.plan
    || previous.operation || previous.lastExecution || previous.autonomousReview || previous.reviewCycles?.length) {
    throw new Error("Draft specification revision requires drafting-plan with an approved spec, an unapproved plan, and no execution/review binding");
  }
  for (const file of ["spec.md", "plan.md", "learning.md", "dependency-context.json"]) {
    if (!artifacts.has(`${parent}/${file}`)) throw new Error(`Draft specification revision requires reassessed ${file}`);
  }
  const approved = draftSpecificationApproval(root, previous);
  if (artifacts.get(`${parent}/spec.md`) === approved.content) {
    throw new Error("Unchanged specification and draft-plan-only edits must use the track drafting flow");
  }
  let specRevision = 1, planRevision = 0;
  if (existsSync(join(root, ".cadre", parent, "plan.md"))) {
    // The old plan is unapproved; its graph need not be valid, but counters must be known.
    const draft = parsePlanContent(read(`${parent}/plan.md`), `${parent}/plan.md`);
    if (!draft.specRevision || !draft.planRevision) throw new Error("Restore the retained draft revision counters before revising its approved specification");
    if (draft.specRevision !== approved.specRevision) throw new Error("Restore the approved specification revision counter before revising the draft");
    specRevision = approved.specRevision; planRevision = draft.planRevision;
  } else if (previous.revision !== 1) {
    throw new Error("Restore the retained draft revision counters before revising its approved specification");
  }
  const graph = parsePlanContent(artifacts.get(`${parent}/plan.md`)!, `${parent}/plan.md`), errors: string[] = [];
  validatePlanGraph(`${parent}/plan.md`, graph, "drafting-plan", errors);
  if (errors.length) throw new Error(errors.join("; "));
  if (graph.specRevision !== specRevision + 1 || graph.planRevision !== planRevision + 1) {
    throw new Error("Draft specification revision must increment spec and draft-plan counters exactly once");
  }
  for (const [label, value] of [["Previous spec revision", specRevision], ["New spec revision", graph.specRevision],
    ["Previous plan revision", planRevision], ["New plan revision", graph.planRevision]]) {
    if (!record.split(/\r?\n/).includes(`- ${label}: ${value}`)) throw new Error(`Revision record must declare ${label}: ${value}`);
  }
  const state: TrackState = { ...proposed, checkpoint: "drafting-plan", commits: { ...proposed.commits, spec: reference, plan: previous.commits?.plan ?? null } };
  (state.history as Array<Record<string, unknown>>).at(-1)!.previousSpecCommit = previous.commits!.spec;
  return state;
}
