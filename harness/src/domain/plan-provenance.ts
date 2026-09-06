import { readGitBlobs } from "./git.js";
import { parsePlanContent } from "./plan.js";

export interface PlanEvidence { owner: string; commit: string; path: string; planRevision: number; graphDigest: string }
export function validatePlanProvenance(root: string, evidence: PlanEvidence[]): string[] {
  const requests = evidence.map((entry) => `${entry.commit}:${entry.path}`);
  const files = readGitBlobs(root, [...new Set(requests)]);
  return evidence.flatMap((entry, index) => {
    const body = files.get(requests[index]!);
    if (body == null) return [`${entry.owner}: plan commit ${entry.commit} does not contain ${entry.path}`];
    const graph = parsePlanContent(body, entry.path);
    return graph.planRevision === entry.planRevision && graph.digest === entry.graphDigest ? []
      : [`${entry.owner}: plan commit ${entry.commit} does not match approved plan revision/graph; record the revision artifact commit before delivery`];
  });
}
