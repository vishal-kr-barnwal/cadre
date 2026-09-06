import { z } from "zod/v4";
import { CadreError } from "./errors.js";
import { contentHash, readSafeArtifact } from "./memory.js";
import type { PlanGraph } from "./plan.js";
import type { DiscoveredTrack, TrackState } from "./state.js";
import { readExecution } from "./execution.js";

export const lifecycleSchema = z.enum(["drafting-spec", "drafting-plan", "planned", "in_progress", "ready_for_review", "completed", "archived"]);
export const listingSchema = z.strictObject({ total: z.number().int(), returned: z.number().int(), complete: z.boolean(), nextCursor: z.string().nullable() });
const cursorSchema = z.strictObject({ digest: z.string().regex(/^[0-9a-f]{64}$/), offset: z.number().int().nonnegative() });
export function pageTracks(tracks: DiscoveredTrack[], options: { statuses?: string[] | undefined; limit: number; cursor?: string | undefined }) {
  const selected = tracks.filter((track) => !options.statuses?.length || options.statuses.includes(track.status)).sort((a, b) => a.id.localeCompare(b.id));
  const digest = contentHash(JSON.stringify({ statuses: options.statuses ?? [], selected }));
  const cursor = options.cursor ? cursorSchema.parse(JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"))) : { digest, offset: 0 };
  if (cursor.digest !== digest) throw new CadreError("STATUS_SNAPSHOT_CHANGED", "Track listing changed; restart without a cursor.");
  if (cursor.offset > selected.length) throw new Error("invalid listing cursor");
  const page = selected.slice(cursor.offset, cursor.offset + options.limit), offset = cursor.offset + page.length;
  return { tracks: page, listing: { total: selected.length, returned: page.length, complete: offset === selected.length,
    nextCursor: offset === selected.length ? null : Buffer.from(JSON.stringify({ digest, offset })).toString("base64url") } };
}

export function summarizeTrackState(state: TrackState | undefined) {
  if (!state) return null;
  const operation = state.operation;
  return { trackId: state.trackId, status: state.status, revision: state.revision ?? 1, checkpoint: state.checkpoint ?? null,
    operation: operation ? { action: operation.action ?? null, checkpoint: operation.checkpoint ?? null,
      executionId: operation.executionId ?? null, expectedCommit: operation.expectedCommit ?? null,
      baseCommit: operation.baseCommit ?? null, approvalMode: operation.approvalMode ?? null } : null,
    lastExecution: state.lastExecution ?? null, commits: state.commits ?? null,
    historyCount: Array.isArray(state.history) ? state.history.length : 0, reviewCycleCount: state.reviewCycles?.length ?? 0 };
}
export function summarizeGraph(graph: PlanGraph) {
  return { digest: graph.digest, specRevision: graph.specRevision, planRevision: graph.planRevision,
    phaseCount: graph.phases.length, taskCount: graph.phases.reduce((count, phase) => count + phase.tasks.length, 0) };
}
export function trackSources(projectRoot: string, location: string) {
  return ["state.json", "spec.md", "plan.md", "learning.md"].flatMap((file) => {
    const path = `.cadre/${location}/${file}`;
    try { return [{ path, sha256: contentHash(readSafeArtifact(projectRoot, path)) }]; }
    catch { return []; } // Full validation separately reports missing or invalid artifacts.
  });
}

export function fullProjectTracks(root: string, tracks: DiscoveredTrack[], states: Map<string, TrackState>, plans: Map<string, PlanGraph>) {
  return tracks.map((track) => {
    const state = states.get(track.id), executionId = state?.operation?.executionId ?? state?.lastExecution?.executionId;
    let execution = null, executionError = null;
    if (typeof executionId === "string") {
      try { execution = readExecution(root, track.id, executionId); }
      catch (error) { executionError = String(error); }
    }
    return { trackId: track.id, state: state ?? null, graph: plans.get(track.id) ?? null, execution, executionError,
      sources: trackSources(root, track.location) };
  });
}
