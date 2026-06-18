#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
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
  spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "scale@example.com"], { cwd: root, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Scale Sim"], { cwd: root, encoding: "utf8" });
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

function runWorker(root, trackId, index) {
  const code = `
const core = require(${JSON.stringify(path.resolve(__dirname, "cadre-core.js"))});
const [root, trackId, index] = JSON.parse(process.argv[1]);
const identity = "worker" + index + "@example.com";
const claim = core.claimTrack(root, trackId, { identity, takeover: true });
const complete = core.completeTask(root, {
  trackId,
  phaseIndex: 1,
  taskIndex: 1,
  commitSha: ("feedface" + String(index).padStart(4, "0")).slice(0, 12),
  command: "printf 'Statements : 91%%\\\\n'",
  coverageThreshold: 80
});
const review = core.recordReview(root, {
  trackId,
  verdict: "approved",
  reviewer: "reviewer" + index + "@example.com",
  blockingCount: 0,
  coverage: 91,
  override: true
});
const ok = claim.ok && complete.ok && review.ok;
console.log(JSON.stringify({ ok, trackId, claim, complete, review }));
process.exit(ok ? 0 : 1);
`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", code, JSON.stringify([root, trackId, index])], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code, signal) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim().split(/\n/).pop() || "null");
      } catch (_) {
        // Keep raw output below.
      }
      resolve({ ok: code === 0 && parsed && parsed.ok, code, signal, stdout, stderr, parsed });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const keep = process.argv.includes("--keep");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-team-scale-"));
  buildFixture(root);

  const regen = core.regenIndex(root);
  assert(regen.ok === true, regen.stderr || regen.error || "regen-index failed");

  const status = core.teamStatus(root);
  const collisions = core.collisionScan(root);
  const available = core.availableWork(root);
  const gate = core.reviewGate(root, "team_scale_19_20260617");

  assert(status.total_tracks === 20, `expected 20 tracks, got ${status.total_tracks}`);
  assert(status.by_status.in_progress === 12, "expected 12 in-progress tracks");
  assert(collisions.collisions.length >= 1, "expected at least one cross-track collision");
  assert(available.available.length === 4, `expected 4 available tracks, got ${available.available.length}`);
  assert(gate.ok === true, `expected completed reviewed track to pass gate: ${gate.reasons.join(", ")}`);

  const trackIds = core.listTracks(root).map((track) => track.track_id);
  const workers = await Promise.all(trackIds.map((trackId, index) => runWorker(root, trackId, index + 1)));
  const failedWorkers = workers.filter((worker) => !worker.ok);
  assert(failedWorkers.length === 0, `expected all concurrent workers to pass: ${JSON.stringify(failedWorkers.slice(0, 3), null, 2)}`);
  const completedAfterWorkers = core.listTracks(root).filter((track) => {
    const metadata = JSON.parse(fs.readFileSync(track.metadata_path, "utf8"));
    return metadata.last_task_result && metadata.review && metadata.review.verdict === "approved";
  });
  assert(completedAfterWorkers.length === 20, `expected 20 claimed/reviewed/completed tracks, got ${completedAfterWorkers.length}`);

  const result = {
    ok: true,
    fixture: root,
    totalTracks: status.total_tracks,
    owners: Object.keys(status.by_owner).length,
    collisions: collisions.collisions.length,
    available: available.available.length,
    concurrent_workers: workers.length,
  };
  console.log(JSON.stringify(result, null, 2));

  if (!keep) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
