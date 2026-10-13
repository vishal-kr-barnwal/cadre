import { createHash } from "node:crypto";
import { operationRef } from "./operation-receipts.js";
import { candidateStateChanges, type CandidateStateChange } from "./candidate-state-changes.js";
import type { ProjectState, TrackState } from "./state.js";

export const archiveOperationId = (batchId: string) => `archive-${createHash("sha256").update(JSON.stringify(batchId)).digest("hex").slice(0, 32)}`;

/** The preview and promotion share exactly the same deterministic archive metadata. */
export function deriveArchivePromotion(project: ProjectState, batchId: string, selectedTracks: string[], moves: Array<{ trackId: string; state: TrackState }>) {
  const operationId = archiveOperationId(batchId), reference = operationRef(operationId);
  return {
    operationId,
    project: { ...project, schemaVersion: 2, history: [...(project.history ?? []), { action: "archive", selectedTracks, commit: reference }] },
    states: new Map(moves.map((move) => [move.trackId, {
      ...move.state, schemaVersion: 2, checkpoint: "archived",
      history: [...(Array.isArray(move.state.history) ? move.state.history : []), { action: "archive", commit: reference }]
    }]))
  };
}

export interface ArchiveStateChanges {
  sourcePath: string;
  path: string;
  sha256: string;
  changes: CandidateStateChange[];
}

export function explainArchiveState(sourcePath: string, path: string, before: Record<string, unknown>, after: Record<string, unknown>): ArchiveStateChanges {
  return { sourcePath, path, sha256: createHash("sha256").update(`${JSON.stringify(after, null, 2)}\n`).digest("hex"), changes: candidateStateChanges(before, after) };
}
