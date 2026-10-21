import { createHash } from "node:crypto";
import { validateProject } from "../state.js";
import { GitHubClient } from "./transport.js";
import { preflight } from "./publication.js";
import { writeSession } from "./storage.js";
import { digest } from "./model.js";

/** Accept explicitly reviewed conflict reconciliation without rewriting an immutable receipt. */
export function reconcilePublication(client: GitHubClient, evidence: string, approvalDigest?: string) {
  const { operation, identity, session } = preflight(client, { allowPending: true });
  if (!session.pending || evidence.trim().length < 20) throw new Error("Publication reconciliation needs a pending checkpoint and fresh verification evidence");
  const head = client.git("rev-parse", "HEAD"), remote = client.fetch(operation.branch);
  if (client.git("status", "--porcelain") || client.run("git", ["merge-base", "--is-ancestor", remote, head]).status !== 0) {
    throw new Error("Commit explicitly reconciled work containing the collaborator's branch before approving publication recovery");
  }
  const validation = validateProject(client.root);
  if (validation.errors.length) throw new Error(validation.errors.join("; "));
  const expected = Object.fromEntries(session.pending.paths.map((path) => {
    const blob = client.run("git", ["show", `${head}:${path}`]);
    const hash = blob.status === 0 ? createHash("sha256").update(blob.stdout).digest("hex") : null;
    if (path.startsWith(".cadre/receipts/") && hash !== session.pending!.expected?.[path]) {
      throw new Error("Publication recovery cannot replace immutable receipt content");
    }
    return [path, hash];
  }));
  const proposal = { operation: operation.id, head, base: identity.base, remote, before: session.pending, expected, evidence };
  const result = { ...proposal, digest: digest(proposal) };
  if (!approvalDigest) return result;
  if (approvalDigest !== result.digest) throw new Error("Publication reconciliation changed; inspect and approve again");
  writeSession(client.root, { ...session, pending: { ...session.pending, expected } });
  return { reconciled: true, head, publicationRequired: true };
}
