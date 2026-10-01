import { archiveOperationId } from "./archive-promotion.js";
import { join } from "node:path";
import { committedReceiptForApproval } from "./operation-receipts.js";
import { safeProjectRoot } from "./paths.js";
import { validateProject } from "./state.js";
import type { ArchiveBatchCandidateInput } from "./governance.js";

export function archiveReceiptPath(input: Pick<ArchiveBatchCandidateInput, "projectRoot" | "batchId">): string {
  const id = archiveOperationId(input.batchId);
  return join(safeProjectRoot(input.projectRoot), ".cadre/receipts", `${id}.json`);
}

/** A committed archive retry must not re-read removed stages or select completed tracks again. */
export function replayCommittedArchive(input: ArchiveBatchCandidateInput, approvalDigest: string) {
  const root = safeProjectRoot(input.projectRoot);
  const id = archiveOperationId(input.batchId);
  const receipt = committedReceiptForApproval(root, id, "archive", approvalDigest, input.baseCommit);
  if (!receipt) return null;
  const validation = validateProject(root);
  return {
    operationPath: archiveReceiptPath(input), operation: { checkpoint: "completed" }, receipt,
    moves: input.selectedTracks.map((trackId) => ({ trackId, targetPath: join(root, ".cadre/archive", trackId) })),
    writes: [], tracksPath: join(root, ".cadre/tracks.md"),
    valid: validation.errors.length === 0,
    derivedStateCurrent: !validation.warnings.some((warning) => warning.startsWith("TRACKS_INDEX_STALE:"))
  };
}
