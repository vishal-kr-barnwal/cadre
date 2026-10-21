import { z } from "zod/v4";
import { blocks, digest, json, operationSchema, slug, workflow, type GitHubOperation } from "./model.js";
import { readLedger, writeLedger, updateOperation, requireLease } from "./ledger.js";
import { readSession, sessionFor, writeSession } from "./storage.js";
import { requireDependencies, requireProtection } from "./policy.js";
import { GitHubClient } from "./transport.js";

export const beginSchema = z.strictObject({ workflow, tracks: z.array(slug).default([]) });
export type BeginInput = z.infer<typeof beginSchema>;
function resourceInput(input: BeginInput): BeginInput {
  beginSchema.parse(input);
  const tracks = [...new Set(input.tracks)].sort();
  if (["track", "implement", "review", "revise", "revert"].includes(input.workflow) && tracks.length !== 1) throw new Error("This GitHub workflow requires exactly one track");
  if (input.workflow === "archive" && !tracks.length) throw new Error("Archive requires selected tracks");
  return { ...input, tracks };
}
export function previewBegin(client: GitHubClient, raw: BeginInput) {
  const input = resourceInput(raw), identity = { ...client.identity(), login: client.login() }, ledger = readLedger(client);
  if (!ledger && !["create", "refresh"].includes(input.workflow)) throw new Error("Enable GitHub collaboration through create or refresh first");
  if (ledger?.value.active) requireProtection(client, identity.defaultBranch);
  if (ledger?.value.incident && input.workflow !== "reconcile") throw new Error(ledger.value.incident);
  if (ledger?.value.active && ledger.value.audited !== identity.base && input.workflow !== "reconcile") {
    throw new Error("Default branch advanced; audit its merge provenance before reserving more work");
  }
  if (ledger && !ledger.value.active && !["create", "refresh", "reconcile"].includes(input.workflow)) throw new Error("GitHub enforcement activation is pending");
  const existing = ledger?.value.operations.find((entry) => ["reserved", "open"].includes(entry.state)
    && (input.workflow === "reconcile" && ledger.value.incident ? entry.workflow === "reconcile" : blocks(entry, input)));
  if (existing && (existing.tracks.join() !== input.tracks.join()
    || !(existing.workflow === input.workflow || input.workflow === "review" && existing.workflow === "implement"
      || input.workflow === "revise" && ["track", "implement"].includes(existing.workflow)))) {
    throw new Error(`Operation is locked by ${existing.url ?? existing.branch}; continue that PR`);
  }
  if (!existing && input.workflow === "review") throw new Error("Review must join its open implementation PR");
  if (!existing && input.workflow === "create" && client.file(identity.base, ".cadre/project.json")) throw new Error("Setup already exists on default; use refresh");
  if (!["create", "refresh", "reconcile"].includes(input.workflow) && !client.file(identity.base, ".cadre/project.json")) throw new Error("Setup PR must merge before tracks can begin");
  const basis = { input, identity, ledgerHead: ledger?.head ?? null, existing: existing ?? null };
  const id = existing?.id ?? `${input.workflow}-${digest(basis).slice(0, 24)}`;
  const reservation = { id, branch: existing?.branch ?? `cadre/github/${id}` };
  return { ...basis, reservation, digest: digest({ ...basis, reservation }) };
}
export function begin(client: GitHubClient, raw: BeginInput, approvalDigest: string) {
  const preview = previewBegin(client, raw);
  if (preview.digest !== approvalDigest) throw new Error("GitHub operation proposal changed; inspect again");
  const session = sessionFor(client.root, client.config), now = Date.now();
  if (session.pending && session.operation !== preview.existing?.id) throw new Error("Publish the current checkpoint before switching operations");
  if (preview.existing) {
    const existing = preview.existing;
    if (existing.lease && existing.lease.expires > now && existing.lease.token !== session.token) {
      throw new Error(`Continue ${existing.url ?? existing.branch}; writer ${existing.lease.owner} must release the lease, or wait for its expiry`);
    }
    const joined = updateOperation(client, existing.id, (entry) => {
      if (entry.lease && entry.lease.expires > now && entry.lease.token !== session.token) throw new Error("Writer lease changed");
      entry.lease = { owner: preview.identity.login, token: session.token, expires: now + 10 * 60_000 };
    });
    writeSession(client.root, { ...session, operation: joined.id });
    return publishReservation(client, joined);
  }
  const id = preview.reservation.id;
  const operation = operationSchema.parse({ id, ...preview.input, branch: preview.reservation.branch, base: preview.identity.base,
    pr: null, url: null, state: "reserved", lease: { owner: preview.identity.login, token: session.token, expires: now + 10 * 60_000 },
    published: null, synchronized: null, assessment: null, review: null });
  if (operation.workflow === "implement") {
    client.fetch(preview.identity.defaultBranch);
    requireDependencies(client, operation, preview.identity.base, true);
  }
  const snapshot = readLedger(client);
  if ((snapshot?.head ?? null) !== preview.ledgerHead) throw new Error("GitHub reservation changed; inspect again");
  writeLedger(client, snapshot, { ...(snapshot?.value ?? { schemaVersion: 1 as const, operations: [], audited: client.config.adoptionCommit,
    incident: null, active: false }), operations: [...(snapshot?.value.operations ?? []), operation] });
  writeSession(client.root, { ...session, operation: id });
  return publishReservation(client, operation);
}
/** Only the fixed coordination descriptor is committed here; product commits remain agent-owned. */
function publishReservation(client: GitHubClient, operation: GitHubOperation): GitHubOperation {
  if (operation.pr) {
    const pr = client.pr(operation.pr);
    if (pr.state !== "open") throw new Error(`PR ${operation.url} is closed; reconcile or explicitly cancel it`);
    return operation;
  }
  const existing = client.prs().find((pr) => pr.head.ref === operation.branch && pr.head.repo?.full_name === client.config.repository);
  if (existing) return updateOperation(client, operation.id, (entry) => { entry.pr = existing.number; entry.url = existing.html_url; entry.state = "open"; });
  const ref = client.run("gh", ["api", "--hostname", client.config.hostname, `repos/${client.config.repository}/git/ref/heads/${operation.branch}`]);
  if (ref.status !== 0) {
    if (!/\(HTTP 404\)/.test(ref.stderr)) throw new Error(`Cannot inspect reserved branch: ${ref.stderr}`);
    const parent = z.object({ tree: z.object({ sha: z.string() }) }).parse(client.repo(`/git/commits/${operation.base}`));
    const tree = z.object({ sha: z.string() }).parse(client.repo("/git/trees", "POST", { base_tree: parent.tree.sha,
      tree: [{ path: `.cadre/github/operations/${operation.id}.json`, mode: "100644", type: "blob",
        content: json({ schemaVersion: 1, id: operation.id, workflow: operation.workflow, tracks: operation.tracks, branch: operation.branch, base: operation.base }) }] }));
    const commit = z.object({ sha: z.string() }).parse(client.repo("/git/commits", "POST", {
      message: `cadre(${operation.workflow}): reserve ${operation.id}`, tree: tree.sha, parents: [operation.base] }));
    client.repo("/git/refs", "POST", { ref: `refs/heads/${operation.branch}`, sha: commit.sha });
  }
  const identity = client.identity();
  const result = client.run("gh", ["pr", "create", "--repo", `${client.config.hostname}/${client.config.repository}`,
    "--head", operation.branch, "--base", identity.defaultBranch, "--draft", "--title",
    `cadre(${operation.workflow}): ${operation.tracks.join(", ") || "project"}`, "--body-file", "-"],
    `Cadre operation: ${operation.id}\nBranch: ${operation.branch}\n\nContinue this PR for shared work. Merge requires current Cadre evidence and independent approval.\n`);
  // Look up even on an uncertain response: never create a second PR blindly.
  const created = client.prs().find((pr) => pr.head.ref === operation.branch && pr.head.repo?.full_name === client.config.repository);
  if (!created) throw new Error(`Reservation retained; PR publication blocked: ${result.stderr}`);
  return updateOperation(client, operation.id, (entry) => { entry.pr = created.number; entry.url = created.html_url; entry.state = "open"; });
}
export function renew(client: GitHubClient, release = false): GitHubOperation {
  const session = readSession(client.root);
  if (!session?.operation) throw new Error("Join a GitHub operation first");
  client.identity();
  if (release && session.pending) throw new Error("Publish the pending checkpoint before collaborator handoff");
  return updateOperation(client, session.operation, (operation) => {
    if (operation.lease && operation.lease.expires > Date.now() && operation.lease.token !== session.token) throw new Error("Another collaborator owns the writer lease");
    if (release && client.git("symbolic-ref", "--short", "HEAD") === operation.branch
      && (client.git("status", "--porcelain") || operation.published !== client.git("rev-parse", "HEAD"))) {
      throw new Error("Commit and publish approved work before collaborator handoff");
    }
    operation.lease = release ? null : { owner: client.login(), token: session.token, expires: Date.now() + 10 * 60_000 };
  });
}
export function currentOperation(client: GitHubClient, checkLease = true): GitHubOperation {
  const session = readSession(client.root), snapshot = readLedger(client);
  const operation = snapshot?.value.operations.find((entry) => entry.id === session?.operation);
  if (!session || !operation) throw new Error("Create or join the owning GitHub PR before mutations");
  if (!["reserved", "open"].includes(operation.state)) throw new Error("The owning GitHub operation is no longer open");
  if (checkLease) requireLease(operation, session.token);
  return operation;
}
