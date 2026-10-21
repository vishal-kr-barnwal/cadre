import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { GitHubClient, type Runner } from "../src/domain/github/transport.js";
import { configSchema, ledgerSchema, blocks, assertAcyclic, json, type GitHubConfig, type Ledger } from "../src/domain/github/model.js";
import { readLedger, writeLedger, requireLease } from "../src/domain/github/ledger.js";
import { markPending, publish, previewSync, synchronize, preflight } from "../src/domain/github/publication.js";
import { requireProtection, requireDependencies, requireIndependentApproval, requireSuccessfulChecks, scopeDigest } from "../src/domain/github/policy.js";
import { audit, inspectHead } from "../src/domain/github/validation.js";
import { readConfig, readSession, writeSession, safePath } from "../src/domain/github/storage.js";
import { requireGitHubMutation, githubCheckpoint } from "../src/domain/github/runtime.js";
import { githubStatus } from "../src/domain/github/service.js";
import { previewBegin, begin, renew } from "../src/domain/github/operations.js";
import { enforcementFiles, previewConfigure, configure, previewActivation, activate } from "../src/domain/github/enforcement.js";
import { reconcilePublication } from "../src/domain/github/publication-recovery.js";
import { fixture as plannedFixture, finishCurrent } from "./helpers/revision-fixture.js";
import { configureValidatorEnvironment, requireValidatorEnvironment } from "../src/domain/github/environment.js";

const token = "87c82d10-94bc-4a46-914f-4f8597cf184e";
function fixture(t: { after(fn: () => void): void }, existingRoot?: string) {
  const directory = mkdtempSync(join(tmpdir(), "cadre-gh-test-")), root = existingRoot ?? join(directory, "checkout"), remote = join(directory, "remote.git");
  mkdirSync(root, { recursive: true }); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false"); git("config", "core.hooksPath", "/dev/null");
  writeFileSync(join(root, "product.txt"), "baseline\n"); git("add", "product.txt"); git("commit", "-m", "baseline");
  const base = git("rev-parse", "HEAD");
  let defaultHead = base;
  git("clone", "--bare", root, remote);
  git("remote", "add", "origin", "https://github.com/test/project.git");
  git("config", `url.${remote}.insteadOf`, "https://github.com/test/project.git");
  const branch = "cadre/github/refresh-fixture";
  git("switch", "-c", branch);
  const config: GitHubConfig = { schemaVersion: 1, mode: "github-strict", repository: "test/project", hostname: "github.com",
    adoptionCommit: base, validatorVersion: "4.0.0", requiredChecks: ["tests"], codeOwners: ["@maintainer"] };
  mkdirSync(join(root, ".cadre"), { recursive: true }); writeFileSync(join(root, ".cadre/github.json"), json(config));
  git("add", ".cadre/github.json"); git("commit", "-m", "approved fixture config");
  git("push", "origin", `HEAD:refs/heads/${branch}`);
  let ledgerHead = "1".repeat(40);
  const snapshots = new Map<string, Ledger>();
  let ledger = ledgerSchema.parse({ schemaVersion: 1, active: true, audited: base, incident: null, operations: [{
    id: "refresh-fixture", workflow: "refresh", tracks: [], branch, base, pr: 1, url: "https://github.com/test/project/pull/1",
    state: "open", lease: { owner: "fixture", token, expires: Date.now() + 600_000 }, published: git("rev-parse", "HEAD"),
    synchronized: base, assessment: null, review: null
  }] });
  snapshots.set(ledgerHead, structuredClone(ledger));
  const objects = new Map<string, { parent?: string; ledger: Ledger }>();
  const calls: Array<{ command: string; args: string[] }> = [];
  let uncertainPush = false, rejectPush = false, race = false, status = 200;
  let protection: unknown = { enforce_admins: { enabled: true }, required_status_checks: { strict: true, contexts: ["cadre-github", "tests"] },
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_code_owner_reviews: true, require_last_push_approval: true,
      bypass_pull_request_allowances: { users: [], teams: [], apps: [] } }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
  const hash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex");
  const runner: Runner = (command, args, input) => {
    calls.push({ command, args });
    if (command === "git") {
      if (args.join(" ") === "remote get-url origin") return { status: 0, stdout: "https://github.com/test/project.git\n", stderr: "" };
      if (args[0] === "push" && rejectPush) return { status: 1, stdout: "", stderr: "fixture network error" };
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8", ...(input === undefined ? {} : { input }) });
      if (args[0] === "push" && uncertainPush) return { status: 1, stdout: "", stderr: "fixture connection lost after remote accepted" };
      return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    }
    if (args[0] === "pr" && args[1] === "ready") return { status: 0, stdout: "", stderr: "" };
    assert.equal(args[0], "api", `Unexpected gh command: ${args.join(" ")}`);
    const endpoint = args.find((arg) => arg.startsWith("repos/") || arg === "user")!;
    const path = endpoint.replace("repos/test/project", "");
    const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
    const body = input ? JSON.parse(input) : undefined;
    let value: unknown;
    if (status !== 200) return { status: 1, stdout: "", stderr: `fixture (HTTP ${status})` };
    if (endpoint === "user") value = { login: "fixture" };
    else if (!path) value = { full_name: "test/project", owner: { type: "User" }, default_branch: "main", allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false };
    else if (path === "/git/ref/heads/main") value = { object: { sha: defaultHead } };
    else if (path === "/git/ref/heads/cadre/coordination") value = { object: { sha: ledgerHead } };
    else if (path.startsWith("/contents/coordination.json")) {
      const ref = decodeURIComponent(path.split("?ref=")[1]!);
      value = { type: "file", encoding: "base64", content: Buffer.from(json(snapshots.get(ref))).toString("base64") };
    } else if (path === "/git/trees" && method === "POST") {
      const proposed = JSON.parse(body.tree[0].content), sha = hash(proposed);
      objects.set(sha, { ledger: proposed }); value = { sha };
    } else if (path === "/git/commits" && method === "POST") {
      const sha = hash(body), object = objects.get(body.tree)!;
      objects.set(sha, { ...object, parent: body.parents[0] }); value = { sha };
    } else if (path === "/git/refs/heads/cadre/coordination" && method === "PATCH") {
      const object = objects.get(body.sha)!;
      if (race || object.parent !== ledgerHead) return { status: 1, stdout: "", stderr: "not a fast forward (HTTP 422)" };
      assert.equal(body.force, false); ledgerHead = body.sha; ledger = object.ledger;
      snapshots.set(ledgerHead, structuredClone(ledger)); value = { object: { sha: ledgerHead } };
    } else if (path === "/branches/main/protection") value = protection;
    else if (path === "/environments/cadre-github") value = { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
    else if (path.startsWith("/environments/cadre-github/deployment-branch-policies")) value = [{ branch_policies: [{ name: "main", type: "branch" }] }];
    else if (/^\/commits\/[^/]+\/pulls/.test(path)) value = [[]];
    else if (path.startsWith("/pulls")) {
      const remoteHead = git("ls-remote", "origin", `refs/heads/${branch}`).split("\t")[0];
      const pr = { number: 1, html_url: "https://github.com/test/project/pull/1", state: "open", draft: true, merged: false,
        merge_commit_sha: null, user: { login: "fixture" }, head: { sha: remoteHead, ref: branch, repo: { full_name: "test/project" } },
        base: { sha: base, ref: "main", repo: { full_name: "test/project" } } };
      value = args.includes("--paginate") ? [[pr]] : pr;
    } else if (path.startsWith("/contents/")) return { status: 1, stdout: "", stderr: "Not Found (HTTP 404)" };
    else throw new Error(`Unexpected fixture endpoint: ${method} ${path}`);
    return { status: 0, stdout: JSON.stringify(value), stderr: "" };
  };
  const client = new GitHubClient(root, config, runner);
  writeSession(root, { config, operation: "refresh-fixture", token, pending: null });
  return { root, git, client, base, branch, config, calls, remote,
    ledger: () => ledger,
    advanceDefault: () => {
      git("switch", "main"); writeFileSync(join(root, "product.txt"), "direct push\n");
      git("add", "product.txt"); git("commit", "-m", "bypass"); git("push", "origin", "HEAD:refs/heads/main");
      defaultHead = git("rev-parse", "HEAD"); git("switch", branch); return defaultHead;
    },
    advanceCollaborator: () => {
      git("fetch", "origin", branch); git("switch", "--detach", "FETCH_HEAD");
      writeFileSync(join(root, "collaborator.txt"), "other work\n"); git("add", "collaborator.txt");
      git("commit", "-m", "collaborator"); git("push", "origin", `HEAD:refs/heads/${branch}`); git("switch", branch);
    },
    failPush: () => { rejectPush = true; }, allowPush: () => { rejectPush = false; },
    uncertainPush: () => { uncertainPush = true; }, race: () => { race = true; },
    failAPI: (code: number) => { status = code; }, protection: (value: unknown) => { protection = value; } };
}

test("local-only projects keep mutation paths and status independent of gh", (t) => {
  const root = mkdtempSync(join(tmpdir(), "cadre-local-only-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(readConfig(root), null);
  assert.deepEqual(githubStatus(root), { enabled: false });
  requireGitHubMutation(root, "create"); githubCheckpoint(root, "phase-complete", []);
  assert.equal(readSession(root), null);
});
test("local setup, planning and a complete execution need no GitHub executable or remote", async (t) => {
  const bin = mkdtempSync(join(tmpdir(), "cadre-no-gh-")); t.after(() => rmSync(bin, { recursive: true, force: true }));
  const marker = join(bin, "called"), originalPath = process.env.PATH, originalMarker = process.env.CADRE_TEST_GH_MARKER;
  writeFileSync(join(bin, "gh"), '#!/bin/sh\nprintf called > "$CADRE_TEST_GH_MARKER"\nexit 99\n', { mode: 0o755 });
  process.env.PATH = `${bin}:${originalPath ?? ""}`; process.env.CADRE_TEST_GH_MARKER = marker;
  try {
    const { root, call, load } = await plannedFixture(t);
    await call("execution_start", { projectRoot: root, trackId: "sample", approvalMode: "track", requestedMode: "sequential" });
    await finishCurrent(root, call, load().operation.executionId);
    assert.deepEqual(githubStatus(root), { enabled: false });
    assert.equal(readSession(root), null);
    for (const path of [".cadre/github.json", ".git/cadre-github", ".github"]) assert.equal(existsSync(join(root, path)), false);
    assert.equal(existsSync(marker), false, "local workflows never invoke gh");
    assert.equal(spawnSync("git", ["remote"], { cwd: root, encoding: "utf8" }).stdout.trim(), "");
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalMarker === undefined) delete process.env.CADRE_TEST_GH_MARKER; else process.env.CADRE_TEST_GH_MARKER = originalMarker;
  }
});
test("published checkpoints target only the owning branch and preserve default", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "product.txt"), "approved delivery\n"); f.git("add", "product.txt"); f.git("commit", "-m", "delivery");
  markPending(f.client, "phase-complete", ["product.txt"]);
  const head = f.git("rev-parse", "HEAD"), result = publish(f.client, "phase-complete");
  assert.equal(result.published, head); assert.equal(readSession(f.root)?.pending, null);
  assert.equal(f.git("ls-remote", "origin", "refs/heads/main").split("\t")[0], f.base);
  assert.ok(f.calls.some((call) => call.args.join(" ") === `push origin ${head}:refs/heads/${f.branch}`));
  assert.ok(!f.calls.some((call) => call.args.includes("--force") || call.args.includes("--all") || call.args.includes("--mirror")));
});
test("dirty checkpoints are never staged or committed by publication", (t) => {
  const f = fixture(t), before = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.root, "product.txt"), "unapproved\n"); markPending(f.client, "task-complete", ["product.txt"]);
  assert.throws(() => publish(f.client, "task-complete"), /not committed/);
  assert.equal(f.git("rev-parse", "HEAD"), before); assert.equal(f.git("diff", "--cached"), "");
  assert.equal(readFileSync(join(f.root, "product.txt"), "utf8"), "unapproved\n");
});
test("failed and uncertain push responses recover without repeating work", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "product.txt"), "delivery\n"); f.git("add", "product.txt"); f.git("commit", "-m", "delivery");
  const head = f.git("rev-parse", "HEAD"); markPending(f.client, "task-complete", ["product.txt"]);
  f.failPush(); assert.throws(() => publish(f.client, "task-complete"), /publication blocked/);
  assert.ok(readSession(f.root)?.pending); assert.equal(f.git("rev-parse", "HEAD"), head);
  f.allowPush(); f.uncertainPush();
  assert.equal(publish(f.client, "task-complete").published, head);
  assert.equal(readSession(f.root)?.pending, null);
});
test("concurrent coordination writers cannot overwrite a reservation", (t) => {
  const f = fixture(t), previous = readLedger(f.client)!;
  const next = structuredClone(previous.value); next.operations[0]!.lease = null;
  f.race(); assert.throws(() => writeLedger(f.client, previous, next), /coordination changed/);
  assert.equal(readLedger(f.client)!.head, previous.head);
});
test("expired leases, removed protection, wrong branches and offline GitHub block publication", (t) => {
  const f = fixture(t);
  assert.throws(() => requireLease({ ...f.ledger().operations[0]!, lease: { owner: "other", token, expires: 0 } }, token), /lease/);
  f.git("switch", "main"); assert.throws(() => publish(f.client, "checkpoint"), /Continue/);
  f.git("switch", f.branch); f.protection({}); assert.throws(() => requireProtection(f.client, "main"));
  f.failAPI(403); assert.throws(() => f.client.file(f.base, ".cadre/project.json"), /Cannot read/);
});
test("missing files are distinct from unavailable GitHub; discovery paginates", (t) => {
  const f = fixture(t);
  assert.equal(f.client.file(f.base, ".cadre/missing.json"), null);
  f.client.prs(); assert.ok(f.calls.some((call) => call.args.includes("--paginate") && call.args.includes("--slurp")));
  f.failAPI(429); assert.throws(() => f.client.file(f.base, ".cadre/missing.json"), /Cannot read/);
});
test("resource reservations cover overlapping tracks and dependency cycles are rejected", () => {
  assert.equal(blocks({ workflow: "create", tracks: [] }, { workflow: "track", tracks: ["a"] }), true);
  assert.equal(blocks({ workflow: "archive", tracks: ["a", "b"] }, { workflow: "implement", tracks: ["b"] }), true);
  assert.equal(blocks({ workflow: "implement", tracks: ["a"] }, { workflow: "implement", tracks: ["b"] }), false);
  assert.throws(() => assertAcyclic(new Map([["a", ["b"]], ["b", ["a"]]])), /cycle/);
  assertAcyclic(new Map([["a", []], ["b", ["a"]]]));
});
test("phase synchronization refuses dirty work and stale approval digests", (t) => {
  const f = fixture(t);
  const proposal = previewSync(f.client);
  assert.throws(() => synchronize(f.client, "0".repeat(64)), /proposal changed/);
  writeFileSync(join(f.root, "product.txt"), "uncommitted\n");
  assert.throws(() => synchronize(f.client, proposal.digest), /Commit and publish/);
  assert.equal(readFileSync(join(f.root, "product.txt"), "utf8"), "uncommitted\n");
});
test("configuration is opt-in, strict and resistant to path traversal/symlinks", (t) => {
  const f = fixture(t);
  assert.throws(() => configSchema.parse({ ...f.config, mode: "local" }));
  assert.throws(() => safePath(f.root, "../elsewhere"));
  symlinkSync(tmpdir(), join(f.root, "unsafe"));
  assert.throws(() => safePath(f.root, "unsafe/file"), /symbolic/);
  rmSync(join(f.root, ".cadre/github.json"));
  assert.deepEqual(readConfig(f.root), f.config);
});
test("existing reservations are returned with their PR instead of creating duplicates", (t) => {
  const f = fixture(t);
  const preview = previewBegin(f.client, { workflow: "refresh", tracks: [] });
  assert.equal(preview.existing?.pr, 1);
  assert.equal(preview.existing?.url, "https://github.com/test/project/pull/1");
});
test("enforcement uses a pinned validator and never checks out executable PR code", (t) => {
  const f = fixture(t), files = enforcementFiles(f.client), workflow = files[".github/workflows/cadre-github.yml"]!;
  assert.match(workflow, /pull_request_target/); assert.match(workflow, /ref: "main"/);
  assert.match(workflow, /--ignore-scripts/); assert.match(workflow, /cadre-ai@4.0.0/);
  assert.match(workflow, /environment: cadre-github/);
  assert.doesNotMatch(workflow, /contents: write|statuses: write/);
  assert.doesNotMatch(workflow, /pull_request_review:|pull_request.head|npm test|npm run/);
  assert.match(files[".github/CODEOWNERS"]!, /@maintainer/);
});
test("candidate validator archive is digest-pinned on trusted default and governance-owned", (t) => {
  const f = fixture(t);
  const config = { ...f.config, validatorArchiveSha256: "a".repeat(64) };
  const client = new GitHubClient(f.root, config, f.client.run);
  const files = enforcementFiles(client), workflow = files[".github/workflows/cadre-github.yml"]!;
  assert.match(workflow, /ref: "main"/);
  assert.match(workflow, /a{64}/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.match(workflow, /--ignore-scripts.*\$GITHUB_WORKSPACE\/\.github\/cadre\/validator\.tgz/);
  assert.doesNotMatch(workflow, /cadre-ai@/);
  assert.match(files[".github/CODEOWNERS"]!, /\/\.github\/cadre\/ @maintainer/);
  assert.throws(() => new GitHubClient(f.root, { ...config, validatorArchiveSha256: "$(whoami)" }, f.client.run));
});
test("validator credentials are isolated to default and environment drift blocks mutations", (t) => {
  const f = fixture(t);
  let environment: unknown = null, policies: Array<{ name: string; type: string }> = [];
  let writes = 0;
  const client = new GitHubClient(f.root, f.config, (command, args, input) => {
    const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
    if (command !== "gh" || !path.includes("/environments/")) return f.client.run(command, args, input);
    const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
    if (method !== "GET") {
      writes++;
      if (method === "PUT") environment = JSON.parse(input!);
      else policies.push(JSON.parse(input!));
    }
    if (environment === null) return { status: 1, stdout: "", stderr: "Not Found (HTTP 404)" };
    const value = path.includes("deployment-branch-policies") ? [{ branch_policies: policies }] : environment;
    return { status: 0, stdout: JSON.stringify(value), stderr: "" };
  });
  assert.throws(() => requireValidatorEnvironment(client, "main"), /restrict access/);
  configureValidatorEnvironment(client, "main");
  assert.equal(writes, 2);
  configureValidatorEnvironment(client, "main"); assert.equal(writes, 2, "recovery does not reset existing settings");
  preflight(client);
  policies.push({ name: "refs/pull/*/merge", type: "branch" });
  assert.throws(() => preflight(client), /only the exact default/);
  assert.throws(() => configureValidatorEnvironment(client, "main"), /only the exact default/);
  policies = [{ name: "main", type: "tag" }];
  assert.throws(() => requireValidatorEnvironment(client, "main"), /only the exact default/);
  environment = { deployment_branch_policy: null };
  assert.throws(() => configureValidatorEnvironment(client, "main"), /reconcile existing/);
  assert.equal(writes, 2, "unsafe existing environments are never overwritten");
});
test("concurrent collaborator pushes never get overwritten by checkpoint publication", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "product.txt"), "local approved work\n");
  f.git("add", "product.txt"); f.git("commit", "-m", "local"); const head = f.git("rev-parse", "HEAD");
  f.advanceCollaborator();
  assert.throws(() => publish(f.client, "phase"), /Collaborator advanced/);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.ok(!f.calls.some((call) => call.args.includes("--force")));
});
test("direct default pushes persist an incident instead of treating delivery as accepted", (t) => {
  const f = fixture(t), before = readLedger(f.client)!.value.audited, changed = f.advanceDefault();
  assert.throws(() => audit(f.client), /Unverified default change/);
  assert.match(f.ledger().incident!, new RegExp(changed));
  assert.equal(f.ledger().audited, before);
  assert.throws(() => publish(f.client, "checkpoint"), /Unverified default change/);
  assert.throws(() => previewBegin(f.client, { workflow: "refresh", tracks: [] }), /Unverified default change/);
});
test("implementation waits for merged plans and completed prerequisite delivery", (t) => {
  const f = fixture(t), op = { ...f.ledger().operations[0]!, workflow: "implement" as const, tracks: ["b"] };
  assert.throws(() => requireDependencies(f.client, op, f.base, true), /plan is not merged/);
  const original = f.client.file.bind(f.client);
  f.client.file = (ref, path) => {
    const id = /tracks\/([^/]+)\/state.json$/.exec(path)?.[1];
    return id ? json({ trackId: id, revision: 1, status: "planned", dependencies: id === "b" ? ["a"] : [] }) : original(ref, path);
  };
  assert.throws(() => requireDependencies(f.client, op, f.base, true), /Dependency a is not complete/);
});

test("synchronization requires checkpoint publication before the next phase", (t) => {
  const f = fixture(t), base = f.advanceDefault();
  // Simulate a default advance already verified by the lifecycle auditor.
  const snapshot = readLedger(f.client)!;
  writeLedger(f.client, snapshot, { ...snapshot.value, audited: base });
  const proposal = previewSync(f.client);
  synchronize(f.client, proposal.digest);
  assert.equal(f.git("merge-base", "HEAD", base), base);
  assert.equal(f.git("show", "-s", "--format=%P", "HEAD").split(" ").length, 2);
  assert.throws(() => preflight(f.client, { phase: true }), /publication/);
  publish(f.client, "default-sync");
  assert.equal(preflight(f.client, { phase: true }).operation.synchronized, base);
});

test("default synchronization preserves explicit merge conflicts and blocks scheduling", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "product.txt"), "approved branch edit\n"); f.git("add", "product.txt"); f.git("commit", "-m", "work");
  publish(f.client, "work");
  const base = f.advanceDefault(), snapshot = readLedger(f.client)!;
  writeLedger(f.client, snapshot, { ...snapshot.value, audited: base });
  assert.throws(() => synchronize(f.client, previewSync(f.client).digest), /explicit conflict/);
  assert.ok(f.git("ls-files", "-u"));
  assert.match(readFileSync(join(f.root, "product.txt"), "utf8"), /<<<<<<< HEAD/);
  assert.throws(() => preflight(f.client, { phase: true }), /Phase boundary/);
});

test("interrupted approved artifacts cannot be published as completed checkpoints", (t) => {
  const f = fixture(t);
  const content = "approved future artifact\n";
  markPending(f.client, "receipt:interrupted", ["approved.txt"], {
    "approved.txt": createHash("sha256").update(content).digest("hex")
  });
  assert.throws(() => publish(f.client, "resume"), /approved durable content/);
  writeFileSync(join(f.root, "approved.txt"), content); f.git("add", "approved.txt"); f.git("commit", "-m", "resume approved artifact");
  publish(f.client, "resume");
  assert.equal(readSession(f.root)?.pending, null);
});

test("an independent writer joins the existing PR only after lease release", (t) => {
  const f = fixture(t), session = readSession(f.root)!;
  const other = "0701f8d3-8071-4926-94a3-c4bd58ca01aa";
  writeSession(f.root, { ...session, token: other });
  const input = { workflow: "refresh" as const, tracks: [] };
  assert.throws(() => begin(f.client, input, previewBegin(f.client, input).digest), /must release/);
  writeSession(f.root, session); renew(f.client, true);
  writeSession(f.root, { ...session, token: other });
  const joined = begin(f.client, input, previewBegin(f.client, input).digest);
  assert.equal(joined.pr, 1); assert.equal(joined.branch, f.branch); assert.equal(joined.lease?.token, other);
  assert.ok(!f.calls.some((call) => call.command === "gh" && call.args[0] === "pr" && call.args[1] === "create"));
});

test("configuration preserves ownership rules and resumes an approved partial write", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, ".github")); writeFileSync(join(f.root, ".github/CODEOWNERS"), "*.ts @existing-owner\n");
  const proposal = previewConfigure(f.root, f.config, f.client), session = readSession(f.root)!;
  writeSession(f.root, { ...session, configuration: proposal });
  writeFileSync(join(f.root, ".cadre/github.json"), proposal.files[".cadre/github.json"]!);
  configure(f.root, f.config, proposal.digest, f.client);
  assert.equal(readFileSync(join(f.root, ".github/CODEOWNERS"), "utf8"), proposal.files[".github/CODEOWNERS"]);
  assert.deepEqual(enforcementFiles(f.client), proposal.files);
  assert.equal(readSession(f.root)?.configuration, undefined);
});

test("stale approvals, author approval and unsuccessful exact-head CI cannot authorize delivery", (t) => {
  const f = fixture(t), head = f.git("rev-parse", "HEAD");
  let reviews: unknown[] = [{ user: { login: "fixture" }, state: "APPROVED", commit_id: head }];
  let statuses: unknown[] = [{ context: "cadre-github", state: "success" }];
  let runs = [{ name: "tests", head_sha: head, status: "completed", conclusion: "success" }];
  const client = new GitHubClient(f.root, f.config, (command, args, input) => {
    if (command === "gh") {
      const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
      const value = path.includes("/reviews?") ? [reviews] : path.includes("/statuses?") ? [statuses]
        : path.includes("/check-runs?") ? [{ check_runs: runs }] : null;
      if (value) return { status: 0, stdout: JSON.stringify(value), stderr: "" };
    }
    return f.client.run(command, args, input);
  });
  assert.throws(() => requireIndependentApproval(client, 1, head), /Independent/);
  reviews = [{ user: { login: "teammate" }, state: "APPROVED", commit_id: f.base }];
  assert.throws(() => requireIndependentApproval(client, 1, head), /Independent/);
  reviews = [{ user: { login: "teammate" }, state: "APPROVED", commit_id: head }];
  requireIndependentApproval(client, 1, head); requireSuccessfulChecks(client, head);
  statuses = [{ context: "cadre-github", state: "failure" }];
  assert.throws(() => requireSuccessfulChecks(client, head), /cadre-github/);
  statuses = [{ context: "cadre-github", state: "success" }]; runs = [];
  assert.throws(() => requireSuccessfulChecks(client, head), /tests/);
});

test("simultaneous start proposals and an uncertain PR response converge on one reservation", (t) => {
  const f = fixture(t), snapshot = readLedger(f.client)!;
  writeLedger(f.client, snapshot, { ...snapshot.value, operations: [] });
  let branch: string | null = null, published = false, created = 0;
  const commit = "a".repeat(40), tree = "b".repeat(40);
  const client = new GitHubClient(f.root, f.config, (command, args, input) => {
    if (command !== "gh") return f.client.run(command, args, input);
    if (args[0] === "pr" && args[1] === "create") {
      assert.ok(branch, "the atomic reservation and branch precede PR creation");
      assert.equal(readLedger(f.client)!.value.operations.length, 1);
      created++; published = true;
      return { status: 1, stdout: "", stderr: "connection lost after creating draft" };
    }
    const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
    const path = endpoint.replace("repos/test/project", ""), body = input ? JSON.parse(input) : null;
    const respond = (value: unknown) => ({ status: 0, stdout: JSON.stringify(value), stderr: "" });
    if (path.startsWith("/contents/.cadre/project.json")) return respond({ type: "file", encoding: "base64", content: Buffer.from("{}").toString("base64") });
    if (path === `/git/commits/${f.base}`) return respond({ tree: { sha: tree } });
    if (path === "/git/trees" && body?.base_tree) return respond({ sha: tree });
    if (path === "/git/commits" && body?.message?.includes("reserve ")) return respond({ sha: commit });
    if (path.startsWith("/git/ref/heads/cadre/github/")) return branch ? respond({ object: { sha: commit } })
      : { status: 1, stdout: "", stderr: "Not Found (HTTP 404)" };
    if (path === "/git/refs") { branch = body.ref.replace("refs/heads/", ""); return respond({ object: { sha: commit } }); }
    if (path.startsWith("/pulls")) {
      const pr = { number: 2, html_url: "https://github.com/test/project/pull/2", state: "open", draft: true,
        merged: false, merge_commit_sha: null, user: { login: "fixture" },
        head: { sha: commit, ref: branch, repo: { full_name: "test/project" } },
        base: { sha: f.base, ref: "main", repo: { full_name: "test/project" } } };
      return respond(args.includes("--paginate") ? [published ? [pr] : []] : pr);
    }
    return f.client.run(command, args, input);
  });
  const input = { workflow: "track" as const, tracks: ["new-feature"] };
  const first = previewBegin(client, input), simultaneous = previewBegin(client, input);
  assert.equal(first.digest, simultaneous.digest);
  const operation = begin(client, input, first.digest);
  assert.equal(operation.pr, 2);
  assert.throws(() => begin(client, input, simultaneous.digest), /proposal changed/);
  const resumed = begin(client, input, previewBegin(client, input).digest);
  assert.equal(resumed.id, operation.id); assert.equal(created, 1);
  assert.equal(readLedger(client)!.value.operations.length, 1);
});

test("activation stays blocked until exact trusted enforcement succeeds and preserves stronger protection", (t) => {
  const f = fixture(t), snapshot = readLedger(f.client)!;
  writeLedger(f.client, snapshot, { ...snapshot.value, active: false });
  const originalFile = f.client.file.bind(f.client), originalRepo = f.client.repo.bind(f.client);
  const files = enforcementFiles(f.client);
  let conclusion = "failure";
  f.client.file = (ref, path) => ref === f.base && path in files ? files[path]! : originalFile(ref, path);
  f.client.repo = (path = "", method = "GET", body) => path.startsWith("/actions/workflows/") ? {
    workflow_runs: [{ head_sha: f.base, conclusion, path: ".github/workflows/cadre-github.yml" }]
  } : originalRepo(path, method, body);
  let proposal = previewActivation(f.client);
  assert.throws(() => activate(f.client, proposal.digest), /successfully validate/);
  assert.equal(f.ledger().active, false);
  const protection = originalRepo("/branches/main/protection") as Record<string, unknown>;
  f.protection({ ...protection, restrictions: { users: [] } });
  assert.throws(() => previewActivation(f.client), /will not overwrite/);
  f.protection({ ...protection, required_linear_history: { enabled: true } });
  assert.throws(() => previewActivation(f.client), /will not weaken/);
  f.protection(protection); conclusion = "success";
  proposal = previewActivation(f.client);
  assert.deepEqual(proposal.rules.required_status_checks.checks.map((check) => check.context), ["cadre-github", "tests"]);
  assert.equal("contexts" in proposal.rules.required_status_checks, false);
  assert.equal("bypass_pull_request_allowances" in proposal.rules.required_pull_request_reviews, false);
  activate(f.client, proposal.digest);
  assert.equal(f.ledger().active, true);
  const personalRepo = f.client.repo.bind(f.client);
  f.client.repo = (path = "", method = "GET", body) => {
    const value = personalRepo(path, method, body);
    return !path && method === "GET" ? { ...(value as Record<string, unknown>), owner: { type: "Organization" } } : value;
  };
  assert.deepEqual(previewActivation(f.client).rules.required_pull_request_reviews.bypass_pull_request_allowances,
    { users: [], teams: [], apps: [] });
});

test("trusted inspection does not execute filters requested by PR attributes", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".gitattributes"), "*.txt filter=untrusted\n");
  f.git("add", ".gitattributes"); f.git("commit", "-m", "PR-controlled attributes");
  f.git("push", "origin", `HEAD:refs/heads/${f.branch}`);
  inspectHead(f.client, f.git("rev-parse", "HEAD"), (checkout) => {
    assert.equal(readFileSync(join(checkout.root, "product.txt"), "utf8"), "baseline\n");
  }, (root) => {
    const checkout = new GitHubClient(root, f.config, (command, args, input) => {
      assert.equal(command, "git");
      const actual = args[0] === "remote" && args[1] === "set-url" ? ["remote", "set-url", "origin", f.remote] : args;
      const result = spawnSync("git", actual, { cwd: root, encoding: "utf8", input });
      return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    });
    checkout.git("config", "filter.untrusted.smudge", "false");
    checkout.git("config", "filter.untrusted.required", "true");
    return checkout;
  });
});

test("verified conflict reconciliation needs fresh approval before replacing pending checkpoint expectations", async (t) => {
  const project = await plannedFixture(t), f = fixture(t, project.root);
  writeFileSync(join(f.root, "product.txt"), "approved local work\n");
  f.git("add", "product.txt"); f.git("commit", "-m", "local approved work");
  markPending(f.client, "task", ["product.txt"]);
  assert.throws(() => renew(f.client, true), /pending checkpoint/);
  f.advanceCollaborator(); f.git("fetch", "origin", f.branch); f.git("merge", "--no-edit", "--no-ff", "FETCH_HEAD");
  writeFileSync(join(f.root, "product.txt"), "verified combined work\n");
  f.git("add", "product.txt"); f.git("commit", "-m", "reconcile and verify");
  assert.throws(() => publish(f.client, "reconciled"), /approved durable content/);
  const evidence = "Reconciled both collaborators' changes and reran affected verification.";
  const preview = reconcilePublication(f.client, evidence) as { digest: string };
  assert.throws(() => reconcilePublication(f.client, evidence, "0".repeat(64)), /approve again/);
  reconcilePublication(f.client, evidence, preview.digest);
  assert.ok(readSession(f.root)?.pending);
  publish(f.client, "reconciled");
  assert.equal(readSession(f.root)?.pending, null);
});

test("same-PR scope changes pause execution inside a phase until fresh assessment", async (t) => {
  const project = await plannedFixture(t), f = fixture(t, project.root), original = f.client.file.bind(f.client);
  f.client.file = (ref, path) => {
    if (!path.startsWith(".cadre/tracks/")) return original(ref, path);
    const blob = f.client.run("git", ["show", `${ref}:${path}`]);
    return blob.status === 0 ? blob.stdout : null;
  };
  const snapshot = readLedger(f.client)!, next = structuredClone(snapshot.value), operation = next.operations[0]!;
  operation.workflow = "implement"; operation.tracks = ["sample"];
  operation.assessment = { base: f.base, scope: scopeDigest(f.client, ["sample"]), evidence: "Approved initial plan assessed against current default" };
  writeLedger(f.client, snapshot, next);
  preflight(f.client, { execution: true });
  const spec = join(f.root, ".cadre/tracks/sample/spec.md");
  writeFileSync(spec, readFileSync(spec, "utf8") + "\nChanged scope needs independent approval.\n");
  f.git("add", ".cadre/tracks/sample/spec.md"); f.git("commit", "-m", "scope revision checkpoint");
  assert.throws(() => preflight(f.client, { execution: true }), /Fresh plan\/dependency assessment/);
});
