#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const core = require("./cadre-core");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function writeTrack(root, id, plan, metadata = {}) {
  write(path.join(root, "cadre", "tracks.md"), "# Tracks\n\n<!-- cadre:index:start -->\n<!-- cadre:index:end -->\n");
  const dir = path.join(root, "cadre", "tracks", id);
  write(path.join(dir, "metadata.json"), JSON.stringify({
    track_id: id,
    type: "feature",
    status: "new",
    priority: "medium",
    depends_on: [],
    description: id,
    git_branch: `track/${id}`,
    worktree_path: `.worktrees/${id}`,
    ...metadata,
  }, null, 2));
  write(path.join(dir, "plan.md"), plan);
  write(path.join(dir, "spec.md"), `# Spec: ${id}\n`);
  write(path.join(dir, "learnings.md"), `# Learnings: ${id}\n`);
}

function samplePlan(id) {
  return `# Plan: ${id}

## Phase 1: Build
<!-- execution: parallel -->

- [ ] Task 1: Implement core
  <!-- files: src/core.js -->

- [ ] Task 2: Add tests
  <!-- files: test/core.test.js -->
  <!-- depends: task1 -->

## Phase 2: Finish

- [ ] Task 1: Verify
  <!-- files: src/core.js -->
`;
}

test("repoMap filters generated bundles and local variable noise", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-core-test-"));
  try {
    git(root, ["init"]);
    write(
      path.join(root, "scripts", "source.js"),
      [
        "function canonicalFunction() { return true; }",
        "const localNoise = 1;",
        "export const exportedSignal = 2;",
        "",
      ].join("\n")
    );
    write(
      path.join(root, ".agents", "skills", "cadre", "templates", "scripts", "generated.js"),
      "function generatedFunction() { return false; }\n"
    );
    write(
      path.join(root, "plugins", "cadre", "scripts", "plugin.js"),
      "function pluginFunction() { return false; }\n"
    );
    git(root, ["add", "."]);

    const map = core.repoMap(root, { limit: 20 });
    const names = map.symbols.map((symbol) => symbol.name);
    assert.equal(map.ok, true);
    assert.ok(names.includes("canonicalFunction"));
    assert.ok(names.includes("exportedSignal"));
    assert.equal(names.includes("localNoise"), false);
    assert.equal(names.includes("generatedFunction"), false);
    assert.equal(names.includes("pluginFunction"), false);

    const matches = core.repoMap(root, { symbol: "generatedFunction" });
    assert.deepEqual(matches.matches, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("isCadreProjectRoot requires real Cadre state markers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-root-test-"));
  try {
    fs.mkdirSync(path.join(root, "skills", "cadre"), { recursive: true });
    assert.equal(core.isCadreProjectRoot(path.join(root, "skills")), false);

    write(path.join(root, "project", "cadre", "setup_state.json"), "{}\n");
    assert.equal(core.isCadreProjectRoot(path.join(root, "project")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("implementationPrep returns bounded candidate context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-prep-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "prep_20260617", samplePlan("prep_20260617"));

    const prep = core.implementationPrep(root, { identity: "dev@example.com" });
    assert.equal(prep.ok, true);
    assert.equal(prep.selected_track, "prep_20260617");
    assert.equal(prep.context.task_counts.total, 3);
    assert.equal(prep.integrity.ok, true);
    assert.equal(prep.team_summary.total_tracks, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createBeadsTree dryRun plans epic, tasks, deps, notes, and metadata patch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-beads-tree-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "beads_20260617", samplePlan("beads_20260617"));

    const result = core.createBeadsTree(root, {
      trackId: "beads_20260617",
      identity: "dev@example.com",
      dryRun: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.beads_epic, "cadre-beads_20260617");
    assert.ok(result.beads_tasks.phase1);
    assert.ok(result.beads_tasks.phase1_task2);
    assert.ok(result.commands.some((entry) => entry.args[0] === "dep"));
    assert.equal(result.metadata_patch.beads_epic, "cadre-beads_20260617");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviewAssist and lspImpact provide fallback review context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-review-assist-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Cadre Test"]);
    writeTrack(root, "review_20260617", samplePlan("review_20260617"));
    write(path.join(root, "src", "core.js"), "function exportedCore() {\n  // TODO finish behavior\n  return true;\n}\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "init"]);

    const assist = core.reviewAssist(root, {
      trackId: "review_20260617",
      base: "HEAD",
      head: "HEAD",
      includeLsp: false,
    });
    assert.equal(assist.ok, true);
    assert.equal(assist.suggested_verdict, "changes_requested");
    assert.ok(assist.blocking_reasons.some((reason) => reason.includes("plan task")));

    const impact = core.lspImpact(root, {
      symbol: "exportedCore",
      files: ["src/core.js"],
      limit: 10,
    });
    assert.equal(impact.ok, true);
    assert.ok(impact.symbols.exportedCore.matches.length >= 1);
    assert.ok(impact.files["src/core.js"].some((symbol) => symbol.name === "exportedCore"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
