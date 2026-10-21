import { readConfig, readSession } from "./storage.js";
import { GitHubClient } from "./transport.js";
import { markPending, preflight, publish } from "./publication.js";
import { requireDelivered } from "./policy.js";

/** No gh invocation or network access unless this project explicitly opted in. */
export function githubClient(root: string): GitHubClient | null {
  const config = readConfig(root);
  return config ? new GitHubClient(root, config) : null;
}
export function requireGitHubMutation(root: string, workflow: string, tracks: string[] = [], phase = false, allowPending = false): void {
  const client = githubClient(root);
  if (!client) return;
  const { operation } = preflight(client, { tracks, phase, allowPending, execution: workflow === "implement" });
  const admitted = workflow === "index" || operation.workflow === workflow
    || workflow === "review" && operation.workflow === "implement"
    || workflow === "revise" && ["implement", "track"].includes(operation.workflow)
    || workflow === "implement" && operation.workflow === "revert"
    || operation.workflow === "reconcile" && ["refresh", "review", "revise", "implement", "revert"].includes(workflow);
  if (!admitted) throw new Error(`Workflow ${workflow} cannot use ${operation.workflow} PR ${operation.url}`);
}
export function requireGitHubDelivery(root: string, tracks: string[]): void {
  const client = githubClient(root);
  if (!client) return;
  const identity = client.identity();
  client.fetch(identity.defaultBranch);
  for (const track of tracks) requireDelivered(client, track, identity.base);
}
export function githubCheckpoint(root: string, checkpoint: string, paths: string[], expected?: Record<string, string | null>): void {
  const client = githubClient(root);
  if (client) markPending(client, checkpoint, paths, expected);
}
export function publishGitHubReceipt(root: string, operationId: string): void {
  const client = githubClient(root);
  if (client && readSession(root)?.pending) publish(client, `receipt:${operationId}`);
}
