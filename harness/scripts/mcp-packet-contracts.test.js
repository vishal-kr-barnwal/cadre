#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const esbuild = require("esbuild");

const harnessRoot = path.resolve(__dirname, "..");
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-packet-contracts-"));
function loadPacket(name) {
  const outfile = path.join(bundleRoot, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(harnessRoot, "src", "mcp", "application", "packets", `${name}.ts`)],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "silent",
  });
  return require(outfile);
}

const { parallelPacket } = loadPacket("parallel");
const { jobPacket } = loadPacket("job");

test.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

function dependencies(stateWorkers = []) {
  return {
    rootResolver: { requireCadreRoot: ({ root }) => root },
    core: {
      parallelWorkflow: (_root, args) => {
        if (args.action === "next_wave") return { ok: true, workers: [{ worker_id: "worker-1" }] };
        if (args.action === "setup_workers") return { ok: true, workers: [{ worker_id: "worker-1", dispatch: {} }] };
        if (args.action === "plan") return { ok: true, state: { workers: stateWorkers } };
        return { ok: true, action: args.action };
      },
    },
  };
}

test("parallel packets return exact immediate continuations and explicit fan-out callbacks", () => {
  const root = "/project";
  const wave = parallelPacket(dependencies(), {
    root,
    action: "next_wave",
    trackId: "track-1",
    agentIdentifier: "codex",
  });
  assert.deepEqual(wave.next, {
    tool: "cadre_action",
    arguments: {
      root,
      action: "parallel.setup_workers",
      input: { trackId: "track-1", groupIndex: 0, maxWorkers: null, agentIdentifier: "codex" },
      execute: true,
    },
  });

  const setup = parallelPacket(dependencies(), {
    root,
    action: "setup_workers",
    trackId: "track-1",
    agentIdentifier: "codex",
    execute: true,
  });
  assert.equal(setup.next, null);
  assert.deepEqual(setup.required, ["data.workers[].dispatch.record_finish_packet"]);

  const setupPreview = parallelPacket(dependencies(), {
    root,
    action: "setup_workers",
    trackId: "track-1",
    agentIdentifier: "codex",
  });
  assert.equal(setupPreview.next, null);
  assert.deepEqual(setupPreview.required, ["execute"]);

  const finished = parallelPacket(dependencies([{ worker_id: "worker-1", status: "awaiting_merge" }]), {
    root,
    action: "record_finish",
    trackId: "track-1",
    agentIdentifier: "codex",
    execute: true,
  });
  assert.equal(finished.next.arguments.action, "parallel.merge_back");
  assert.equal(finished.next.arguments.execute, true);

  const merged = parallelPacket(dependencies([{ worker_id: "worker-1", status: "merged" }]), {
    root,
    action: "merge_back",
    trackId: "track-1",
    agentIdentifier: "codex",
    execute: true,
  });
  assert.equal(merged.next.arguments.action, "parallel.cleanup");

  const cleaned = parallelPacket(dependencies([{ worker_id: "worker-1", status: "merged" }]), {
    root,
    action: "cleanup",
    trackId: "track-1",
    agentIdentifier: "codex",
    execute: true,
  });
  assert.deepEqual(cleaned.next, {
    tool: "cadre_workflow",
    arguments: {
      root,
      workflow: "implement",
      input: { trackId: "track-1", agentIdentifier: "codex" },
      execute: false,
    },
  });
});

test("parallel record_finish waits for every worker callback", () => {
  const response = parallelPacket(dependencies([
    { worker_id: "worker-1", status: "awaiting_merge" },
    { worker_id: "worker-2", status: "in_progress", phase_index: 1, task_index: 2, worktree: "/project/.workers/worker-2" },
  ]), {
    root: "/project",
    action: "record_finish",
    trackId: "track-1",
    execute: true,
  });
  assert.equal(response.next, null);
  assert.deepEqual(response.required, ["data.worker_callbacks[].record_finish_packet"]);
  assert.equal(response.data.worker_callbacks.length, 1);
  assert.equal(response.data.worker_callbacks[0].worker_id, "worker-2");
  assert.equal(response.data.worker_callbacks[0].kind, "completion");
  assert.deepEqual(response.data.worker_callbacks[0].record_finish_packet, {
    tool: "cadre_action",
    arguments: {
      root: "/project",
      action: "parallel.record_finish",
      input: {
        trackId: "track-1",
        workerId: "worker-2",
        status: "awaiting_merge",
        phaseIndex: 1,
        taskIndex: 2,
        repo: ".",
        workerRef: null,
        commitSha: "<commit-sha>",
        coverage: "<coverage-number-or-null>",
        filesChanged: ["<changed-file>"],
        tests: [{ command: "<test-command>", cwd: "/project/.workers/worker-2", ok: true, status: 0 }],
        summary: "<worker-summary>",
        blockers: [],
      },
      execute: true,
    },
  });
});

test("parallel packets return exact recovery callbacks and never advance unmerged state", () => {
  const root = "/project";
  const blocked = { worker_id: "worker-1", status: "conflict", phase_index: 1, task_index: 1 };
  const recorded = parallelPacket(dependencies([blocked]), {
    root,
    action: "record_finish",
    trackId: "track-1",
    agentIdentifier: "codex",
    execute: true,
  });
  assert.equal(recorded.next, null);
  assert.deepEqual(recorded.required, ["data.worker_callbacks[].record_finish_packet"]);
  assert.equal(recorded.data.worker_callbacks[0].kind, "recovery");
  assert.equal(recorded.data.worker_callbacks[0].record_finish_packet.arguments.action, "parallel.record_finish");
  assert.equal(recorded.data.worker_callbacks[0].record_finish_packet.arguments.input.workerId, "worker-1");

  const merge = parallelPacket(dependencies([{ worker_id: "worker-1", status: "awaiting_merge" }]), {
    root,
    action: "merge_back",
    trackId: "track-1",
    execute: true,
  });
  assert.equal(merge.next, null);
  assert.deepEqual(merge.required, ["data.worker_callbacks[].record_finish_packet"]);

  const cleanup = parallelPacket(dependencies([{ worker_id: "worker-1", status: "in_progress" }]), {
    root,
    action: "cleanup",
    trackId: "track-1",
    execute: true,
  });
  assert.equal(cleanup.next, null);
  assert.deepEqual(cleanup.required, ["data.worker_callbacks[].record_finish_packet"]);

  const emptyMerge = parallelPacket(dependencies([]), {
    root,
    action: "merge_back",
    trackId: "track-1",
    execute: true,
  });
  assert.equal(emptyMerge.ok, false);
  assert.equal(emptyMerge.next, null);
  assert.match(emptyMerge.errors.join(" "), /no worker state/i);
});

test("job result packets remain pollable and resume completed task workflows", () => {
  const root = "/project";
  const record = {
    id: "job_00000000-0000-0000-0000-000000000000",
    type: "complete_task",
    root,
    args: { trackId: "track-1" },
    status: "running",
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: null,
    stdout: "",
    stderr: "",
    result: null,
    exit_code: null,
    signal: null,
  };
  const deps = {
    rootResolver: { requireCadreRoot: ({ root: candidate }) => candidate },
    jobs: {
      get: () => record,
      result: () => ({ ok: true, job: { id: record.id, type: record.type, root, status: record.status }, result: {} }),
      loadPersisted: () => null,
    },
  };
  const running = jobPacket(deps, { root, action: "result", jobId: record.id });
  assert.deepEqual(running.next, {
    tool: "cadre_action",
    arguments: { root, action: "job.result", input: { jobId: record.id } },
  });

  record.status = "succeeded";
  record.args = { track_id: "track-1" };
  const completed = jobPacket(deps, { root, action: "result", jobId: record.id });
  assert.deepEqual(completed.next, {
    tool: "cadre_workflow",
    arguments: { root, workflow: "implement", input: { trackId: "track-1" }, execute: false },
  });
});

test("persisted running jobs fail closed after a server restart", () => {
  const root = "/project";
  const jobId = "job_00000000-0000-0000-0000-000000000000";
  const response = jobPacket({
    rootResolver: { requireCadreRoot: ({ root: candidate }) => candidate },
    jobs: {
      get: () => null,
      result: () => ({ ok: false, error: `Job not found: ${jobId}` }),
      loadPersisted: () => ({ id: jobId, type: "coverage", root, status: "running", stale: true }),
    },
  }, { root, action: "result", jobId });
  assert.equal(response.ok, false);
  assert.equal(response.next, null);
  assert.match(response.errors.join(" "), /interrupted.*restart/i);
});
