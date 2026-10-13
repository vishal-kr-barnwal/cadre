import { createHash } from "node:crypto";
import { candidateArtifactPath, normalizeCandidatePath } from "./staging.js";
import { validateTrackOperation, type TrackState } from "./state.js";

/** The only new authored artifact after Git reversal is its exact operation record. */
export function requireRevertApproval(state: TrackState, artifacts: Map<string, string>): string {
  const errors: string[] = [];
  validateTrackOperation(state, "revert approval", errors);
  const operation = state.operation!;
  if (errors.length) throw new Error(errors.join("; "));
  if (!/^[0-9a-f]{64}$/.test(operation.approvalDigest ?? "") || !operation.approvedArtifactHashes?.length) {
    throw new Error("Revert requires the original approval digest and complete approved artifact hashes");
  }
  const snapshot = String(operation.originalExecutionPath ?? "");
  if (!/^reverts\/revert-[a-z0-9-]+-execution-before\.json$/.test(snapshot)) throw new Error("Revert requires its approved original execution snapshot path");
  const parent = `tracks/${state.trackId}`, candidateId = `revert-${state.trackId}`;
  const record = `${parent}/${snapshot.replace(/-execution-before\.json$/, ".json")}`;
  const approved = new Map<string, string>();
  for (const entry of operation.approvedArtifactHashes) {
    if (normalizeCandidatePath(entry.path) !== entry.path) throw new Error("Revert approval paths must be canonical");
    const path = candidateArtifactPath(candidateId, entry.path);
    if (!path.startsWith(`${parent}/`) || approved.has(path)) throw new Error("Revert approval must uniquely own its artifacts");
    approved.set(path, entry.sha256);
  }
  const paths = operation.approvedArtifacts!.map((path) => candidateArtifactPath(candidateId, normalizeCandidatePath(path)));
  if (new Set(paths).size !== paths.length || paths.length !== approved.size || paths.some((path) => !approved.has(path))) {
    throw new Error("Revert requires complete approved artifact hashes for exactly its manifest");
  }
  for (const [path, hash] of approved) {
    const body = artifacts.get(path);
    if (body === undefined || createHash("sha256").update(body).digest("hex") !== hash) {
      throw new Error(`Revert artifact differs from its original approval: ${path}`);
    }
  }
  if ([...artifacts.keys()].some((path) => !approved.has(path) && path !== record)) {
    throw new Error("Revert cannot add artifacts outside its original approval and exact reversal record");
  }
  return record;
}
