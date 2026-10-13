import { isDeepStrictEqual } from "node:util";
import { promotionEvidence, type BeforeEvidence, type PromotionFile } from "./promotion-evidence.js";
import { approvalModeMigrationSchema } from "./approval-policy.js";
import type { TrackState } from "./state.js";
import { requireRevisionPreservation } from "./revision-preservation.js";

/** Refresh authority is narrower than arbitrary edits to an otherwise valid track state. */
export function requireRefreshPreservation(root: string, files: PromotionFile[], saved?: BeforeEvidence[], base?: string | null): BeforeEvidence[] {
  const evidence = promotionEvidence(root, files, saved, base);
  for (const file of files) {
    const match = /^\.cadre\/tracks\/([^/]+)\/state\.json$/.exec(file.path);
    if (!match) continue;
    if (file.content === null) throw new Error("Refresh cannot delete a track");
    const previous = JSON.parse(evidence.read(file.path)) as TrackState, proposed = JSON.parse(file.content) as TrackState;
    const priorHistory = Array.isArray(previous.history) ? previous.history : [];
    const history = Array.isArray(proposed.history) ? proposed.history : [];
    if (history.length !== priorHistory.length + 1 || !isDeepStrictEqual(history.slice(0, -1), priorHistory)
      || history.at(-1)?.action !== "refresh") throw new Error("Refresh must append history while retaining its original track evidence");
    const revised = proposed.revision !== previous.revision;
    if (revised) {
      requireRevisionPreservation(root, previous, proposed, files, evidence.read, "refresh");
      const records = files.filter((item) => item.path.startsWith(`.cadre/tracks/${match[1]}/revisions/`) && item.content !== null);
      if (proposed.revision !== Number(previous.revision) + 1 || records.length !== 1
        || !records[0]!.content!.split(/\r?\n/).includes(`- Previous track revision: ${previous.revision}`)
        || !records[0]!.content!.split(/\r?\n/).includes(`- New track revision: ${proposed.revision}`)
        || ![previous.status, "planned", "in_progress"].includes(proposed.status)) {
        throw new Error("Refresh scope changes require the next approved revision and its retained revision record");
      }
      continue; // The revision derivation and journal guard own scope supersession.
    }
    for (const field of ["trackId", "title", "type", "status", "checkpoint", "dependencies", "artifactProgress", "lastExecution", "reviewCycles"] as const) {
      if (!isDeepStrictEqual(previous[field], proposed[field])) throw new Error(`Context-only refresh must preserve ${field}; use the approved review or revision transition`);
    }
    const reference = history.at(-1)?.commit, expected = {...previous.commits};
    const planPath = file.path.replace(/state\.json$/, "plan.md"), plan = files.find((item) => item.path === planPath);
    if (plan?.content != null && plan.content !== evidence.read(planPath)) expected.plan = reference;
    if (files.some((item) => item.path === file.path.replace(/state\.json$/, "dependency-context.json"))) expected.dependencyContext = reference;
    if (!isDeepStrictEqual(proposed.commits, expected)) throw new Error("Context-only refresh must preserve commit authority except for its derived artifact references");
    if (!isDeepStrictEqual(previous.operation, proposed.operation)) {
      const migration = approvalModeMigrationSchema.safeParse(proposed.approvalModeMigration);
      const operation = previous.operation;
      const allowed = operation?.action === "implement" && operation.approvalMode === "autonomous"
        && (operation.approvalPolicyVersion ?? 1) === 1 && migration.success
        && migration.data.executionId === operation.executionId
        && files.some((item) => item.path === `.cadre/${migration.data.refreshPath}`)
        && isDeepStrictEqual(proposed.operation, {...operation, approvalMode: migration.data.approvalMode, approvalPolicyVersion: 2});
      if (!allowed) throw new Error("Context-only refresh must preserve execution ownership outside explicit legacy migration");
    }
  }
  return evidence.retained();
}
