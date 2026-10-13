import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readSafeArtifact } from "./memory.js";
import { parsePlanContent } from "./plan.js";
import type { TrackState } from "./state.js";
import type { PromotionFile } from "./promotion-evidence.js";
import { draftSpecificationApproval } from "./draft-approval.js";

/** Pending revisions retain the same record/counter contract as fresh approvals. */
export function requireRevisionPreservation(root: string, previous: TrackState, proposed: TrackState,
  files: PromotionFile[], original: (path: string) => string, action: "revise" | "refresh" = "revise"): void {
  const priorHistory = Array.isArray(previous.history) ? previous.history : [];
  const history = Array.isArray(proposed.history) ? proposed.history : [];
  if (history.length !== priorHistory.length + 1 || !isDeepStrictEqual(history.slice(0, -1), priorHistory)
    || history.at(-1)?.action !== action) throw new Error("Revision must preserve original history and append its approval");
  const parent = `.cadre/tracks/${previous.trackId}/`;
  const before = (path: string): string | null => {
    const file = files.find((item) => item.path === path);
    if (file) return file.before === null || file.before === undefined && !existsSync(join(root, path)) ? null : original(path);
    return existsSync(join(root, path)) ? readSafeArtifact(root, path) : null;
  };
  const spec = files.find((file) => file.path === parent + "spec.md");
  const plan = files.find((file) => file.path === parent + "plan.md");
  const records = files.filter((file) => file.path.startsWith(parent + "revisions/"));
  const priorPlan = before(parent + "plan.md"), nextPlan = plan ? plan.content : priorPlan;
  const oldGraph = priorPlan === null ? null : parsePlanContent(priorPlan, parent + "plan.md");
  const graph = nextPlan === null ? null : parsePlanContent(nextPlan, parent + "plan.md");
  const specChanged = spec !== undefined && spec.content !== before(spec.path);
  const graphChanged = graph?.digest !== oldGraph?.digest;
  const changed = specChanged || graphChanged || !isDeepStrictEqual(previous.dependencies, proposed.dependencies);
  if (!changed && proposed.revision === previous.revision && !records.length) return;
  if (previous.status === "drafting-plan") {
    if (previous.commits?.plan || proposed.status !== "drafting-plan" || proposed.checkpoint !== "drafting-plan"
      || proposed.commits?.plan || proposed.operation || proposed.lastExecution || proposed.autonomousReview || proposed.reviewCycles?.length
      || history.at(-1)?.previousSpecCommit !== previous.commits?.spec || proposed.commits?.spec !== history.at(-1)?.commit) {
      throw new Error("Draft revision must preserve its unapproved plan and specification approval evidence");
    }
    const approved = draftSpecificationApproval(root, previous);
    if (oldGraph && oldGraph.specRevision !== approved.specRevision || graph?.specRevision !== approved.specRevision + 1) {
      throw new Error("Draft revision must retain the approved specification revision counter");
    }
    if (!spec?.content || spec.content === approved.content
      || ["plan.md", "learning.md", "dependency-context.json"].some((path) => !files.some((file) => file.path === parent + path && file.content !== null))) {
      throw new Error("Draft revision requires a changed approved specification and reassessed draft artifacts");
    }
  }
  if (proposed.revision !== Number(previous.revision) + 1 || records.length !== 1 || !records[0]!.content?.trim()) {
    throw new Error("Revision changes require the next track revision and one fresh revision record; retain intent for approved repair");
  }
  const record = records[0]!;
  if (record.before === undefined ? existsSync(join(root, record.path)) : record.before !== null) {
    throw new Error("Preserve existing revision records; retain intent for approved repair with a fresh record");
  }
  const oldSpec = oldGraph?.specRevision ?? 1, oldPlan = oldGraph?.planRevision ?? 0;
  if (!graph || (specChanged && graph.specRevision !== oldSpec + 1)
    || (graphChanged && (graph.planRevision !== oldPlan + 1
      || ![oldSpec, oldSpec + (spec ? 1 : 0)].includes(graph.specRevision!)))) {
    throw new Error("Revision changes require synchronized spec and plan counters; retain intent for approved repair");
  }
  for (const [label, value] of [["Previous track revision", previous.revision], ["New track revision", proposed.revision],
    ["Previous spec revision", oldSpec], ["New spec revision", graph.specRevision],
    ["Previous plan revision", oldPlan], ["New plan revision", graph.planRevision]]) {
    if (!record.content!.split(/\r?\n/).includes(`- ${label}: ${value}`)) throw new Error(`Revision record must declare ${label}: ${value}`);
  }
}
