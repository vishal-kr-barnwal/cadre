#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const core = require("./cadre-core");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function metadata(id, status, owner, extra = {}) {
  return {
    track_id: id,
    name: id.replace(/_/g, " "),
    type: "feature",
    status,
    priority: "medium",
    depends_on: [],
    estimated_hours: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
    description: id,
    owner,
    reviewer: null,
    git_branch: `track/${id}`,
    worktree_path: `.worktrees/${id}`,
    ...extra,
  };
}

function plan(id, index) {
  const shared = index % 5 === 0 ? "src/shared/session.ts" : `src/module_${index}/index.ts`;
  return `# Plan: ${id}

## Phase 1: Build
<!-- execution: parallel -->

- [ ] Task 1: Implement core for ${id}
  <!-- files: ${shared}, src/module_${index}/index.test.ts -->

- [ ] Task 2: Update docs for ${id}
  <!-- files: docs/module_${index}.md -->

## Phase 2: Verify

- [ ] Task 1: Run verification
  <!-- files: src/module_${index}/index.ts -->
`;
}

function buildFixture(root) {
  write(path.join(root, "cadre", "tracks.md"), `# Tracks

<!-- cadre:index:start -->
<!-- cadre:index:end -->
`);
  write(path.join(root, "cadre", "config.json"), JSON.stringify({
    sync_mode: "shared",
    require_second_reviewer: true,
  }, null, 2));

  for (let i = 0; i < 20; i += 1) {
    const id = `team_scale_${String(i + 1).padStart(2, "0")}_20260617`;
    const status = i < 12 ? "in_progress" : i < 16 ? "new" : i < 18 ? "blocked" : "completed";
    const owner = status === "new" ? null : `dev${(i % 10) + 1}@example.com`;
    const review = status === "completed"
      ? {
          verdict: "approved",
          blocking_count: 0,
          date: "2026-06-17T00:00:00Z",
          reviewer: `reviewer${i}@example.com`,
          coverage: 88,
          self_reviewed: false,
          reviewed_sha: `deadbeef${i}`,
          review_seq: 1,
        }
      : undefined;
    const trackDir = path.join(root, "cadre", "tracks", id);
    write(path.join(trackDir, "metadata.json"), JSON.stringify(metadata(id, status, owner, { review }), null, 2));
    write(path.join(trackDir, "plan.md"), plan(id, i));
    write(path.join(trackDir, "spec.md"), `# Spec: ${id}\n`);
    write(path.join(trackDir, "learnings.md"), `# Learnings: ${id}\n`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const keep = process.argv.includes("--keep");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-team-scale-"));
  buildFixture(root);

  const regen = spawnSync("bash", [
    path.resolve(__dirname, "..", "templates", "scripts", "cadre-regen-index.sh"),
    root,
  ], { encoding: "utf8" });
  assert(regen.status === 0, regen.stderr || "regen-index failed");

  const status = core.teamStatus(root);
  const collisions = core.collisionScan(root);
  const available = core.availableWork(root);
  const gate = core.reviewGate(root, "team_scale_19_20260617");

  assert(status.total_tracks === 20, `expected 20 tracks, got ${status.total_tracks}`);
  assert(status.by_status.in_progress === 12, "expected 12 in-progress tracks");
  assert(collisions.collisions.length >= 1, "expected at least one cross-track collision");
  assert(available.available.length === 4, `expected 4 available tracks, got ${available.available.length}`);
  assert(gate.ok === true, `expected completed reviewed track to pass gate: ${gate.reasons.join(", ")}`);

  const result = {
    ok: true,
    fixture: root,
    totalTracks: status.total_tracks,
    owners: Object.keys(status.by_owner).length,
    collisions: collisions.collisions.length,
    available: available.available.length,
  };
  console.log(JSON.stringify(result, null, 2));

  if (!keep) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
