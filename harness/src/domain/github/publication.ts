import { readFileSync, existsSync } from "node:fs";
import { relative } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { currentOperation } from "./operations.js";
import { readLedger, updateOperation, requireLease } from "./ledger.js";
import { readSession, writeSession, safePath } from "./storage.js";
import { GitHubClient } from "./transport.js";
import { requireDependencies, requireProtection, requireIndependentApproval, scopeDigest } from "./policy.js";
import { digest, type GitHubOperation } from "./model.js";

export function requireOwningBranch(client: GitHubClient, operation: GitHubOperation): void {
  if (client.git("symbolic-ref", "--short", "HEAD") !== operation.branch) {
    throw new Error(`Continue ${operation.url} on ${operation.branch}; fetch and switch without discarding local work`);
  }
  if (!operation.pr) throw new Error("Publish the owning draft PR before substantive work");
  const pr = client.pr(operation.pr);
  if (pr.state !== "open" || pr.head.ref !== operation.branch || pr.head.repo?.full_name !== client.config.repository) throw new Error("Owning PR is closed or its branch/repository changed");
}
export function preflight(client: GitHubClient, options: { allowPending?: boolean; phase?: boolean; execution?: boolean; tracks?: string[] } = {}) {
  const operation = currentOperation(client), identity = client.identity(), ledger = readLedger(client)!;
  requireOwningBranch(client, operation);
  if (ledger.value.incident && operation.workflow !== "reconcile") throw new Error(ledger.value.incident);
  if (ledger.value.active) requireProtection(client, identity.defaultBranch);
  else if (!["create", "refresh", "reconcile"].includes(operation.workflow)) throw new Error("GitHub enforcement is not active");
  if (ledger.value.active && ledger.value.audited !== identity.base && operation.workflow !== "reconcile") throw new Error("Default branch advanced; run GitHub reconcile/audit before continuing");
  if (options.tracks?.some((track) => !operation.tracks.includes(track))) throw new Error("The owning PR does not reserve every affected track");
  const session = readSession(client.root)!;
  if (session.pending && !options.allowPending) throw new Error(`Checkpoint ${session.pending.checkpoint} needs its committed publication before dependent work`);
  if (!options.allowPending) {
    const remote = client.fetch(operation.branch);
    if (client.run("git", ["merge-base", "--is-ancestor", remote, "HEAD"]).status !== 0) throw new Error("Collaborator advanced the owning branch; reconcile and verify before mutations");
  }
  if (options.phase && operation.synchronized !== identity.base) throw new Error("Phase boundary requires fetching and merging current default with github sync");
  if (options.phase) {
    if (client.fetch(identity.defaultBranch) !== identity.base) throw new Error("Default advanced during phase preflight; reconcile and retry");
    if (client.run("git", ["merge-base", "--is-ancestor", identity.base, "HEAD"]).status !== 0) throw new Error("Merge current default before this phase boundary");
  }
  if ((options.phase || options.execution) && operation.workflow === "implement") {
    requireDependencies(client, operation, identity.base, true);
    if (operation.assessment?.base !== identity.base || operation.assessment.scope !== scopeDigest(client, operation.tracks)) {
      throw new Error("Fresh plan/dependency assessment required after synchronization; run github assess with evidence");
    }
  }
  return { operation, identity, session };
}

/** Publication mutates no tracked files and never stages or creates a product commit. */
export function publish(client: GitHubClient, checkpoint: string): GitHubOperation {
  if (!checkpoint.trim()) throw new Error("Publication requires a named checkpoint");
  const { operation, identity, session } = preflight(client, { allowPending: true });
  if (!session.pending) markPending(client, checkpoint, []);
  if (operation.branch === identity.defaultBranch) throw new Error("Refusing to push default");
  const paths = session.pending?.paths ?? [];
  for (const path of paths) safePath(client.root, path);
  if (paths.length && (client.git("diff", "--name-only", "HEAD", "--", ...paths)
    || client.git("ls-files", "--others", "--exclude-standard", "--", ...paths))) {
    throw new Error("Checkpoint is not committed; commit only its approved artifacts before publication");
  }
  const head = client.git("rev-parse", "HEAD^{commit}");
  for (const [path, expected] of Object.entries(session.pending?.expected ?? {})) {
    safePath(client.root, path);
    const blob = client.run("git", ["show", `${head}:${path}`]);
    const actual = blob.status === 0 ? createHash("sha256").update(blob.stdout).digest("hex") : null;
    if (actual !== expected) throw new Error(`Checkpoint ${path} does not match its approved durable content; resume the pending operation before publication`);
  }
  for (const track of operation.tracks) {
    const journals = client.git("ls-tree", "-r", "--name-only", head, "--", `.cadre/tracks/${track}/executions`).split("\n").filter((path) => path.endsWith(".json"));
    for (const path of journals) {
      const journal = JSON.parse(client.git("show", `${head}:${path}`)) as { nodes?: Record<string, { status?: string; workerCommit?: string | null; mergeCommit?: string | null }> };
      for (const node of Object.values(journal.nodes ?? {})) {
        if (!["completed", "integrated"].includes(node.status ?? "")) continue;
        for (const commit of [node.workerCommit, node.mergeCommit].filter((value): value is string => Boolean(value))) {
          if (client.run("git", ["merge-base", "--is-ancestor", commit, head]).status !== 0) throw new Error("Integrate verified worker product commits into the owning PR branch before publishing their checkpoint");
        }
      }
    }
  }
  const remote = client.fetch(operation.branch);
  if (client.run("git", ["merge-base", "--is-ancestor", remote, head]).status !== 0) {
    throw new Error(`Collaborator advanced ${operation.branch}; fetch, reconcile and verify without force-pushing`);
  }
  if (head !== remote) {
    const pushed = client.run("git", ["push", "origin", `${head}:refs/heads/${operation.branch}`]);
    let observed: string;
    try { observed = client.fetch(operation.branch); }
    catch { throw new Error(`Committed locally; publication blocked. Remote outcome is uncertain; inspect ${operation.branch} before retrying ${head}`); }
    if (client.run("git", ["merge-base", "--is-ancestor", head, observed]).status !== 0) {
      throw new Error(`Committed locally; publication blocked. Preserve ${head}. ${pushed.stderr.slice(0, 1000)}`);
    }
  }
  const updated = updateOperation(client, operation.id, (entry) => {
    requireLease(entry, session.token);
    entry.published = head;
    if (entry.review && entry.review.head !== head) entry.review = null;
  });
  writeSession(client.root, { ...session, pending: null });
  if (operation.review && operation.review.head !== head && operation.pr) {
    // A failed draft toggle never restores the invalidated merge evidence.
    client.run("gh", ["pr", "ready", String(operation.pr), "--undo", "--repo", `${client.config.hostname}/${client.config.repository}`]);
  }
  return updated;
}
export function markPending(client: GitHubClient, checkpoint: string, paths: string[], expected?: Record<string, string | null>): void {
  const session = readSession(client.root);
  if (!session) throw new Error("GitHub writer session missing");
  const normalized = paths.map((path) => path.startsWith(client.root + "/") ? relative(client.root, path).split("\\").join("/") : path);
  const content = { ...session.pending?.expected };
  for (const path of normalized) {
    const target = safePath(client.root, path);
    content[path] = expected && path in expected ? expected[path]! : existsSync(target)
      ? createHash("sha256").update(readFileSync(target)).digest("hex") : null;
  }
  writeSession(client.root, { ...session, pending: { checkpoint, paths: [...new Set([...(session.pending?.paths ?? []), ...normalized])], expected: content } });
}
function requireQuiescentWorkers(client: GitHubClient, operation: GitHubOperation): void {
  for (const track of operation.tracks) {
    const statePath = safePath(client.root, `.cadre/tracks/${track}/state.json`);
    if (!existsSync(statePath)) continue;
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { operation?: { executionId?: string }; lastExecution?: { executionId?: string } };
    const execution = state.operation?.executionId ?? state.lastExecution?.executionId;
    if (!execution) continue;
    const journal = JSON.parse(readFileSync(safePath(client.root, `.cadre/tracks/${track}/executions/execution-${execution}.json`), "utf8")) as {
      nodes: Record<string, { kind: string; status: string; workerId?: string | null }> };
    if (Object.values(journal.nodes).some((node) => node.kind !== "phase" && !["pending", "completed", "blocked"].includes(node.status))) {
      throw new Error("Reach a quiescent worker boundary before merging default");
    }
  }
  for (const record of client.git("worktree", "list", "--porcelain").split("\n\n")) {
    if (!operation.tracks.some((track) => record.includes(`branch refs/heads/cadre/${track}/`))) continue;
    const path = /^worktree (.+)$/m.exec(record)?.[1], head = /^HEAD ([0-9a-f]{40})$/m.exec(record)?.[1];
    if (!path || !head || client.git("-C", path, "status", "--porcelain")
      || client.run("git", ["merge-base", "--is-ancestor", head, "HEAD"]).status !== 0) {
      throw new Error("Integrate verified worker work and reach a clean boundary before synchronizing default");
    }
  }
}
export function previewSync(client: GitHubClient) {
  const { operation, identity } = preflight(client);
  requireQuiescentWorkers(client, operation);
  if (client.git("status", "--porcelain")) throw new Error("Commit and publish the current checkpoint before synchronizing; never stash user changes");
  client.fetch(identity.defaultBranch);
  const head = client.git("rev-parse", "HEAD");
  const basis = { operationId: operation.id, head, base: identity.base, branch: identity.defaultBranch };
  return { ...basis, digest: digest(basis) };
}
export function synchronize(client: GitHubClient, approvalDigest: string) {
  const proposal = previewSync(client);
  if (proposal.digest !== approvalDigest) throw new Error("Synchronization proposal changed");
  const result = client.run("git", ["-c", "core.hooksPath=/dev/null", "merge", "--no-edit", "--no-ff", proposal.base]);
  if (result.status !== 0) throw new Error("Default merge needs explicit conflict resolution; preserve the merge and local work, then verify and publish");
  const operation = currentOperation(client);
  if (operation.pr) client.run("gh", ["pr", "ready", String(operation.pr), "--undo", "--repo", `${client.config.hostname}/${client.config.repository}`]);
  markPending(client, "default-synchronization", []);
  return updateOperation(client, proposal.operationId, (entry) => {
    entry.synchronized = proposal.base;
    entry.assessment = null; entry.review = null;
  });
}
export function assess(client: GitHubClient, evidence: string) {
  if (!evidence.trim()) throw new Error("Fresh assessment requires evidence");
  const { operation, identity } = preflight(client);
  if (operation.synchronized !== identity.base || client.run("git", ["merge-base", "--is-ancestor", identity.base, "HEAD"]).status !== 0) throw new Error("Synchronize current default before assessment");
  requireDependencies(client, operation, identity.base, operation.workflow === "implement");
  const scope = scopeDigest(client, operation.tracks);
  // Later scope revisions stay in the implementation PR but require an independent approval checkpoint.
  if (operation.workflow === "implement" && scopeDigest(client, operation.tracks, identity.base) !== scope) {
    requireIndependentApproval(client, operation.pr!, client.git("rev-parse", "HEAD"));
  }
  return updateOperation(client, operation.id, (entry) => { entry.assessment = { base: identity.base, scope, evidence }; });
}
