import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import { validateProject } from "../state.js";
import { requireReviewedProductUnchanged } from "../git.js";
import { resolveOperation, receiptSchema } from "../operation-receipts.js";
import { GitHubClient } from "./transport.js";
import { readLedger, writeLedger, updateOperation } from "./ledger.js";
import { currentOperation } from "./operations.js";
import { preflight } from "./publication.js";
import { requireDependencies, requireIndependentApproval, requireProtection, requireSuccessfulChecks, scopeDigest } from "./policy.js";
import { digest, type GitHubOperation, type PullRequest } from "./model.js";

/** Inspect PR data in a disposable checkout. No install, hooks, project script, or PR executable runs. */
export function inspectHead<T>(client: GitHubClient, head: string, inspect: (checkout: GitHubClient) => T,
  makeClient = (root: string) => new GitHubClient(root, client.config)): T {
  const temporary = mkdtempSync(join(tmpdir(), "cadre-github-verify-"));
  try {
    client.git("-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--no-local", client.root, temporary);
    const checkout = makeClient(temporary);
    checkout.git("remote", "set-url", "origin", client.git("remote", "get-url", "origin"));
    checkout.git("fetch", "--no-tags", "origin", head);
    // Repository attributes cannot request a globally configured executable smudge filter.
    mkdirSync(join(temporary, ".git/info"), { recursive: true });
    writeFileSync(join(temporary, ".git/info/attributes"), "* -filter -text -ident -working-tree-encoding\n");
    checkout.git("-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.required=false", "-c", "filter.lfs.smudge=",
      "-c", "filter.lfs.process=", "checkout", "--detach", head);
    return inspect(checkout);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
export function validateLocalEvidence(client: GitHubClient, operation: GitHubOperation, base: string): void {
  const validation = validateProject(client.root);
  if (validation.errors.length) throw new Error(validation.errors.join("; "));
  const changed = client.git("diff", "--name-only", base, "HEAD").split("\n").filter(Boolean);
  for (const path of changed) {
    const track = /^\.cadre\/(?:tracks|archive)\/([^/]+)\//.exec(path)?.[1];
    if (track && !operation.tracks.includes(track)) throw new Error(`PR does not reserve affected track ${track}`);
    if (/^\.cadre\/(?:project\.json|product\.md|guidelines\.md|workflow\.md|tech-stack\.md|styleguides\/)/.test(path)
      && !["create", "refresh", "reconcile"].includes(operation.workflow)
      && !(operation.workflow === "archive" && path === ".cadre/project.json")) throw new Error("Project context changes require a refresh PR");
    if (path.startsWith(".github/") && !["create", "refresh", "reconcile"].includes(operation.workflow)) throw new Error("Governance changes require a refresh PR");
  }
  if (client.run("git", ["merge-base", "--is-ancestor", base, "HEAD"]).status !== 0) throw new Error("Implementation is behind current default");
  const refreshed = operation.review?.source === "revalidation" && operation.review.head === client.git("rev-parse", "HEAD")
    && operation.review.base === base && operation.review.scope === scopeDigest(client, operation.tracks);
  if (operation.workflow === "implement") for (const id of operation.tracks) {
    const state = validation.states.get(id), cycle = state?.reviewCycles?.at(-1);
    if (state?.status !== "completed" || cycle?.outcome !== "clean" || !cycle.reviewedHead || !cycle.approvalConfirmation) throw new Error(`Track ${id} requires an approved clean Cadre review`);
    if (!refreshed) {
      if (client.run("git", ["merge-base", "--is-ancestor", base, cycle.reviewedHead]).status !== 0) throw new Error("Cadre review predates current default; synchronize and run github review with fresh verification and review evidence");
      requireReviewedProductUnchanged(client.root, cycle.reviewedHead, id);
    }
    const history = state.history as Array<{action: string; commit: string}>;
    const review = [...history].reverse().find((entry) => entry.action === "review");
    if (!review?.commit?.startsWith("op:")) throw new Error("Clean review lacks an immutable operation receipt");
    const commit = resolveOperation(client.root, review.commit);
    const receipt = receiptSchema.parse(JSON.parse(client.git("show", `${commit}:.cadre/receipts/${review.commit.slice(3)}.json`)));
    if (receipt.kind !== "review") throw new Error("Clean review receipt has the wrong workflow");
  }
}
function requirePrBinding(client: GitHubClient, operation: GitHubOperation, pr: PullRequest, defaultBranch: string): void {
  if (pr.base.ref !== defaultBranch || pr.base.repo.full_name !== client.config.repository
    || pr.head.repo?.full_name !== client.config.repository || pr.head.ref !== operation.branch) throw new Error("PR repository, base, or owning branch changed");
  const descriptor = client.file(pr.head.sha, `.cadre/github/operations/${operation.id}.json`);
  if (!descriptor) throw new Error("PR has no committed Cadre operation descriptor");
  const value = z.object({ id: z.literal(operation.id), branch: z.literal(operation.branch), base: z.literal(operation.base),
    workflow: z.literal(operation.workflow), tracks: z.array(z.string()) }).parse(JSON.parse(descriptor));
  if (value.tracks.join() !== operation.tracks.join()) throw new Error("PR resource ownership was changed");
}
export function checkPullRequest(client: GitHubClient, number: number, independent = true) {
  const identity = client.identity(), ledger = readLedger(client);
  const operation = ledger?.value.operations.find((entry) => entry.pr === number);
  if (!operation || !["open", "merged"].includes(operation.state)) throw new Error("PR has no active Cadre reservation");
  const pr = client.pr(number);
  requirePrBinding(client, operation, pr, identity.defaultBranch);
  if (ledger?.value.active) requireProtection(client, identity.defaultBranch);
  if (ledger?.value.incident && operation.workflow !== "reconcile") throw new Error(ledger.value.incident);
  if (!operation.published || operation.published !== pr.head.sha) throw new Error("Current PR head has not completed checkpoint publication");
  if (["implement", "reconcile"].includes(operation.workflow) && (!operation.review || operation.review.head !== pr.head.sha || operation.review.base !== identity.base)) {
    throw new Error("Fresh clean Cadre review evidence is required for this PR head and default baseline");
  }
  client.fetch(identity.defaultBranch);
  requireDependencies(client, { ...operation, branch: pr.head.sha }, identity.base, operation.workflow === "implement");
  inspectHead(client, pr.head.sha, (checkout) => {
    if (checkout.git("show", "HEAD:.cadre/github.json").trim() !== JSON.stringify(client.config, null, 2)) throw new Error("PR changed or removed trusted GitHub policy");
    validateLocalEvidence(checkout, operation, identity.base);
    if (operation.workflow === "implement" && operation.review?.scope !== scopeDigest(checkout, operation.tracks)) throw new Error("Approved review scope changed");
    if (operation.workflow === "track" && checkout.git("diff", "--name-only", identity.base, "HEAD", "--", ".", ":(exclude).cadre/**")) {
      throw new Error("Track planning PR cannot deliver product changes");
    }
  });
  if (independent) requireIndependentApproval(client, number, pr.head.sha);
  return { valid: true, pr: number, head: pr.head.sha, base: identity.base };
}
export function ready(client: GitHubClient) {
  const { operation, identity } = preflight(client, { phase: true });
  const head = client.git("rev-parse", "HEAD");
  if (client.git("status", "--porcelain") || operation.published !== head) throw new Error("Commit and publish all approved checkpoints before readiness");
  if (operation.workflow === "reconcile" && (operation.review?.source !== "revalidation" || operation.review.head !== head
    || operation.review.base !== identity.base)) throw new Error("Reconciliation requires fresh approved github review evidence before readiness");
  validateLocalEvidence(client, operation, identity.base);
  requireDependencies(client, operation, identity.base, operation.workflow === "implement");
  const updated = updateOperation(client, operation.id, (entry) => {
    if (entry.review?.head !== head || entry.review.base !== identity.base) {
      entry.review = { head, base: identity.base, scope: scopeDigest(client, operation.tracks),
        evidence: "Validated committed Cadre clean review and approval receipts", source: "cadre-receipt" };
    }
  });
  // Teammate approval is a merge gate, not a prerequisite for asking that teammate to review.
  client.command("gh", ["pr", "ready", String(operation.pr), "--repo", `${client.config.hostname}/${client.config.repository}`]);
  return updated;
}
/** A fresh semantic review of an unmerged, previously reviewed PR does not rewrite its historical receipts. */
export function revalidateReview(client: GitHubClient, evidence: string, approvalDigest?: string) {
  const { operation, identity } = preflight(client, { phase: true });
  if (!["implement", "reconcile"].includes(operation.workflow) || evidence.trim().length < 20) {
    throw new Error("Revalidation requires an implementation/reconciliation PR and substantive fresh verification/review evidence");
  }
  const head = client.git("rev-parse", "HEAD");
  if (client.git("status", "--porcelain") || operation.published !== head) throw new Error("Commit and publish reviewed work first");
  const review = { head, base: identity.base, scope: scopeDigest(client, operation.tracks), evidence, source: "revalidation" as const };
  validateLocalEvidence(client, { ...operation, review }, identity.base);
  const proposal = { operation: operation.id, review, digest: digest({ operation: operation.id, review }) };
  if (!approvalDigest) return proposal;
  if (approvalDigest !== proposal.digest) throw new Error("Review proposal changed; fresh approval required");
  return updateOperation(client, operation.id, (entry) => { entry.review = review; });
}
/** Every default advance must be an accepted merge or an explicitly approved adoption baseline. */
export function audit(client: GitHubClient) {
  const identity = client.identity(), snapshot = readLedger(client);
  if (!snapshot) throw new Error("GitHub coordination is missing");
  if (snapshot.value.active) requireProtection(client, identity.defaultBranch);
  const base = client.fetch(identity.defaultBranch);
  if (base !== identity.base) throw new Error("Default changed during audit; retry");
  const next = structuredClone(snapshot.value);
  if (client.run("git", ["merge-base", "--is-ancestor", next.audited, base]).status !== 0) {
    next.incident = "Default history was rewritten; an explicit reconciliation PR is required";
  } else {
    for (const commit of client.git("rev-list", "--first-parent", "--reverse", `${next.audited}..${base}`).split("\n").filter(Boolean)) {
      const prs = client.pages(`/commits/${commit}/pulls?per_page=100`) as Array<{ number: number }>;
      const entry = next.operations.find((operation) => operation.pr && prs.some((pr) => pr.number === operation.pr));
      if (!entry?.pr) { next.incident = `Unverified default change ${commit}; review and adopt or revert through a reconciliation PR`; break; }
      const pr = client.pr(entry.pr), parents = client.git("show", "-s", "--format=%P", commit).split(" ");
      if (!pr.merged || pr.merge_commit_sha !== commit || parents.length !== 2 || parents[1] !== pr.head.sha
        || entry.published !== pr.head.sha || entry.workflow === "implement" && (!entry.review || entry.review.head !== pr.head.sha || entry.review.base !== parents[0])) {
        next.incident = `Bypassed or rewritten delivery in ${entry.url}; fresh review and reconciliation required`; break;
      }
      try {
        requirePrBinding(client, entry, pr, identity.defaultBranch);
        requireIndependentApproval(client, entry.pr, pr.head.sha);
        requireSuccessfulChecks(client, pr.head.sha, next.active);
        requireDependencies(client, { ...entry, branch: pr.head.sha }, parents[0]!, entry.workflow === "implement");
        inspectHead(client, pr.head.sha, (checkout) => validateLocalEvidence(checkout, entry, parents[0]!));
      }
      catch (error) { next.incident = `Unverified merge ${entry.url}: ${(error as Error).message}`; break; }
      entry.state = "merged"; entry.lease = null; next.audited = commit;
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(snapshot.value)) writeLedger(client, snapshot, next);
  if (next.incident) throw new Error(next.incident);
  return { audited: next.audited };
}
export function cancel(client: GitHubClient) {
  const operation = currentOperation(client);
  if (!operation.pr) throw new Error("Recover PR publication before cancellation");
  const pr = client.pr(operation.pr);
  if (pr.state !== "closed" || pr.merged) throw new Error("Close the unmerged PR explicitly before releasing its reservation");
  return updateOperation(client, operation.id, (entry) => { entry.state = "cancelled"; entry.lease = null; });
}
