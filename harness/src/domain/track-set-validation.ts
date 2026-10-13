import type { TrackState } from "./state.js";

export interface LocatedTrack { location: string; state: TrackState }

/** Canonical validation and proposed overlays share the same cross-track rules. */
export function validateTrackSet(tracks: LocatedTrack[], errors: string[]): void {
  const byId = new Map<string, LocatedTrack>();
  for (const track of tracks) {
    const {state, location} = track, id = state.trackId;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? "")) { errors.push(`${location}: invalid trackId`); continue; }
    const existing = byId.get(id);
    if (existing) { errors.push(`${id}: duplicate track state under ${existing.location} and ${location}`); continue; }
    byId.set(id, track);
    const expected = `${state.status === "archived" ? "archive" : "tracks"}/${id}`;
    if (location !== expected) errors.push(`${id}: status ${state.status} requires location ${expected}`);
    if (!Array.isArray(state.dependencies) || state.dependencies.some((dependency) => typeof dependency !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dependency)) || new Set(state.dependencies).size !== state.dependencies.length) {
      errors.push(`${id}: dependencies must be unique track IDs`);
    }
    if (["completed", "archived"].includes(state.status)) {
      const review = state.reviewCycles?.at(-1), execution = state.lastExecution;
      if (review?.outcome !== "clean") errors.push(`${id}: ${state.status} track lacks a final clean review cycle`);
      else if (!execution || review.executionId !== execution.executionId || review.planRevision !== execution.planRevision
        || review.graphDigest !== execution.graphDigest || review.reviewedHead !== execution.headCommit) {
        errors.push(`${id}: final clean review is not bound to the current completed execution`);
      }
    }
  }
  const dependencies = (state: TrackState): string[] => Array.isArray(state.dependencies) ? state.dependencies.filter((id) => typeof id === "string") : [];
  for (const {state} of tracks) for (const dependency of dependencies(state)) {
    if (!byId.has(dependency)) errors.push(`${state.trackId}: unknown dependency ${dependency}`);
    if (dependency === state.trackId) errors.push(`${state.trackId}: track cannot depend on itself`);
    const status = byId.get(dependency)?.state.status;
    if (["in_progress", "ready_for_review", "completed", "archived"].includes(state.status)
      && status && !["completed", "archived"].includes(status)) errors.push(`${state.trackId}: ${state.status} track has incomplete dependency ${dependency}`);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (visiting.has(id)) { errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`); return; }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies(byId.get(id)!.state)) visit(dependency, [...trail, id]);
    visiting.delete(id); visited.add(id);
  };
  for (const id of byId.keys()) visit(id, []);
}
