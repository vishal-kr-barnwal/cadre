import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import { deriveRevertCandidate } from "./revert-candidate.js";
import { readSafeArtifact } from "./memory.js";
import { candidateArtifactPath, listCandidatePaths, readCandidateFiles } from "./staging.js";
import type { TrackState } from "./state.js";

export const revertApprovalProofSchema = z.strictObject({beforeState: z.string().max(1024 * 1024), authoredState: z.string().max(1024 * 1024)});
export type RevertApprovalProof = z.infer<typeof revertApprovalProofSchema>;

/** Keep original authority/bytes in ignored recovery; published receipts stay unchanged. */
export function requireRevertFreshness(root: string, kind: string, operationId: string,
  files: Array<{path: string; content: string | null; before?: string | null}>, saved?: RevertApprovalProof): RevertApprovalProof | undefined {
  if (kind !== "revert") {
    if (saved) throw new Error("Revert recovery proof belongs only to a reversal");
    return;
  }
  const states = files.filter((file) => /^\.cadre\/tracks\/[^/]+\/state\.json$/.test(file.path));
  if (states.length !== 1 || !states[0]?.content) throw new Error("Revert recovery requires exactly one owned state");
  const file = states[0], actual = JSON.parse(file.content!) as TrackState, parent = `tracks/${actual.trackId}`;
  if (file.path !== `.cadre/${parent}/state.json`) throw new Error("Revert recovery state identity mismatch");
  let proof = saved;
  if (!proof) {
    const beforeState = readSafeArtifact(root, file.path), before = JSON.parse(beforeState) as TrackState;
    if (before.operation?.action !== "revert") {
      throw new Error("Legacy partial revert lacks original authority proof; preserve intent and recover the exact approved pre-promotion state before resume");
    }
    const candidateId = `revert-${actual.trackId}`;
    const paths = listCandidatePaths(root, candidateId).filter((path) => candidateArtifactPath(candidateId, path) === `${parent}/state.json`);
    if (paths.length !== 1) throw new Error("Revert recovery needs the exact originally approved staged state");
    proof = {beforeState, authoredState: readCandidateFiles(root, candidateId, paths)[0]!.content};
  }
  proof = revertApprovalProofSchema.parse(proof);
  if (file.before !== undefined && createHash("sha256").update(proof.beforeState).digest("hex") !== file.before) {
    throw new Error("Revert recovery authority differs from the original pre-promotion state hash");
  }
  const previous = JSON.parse(proof.beforeState) as TrackState, authored = JSON.parse(proof.authoredState) as TrackState;
  if (previous.trackId !== actual.trackId || authored.trackId !== actual.trackId) throw new Error("Revert proof must retain the owned track identity");
  const artifacts = new Map<string, string>();
  for (const entry of files) {
    if (entry.path === ".cadre/tracks.md") continue; // Digest-bound runtime index.
    if (!entry.path.startsWith(`.cadre/${parent}/`) || entry.content === null) throw new Error("Revert recovery cannot mutate other tracks or delete artifacts");
    artifacts.set(entry.path.slice(".cadre/".length), entry.content);
  }
  artifacts.set(`${parent}/state.json`, proof.authoredState);
  const snapshot = artifacts.get(`${parent}/${previous.operation?.originalExecutionPath}`);
  if (!snapshot) throw new Error("Revert recovery requires its approved original execution snapshot");
  const next = deriveRevertCandidate(root, previous, authored, artifacts, (path) =>
    path === `${parent}/${previous.lastExecution?.journal}` ? snapshot : readSafeArtifact(root, `.cadre/${path}`));
  next.schemaVersion = 2;
  next.history = [...(Array.isArray(next.history) ? next.history : []), {action: "revert", commit: `op:${operationId}`}];
  if (artifacts.has(`${parent}/dependency-context.json`)) next.commits = {...next.commits, dependencyContext: `op:${operationId}`};
  if (!isDeepStrictEqual(next, actual)) throw new Error("Revert recovery state differs from approved authority and deterministic reconciliation");
  return proof;
}
