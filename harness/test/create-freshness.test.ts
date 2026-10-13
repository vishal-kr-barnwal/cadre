import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCadreServer } from "../src/mcp/server.js";
import { previewProjectInitCandidate, applyProjectInitCandidate } from "../src/domain/init.js";
import { promoteOperation, resumeOperation } from "../src/domain/operation-receipts.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { git, json, read, write, commit } from "./helpers/revision-fixture.js";

function brownfield(t: {after: (fn: () => void) => void}) {
  const root = mkdtempSync(join(tmpdir(), "cadre-create-basis-")); t.after(() => rmSync(root, {recursive: true, force: true}));
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "commit.gpgsign", "false");
  write(root, "package.json", json({name: "existing-service", type: "module"}));
  write(root, "src/service.js", 'export const transport = "http";\n'); git(root, "add", "."); git(root, "commit", "-m", "existing HTTP service");
  const stagedFiles = ["product.md", "guidelines.md", "tech-stack.md"]; prepareCandidateStage(root, "create", stagedFiles);
  write(root, ".cadre/stage/create/product.md", "# Product\nExisting HTTP service. User asks for retries with compatible HTTP behavior.\n");
  write(root, ".cadre/stage/create/guidelines.md", "# Guidelines\nPreserve existing JavaScript ESM conventions.\n");
  write(root, ".cadre/stage/create/tech-stack.md", "# Stack\nJavaScript ESM and HTTP.\n");
  return {root, input: {projectRoot: root, projectName: "Existing", context: "brownfield" as const, gitDisposition: "existing" as const,
    baseCommit: git(root, "rev-parse", "HEAD"), approvedAt: "2026-10-13T00:00:00Z", stagedFiles, styleguideIds: ["project/styleguides/general"]}};
}
for (const name of ["codex", "claude-code", "zed"]) for (const scenario of ["unchanged", "head", "dirty", "staged", "untracked", "canonical", "initialized", "candidate"]) {
  test(`create binds repository and canonical state: ${name}/${scenario}`, async (t) => {
    const {root, input} = brownfield(t), server = createCadreServer(), client = new Client({name, version: "3.9.2"});
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
    t.after(async () => {await client.close(); await server.close();});
    const call = async (request: Record<string, unknown>) => {
      const r = await client.callTool({name: "project_init_candidate", arguments: {request}});
      return {r, data: (r.structuredContent ?? JSON.parse((r.content as Array<{text: string}>)[0]!.text)) as Record<string, any>};
    };
    const prepared = await call({mode: "prepare", ...input}); assert.equal(prepared.r.isError, undefined);
    if (["head", "dirty", "staged"].includes(scenario)) {
      write(root, "src/service.js", 'export const transport = "grpc";\n');
      if (scenario !== "dirty") git(root, "add", "src/service.js");
      if (scenario === "head") git(root, "commit", "-m", "later transport change");
    }
    if (scenario === "untracked") write(root, "src/grpc.js", "new transport\n");
    if (scenario === "canonical") write(root, ".cadre/product.md", "# Retain independent product\n");
    if (scenario === "candidate") write(root, ".cadre/stage/create/product.md", "# Different proposal\n");
    if (scenario === "initialized") {
      const newer = await call({mode: "prepare", ...input, projectName: "Newer"}); assert.equal(newer.r.isError, undefined);
      const result = await call({mode: "apply", proposalToken: newer.data.proposalToken}); assert.equal(result.r.isError, undefined); commit(root, result.data.receipt);
    }
    const status = git(root, "status", "--porcelain"), index = git(root, "write-tree"), head = git(root, "rev-parse", "HEAD");
    const applied = await call({mode: "apply", proposalToken: prepared.data.proposalToken});
    if (scenario === "unchanged") {
      assert.equal(applied.r.isError, undefined); assert.match(read(root, ".cadre/product.md"), /User asks for retries/);
      assert.match(read(root, ".cadre/guidelines.md"), /existing JavaScript ESM/); commit(root, applied.data.receipt);
    } else {
      assert.equal(applied.r.isError, true, "Stale setup must fail before promotion");
      assert.equal(git(root, "status", "--porcelain"), status); assert.equal(git(root, "write-tree"), index); assert.equal(git(root, "rev-parse", "HEAD"), head);
      if (scenario === "canonical") assert.equal(read(root, ".cadre/product.md"), "# Retain independent product\n");
      if (scenario === "initialized") assert.equal(JSON.parse(read(root, ".cadre/project.json")).project.name, "Newer");
    }
  });
}
for (const checkpoint of ["intent", "partial"]) test(`create recovery retains repository evidence after ${checkpoint}`, (t) => {
  const {root, input} = brownfield(t), p = previewProjectInitCandidate(input);
  assert.throws(() => promoteOperation(root, {operationId: p.operationId!, kind: "create", approvalDigest: p.digest,
    baseCommit: input.baseCommit, createBasis: p.repositoryBasis!}, p.files.map((file) => ({path: `.cadre/${file.path}`, content: file.content})),
    (path) => {if (checkpoint === "intent" || path.endsWith("/project.json")) throw Error("fixture crash");}), /fixture crash/);
  rmSync(join(root, ".cadre/stage/create"), {recursive: true});
  const intentPath = `.cadre/stage/operations/${p.operationId}.json`, intent = read(root, intentPath);
  write(root, "src/service.js", "unapproved drift\n");
  assert.throws(() => resumeOperation(root, p.operationId!, p.digest), /Repository inputs changed/); assert.equal(read(root, intentPath), intent);
  write(root, "src/service.js", 'export const transport = "http";\n'); commit(root, applyProjectInitCandidate(input, p.digest).receipt!);
  write(root, "later.txt", "Later user work\n");
  const state = read(root, ".cadre/project.json"); assert.equal(applyProjectInitCandidate(input, p.digest).receipt!.status, "committed"); assert.equal(read(root, ".cadre/project.json"), state);
});
test("create rejects an incorrect Git base and nested repository root", (t) => {
  const {root, input} = brownfield(t);
  assert.throws(() => previewProjectInitCandidate({...input, baseCommit: "a".repeat(40)}), /Git disposition\/baseCommit/);
  const nested = join(root, "nested"); write(root, "nested/README.md", "Nested\n"); prepareCandidateStage(nested, "create", input.stagedFiles);
  for (const file of input.stagedFiles) write(nested, `.cadre/stage/create/${file}`, read(root, `.cadre/stage/create/${file}`));
  assert.throws(() => previewProjectInitCandidate({...input, projectRoot: nested}), /exact Git worktree root/);
});

for (const missing of [false, true]) test(`create recovery cannot replace ${missing ? "missing" : "forged"} approval evidence`, (t) => {
  const {root, input} = brownfield(t), p = previewProjectInitCandidate(input);
  assert.throws(() => promoteOperation(root, {operationId: p.operationId!, kind: "create", approvalDigest: p.digest,
    baseCommit: input.baseCommit, createBasis: p.repositoryBasis!}, p.files.map((file) => ({path: `.cadre/${file.path}`, content: file.content})), () => {throw Error("fixture crash");}), /fixture crash/);
  const path = `.cadre/stage/operations/${p.operationId}.json`, intent = JSON.parse(read(root, path));
  if (missing) delete intent.createBasis; else intent.createBasis.files[0].sha256 = "a".repeat(64);
  write(root, path, json(intent)); const before = read(root, path), status = git(root, "status", "--porcelain");
  assert.throws(() => resumeOperation(root, p.operationId!, p.digest), /original approval digest|lacks approved repository evidence/);
  assert.equal(read(root, path), before); assert.equal(git(root, "status", "--porcelain"), status);
});

test("create accepts an existing Git worktree with no first commit", (t) => {
  const root = mkdtempSync(join(tmpdir(), "cadre-unborn-create-")); t.after(() => rmSync(root, {recursive: true, force: true}));
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "commit.gpgsign", "false");
  const stagedFiles = ["product.md", "guidelines.md", "tech-stack.md"]; prepareCandidateStage(root, "create", stagedFiles);
  for (const file of stagedFiles) write(root, `.cadre/stage/create/${file}`, `# ${file}\nUser-requested future HTTP service.\n`);
  const input = {projectRoot: root, projectName: "Unborn", context: "greenfield" as const, gitDisposition: "existing" as const,
    baseCommit: null, approvedAt: "2026-10-13T00:00:00Z", stagedFiles, styleguideIds: ["project/styleguides/general"]};
  const p = previewProjectInitCandidate(input); commit(root, applyProjectInitCandidate(input, p.digest).receipt!);
  assert.equal(git(root, "rev-list", "--count", "HEAD"), "1");
  assert.equal(git(root, "branch", "--show-current"), "main");
});
