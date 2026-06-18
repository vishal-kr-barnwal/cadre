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

function installFakeBd(root) {
  const bin = path.join(root, "bin");
  const bd = path.join(bin, "bd");
  write(bd, `#!/bin/sh
printf '%s\n' "$*" >> "$PWD/bd.log"
case "$1" in
  show)
    if [ -f "$PWD/bd-notes.txt" ]; then cat "$PWD/bd-notes.txt"; else printf '{}\n'; fi
    ;;
  note)
    printf '%s\n' "$3" >> "$PWD/bd-notes.txt"
    printf '{"ok":true}\n'
    ;;
  sql)
    printf 'Rows affected: 3\n'
    ;;
  close|label|dep|create|ready|list|update|mail|formula|admin|rules|dolt|worktree)
    printf '{"ok":true}\n'
    ;;
  *)
    printf '{"ok":true}\n'
    ;;
esac
`);
  fs.chmodSync(bd, 0o755);
  return bin;
}

function installTrackCreationFakeBd(root) {
  const bin = path.join(root, "bin");
  const bd = path.join(bin, "bd");
  write(bd, `#!/bin/sh
printf '%s\n' "$*" >> "$PWD/bd.log"
case "$1" in
  show)
    exit 1
    ;;
  create)
    title="$(printf '%s' "$2" | tr -c 'A-Za-z0-9' '_' | cut -c1-24)"
    printf '{"id":"bd-%s"}\n' "$title"
    ;;
  note|dep)
    printf '{"ok":true}\n'
    ;;
  *)
    printf '{"ok":true}\n'
    ;;
esac
`);
  fs.chmodSync(bd, 0o755);
  return bin;
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

test("parsePlanText captures annotations, repo ownership, and commit refs", () => {
  const plan = core.parsePlanText(`# Plan

## Phase 1: Typed Work
<!-- execution: parallel -->
<!-- depends: phase0 -->

- [~] Task 1: Touch runtime commit: abc1234
  <!-- files: src/runtime.ts, tests/runtime.test.ts -->
  <!-- repo: app -->
  <!-- depends: task0 -->
  <!-- shas: app:deadbeef -->
`);

  assert.equal(plan.ok, true);
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.phases[0].annotations.execution, "parallel");
  assert.equal(plan.phases[0].annotations.depends, "phase0");
  assert.equal(plan.tasks[0].task_key, "phase1_task1");
  assert.deepEqual(plan.tasks[0].files, ["src/runtime.ts", "tests/runtime.test.ts"]);
  assert.equal(plan.tasks[0].repo, "app");
  assert.deepEqual(plan.tasks[0].depends, ["task0"]);
  assert.ok(plan.tasks[0].commit_shas.includes("abc1234"));
  assert.equal(plan.tasks[0].repo_shas.app, "deadbeef");
});

test("build emits every required runtime bundle path", () => {
  for (const file of [
    "scripts/cadre-core.js",
    "scripts/cadre-job-runner.js",
    "scripts/cadre-lsp-setup.js",
    "scripts/cadre-lsp-review.js",
    "scripts/cadre-lsp-daemon.js",
    "scripts/mcp/cadre-server.js",
    "templates/scripts/cadre-lsp-setup.js",
    "plugins/cadre/scripts/cadre-lsp-review.js",
    "plugins/cadre-claude/scripts/cadre-lsp-daemon.js",
  ]) {
    assert.equal(fs.existsSync(path.join(__dirname, "..", file)), true, `missing ${file}`);
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

test("planAssist and worktreePlan return bounded planning evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-plan-assist-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "assist_20260617", samplePlan("assist_20260617"));
    write(path.join(root, "src", "core.js"), "function core() { return true; }\n");
    write(path.join(root, "src", "core.test.js"), "test('core', () => {});\n");

    const assist = core.planAssist(root, { trackId: "assist_20260617", limit: 20 });
    assert.equal(assist.ok, true);
    assert.ok(assist.file_claims["."].includes("src/core.js"));
    assert.ok(assist.likely_tests.includes("src/core.test.js"));
    assert.ok(assist.phases.some((phase) => phase.phase_index === 1 && phase.parallel_candidate === true));
    assert.equal(assist.semantic_impact.ok, true);

    const worktrees = core.worktreePlan(root, { trackId: "assist_20260617" });
    assert.equal(worktrees.ok, true);
    assert.equal(worktrees.execute, false);
    assert.equal(worktrees.plans[0].repo, ".");
    assert.ok(worktrees.plans[0].commands[0].args.includes(path.join(root, ".worktrees", "assist_20260617")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parallelWorkflow plans waves and keeps mutating actions dry-run by default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-parallel-packet-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "parallel_20260617", samplePlan("parallel_20260617"));

    const next = core.parallelWorkflow(root, { action: "next_wave", trackId: "parallel_20260617" });
    assert.equal(next.ok, true);
    assert.deepEqual(next.phase_ids, ["phase1"]);
    assert.equal(next.workers.length, 2);

    const setup = core.parallelWorkflow(root, { action: "setup_workers", trackId: "parallel_20260617" });
    assert.equal(setup.ok, true);
    assert.equal(setup.dry_run, true);
    assert.equal(setup.commands.length, 2);
    assert.equal(setup.results.length, 0);

    const dryRecord = core.parallelWorkflow(root, {
      action: "record_finish",
      trackId: "parallel_20260617",
      workerId: "worker-one",
      phaseIndex: 1,
      taskIndex: 1,
    });
    assert.equal(dryRecord.ok, true);
    assert.equal(dryRecord.dry_run, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "parallel_20260617", "parallel_state.json")), false);

    const recorded = core.parallelWorkflow(root, {
      action: "record_finish",
      execute: true,
      trackId: "parallel_20260617",
      workerId: "worker-one",
      status: "awaiting_merge",
      phaseIndex: 1,
      taskIndex: 1,
      branch: "track/parallel-worker-one",
      worktree: ".worktrees/parallel_20260617/worker-one",
      repo: ".",
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.summary.completed_workers, 1);

    const merge = core.parallelWorkflow(root, { action: "merge_back", trackId: "parallel_20260617" });
    assert.equal(merge.ok, true);
    assert.equal(merge.dry_run, true);
    assert.ok(merge.commands[0].args.includes("track/parallel-worker-one"));

    const cleanup = core.parallelWorkflow(root, { action: "cleanup", trackId: "parallel_20260617" });
    assert.equal(cleanup.ok, true);
    assert.equal(cleanup.commands[0].args[2], ".worktrees/parallel_20260617/worker-one");
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
    assert.ok(result.commands.some((entry) => entry.args.includes("--design")));
    assert.ok(result.commands.some((entry) => entry.args.includes("--acceptance")));
    assert.equal(result.metadata_patch.beads_epic, "cadre-beads_20260617");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createBeadsTree dryRun can preflight a track before files exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-beads-draft-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "tracks.md"), "# Tracks\n\n<!-- cadre:index:start -->\n<!-- cadre:index:end -->\n");

    const result = core.createBeadsTree(root, {
      trackId: "draft_20260617",
      identity: "dev@example.com",
      dryRun: true,
      planText: samplePlan("draft_20260617"),
      specText: "# Spec\n\n## Acceptance\nWorks before files exist.\n",
      metadata: { description: "Draft track", priority: "high" },
    });

    assert.equal(result.ok, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.beads_epic, "cadre-draft_20260617");
    assert.ok(result.beads_tasks.phase1_task1);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "draft_20260617")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("metadataPatch preserves unrelated metadata while patching selected keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-metadata-patch-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "patch_20260617", samplePlan("patch_20260617"), {
      owner: "old@example.com",
      review: { verdict: "changes_requested", blocking_count: 1 },
    });

    const patched = core.metadataPatch(root, {
      trackId: "patch_20260617",
      patch: { owner: "new@example.com" },
    });

    assert.equal(patched.ok, true);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "patch_20260617", "metadata.json"), "utf8"));
    assert.equal(metadata.owner, "new@example.com");
    assert.equal(metadata.review.verdict, "changes_requested");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lock primitives reject live holders and recover stale locks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-lock-test-"));
  try {
    write(path.join(root, "cadre", "setup_state.json"), "{}\n");
    const first = core.acquireLock(root, "track:lock_20260617");
    assert.equal(first.ok, true);

    const conflict = core.acquireLock(root, "track:lock_20260617");
    assert.equal(conflict.ok, false);
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.stale, false);

    write(path.join(first.dir, "owner.json"), JSON.stringify({
      name: "track:lock_20260617",
      pid: process.pid,
      owner: "stale@example.com",
      acquired_at: "2000-01-01T00:00:00.000Z",
      updated_at: "2000-01-01T00:00:00.000Z",
    }, null, 2));
    const recovered = core.acquireLock(root, "track:lock_20260617");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.attempts, 2);
    assert.equal(core.releaseLock(recovered).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("phaseSchedule returns conflict-free ready phase groups", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-phase-schedule-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "phase_20260617", `# Plan: phase_20260617

## Phase 1: Foundation

- [x] Task 1: Done
  <!-- files: src/foundation.js -->

## Phase 2: API
<!-- depends: -->

- [ ] Task 1: Build API
  <!-- files: src/api.js -->

## Phase 3: UI
<!-- depends: -->

- [ ] Task 1: Build UI
  <!-- files: src/ui.js -->

## Phase 4: Wire
<!-- depends: phase2, phase3 -->

- [ ] Task 1: Integrate
  <!-- files: src/app.js -->
`);

    const schedule = core.phaseSchedule(root, { trackId: "phase_20260617" });

    assert.equal(schedule.ok, true);
    assert.deepEqual(schedule.ready_phases, ["phase2", "phase3"]);
    assert.deepEqual(schedule.ready_groups, [["phase2", "phase3"]]);
    assert.deepEqual(schedule.conflict_splits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("phaseSchedule splits ready phases with file ownership conflicts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-phase-conflict-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "phase_conflict_20260617", `# Plan: phase_conflict_20260617

## Phase 1: Foundation

- [x] Task 1: Done
  <!-- files: src/foundation.js -->

## Phase 2: API
<!-- depends: -->

- [ ] Task 1: Update shared model
  <!-- files: src/shared.js -->

## Phase 3: UI
<!-- depends: -->

- [ ] Task 1: Update shared model
  <!-- files: src/shared.js -->
`);

    const schedule = core.phaseSchedule(root, { trackId: "phase_conflict_20260617" });

    assert.equal(schedule.ok, true);
    assert.deepEqual(schedule.ready_phases, ["phase2", "phase3"]);
    assert.deepEqual(schedule.ready_groups, [["phase2"], ["phase3"]]);
    assert.equal(schedule.conflict_splits.length, 1);
    assert.equal(schedule.conflict_splits[0].file, "src/shared.js");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask gates plan mutation on measured coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-complete-task-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "complete_20260617", samplePlan("complete_20260617"));

    const low = core.completeTask(root, {
      trackId: "complete_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 72%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(low.ok, false);
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", "complete_20260617", "plan.md"), "utf8"), /- \[ \] Task 1/);

    const ok = core.completeTask(root, {
      trackId: "complete_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 86%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(ok.ok, true);
    const plan = fs.readFileSync(path.join(root, "cadre", "tracks", "complete_20260617", "plan.md"), "utf8");
    assert.match(plan, /- \[x\] Task 1: Implement core \(abcdef123456\)/);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "complete_20260617", "metadata.json"), "utf8"));
    assert.equal(metadata.last_coverage, 86);
    assert.equal(metadata.last_task_result.task_key, "phase1_task1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask refuses mapped Beads tasks when bd is unavailable without mutating plan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-complete-beads-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    writeTrack(root, "beads_required_20260617", samplePlan("beads_required_20260617"), {
      beads_epic: "cadre-beads_required_20260617",
      beads_tasks: { phase1_task1: "bd-task-1" },
    });
    process.env.PATH = "/nonexistent";

    const result = core.completeTask(root, {
      trackId: "beads_required_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 86%%\\n'",
      coverageThreshold: 80,
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "beads_unavailable");
    const plan = fs.readFileSync(path.join(root, "cadre", "tracks", "beads_required_20260617", "plan.md"), "utf8");
    assert.match(plan, /- \[ \] Task 1: Implement core/);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "beads_required_20260617", "metadata.json"), "utf8"));
    assert.equal(metadata.last_task_result, undefined);
    assert.equal(metadata.last_test_run, undefined);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask writes a recovery journal and avoids duplicate Beads notes on retry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-complete-journal-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    const fakeBin = installFakeBd(root);
    process.env.PATH = `${fakeBin}:${oldPath}`;
    writeTrack(root, "journal_20260617", samplePlan("journal_20260617"), {
      beads_epic: "cadre-journal_20260617",
      beads_tasks: { phase1_task1: "bd-task-1" },
    });

    const args = {
      trackId: "journal_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 87%%\\n'",
      coverageThreshold: 80,
    };
    const first = core.completeTask(root, args);
    assert.equal(first.ok, true);
    const second = core.completeTask(root, args);
    assert.equal(second.ok, true);
    assert.equal(second.beads.note.skipped, true);
    assert.equal(second.beads.close.skipped, true);

    const journal = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "journal_20260617", "completion_journal.json"), "utf8"));
    const entries = Object.values(journal.entries);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].stage, "completed");
    assert.equal(entries[0].beads_note_written, true);
    assert.equal(entries[0].beads_close_written, true);

    const log = fs.readFileSync(path.join(root, "bd.log"), "utf8").trim().split(/\n/);
    assert.equal(log.filter((line) => line.startsWith("note ")).length, 1);
    assert.equal(log.filter((line) => line.startsWith("close ")).length, 1);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("beadsTaskWrite covers expanded CLI operations and SQL rows affected parsing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-beads-wrapper-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    const fakeBin = installFakeBd(root);
    process.env.PATH = `${fakeBin}:${oldPath}`;

    const sql = core.beadsTaskWrite(root, { operation: "sql", sql: "update beads set status='closed'" });
    assert.equal(sql.ok, true);
    assert.equal(sql.rows_affected, 3);

    const create = core.beadsTaskWrite(root, {
      operation: "create",
      title: "Keep label order",
      labels: ["review:ready", "team:api"],
    });
    assert.equal(create.ok, true);
    const label = core.beadsTaskWrite(root, { operation: "label_add", id: "bd-1", label: "review:ready" });
    assert.equal(label.ok, true);
    const dep = core.beadsTaskWrite(root, { operation: "dep_add", id: "bd-2", dependsOn: "bd-1" });
    assert.equal(dep.ok, true);

    const log = fs.readFileSync(path.join(root, "bd.log"), "utf8");
    assert.match(log, /create Keep label order --json --labels review:ready,team:api/);
    assert.match(log, /label add bd-1 review:ready --json/);
    assert.match(log, /dep add bd-2 bd-1 --json/);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shared control-plane post sync fails closed when remote verification fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-sync-fail-closed-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), JSON.stringify({
      sync_mode: "shared",
      control_remote: "origin",
      control_branch: "main",
    }, null, 2));

    const result = core.syncControlPlane(root, { mode: "post" });
    assert.equal(result.ok, false);
    assert.match(result.safety.reason, /Unable to verify origin\/main/);
    assert.equal(result.commands.some((cmd) => cmd.command.includes("git push")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("teamBoard returns WIP, review queue, and blockers without Beads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-team-board-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "active_20260617", samplePlan("active_20260617"), {
      status: "in_progress",
      owner: "dev@example.com",
      review: { verdict: "changes_requested", blocking_count: 1 },
    });
    writeTrack(root, "blocked_20260617", samplePlan("blocked_20260617"), {
      depends_on: ["missing_20260617"],
    });

    const board = core.teamBoard(root);
    assert.equal(board.ok, true);
    assert.ok(board.wip.some((item) => item.track_id === "active_20260617"));
    assert.ok(board.review_queue.some((item) => item.track_id === "active_20260617"));
    assert.ok(board.blockers.some((item) => item.track_id === "blocked_20260617"));
    assert.equal(typeof board.beads.available, "boolean");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fleetStatus and beadsSummary degrade cleanly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-fleet-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "app",
      repos: [
        { name: "app", submodule_path: "repos/app" },
        { name: "missing", submodule_path: "repos/missing" },
      ],
    }, null, 2));
    fs.mkdirSync(path.join(root, "repos", "app"), { recursive: true });
    git(path.join(root, "repos", "app"), ["init"]);

    const fleet = core.fleetStatus(root);
    assert.equal(fleet.ok, true);
    assert.equal(fleet.topology, "polyrepo");
    assert.ok(fleet.repos.some((repo) => repo.name === "." && repo.role === "control"));
    assert.ok(fleet.repos.some((repo) => repo.name === "missing" && repo.exists === false));
    assert.equal(typeof fleet.providers.gh, "boolean");

    const beads = core.beadsSummary(root);
    assert.equal(beads.ok, true);
    assert.equal(typeof beads.available, "boolean");
    assert.ok(Object.prototype.hasOwnProperty.call(beads, "ready"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup writes detected and requested style guides from templates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-style-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    write(path.join(root, "tsconfig.json"), "{}\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.css"), ".app { color: black; }\n");

    const setup = core.workflowPacket(root, {
      workflow: "setup",
      execute: true,
      productText: "# Product\n",
      techStack: {
        languages: ["TypeScript"],
        frameworks: ["React"],
        platforms: ["web"],
        styleGuideIds: ["html-css"],
      },
      styleGuideIds: ["python"],
    });

    assert.equal(setup.ok, true);
    assert.equal(setup.styleGuides.source, "tech-stack.json");
    assert.ok(setup.styleGuides.detected.includes("typescript"));
    assert.ok(setup.styleGuides.detected.includes("html-css"));
    assert.ok(setup.styleGuides.selected.includes("general"));
    assert.ok(setup.styleGuides.selected.includes("python"));
    assert.ok(setup.styleGuides.written.includes("cadre/code_styleguides/general.md"));
    assert.ok(setup.styleGuides.written.includes("cadre/code_styleguides/typescript.md"));
    assert.ok(setup.styleGuides.written.includes("cadre/code_styleguides/python.md"));
    assert.match(fs.readFileSync(path.join(root, "cadre", "patterns.md"), "utf8"), /# Codebase Patterns/);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.md")), false);
    const techStack = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"));
    assert.deepEqual(techStack.languages, ["TypeScript"]);
    assert.match(setup.techStackSummary.summary, /languages: TypeScript/);
    const beads = JSON.parse(fs.readFileSync(path.join(root, "cadre", "beads.json"), "utf8"));
    assert.equal(beads.mode, "normal");
    assert.equal(beads.packet_only, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup rejects unknown explicit style guide ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-style-missing-test-"));
  try {
    git(root, ["init"]);
    const setup = core.workflowPacket(root, {
      workflow: "setup",
      productText: "# Product\n",
      techStack: { languages: ["TypeScript"] },
      styleGuideIds: "typescript not-a-guide",
    });

    assert.equal(setup.ok, false);
    assert.deepEqual(setup.styleGuides.missing, ["not-a-guide"]);
    assert.equal(fs.existsSync(path.join(root, "cadre")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("implementationPrep returns packet-selected style guides", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-implement-style-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    write(path.join(root, "tsconfig.json"), "{}\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.css"), ".app { color: black; }\n");
    write(path.join(root, "src", "worker.py"), "print('not in tech stack')\n");
    const setup = core.workflowPacket(root, {
      workflow: "setup",
      execute: true,
      productText: "# Product\n",
      techStack: {
        languages: ["TypeScript"],
        frameworks: ["React"],
        platforms: ["web"],
        styleGuideIds: ["html-css"],
      },
    });
    assert.equal(setup.ok, true);
    writeTrack(root, "style_20260618", `# Plan: style_20260618

## Phase 1: Build

- [ ] Task 1: Update app
  <!-- files: src/app.ts, src/app.css -->
`);

    const prep = core.implementationPrep(root, {
      trackId: "style_20260618",
      identity: "dev@example.com",
      styleGuideMaxChars: 1200,
    });

    assert.equal(prep.ok, true);
    assert.equal(prep.styleGuides.available, true);
    assert.ok(prep.styleGuides.selected.includes("general"));
    assert.ok(prep.styleGuides.selected.includes("typescript"));
    assert.ok(prep.styleGuides.selected.includes("html-css"));
    assert.equal(prep.styleGuides.selected.includes("python"), false);
    assert.ok(prep.styleGuides.tech_stack_ids.includes("typescript"));
    assert.ok(prep.styleGuides.tech_stack_ids.includes("html-css"));
    assert.ok(prep.styleGuides.task_file_ids.includes("typescript"));
    const typeGuide = prep.styleGuides.guides.find((guide) => guide.id === "typescript");
    assert.ok(typeGuide);
    assert.equal(typeGuide.path, "cadre/code_styleguides/typescript.md");
    assert.ok(typeGuide.content.includes("TypeScript"));
    assert.ok(typeGuide.content.length <= 1200);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack writes template-backed track learnings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-template-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    process.env.PATH = `${installTrackCreationFakeBd(root)}:${oldPath}`;
    const setup = core.workflowPacket(root, {
      workflow: "setup",
      execute: true,
      productText: "# Product\n",
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(setup.ok, true);

    const created = core.workflowPacket(root, {
      workflow: "newtrack",
      execute: true,
      trackId: "tmpl_20260618",
      specText: "# Spec\n",
      planText: samplePlan("tmpl_20260618"),
    });

    assert.equal(created.ok, true);
    const learnings = fs.readFileSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "learnings.md"), "utf8");
    assert.match(learnings, /# Track Learnings: tmpl_20260618/);
    assert.equal(learnings.includes("{{track_id}}"), false);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflowPacket exposes packet-only routes for primary workflows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-workflow-test-"));
  const setupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-workflow-setup-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "workflow@example.com"]);
    git(root, ["config", "user.name", "Workflow Test"]);
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    writeTrack(root, "workflow_20260618", samplePlan("workflow_20260618"), {
      status: "in_progress",
      owner: "workflow@example.com",
    });
    writeTrack(root, "done_20260618", samplePlan("done_20260618"), {
      status: "completed",
    });

    const setup = core.workflowPacket(setupRoot, {
      workflow: "setup",
      execute: true,
      productText: "# Product\n",
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(setup.ok, true);
    assert.equal(setup.packet_only, true);
    assert.ok(setup.written.includes("cadre/setup_state.json"));
    assert.equal(fs.existsSync(path.join(setupRoot, "cadre", "workflow.md")), true);

    const draft = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "draft_20260618",
      specText: "# Spec\n",
      planText: samplePlan("draft_20260618"),
    });
    assert.equal(draft.ok, true);
    assert.equal(draft.dry_run, true);
    assert.equal(draft.packet_only, true);

    for (const [workflow, args] of [
      ["implement", { trackId: "workflow_20260618" }],
      ["status", { mode: "fleet" }],
      ["review", { trackId: "workflow_20260618", includeLsp: false }],
      ["validate", { trackId: "workflow_20260618" }],
      ["archive", { trackId: "done_20260618" }],
      ["handoff", { trackId: "workflow_20260618" }],
      ["ship", { trackId: "workflow_20260618" }],
      ["land", { trackId: "workflow_20260618" }],
      ["release", {}],
      ["revise", { trackId: "workflow_20260618" }],
      ["refresh", {}],
      ["flag", { trackId: "workflow_20260618", status: "blocked", reason: "waiting for credentials" }],
      ["revert", { trackId: "workflow_20260618" }],
      ["formula", {}],
    ]) {
      const result = core.workflowPacket(root, { workflow, ...args });
      assert.equal(result.packet_only, true, `expected ${workflow} to be packet-only`);
      assert.equal(result.workflow, workflow);
      assert.equal(/Unknown Cadre workflow packet/.test(String(result.error || "")), false);
    }

    const flag = core.workflowPacket(root, {
      workflow: "flag",
      trackId: "workflow_20260618",
      status: "blocked",
      reason: "waiting for credentials",
      execute: true,
    });
    assert.equal(flag.ok, true);
    assert.equal(flag.dry_run, false);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "workflow_20260618", "metadata.json"), "utf8"));
    assert.equal(metadata.status, "blocked");
    assert.equal(metadata.last_status_reason, "waiting for credentials");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(setupRoot, { recursive: true, force: true });
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

test("workspace diagnostics, test impact, and dependency graph expose polyglot evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-intel-graph-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "package.json"), JSON.stringify({
      scripts: {
        test: "node --test",
        typecheck: "tsc --noEmit",
      },
      devDependencies: {
        nx: "1.0.0",
      },
    }, null, 2));
    write(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    write(path.join(root, "nx.json"), "{}\n");
    write(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    write(path.join(root, "go.mod"), "module example.com/app\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.test.ts"), "test('app', () => {});\n");
    git(root, ["add", "."]);

    const diagnostics = core.workspaceDiagnostics(root);
    assert.equal(diagnostics.ok, true);
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "node"));
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "pytest"));
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "go"));
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "nx"));
    assert.ok(diagnostics.commands.some((command) => command.command === "pnpm test"));

    const impact = core.testImpact(root, { files: ["src/app.ts"] });
    assert.equal(impact.ok, true);
    assert.deepEqual(impact.likely_tests["src/app.ts"], ["src/app.test.ts"]);
    assert.ok(impact.manifests.includes("package.json"));

    const graph = core.dependencyGraph(root);
    assert.equal(graph.ok, true);
    assert.ok(graph.manifests.some((manifest) => manifest.file === "package.json"));
    assert.ok(graph.edges.some((edge) => edge.from === "package.json"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("providerEvidence persists structured review evidence and metadata pointer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-review-evidence-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "reviewer@example.com"]);
    git(root, ["config", "user.name", "Reviewer"]);
    writeTrack(root, "evidence_20260617", samplePlan("evidence_20260617"), {
      owner: "owner@example.com",
    });

    const recorded = core.providerEvidence(root, {
      trackId: "evidence_20260617",
      provider: "github",
      reviewer: "reviewer@example.com",
      fetch: false,
      findings: [
        { id: "finding-1", severity: "blocking", message: "Needs a test" },
        { id: "finding-2", severity: "warning", message: "Polish naming" },
      ],
      evidence: { pr: 42, checks: "pending" },
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.entry.blocking_count, 1);

    const evidence = core.reviewEvidence(root, "evidence_20260617");
    assert.equal(evidence.ok, true);
    assert.equal(evidence.evidence.entries.length, 1);
    assert.equal(evidence.evidence.entries[0].provider, "github");

    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "evidence_20260617", "metadata.json"), "utf8"));
    assert.equal(metadata.review_evidence.path, "cadre/tracks/evidence_20260617/review-evidence.json");
    assert.equal(metadata.review_evidence.blocking_count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo reviewAssist, machine gate, and review records are repo-aware", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-review-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "owner@example.com"]);
    git(root, ["config", "user.name", "Owner"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({ mode: "polyrepo", default_repo: "app" }, null, 2));

    const appRoot = path.join(root, "repos", "app");
    fs.mkdirSync(appRoot, { recursive: true });
    git(appRoot, ["init"]);
    git(appRoot, ["config", "user.email", "app@example.com"]);
    git(appRoot, ["config", "user.name", "App"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() {\n  return true;\n}\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "initial app"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() {\n  // TODO verify edge case\n  return true;\n}\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "feature app"]);
    const appHead = git(appRoot, ["rev-parse", "HEAD"]).stdout.trim();

    const plan = `# Plan: poly_20260617

## Phase 1: App

- [x] Task 1: Update app
  <!-- repo: app -->
  <!-- files: src/app.js -->
`;
    writeTrack(root, "poly_20260617", plan, {
      owner: "owner@example.com",
      last_coverage: 91,
      repos: {
        app: {
          submodule_path: "repos/app",
          git_branch: "HEAD",
          base_branch: "HEAD~1",
        },
      },
    });

    const assist = core.reviewAssist(root, {
      trackId: "poly_20260617",
      includeLsp: false,
      includeMachine: false,
      todoLimit: 10,
    });
    assert.equal(assist.ok, true);
    const appDiff = assist.repo_diffs.find((entry) => entry.repo === "app");
    assert.ok(appDiff);
    assert.ok(appDiff.files.includes("src/app.js"));
    assert.ok(assist.todos.some((todo) => todo.repo === "app" && todo.file === "src/app.js"));

    const machine = core.reviewMachineGate(root, {
      trackId: "poly_20260617",
      machineCommand: "node -e \"process.exit(0)\"",
    });
    assert.equal(machine.ok, true);
    assert.equal(machine.available, true);
    assert.equal(machine.results[0].repo, "app");

    const review = core.recordReview(root, {
      trackId: "poly_20260617",
      verdict: "approved",
      reviewer: "reviewer@example.com",
    });
    assert.equal(review.ok, true);
    assert.equal(review.review.reviewed_shas.app, appHead);

    const matchingGate = core.reviewGate(root, "poly_20260617", {
      headSha: "control-without-review-pin",
      headShas: { app: appHead },
    });
    assert.equal(matchingGate.ok, true);

    const staleGate = core.reviewGate(root, "poly_20260617", {
      headShas: { app: "0000000" },
    });
    assert.equal(staleGate.ok, false);
    assert.ok(staleGate.reasons.some((reason) => reason.includes("reviewed_shas.app")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo workflows fail closed on unresolved task repos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-missing-repo-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({ mode: "polyrepo", default_repo: "app" }, null, 2));
    write(path.join(root, "cadre", "config.json"), JSON.stringify({
      coverage_command: "node -e \"require('fs').writeFileSync('coverage-ran.txt','yes')\"",
      machine_gate_command: "node -e \"process.exit(0)\"",
    }, null, 2));
    fs.mkdirSync(path.join(root, "repos", "app"), { recursive: true });

    const plan = `# Plan: missing_repo_20260617

## Phase 1: App

- [x] Task 1: Update ghost repo
  <!-- repo: ghost -->
  <!-- files: src/app.js -->
`;
    writeTrack(root, "missing_repo_20260617", plan, {
      owner: "owner@example.com",
      last_coverage: 91,
      repos: {
        app: {
          submodule_path: "repos/app",
          git_branch: "HEAD",
          base_branch: "main",
        },
      },
    });

    const integrity = core.planIntegrity(root, "missing_repo_20260617");
    assert.equal(integrity.ok, false);
    assert.ok(integrity.errors.some((error) => error.repo === "ghost"));

    const schedule = core.phaseSchedule(root, { trackId: "missing_repo_20260617" });
    assert.equal(schedule.ok, false);
    assert.ok(schedule.errors.some((error) => error.repo === "ghost"));

    const completion = core.completeTask(root, {
      trackId: "missing_repo_20260617",
      phaseIndex: 1,
      taskIndex: 1,
    });
    assert.equal(completion.ok, false);
    assert.equal(completion.stage, "polyrepo_repo_resolution");
    assert.equal(fs.existsSync(path.join(root, "coverage-ran.txt")), false);

    const coverage = core.testCoverage(root, {
      trackId: "missing_repo_20260617",
      phaseIndex: 1,
      taskIndex: 1,
    });
    assert.equal(coverage.ok, false);
    assert.equal(coverage.stage, "polyrepo_repo_resolution");

    const assist = core.reviewAssist(root, {
      trackId: "missing_repo_20260617",
      includeLsp: false,
      includeMachine: false,
    });
    assert.equal(assist.ok, false);
    assert.equal(assist.stage, "polyrepo_repo_resolution");

    const machine = core.reviewMachineGate(root, {
      trackId: "missing_repo_20260617",
    });
    assert.equal(machine.ok, false);
    assert.equal(machine.stage, "polyrepo_repo_resolution");

    const review = core.recordReview(root, {
      trackId: "missing_repo_20260617",
      verdict: "approved",
      reviewer: "reviewer@example.com",
    });
    assert.equal(review.ok, false);
    assert.equal(review.stage, "polyrepo_repo_resolution");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
