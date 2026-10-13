import { isDeepStrictEqual } from "node:util";
import { requireRevertApproval } from "./revert-approval.js";
import { requireRevertGitProof } from "./revert-git.js";
import { requireUnchangedAutonomousReview } from "./autonomous-review.js";
import { requireQuiescentExecution } from "./execution-quiescence.js";
import type { ExecutionJournal } from "./execution.js";
import type { TrackState } from "./state.js";

/** A reversal approval resets delivery evidence, never the scope or review authority. */
export function deriveRevertCandidate(root: string, previous: TrackState, proposed: TrackState,
  artifacts: Map<string, string>, read: (path: string) => string): TrackState {
  requireUnchangedAutonomousReview(previous.autonomousReview, proposed.autonomousReview, "Revert");
  for (const field of ["revision", "dependencies", "commits", "reviewCycles", "approvalModeMigration"] as const) {
    if (!isDeepStrictEqual(previous[field], proposed[field])) throw new Error(`Revert must preserve authored ${field}`);
  }
  const operation = previous.operation;
  if (operation?.action !== "revert" || !Array.isArray(operation.revertCommits) || !operation.revertCommits.length) {
    throw new Error("Revert promotion requires the persisted approved reversal operation and actual reversal commits");
  }
  const parent = `tracks/${previous.trackId}`, binding = previous.lastExecution;
  if (!binding?.executionId || proposed.status !== "in_progress" || proposed.operation?.action !== "implement"
    || proposed.operation.executionId !== binding.executionId || proposed.operation.journal !== binding.journal
    || proposed.operation.graphDigest !== binding.graphDigest || proposed.operation.planRevision !== binding.planRevision
    || proposed.operation.approvalMode !== binding.approvalMode
    || proposed.operation.approvalPolicyVersion !== binding.approvalPolicyVersion) {
    throw new Error("Revert must restore the retained execution's original implement binding");
  }
  const recordPath = requireRevertApproval(previous, artifacts);
  const journal = JSON.parse(read(`${parent}/${binding.journal}`)) as ExecutionJournal;
  requireQuiescentExecution(root, journal);
  if (!artifacts.has(`${parent}/state.json`) || !artifacts.has(`${parent}/${binding.journal}`)
    || typeof operation.originalExecutionPath !== "string"
    || !/^reverts\/revert-[a-z0-9-]+-execution-before\.json$/.test(operation.originalExecutionPath)
    || artifacts.get(`${parent}/${operation.originalExecutionPath}`) !== read(`${parent}/${binding.journal}`)) {
    throw new Error("Revert requires proposed state/journal and the exact original execution snapshot");
  }
  const receipts = [...artifacts].filter(([path]) => path === recordPath);
  if (!receipts.some(([, body]) => {
    const record = JSON.parse(body) as Record<string, unknown>;
    return record.reconciliationCommit === null
      && Object.entries(operation).every(([key, value]) => isDeepStrictEqual(record[key], value));
  })) throw new Error("Revert requires the exact durable reversal record from its persisted approval");
  requireRevertGitProof(root, operation, journal);
  return { ...proposed, ...(previous.autonomousReview ? {
    autonomousReview: {...previous.autonomousReview,
      checkpoint: previous.autonomousReview.checkpoint === "blocked" ? "blocked" as const : "implementing" as const}
  } : {}) };
}
