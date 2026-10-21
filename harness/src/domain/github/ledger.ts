import { z } from "zod/v4";
import { coordinationBranch, ledgerSchema, json, type Ledger, type GitHubOperation } from "./model.js";
import { GitHubClient } from "./transport.js";

const refSchema = z.object({ object: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }) });
const objectSchema = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) });
export interface LedgerSnapshot { head: string; value: Ledger }
export function readLedger(client: GitHubClient): LedgerSnapshot | null {
  const result = client.run("gh", ["api", "--hostname", client.config.hostname,
    `repos/${client.config.repository}/git/ref/heads/${coordinationBranch}`]);
  if (result.status !== 0) {
    if (/\(HTTP 404\)/.test(result.stderr)) return null;
    throw new Error(`Cannot read GitHub coordination: ${result.stderr.slice(0, 1500)}`);
  }
  const head = refSchema.parse(JSON.parse(result.stdout)).object.sha;
  const body = client.file(head, "coordination.json");
  if (!body) throw new Error("GitHub coordination branch is malformed; preserve it for explicit repair");
  return { head, value: ledgerSchema.parse(JSON.parse(body)) };
}

/** One append-only ref serializes overlapping resource acquisition and lease changes.
 * Competing children of the same parent cannot both fast-forward this ref. */
export function writeLedger(client: GitHubClient, previous: LedgerSnapshot | null, value: Ledger): LedgerSnapshot {
  ledgerSchema.parse(value);
  const tree = objectSchema.parse(client.repo("/git/trees", "POST", {
    tree: [{ path: "coordination.json", mode: "100644", type: "blob", content: json(value) }]
  })).sha;
  const commit = objectSchema.parse(client.repo("/git/commits", "POST", {
    message: "cadre: coordinate GitHub operation", tree, parents: previous ? [previous.head] : []
  })).sha;
  try {
    if (previous) client.repo(`/git/refs/heads/${coordinationBranch}`, "PATCH", { sha: commit, force: false });
    else client.repo("/git/refs", "POST", { ref: `refs/heads/${coordinationBranch}`, sha: commit });
  } catch (error) {
    const observed = readLedger(client);
    if (observed?.head === commit) return observed;
    throw new Error(`GitHub coordination changed or publication failed; reread and resume without overwriting: ${String(error)}`);
  }
  return { head: commit, value };
}
export function updateOperation(client: GitHubClient, id: string, change: (operation: GitHubOperation) => void): GitHubOperation {
  const snapshot = readLedger(client);
  if (!snapshot) throw new Error("GitHub coordination is missing");
  const next = structuredClone(snapshot.value);
  const operation = next.operations.find((entry) => entry.id === id);
  if (!operation) throw new Error(`Unknown GitHub operation ${id}`);
  change(operation); writeLedger(client, snapshot, next);
  return operation;
}
export function requireLease(operation: GitHubOperation, token: string, now = Date.now()): void {
  if (operation.lease?.token !== token || operation.lease.expires <= now) {
    throw new Error(`GitHub writer lease unavailable; join/renew ${operation.url ?? operation.branch} before updating state`);
  }
}
