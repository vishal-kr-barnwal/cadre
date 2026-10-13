import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireRevertGitProof } from "../src/domain/revert-git.js";
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
  const nodes: Record<string, Pick<ExecutionNode, "id" | "kind" | "workerCommit" | "mergeCommit">> = {P1: {id: "P1", kind: "phase", workerCommit: null, mergeCommit: null}};
  commits.forEach((commit, i) => {nodes[`T1.${i + 1}`] = {id: `T1.${i + 1}`, kind: "task", workerCommit: commit, mergeCommit: null};});
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
