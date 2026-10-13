import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireRevertGitProof } from "../src/domain/revert-git.js";
import { captureRepositoryBasis } from "../src/domain/repository-basis.js";
import { requireRevertScope } from "../src/domain/revert-scope.js";
import type { ExecutionNode } from "../src/domain/execution.js";
import { git, write } from "./helpers/revision-fixture.js";

function repository(t: {after: (fn: () => void) => void}) {
  const root = mkdtempSync(join(tmpdir(), "cadre-git-reversal-")); t.after(() => rmSync(root, {recursive: true, force: true}));
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "commit.gpgsign", "false");
  write(root, "product.txt", "start\nbefore\nend\n"); git(root, "add", "."); git(root, "commit", "-m", "initial");
  return root;
}
const head = (root: string) => git(root, "rev-parse", "HEAD");
function delivered(commits: string[]) {
  const nodes: Record<string, Pick<ExecutionNode, "id" | "kind" | "phaseId" | "workerCommit" | "mergeCommit">> = {P1: {id: "P1", phaseId: "P1", kind: "phase", workerCommit: null, mergeCommit: null}};
  commits.forEach((commit, i) => {nodes[`T1.${i + 1}`] = {id: `T1.${i + 1}`, phaseId: "P1", kind: "task", workerCommit: commit, mergeCommit: null};});
  return {trackId: "sample", nodes};
}
const approve = (baseCommit: string, commits: string[], revertCommits: string[]) => ({baseCommit, commits, revertCommits, targetKind: "phase", targetId: "P1"});

for (const kind of ["text", "binary", "mode", "rename"]) test(`reverse proof verifies ${kind} while preserving Git state`, (t) => {
  const root = repository(t);
  if (kind === "text") write(root, "product.txt", "start\nafter\nend\n");
  if (kind === "binary") writeFileSync(join(root, "binary.dat"), Buffer.from([0, 255, 1, 32]));
  if (kind === "mode") chmodSync(join(root, "product.txt"), 0o755);
  if (kind === "rename") git(root, "mv", "product.txt", "renamed.txt");
  git(root, "add", "."); git(root, "commit", "-m", `feat: ${kind}`); const target = head(root);
  write(root, "unrelated.txt", "Retain approved later work\n"); git(root, "add", "."); git(root, "commit", "-m", "feat: later work"); const base = head(root);
  git(root, "revert", "--no-edit", target); const reversal = head(root);
  const index = git(root, "write-tree"), objects = git(root, "count-objects", "-v"), status = git(root, "status", "--porcelain");
  requireRevertGitProof(root, approve(base, [target], [reversal]), delivered([target]));
  assert.equal(head(root), reversal); assert.equal(git(root, "write-tree"), index);
  assert.equal(git(root, "count-objects", "-v"), objects); assert.equal(git(root, "status", "--porcelain"), status);
});

for (const targetKind of ["phase", "track"]) test(`reverse proof verifies ordered multi-commit ${targetKind}`, (t) => {
  const root = repository(t);
  write(root, "first.txt", "first\n"); git(root, "add", "."); git(root, "commit", "-m", "first"); const first = head(root);
  write(root, "second.txt", "second\n"); git(root, "add", "."); git(root, "commit", "-m", "second"); const second = head(root);
  git(root, "revert", "--no-edit", second); const reverseSecond = head(root);
  git(root, "revert", "--no-edit", first); const reverseFirst = head(root);
  const input = {...approve(second, [second, first], [reverseSecond, reverseFirst]), targetKind, targetId: targetKind === "track" ? "sample" : "P1"};
  requireRevertGitProof(root, input, delivered([first, second]));
  assert.throws(() => requireRevertGitProof(root, {...input, commits: [first, second]}, delivered([first, second])), /conflicts|does not match/);
  assert.throws(() => requireRevertGitProof(root, {...input, revertCommits: [reverseSecond]}, delivered([first, second])), /one distinct actual reversal/);
  assert.throws(() => requireRevertGitProof(root, {...input, commits: [second, second.slice(0, 9)]}, delivered([first, second])), /alias/);
  assert.throws(() => requireRevertGitProof(root, input, delivered([second])), /retained execution commit provenance/);
});

for (const mainline of [1, 2]) test(`merge reversal requires its approved mainline ${mainline}`, (t) => {
  const root = repository(t); git(root, "checkout", "-b", "feature");
  write(root, "feature.txt", "feature\n"); git(root, "add", "."); git(root, "commit", "-m", "feature");
  git(root, "checkout", "main"); write(root, "main.txt", "main\n"); git(root, "add", "."); git(root, "commit", "-m", "main work");
  git(root, "merge", "--no-ff", "feature", "-m", "merge feature"); const target = head(root);
  git(root, "revert", "--no-edit", "-m", String(mainline), target); const reversal = head(root), input = approve(target, [target], [reversal]);
  assert.throws(() => requireRevertGitProof(root, input, delivered([target])), /mainline/);
  requireRevertGitProof(root, {...input, mainlineParents: {[target]: mainline}}, delivered([target]));
  assert.throws(() => requireRevertGitProof(root, {...input, mainlineParents: {[target]: mainline === 1 ? 2 : 1}}, delivered([target])), /does not match/);
});

test("conflict resolution requires an exact approved tree and bounded target paths", (t) => {
  const root = repository(t); write(root, "product.txt", "start\nafter\nend\n");
  git(root, "add", "."); git(root, "commit", "-m", "feature"); const target = head(root);
  write(root, "product.txt", "start\nlater\nend\n"); git(root, "add", "."); git(root, "commit", "-m", "later overlapping work"); const base = head(root);
  assert.throws(() => git(root, "revert", "--no-edit", target));
  write(root, "product.txt", "start\nexplicit approved resolution\nend\n"); git(root, "add", "."); git(root, "revert", "--continue"); const reversal = head(root);
  const input = approve(base, [target], [reversal]), tree = git(root, "rev-parse", "HEAD^{tree}");
  assert.throws(() => requireRevertGitProof(root, input, delivered([target])), /conflictResolutionTrees/);
  requireRevertGitProof(root, {...input, conflictResolutionTrees: {[target]: tree}}, delivered([target]));
  assert.throws(() => requireRevertGitProof(root, {...input, conflictResolutionTrees: {[target]: git(root, "rev-parse", `${base}^{tree}`)}}, delivered([target])), /does not match/);
  write(root, "unrelated.txt", "not in target\n"); git(root, "add", "."); git(root, "commit", "-m", "unrelated change");
  const combined = head(root), extraTree = git(root, "rev-parse", "HEAD^{tree}");
  // Use the conflict commit parent with a combined resolution to exercise the bounded-path guard.
  git(root, "checkout", "-b", "combined", base); write(root, "product.txt", "start\nexplicit approved resolution\nend\n"); write(root, "unrelated.txt", "not in target\n");
  git(root, "add", "."); git(root, "commit", "-m", "combined resolution");
  assert.equal(git(root, "rev-parse", "HEAD^{tree}"), extraTree);
  assert.throws(() => requireRevertGitProof(root, {...input, revertCommits: [head(root)], conflictResolutionTrees: {[target]: extraTree}}, delivered([target])), /outside the reversal target/);
  assert.notEqual(head(root), combined);
});

test("reversal follows a later rename without changing the source Git store", (t) => {
  const root = repository(t); write(root, "product.txt", "start\nafter\nend\n"); git(root, "add", "."); git(root, "commit", "-m", "feature"); const target = head(root);
  git(root, "mv", "product.txt", "moved.txt"); git(root, "commit", "-m", "later rename"); const base = head(root);
  git(root, "revert", "--no-edit", target); const reversal = head(root), index = git(root, "write-tree"), objects = git(root, "count-objects", "-v");
  requireRevertGitProof(root, approve(base, [target], [reversal]), delivered([target]));
  assert.equal(readFileSync(join(root, "moved.txt"), "utf8"), "start\nbefore\nend\n");
  assert.equal(git(root, "write-tree"), index); assert.equal(git(root, "count-objects", "-v"), objects);
});

test("approved rename/delete resolution uses the renamed target path only", (t) => {
  const root = repository(t); write(root, "added.txt", "new file\n"); git(root, "add", "."); git(root, "commit", "-m", "add file"); const target = head(root);
  git(root, "mv", "added.txt", "moved.txt"); git(root, "commit", "-m", "later rename"); const base = head(root);
  assert.throws(() => git(root, "revert", "--no-edit", target)); git(root, "rm", "moved.txt"); git(root, "revert", "--continue"); const reversal = head(root);
  const input = {...approve(base, [target], [reversal]), conflictResolutionTrees: {[target]: git(root, "rev-parse", "HEAD^{tree}")}};
  requireRevertGitProof(root, input, delivered([target]));
});

test("reversal commits must belong to the selected task and complete phase", (t) => {
  const root = repository(t); write(root, "first.txt", "first\n"); git(root, "add", "."); git(root, "commit", "-m", "first"); const first = head(root);
  write(root, "second.txt", "second\n"); git(root, "add", "."); git(root, "commit", "-m", "second"); const second = head(root);
  git(root, "revert", "--no-edit", second); const reversal = head(root), delivery = delivered([first, second]);
  assert.throws(() => requireRevertGitProof(root, {...approve(second, [second], [reversal]), targetKind: "task", targetId: "T1.1"}, delivery), /outside its named/);
  assert.throws(() => requireRevertGitProof(root, approve(second, [second], [reversal]), delivery), /omits delivered/);
  delivery.nodes.P2 = {id: "P2", kind: "phase", phaseId: "P2", workerCommit: null, mergeCommit: null}; delivery.nodes["T1.2"]!.phaseId = "P2";
  assert.throws(() => requireRevertGitProof(root, approve(second, [second], [reversal]), delivery), /outside its named/);
});

for (const kind of ["tracked", "untracked"]) test(`reversal retains approved ${kind} user files and detects drift`, (t) => {
  const root = repository(t); write(root, "user.txt", "initial\n"); git(root, "add", "."); git(root, "commit", "-m", "unrelated baseline");
  write(root, "product.txt", "start\nafter\nend\n"); git(root, "add", "product.txt"); git(root, "commit", "-m", "feature"); const target = head(root);
  const path = kind === "tracked" ? "user.txt" : "untracked.txt"; write(root, path, "Retain original user edit\n");
  const baseline = captureRepositoryBasis(root, true, "sample"); git(root, "revert", "--no-edit", target); const reversal = head(root), status = git(root, "status", "--porcelain"), index = git(root, "write-tree");
  requireRevertGitProof(root, approve(target, [target], [reversal]), delivered([target]), baseline);
  assert.equal(git(root, "status", "--porcelain"), status); assert.equal(git(root, "write-tree"), index);
  write(root, path, "Unapproved later edit\n");
  assert.throws(() => requireRevertGitProof(root, approve(target, [target], [reversal]), delivered([target]), baseline), /approved reversal baseline/);
  write(root, path, "Retain original user edit\n"); write(root, ".cadre/product.md", "Unapproved policy drift\n");
  assert.throws(() => requireRevertGitProof(root, approve(target, [target], [reversal]), delivered([target]), baseline), /approved reversal baseline/);
});

test("phase integration reverses introduced tasks once without discarding earlier phases", (t) => {
  const root = repository(t); git(root, "checkout", "-b", "phase");
  write(root, "first.txt", "first\n"); git(root, "add", "."); git(root, "commit", "-m", "first"); const first = head(root);
  write(root, "second.txt", "second\n"); git(root, "add", "."); git(root, "commit", "-m", "second"); const second = head(root);
  git(root, "checkout", "main"); write(root, "other.txt", "canonical unrelated\n"); git(root, "add", "."); git(root, "commit", "-m", "other work");
  git(root, "merge", "--no-ff", "phase", "-m", "integrate phase"); const integration = head(root), delivery = delivered([first, second]);
  delivery.nodes.P1!.mergeCommit = integration; delivery.nodes.P1!.workerCommit = second;
  git(root, "revert", "--no-edit", "-m", "1", integration);
  requireRevertGitProof(root, {...approve(integration, [integration], [head(root)]), mainlineParents: {[integration]: 1}}, delivery);
  assert.equal(readFileSync(join(root, "other.txt"), "utf8"), "canonical unrelated\n");
});

for (const integration of ["direct", "fast-forward"]) for (const targetKind of ["phase", "track"]) {
  test(`${integration} ${targetKind} reversal must cover every task delta`, (t) => {
    const root = repository(t);
    if (integration === "fast-forward") git(root, "checkout", "-b", "phase");
    write(root, "first.txt", "first\n"); git(root, "add", "."); git(root, "commit", "-m", "first"); const first = head(root);
    write(root, "second.txt", "second\n"); git(root, "add", "."); git(root, "commit", "-m", "second"); const second = head(root);
    if (integration === "fast-forward") {git(root, "checkout", "main"); git(root, "merge", "--ff-only", "phase");}
    const delivery = delivered([first, second]); Object.assign(delivery.nodes.P1!, {workerCommit: second, mergeCommit: second});
    git(root, "revert", "--no-edit", second); const reversedSecond = head(root);
    const scope = {targetKind, targetId: targetKind === "track" ? "sample" : "P1"};
    assert.throws(() => requireRevertGitProof(root, {...approve(second, [second], [reversedSecond]), ...scope}, delivery), /omits delivered/);
    assert.equal(readFileSync(join(root, "first.txt"), "utf8"), "first\n");
    git(root, "revert", "--no-edit", first);
    requireRevertGitProof(root, {...approve(second, [second, first], [reversedSecond, head(root)]), ...scope}, delivery);
  });
}

test("merge coverage excludes tasks already in its mainline and prevents double reversal", (t) => {
  const root = repository(t);
  write(root, "first.txt", "already canonical\n"); git(root, "add", "."); git(root, "commit", "-m", "first"); const first = head(root);
  git(root, "checkout", "-b", "phase"); write(root, "second.txt", "phase work\n"); git(root, "add", "."); git(root, "commit", "-m", "second"); const second = head(root);
  git(root, "checkout", "main"); write(root, "other.txt", "unrelated\n"); git(root, "add", "."); git(root, "commit", "-m", "unrelated");
  git(root, "merge", "--no-ff", "phase", "-m", "phase integration"); const merge = head(root), delivery = delivered([first, second]);
  Object.assign(delivery.nodes.P1!, {workerCommit: second, mergeCommit: merge});
  const operation = {...approve(merge, [merge], []), mainlineParents: {[merge]: 1}};
  assert.throws(() => requireRevertScope(root, operation, delivery, [merge]), /omits delivered/);
  assert.throws(() => requireRevertScope(root, operation, delivery, [merge, second, first]), /twice/);
  git(root, "revert", "--no-edit", "-m", "1", merge); const reverseMerge = head(root);
  git(root, "revert", "--no-edit", first);
  requireRevertGitProof(root, {...operation, commits: [merge, first], revertCommits: [reverseMerge, head(root)]}, delivery);
  assert.equal(readFileSync(join(root, "other.txt"), "utf8"), "unrelated\n");
});
