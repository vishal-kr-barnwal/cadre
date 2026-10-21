import { readFileSync } from "node:fs";
import { z } from "zod/v4";
import { readConfig, readSession } from "./storage.js";
import { GitHubClient } from "./transport.js";
import { begin, previewBegin, beginSchema, renew } from "./operations.js";
import { publish, previewSync, synchronize, assess } from "./publication.js";
import { audit, cancel, checkPullRequest, ready, revalidateReview } from "./validation.js";
import { previewActivation, activate } from "./enforcement.js";
import { readLedger } from "./ledger.js";
import { workflow, slug } from "./model.js";
import { recover } from "./recovery.js";
import { reconcilePublication } from "./publication-recovery.js";

export const githubRequestSchema = z.strictObject({
  projectRoot: z.string().min(1),
  action: z.enum(["begin", "renew", "release", "cancel", "publish", "sync", "assess", "ready", "audit", "activate", "review", "recover", "reconcile-publication"]),
  pr: z.number().int().positive().optional(),
  workflow: workflow.optional(), tracks: z.array(slug).optional(),
  approvalDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(), evidence: z.string().min(1).optional()
});
export type GitHubRequest = z.infer<typeof githubRequestSchema>;
export function githubStatus(root: string) {
  const config = readConfig(root);
  if (!config) return { enabled: false };
  const client = new GitHubClient(root, config), identity = client.identity(), ledger = readLedger(client), session = readSession(root);
  return { enabled: true, repository: config.repository, ...identity, active: ledger?.value.active ?? false,
    incident: ledger?.value.incident ?? null, operation: ledger?.value.operations.find((entry) => entry.id === session?.operation) ?? null,
    pendingPublication: session?.pending ?? null,
    operations: ledger?.value.operations ?? [], pullRequests: client.prs().map((pr) => ({ number: pr.number, url: pr.html_url,
      branch: pr.head.ref, draft: pr.draft ?? false, head: pr.head.sha })) };
}
export function githubOperation(input: GitHubRequest): unknown {
  githubRequestSchema.parse(input);
  const config = readConfig(input.projectRoot);
  if (!config) throw new Error("GitHub mode is not enabled; local workflows require no GitHub configuration");
  const client = new GitHubClient(input.projectRoot, config);
  switch (input.action) {
    case "begin": {
      const request = beginSchema.parse({ workflow: input.workflow, tracks: input.tracks ?? [] });
      return input.approvalDigest ? begin(client, request, input.approvalDigest) : previewBegin(client, request);
    }
    case "renew": return renew(client);
    case "release": return renew(client, true);
    case "cancel": return cancel(client);
    case "publish": return publish(client, input.evidence ?? "approved-checkpoint");
    case "reconcile-publication": return reconcilePublication(client, input.evidence ?? "", input.approvalDigest);
    case "sync": return input.approvalDigest ? synchronize(client, input.approvalDigest) : previewSync(client);
    case "assess": return assess(client, input.evidence ?? "");
    case "ready": return ready(client);
    case "review": return revalidateReview(client, input.evidence ?? "", input.approvalDigest);
    case "recover": {
      if (!input.pr) throw new Error("Recovery requires the merged reconciliation PR number");
      return recover(client, input.pr, input.approvalDigest);
    }
    case "audit": return audit(client);
    case "activate": return input.approvalDigest ? activate(client, input.approvalDigest) : previewActivation(client);
  }
}
export function runGitHubCI(root: string, eventPath: string) {
  const config = readConfig(root);
  if (!config) throw new Error("Trusted default has no GitHub policy");
  const event = z.object({ pull_request: z.object({ number: z.number().int().positive(), state: z.string() }).optional() })
    .parse(JSON.parse(readFileSync(eventPath, "utf8")));
  const client = new GitHubClient(root, config);
  if (event.pull_request?.state === "open") {
    const pr = client.pr(event.pull_request.number);
    const status = (state: string, description: string) => client.repo(`/statuses/${pr.head.sha}`, "POST",
      { state, context: "cadre-github", description });
    status("pending", "Validating Cadre ownership, dependencies and review evidence");
    try {
      const result = checkPullRequest(client, event.pull_request.number, false);
      if (result.head !== pr.head.sha) throw new Error("PR changed during validation; rerun its current head");
      status("success", "Cadre evidence validated for this commit");
      return result;
    } catch (error) {
      status("failure", "Cadre evidence is missing, stale, blocked or invalid");
      throw error;
    }
  }
  return audit(client);
}
