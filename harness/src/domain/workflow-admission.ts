import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { promotionEvidence, type BeforeEvidence, type PromotionFile } from "./promotion-evidence.js";
import { isGitAncestor, readGitBlobs, readGitFileAtCommit, resolveGitCommit } from "./git.js";
import { parsePlanContent } from "./plan.js";
import { requireRevisionPreservation } from "./revision-preservation.js";
import type { TrackState } from "./state.js";

/** Workflow routing must survive stage loss and partial promotion. */
export function requireWorkflowAdmission(root: string, kind: "track" | "revise", files: PromotionFile[],
  saved?: BeforeEvidence[], base?: string | null): BeforeEvidence[] {
  const evidence = promotionEvidence(root, files, saved, base);
  for (const file of files) {
    const parent = /^(\.cadre\/tracks\/[^/]+)\//.exec(file.path)?.[1];
    if (parent && !files.some((item) => item.path === `${parent}/state.json`)) throw new Error("Track transition requires its proposed state.json");
  }
  for (const file of files) {
    if (!/^\.cadre\/tracks\/[^/]+\/state\.json$/.test(file.path)) continue;
    if (file.content === null) throw new Error(`${kind} cannot delete a track`);
    const existing = file.before === undefined ? existsSync(join(root, file.path)) : file.before !== null;
    if (!existing) {
      if (kind === "revise") throw new Error("Revision requires an existing approved baseline; create new tracks through track");
      continue;
    }
    const previous = JSON.parse(evidence.read(file.path)) as TrackState;
    if (kind === "revise") {
      if (!["drafting-plan", "planned", "in_progress", "ready_for_review"].includes(previous.status)) {
        throw new Error("Revision requires an existing approved active baseline");
      }
      requireRevisionPreservation(root, previous, JSON.parse(file.content) as TrackState, files, evidence.read);
      continue;
    }
    if (!["drafting-spec", "drafting-plan"].includes(previous.status)) throw new Error("Track already has an approved baseline");
    if (!previous.commits?.spec) continue;
    const proposed = JSON.parse(file.content) as TrackState;
    if (previous.revision !== proposed.revision || !isDeepStrictEqual(previous.dependencies, proposed.dependencies)) {
      throw new Error("Planning must preserve approved specification revision and dependencies; use revise for scope changes");
    }
    const path = file.path.replace(/state\.json$/, "spec.md"), spec = files.find((item) => item.path === path);
    const commit = resolveGitCommit(root, previous.commits.spec);
    if (!isGitAncestor(root, commit)) throw new Error("Restore reachable specification approval before planning");
    if (spec?.content !== readGitFileAtCommit(root, commit, path)) {
      throw new Error("Planning must preserve the committed approved specification; use revise for scope changes");
    }
    const planPath = file.path.replace(/state\.json$/, "plan.md"), plan = files.find((item) => item.path === planPath);
    const request = `${commit}:${planPath}`, approvedPlan = readGitBlobs(root, [request]).get(request);
    const specRevision = approvedPlan ? parsePlanContent(approvedPlan, planPath).specRevision : previous.revision;
    if (!plan?.content || parsePlanContent(plan.content, planPath).specRevision !== specRevision) {
      throw new Error("Planning must preserve the approved specification revision counter; use revise for scope changes");
    }
  }
  return evidence.retained();
}
