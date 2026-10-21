import { GitHubClient } from "./transport.js";
import { digest } from "./model.js";
import { readLedger, writeLedger } from "./ledger.js";
import { requireIndependentApproval, requireProtection, requireSuccessfulChecks } from "./policy.js";
import { inspectHead, validateLocalEvidence } from "./validation.js";

/** Accept only a reviewed, independently approved, merged reconciliation PR.
 * This is an additive adoption record, never a fabricated historical approval. */
export function recover(client: GitHubClient, prNumber: number, approvalDigest?: string) {
  const identity = client.identity(), snapshot = readLedger(client);
  if (!snapshot?.value.incident) throw new Error("No GitHub incident needs reconciliation");
  if (snapshot.value.active) requireProtection(client, identity.defaultBranch);
  const operation = snapshot.value.operations.find((entry) => entry.pr === prNumber && entry.workflow === "reconcile");
  if (!operation?.review || operation.review.source !== "revalidation") throw new Error("Reconciliation needs an explicitly approved fresh review");
  const pr = client.pr(prNumber);
  if (!pr.merged || pr.merge_commit_sha !== identity.base || pr.head.sha !== operation.review.head || operation.published !== pr.head.sha) {
    throw new Error("Reconciliation must be the current default merge with unchanged reviewed/published head");
  }
  client.fetch(identity.defaultBranch);
  const parents = client.git("show", "-s", "--format=%P", identity.base).split(" ");
  if (parents.length !== 2 || parents[0] !== operation.review.base || parents[1] !== pr.head.sha) throw new Error("Reconciliation merge does not preserve reviewed history");
  requireIndependentApproval(client, prNumber, pr.head.sha);
  requireSuccessfulChecks(client, pr.head.sha, snapshot.value.active);
  inspectHead(client, pr.head.sha, (checkout) => validateLocalEvidence(checkout, operation, operation.review!.base));
  const proposal = { pr: prNumber, from: snapshot.value.audited, to: identity.base, incident: snapshot.value.incident,
    evidence: operation.review.evidence, tracks: operation.tracks, ledgerHead: snapshot.head };
  const result = { ...proposal, digest: digest(proposal) };
  if (!approvalDigest) return result;
  if (approvalDigest !== result.digest) throw new Error("Reconciliation proposal changed; inspect again");
  const next = structuredClone(snapshot.value);
  next.audited = identity.base; next.incident = null;
  for (const entry of next.operations) {
    if (!entry.pr || !["open", "reserved"].includes(entry.state)) continue;
    if (entry.id === operation.id) { entry.state = "merged"; entry.lease = null; continue; }
    if (!entry.tracks.every((id) => operation.tracks.includes(id))) continue;
    const prior = client.pr(entry.pr);
    if (prior.merged && prior.merge_commit_sha && client.run("git", ["merge-base", "--is-ancestor", prior.merge_commit_sha, identity.base]).status === 0) {
      entry.state = "merged"; entry.lease = null; entry.recoveredBy = operation.id;
    }
  }
  writeLedger(client, snapshot, next);
  return { recovered: true, pr: prNumber, audited: identity.base };
}
