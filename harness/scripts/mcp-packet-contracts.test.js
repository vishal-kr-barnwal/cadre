#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const esbuild = require("esbuild");
const core = require("./cadre-core.js");

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

function loadSource(name, entry) {
  const outfile = path.join(bundleRoot, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(harnessRoot, "src", ...entry)],
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
const { trackPacket } = loadPacket("track");
const { parseWorkflowToolRequest, workflowRuntimeArgs } = loadSource("workflow-tool-requests", ["mcp", "application", "tool-requests.ts"]);

test.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

function approvalStamp(packet) {
  assert.match(packet.decision.stage_hash, /^[a-f0-9]{64}$/);
  assert.equal(Number.isSafeInteger(packet.decision.stage_revision), true);
  return {
    stage_hash: packet.decision.stage_hash,
    stage_revision: packet.decision.stage_revision,
  };
}

function assertWritableInputPaths(decision, expected) {
  assert.equal(Array.isArray(decision.writable_paths), true);
  for (const pointer of decision.writable_paths) {
    assert.equal(
      typeof pointer === "string" && pointer.startsWith("/arguments/input/"),
      true,
      `Unsafe workflow continuation path: ${String(pointer)}`,
    );
  }
  if (expected) assert.deepEqual(decision.writable_paths, expected);
}

function assertWorkflowDecisionContinuation(packet, field, {
  root,
  workflow,
  input,
  sessionId = null,
  writablePaths,
}) {
  const approval = sessionId ? { session_id: sessionId } : undefined;
  const expectedArguments = {
    root,
    workflow,
    input,
    execute: false,
    ...(approval ? { approval } : {}),
  };
  assert.deepEqual(packet.decision[field], {
    tool: "cadre_workflow",
    arguments: expectedArguments,
  });
  assert.deepEqual(parseWorkflowToolRequest(packet.decision[field].arguments), expectedArguments);
  if (sessionId) {
    assert.deepEqual(packet.decision[field].arguments.approval, { session_id: sessionId });
  }
  assertWritableInputPaths(packet.decision, writablePaths);
}

const inputPaths = (...arguments_) => arguments_.map((argument) => `/arguments/input/${argument.replaceAll(".", "/")}`);
const setupProductPaths = inputPaths(
  "product", "intent.product", "intent.productOther", "intent.productIntent", "intent.productSummary",
  "productOther", "productIntent", "productSummary",
);
const setupGuidelinePaths = inputPaths("productGuidelines");
const setupTechnicalPaths = inputPaths(
  "techStack", "intent.techStack", "intent.techStackOther", "intent.techStackIntent", "intent.techStackSummary",
  "techStackOther", "techStackIntent", "techStackSummary", "styleGuideIds",
  "writeLsp", "setupLsp", "lsp", "providerMode", "provider", "syncMode", "teamSize", "integrations",
  "config", "topology", "polyrepo", "repos", "ciProvider", "writeCi", "writeGitattributes",
  "addSubmodules", "executeSubmodules",
);
const setupWorkflowPaths = inputPaths("workflowPolicy");
const newTrackSpecPaths = inputPaths(
  "spec", "description", "intent.goal", "intent.goalOther", "goal", "goalOther",
  "intent.outcome", "intent.outcomeOther", "outcome", "outcomeOther",
  "intent.acceptanceCriteria", "intent.acceptanceCriteriaOther", "acceptanceCriteria", "acceptanceCriteriaOther",
  "intent.scope", "intent.scopeOther", "scope", "scopeOther",
);

test("public workflow packets reject injected runtime controls and skill integrity metadata", () => {
  for (const field of ["root", "approval", "source_files", "source_file_hashes", "_cadreApprovalInputError", "_cadreApprovalPersistedPayload"]) {
    assert.throws(() => parseWorkflowToolRequest({
      root: "/project",
      workflow: "skill",
      input: { [field]: field === "source_files" ? [] : {} },
    }), new RegExp(`reserved control fields: ${field}`));
  }
});

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

test("executed worktree setup resumes the implement workflow", () => {
  const root = "/project";
  const response = trackPacket({
    rootResolver: { requireCadreRoot: ({ root: candidate }) => candidate },
    core: { worktreePlan: () => ({ ok: true, track_id: "track-1", branch_set: [{ repo: "root", health: "ready" }] }) },
  }, {
    root,
    action: "worktree_plan",
    trackId: "track-1",
    repo: "root",
    base: "main",
    head: "track/track-1",
    agentIdentifier: "codex",
    maxWorkers: 3,
    execute: true,
  });
  assert.deepEqual(response.next, {
    tool: "cadre_workflow",
    arguments: {
      root,
      workflow: "implement",
      input: {
        trackId: "track-1",
        repo: "root",
        base: "main",
        head: "track/track-1",
        agentIdentifier: "codex",
        maxWorkers: 3,
      },
      execute: true,
    },
  });
});

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

test("pre-session clarifications preserve partial false and empty input values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-partial-setup-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    fs.writeFileSync(path.join(root, "src", "app.ts"), "export const app = true;\n");
    const partialInput = {
      providerMode: "local",
      styleGuideIds: [],
      writeLsp: false,
    };
    const packet = invoke({ root, workflow: "setup", input: partialInput, execute: false });
    assert.equal(packet.decision.kind, "clarification");
    assert.equal(packet.decision.session_id, null);
    assert.deepEqual(packet.required, ["product"]);
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "setup",
      input: partialInput,
      writablePaths: [
        "/arguments/input/intent/product",
        "/arguments/input/intent/productOther",
        "/arguments/input/product",
      ],
    });
    assert.deepEqual(packet.decision.prompts[0].responseTarget.valueMap, {});
    assert.deepEqual(packet.decision.resume.arguments.input.styleGuideIds, []);
    assert.equal(packet.decision.resume.arguments.input.writeLsp, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public setup packets preserve one lazy session across evidence, prompts, approvals, and execution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-setup-staging-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  const artifactPaths = (packet) => packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort();
  const sessionDirectory = path.join(root, "cadre", "local", "approval-sessions");
  const onlySession = (sessionId) => {
    assert.deepEqual(fs.readdirSync(sessionDirectory).filter((file) => file.endsWith(".json")), [`${sessionId}.json`]);
    return JSON.parse(fs.readFileSync(path.join(sessionDirectory, `${sessionId}.json`), "utf8"));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    spawnSync("git", ["config", "user.email", "setup@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Setup Test"], { cwd: root });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "repos", "app", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } }, null, 2)}\n`);
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
    fs.writeFileSync(path.join(root, "src", "app.ts"), "export const app = true;\n");
    fs.writeFileSync(path.join(root, "repos", "app", "src", "app.ts"), "export const nested = true;\n");

    const baseInput = {
      product: { title: "Packet Product", summary: "Coordinate a repository-grounded staged setup." },
      productGuidelines: { title: "Product Guidelines", summary: "Keep recovery explicit and preserve reviewed evidence." },
      techStack: { languages: ["TypeScript"] },
      workflowPolicy: { title: "Project Workflow", summary: "Run focused tests and record explicit stage approvals." },
      topology: "polyrepo",
      repos: {
        mode: "polyrepo",
        default_repo: "app",
        repos: [{ name: "app", submodule_path: "repos/app", url: "git@github.com:org/app.git", enabled: true }],
      },
      providerMode: "local",
      syncMode: "local",
      integrations: {},
    };
    let packet = invoke({ root, workflow: "setup", input: baseInput, execute: false });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "product");
    assert.deepEqual(artifactPaths(packet), ["cadre/product.json", "cadre/product.md"]);
    const sessionId = packet.decision.session_id;
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "setup",
      input: {},
      sessionId,
      writablePaths: setupProductPaths,
    });
    let session = onlySession(sessionId);
    assert.deepEqual(session.stage_order, ["product", "product_guidelines", "technical", "workflow"]);
    assert.deepEqual(session.stage_records.product.snapshot_files.map((file) => file.path), ["cadre/product.json", "cadre/product.md"]);
    assert.deepEqual(session.stage_records.product_guidelines.snapshot_files, []);
    assert.deepEqual(session.stage_records.technical.snapshot_files, []);
    assert.deepEqual(session.stage_records.workflow.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);

    packet = invoke({
      root,
      workflow: "setup",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "product", ...approvalStamp(packet), approved_stages: ["product"] },
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "product_guidelines");
    assert.equal(packet.decision.session_id, sessionId);
    assert.deepEqual(artifactPaths(packet), ["cadre/product_guidelines.json", "cadre/product_guidelines.md"]);
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "setup",
      input: {},
      sessionId,
      writablePaths: setupGuidelinePaths,
    });
    onlySession(sessionId);

    packet = invoke({
      root,
      workflow: "setup",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "product_guidelines", ...approvalStamp(packet), approved_stages: ["product", "product_guidelines"] },
    });
    assert.equal(packet.decision.kind, "clarification");
    assert.equal(packet.decision.current_stage, "technical");
    assert.equal(packet.decision.session_id, sessionId);
    assert.deepEqual(packet.decision.approved_stages, ["product", "product_guidelines"]);
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "setup",
      input: {},
      sessionId,
      writablePaths: inputPaths("styleGuideIds", "writeLsp"),
    });
    assert.deepEqual(packet.decision.prompts.map((prompt) => prompt.id).sort(), ["setup-lsp", "setup-style-guides"]);
    const lspPrompt = packet.decision.prompts.find((prompt) => prompt.id === "setup-lsp");
    assert.deepEqual(lspPrompt.responseTarget.valueMap, {
      "write-lsp": { writeLsp: true },
      "skip-lsp": { writeLsp: false },
    });
    for (const choice of lspPrompt.choices) {
      const mappedInput = lspPrompt.responseTarget.valueMap[choice.id];
      const mappedCall = structuredClone(packet.decision.resume);
      Object.assign(mappedCall.arguments.input, mappedInput);
      assert.deepEqual(parseWorkflowToolRequest(mappedCall.arguments), mappedCall.arguments);
      for (const key of Object.keys(mappedInput)) {
        assert.ok(packet.decision.writable_paths.includes(`/arguments/input/${key}`));
      }
    }
    assert.deepEqual(artifactPaths(packet), []);

    packet = invoke({
      root,
      workflow: "setup",
      input: { styleGuideIds: ["general", "typescript"] },
      execute: false,
      approval: { session_id: sessionId },
    });
    assert.equal(packet.decision.kind, "clarification");
    assert.deepEqual(packet.decision.prompts.map((prompt) => prompt.id), ["setup-lsp"]);
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "setup",
      input: {},
      sessionId,
      writablePaths: inputPaths("writeLsp"),
    });
    session = onlySession(sessionId);
    assert.deepEqual(session.payload.styleGuideIds, ["general", "typescript"]);
    assert.deepEqual(session.stage_records.technical.snapshot_files, []);

    const skipLspPrompt = packet.decision.prompts.find((prompt) => prompt.id === "setup-lsp");
    assert.deepEqual(skipLspPrompt.responseTarget.valueMap["skip-lsp"], { writeLsp: false });
    const skipLspResume = structuredClone(packet.decision.resume);
    Object.assign(skipLspResume.arguments.input, skipLspPrompt.responseTarget.valueMap["skip-lsp"]);
    packet = invoke(skipLspResume.arguments);
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "technical");
    assert.equal(packet.decision.session_id, sessionId);
    assert.deepEqual(artifactPaths(packet), [
      "cadre/repos.json",
      "cadre/repos.md",
      "cadre/styleguides/README.md",
      "cadre/styleguides/general.json",
      "cadre/styleguides/general.md",
      "cadre/styleguides/index.json",
      "cadre/styleguides/typescript.json",
      "cadre/styleguides/typescript.md",
      "cadre/tech-stack.json",
      "cadre/tech-stack.md",
    ]);
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "setup",
      input: {},
      sessionId,
      writablePaths: setupTechnicalPaths,
    });
    session = onlySession(sessionId);
    assert.deepEqual(session.final_snapshot_files, []);

    packet = invoke({
      root,
      workflow: "setup",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "technical", ...approvalStamp(packet), approved_stages: ["product", "product_guidelines", "technical"] },
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "workflow");
    assert.equal(packet.decision.session_id, sessionId);
    assert.deepEqual(artifactPaths(packet), ["cadre/workflow.json", "cadre/workflow.md"]);
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "setup",
      input: {},
      sessionId,
      writablePaths: setupWorkflowPaths,
    });
    session = onlySession(sessionId);
    assert.ok(session.final_snapshot_files.some((file) => file.path === "cadre/config.json"));
    const firstFinalSnapshot = JSON.stringify(session.final_snapshot_files);

    packet = invoke({ root, workflow: "setup", input: {}, execute: false, approval: { session_id: sessionId } });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "workflow");
    assert.equal(JSON.stringify(onlySession(sessionId).final_snapshot_files), firstFinalSnapshot);

    packet = invoke({
      root,
      workflow: "setup",
      input: {},
      execute: false,
      approval: {
        session_id: sessionId,
        stage: "workflow",
        ...approvalStamp(packet),
        approved_stages: ["product", "product_guidelines", "technical", "workflow"],
      },
    });
    const approvedStages = ["product", "product_guidelines", "technical", "workflow"];
    assert.deepEqual(packet.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "setup",
        input: {},
        execute: true,
        approval: { session_id: sessionId, approved_stages: approvedStages, complete: true },
      },
    });
    const approvedSession = onlySession(sessionId);
    packet = invoke(packet.next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.decision.kind, "complete");
    assert.equal(fs.existsSync(path.join(root, "cadre", "lsp.json")), false);
    assert.equal(packet.data.control_commit.ok, true);
    for (const snapshot of approvedSession.snapshot_files.filter((file) => file.missing !== true)) {
      assert.equal(fs.readFileSync(path.join(root, snapshot.path), "utf8"), snapshot.content, snapshot.path);
    }
    assert.equal(fs.existsSync(path.join(sessionDirectory, `${sessionId}.json`)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stale staged approval exposes authoritative recovery while a missing session does not", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-stale-approval-"));
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-missing-approval-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    for (const candidate of [root, missingRoot]) {
      assert.equal(spawnSync("git", ["init"], { cwd: candidate, encoding: "utf8" }).status, 0);
    }

    const missingSessionId = "000000000000000000000001";
    const missing = invoke({
      root: missingRoot,
      workflow: "setup",
      input: {},
      execute: false,
      approval: { session_id: missingSessionId },
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.decision.kind, "blocked");
    assert.match(missing.decision.reason, /session was not found/i);
    assert.equal(missing.decision.session_id, missingSessionId);
    assert.equal(missing.decision.resume, null);
    assert.equal(missing.next, null);

    const baseInput = {
      product: { title: "Stale Approval Product", summary: "Review exact staged setup revisions." },
      productGuidelines: { title: "Product Guidelines", summary: "Preserve each reviewed stage revision." },
      techStack: { languages: ["TypeScript"] },
      workflowPolicy: { title: "Project Workflow", summary: "Approve only the currently reviewed bytes." },
      providerMode: "local",
      syncMode: "local",
      styleGuideIds: [],
      writeLsp: false,
      integrations: {},
    };
    let packet = invoke({ root, workflow: "setup", input: baseInput, execute: false });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "product");
    const sessionId = packet.decision.session_id;

    packet = invoke({
      root,
      workflow: "setup",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "product", ...approvalStamp(packet), approved_stages: ["product"] },
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "product_guidelines");
    const staleStamp = approvalStamp(packet);

    const amended = invoke({
      root,
      workflow: "setup",
      input: {
        productGuidelines: {
          title: "Product Guidelines",
          summary: "The user's corrected guideline evidence is authoritative.",
        },
      },
      execute: false,
      approval: { session_id: sessionId },
    });
    assert.equal(amended.decision.kind, "approval");
    assert.equal(amended.decision.stage, "product_guidelines");
    assert.notEqual(amended.decision.stage_hash, staleStamp.stage_hash);
    assert.ok(amended.decision.stage_revision > staleStamp.stage_revision);

    const stale = invoke({
      root,
      workflow: "setup",
      input: {},
      execute: false,
      approval: {
        session_id: sessionId,
        stage: "product_guidelines",
        ...staleStamp,
        approved_stages: ["product", "product_guidelines"],
      },
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.decision.kind, "blocked");
    assert.equal(stale.decision.current_stage, "product_guidelines");
    assert.equal(stale.decision.stage_hash, amended.decision.stage_hash);
    assert.equal(stale.decision.stage_revision, amended.decision.stage_revision);
    assert.deepEqual(stale.decision.approved_stages, ["product"]);
    assertWorkflowDecisionContinuation(stale, "resume", {
      root,
      workflow: "setup",
      input: {},
      sessionId,
      writablePaths: setupGuidelinePaths,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(missingRoot, { recursive: true, force: true });
  }
});

test("newtrack schema clarification returns a typed current-stage resume", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-newtrack-schema-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    const packet = invoke({
      root,
      workflow: "newtrack",
      input: {
        trackId: "invalid_spec_schema_20260715",
        spec: { version: 1, schema: "not-cadre-spec" },
        commitMode: "off",
      },
      execute: false,
    });
    assert.equal(packet.ok, false);
    assert.equal(packet.decision.kind, "clarification");
    assert.equal(packet.decision.current_stage, "spec");
    assert.deepEqual(packet.decision.prompts, []);
    assert.deepEqual(packet.required, ["spec"]);
    const sessionId = packet.decision.session_id;
    assert.match(sessionId, /^[a-f0-9]{24}$/);
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "newtrack",
      input: {},
      sessionId,
      writablePaths: ["/arguments/input/spec"],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public newtrack packets collect spec then plan and execute the exact continuation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-newtrack-staging-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  const trackId = "public_newtrack_20260714";
  const spec = {
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: trackId,
    title: "Public newtrack lifecycle",
    description: "Create one track through an ordered spec then plan review session.",
    functional_requirements: [{ heading: "Spec first", body: "Review requirements before Cadre requests the plan." }],
    non_functional_requirements: [],
    acceptance_criteria: [{ heading: "Exact continuation", body: "The returned continuation writes only approved snapshot bytes." }],
    out_of_scope: [{ heading: "No eager plan", body: "Do not generate plan or final files during spec review." }],
  };
  const plan = {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: trackId,
    title: "Plan: public newtrack lifecycle",
    phases: [{
      phase_index: 1,
      title: "Phase 1: Implement",
      execution_mode: "sequential",
      depends_on: [],
      tasks: [{
        task_index: 1,
        task_key: "phase1_task1",
        title: "Implement the approved spec",
        status: "pending",
        files: ["src/newtrack.ts"],
        depends_on: [],
        commit_shas: [],
        repo_shas: {},
      }],
    }],
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    spawnSync("git", ["config", "user.email", "newtrack@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Newtrack Test"], { cwd: root });

    let packet = invoke({
      root,
      workflow: "newtrack",
      input: { trackId, spec, commitMode: "off" },
      execute: false,
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "spec");
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort(), [
      `cadre/tracks/${trackId}/spec.json`,
      `cadre/tracks/${trackId}/spec.md`,
    ]);
    const sessionId = packet.decision.session_id;
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "newtrack",
      input: {},
      sessionId,
      writablePaths: newTrackSpecPaths,
    });

    packet = invoke({
      root,
      workflow: "newtrack",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "spec", ...approvalStamp(packet), approved_stages: ["spec"] },
    });
    assert.equal(packet.decision.kind, "clarification");
    assert.equal(packet.decision.current_stage, "plan");
    assert.equal(packet.decision.session_id, sessionId);
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "newtrack",
      input: {},
      sessionId,
      writablePaths: inputPaths("plan"),
    });
    assert.deepEqual(packet.required, ["plan"]);
    assert.deepEqual(packet.artifacts, []);

    packet = invoke({
      root,
      workflow: "newtrack",
      input: { plan },
      execute: false,
      approval: { session_id: sessionId },
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "plan");
    assert.equal(packet.decision.session_id, sessionId);
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "newtrack",
      input: {},
      sessionId,
      writablePaths: inputPaths("plan"),
    });
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort(), [
      `cadre/tracks/${trackId}/plan.json`,
      `cadre/tracks/${trackId}/plan.md`,
    ]);
    for (const name of ["metadata.json", "learnings.jsonl", "learnings.md"]) {
      assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, name)), false, `${name} is final-only`);
    }

    packet = invoke({
      root,
      workflow: "newtrack",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "plan", ...approvalStamp(packet), approved_stages: ["spec", "plan"] },
    });
    assert.equal(packet.decision.kind, "ready");
    assert.deepEqual(packet.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "newtrack",
        input: {},
        execute: true,
        approval: { session_id: sessionId, approved_stages: ["spec", "plan"], complete: true },
      },
    });
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const approvedSnapshots = JSON.parse(fs.readFileSync(sessionFile, "utf8")).snapshot_files
      .filter((file) => file.missing !== true)
      .map((file) => ({ path: file.path, content: file.content }));
    packet = invoke(packet.next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.decision.kind, "complete");
    for (const snapshot of approvedSnapshots) {
      assert.equal(fs.readFileSync(path.join(root, snapshot.path), "utf8"), snapshot.content, snapshot.path);
    }
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public formula pour packets retain formula identity through staged continuation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-formula-pour-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  const trackId = "public_formula_pour_20260714";
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    spawnSync("git", ["config", "user.email", "formula@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Formula Test"], { cwd: root });
    fs.mkdirSync(path.join(root, "cadre", "formulas"), { recursive: true });
    fs.writeFileSync(path.join(root, "cadre", "formulas", "api.json"), `${JSON.stringify({
      version: 1,
      schema: "cadre.formula.v1",
      id: "api",
      title: "API formula",
      description: "Create the reviewed API workflow.",
      phase_title: "API workflow delivery",
      defaults: { service: "billing" },
      acceptance: ["The API workflow follows its approved spec and plan."],
      steps: [{ id: "build", title: "Build the API workflow", files: ["src/api.ts"] }],
    }, null, 2)}\n`);

    const invalid = invoke({
      root,
      workflow: "formula",
      input: {},
      execute: false,
      approval: { session_id: "000000000000000000000001" },
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.workflow, "formula");
    assert.equal(invalid.data.action, "pour");
    assert.equal(invalid.decision.kind, "blocked");

    let packet = invoke({
      root,
      workflow: "formula",
      input: { action: "pour", id: "api", trackId, commitMode: "off" },
      execute: false,
    });
    assert.equal(packet.workflow, "formula");
    assert.equal(packet.data.action, "pour");
    assert.equal(packet.data.formula_id, "api");
    assert.deepEqual(packet.data.variables, { service: "billing" });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "spec");
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort(), [
      `cadre/tracks/${trackId}/spec.json`,
      `cadre/tracks/${trackId}/spec.md`,
    ]);
    const sessionId = packet.decision.session_id;
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "formula",
      input: {},
      sessionId,
      writablePaths: newTrackSpecPaths,
    });

    packet = invoke({
      root,
      workflow: "formula",
      input: {},
      execute: false,
      approval: { session_id: sessionId },
    });
    assert.equal(packet.workflow, "formula");
    assert.equal(packet.data.action, "pour");
    assert.equal(packet.data.formula_id, "api");
    assert.deepEqual(packet.data.variables, { service: "billing" });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "spec");
    assert.equal(packet.decision.session_id, sessionId);

    packet = invoke({
      root,
      workflow: "formula",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "spec", ...approvalStamp(packet), approved_stages: ["spec"] },
    });
    assert.equal(packet.workflow, "formula");
    assert.equal(packet.data.action, "pour");
    assert.equal(packet.data.formula_id, "api");
    assert.deepEqual(packet.data.variables, { service: "billing" });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "plan");
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "formula",
      input: {},
      sessionId,
      writablePaths: inputPaths("plan"),
    });
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort(), [
      `cadre/tracks/${trackId}/plan.json`,
      `cadre/tracks/${trackId}/plan.md`,
    ]);

    packet = invoke({
      root,
      workflow: "formula",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "plan", ...approvalStamp(packet), approved_stages: ["spec", "plan"] },
    });
    assert.deepEqual(packet.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "formula",
        input: {},
        execute: true,
        approval: { session_id: sessionId, approved_stages: ["spec", "plan"], complete: true },
      },
    });

    packet = invoke(packet.next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.workflow, "formula");
    assert.equal(packet.decision.kind, "complete");
    assert.equal(packet.data.formula_id, "api");
    assert.equal(packet.data.track_id, trackId);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "metadata.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public revise packets preserve declared spec then plan staging through the exact continuation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-revise-staging-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  const writeJson = (relativePath, value) => {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  const trackId = "public_revise_20260714";
  const spec = (description) => ({
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: trackId,
    title: "Public revise lifecycle",
    description,
    functional_requirements: [{ heading: "Ordered review", body: "Review the spec before requesting the dependent plan." }],
    non_functional_requirements: [],
    acceptance_criteria: [{ heading: "Exact execution", body: "Execute only the bytes approved in both stages." }],
    out_of_scope: [],
  });
  const plan = (taskTitle) => ({
    version: 1,
    schema: "cadre.plan.v1",
    track_id: trackId,
    title: "Plan: public revise lifecycle",
    phases: [{
      phase_index: 1,
      title: "Phase 1: Revise",
      execution_mode: "sequential",
      depends_on: [],
      tasks: [{
        task_index: 1,
        task_key: "phase1_task1",
        title: taskTitle,
        status: "pending",
        files: ["src/revise.ts"],
        depends_on: [],
        commit_shas: [],
        repo_shas: {},
      }],
    }],
  });
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    spawnSync("git", ["config", "user.email", "revise@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Revise Test"], { cwd: root });
    writeJson(`cadre/tracks/${trackId}/metadata.json`, {
      track_id: trackId,
      type: "feature",
      status: "new",
      priority: "medium",
      depends_on: [],
      description: "Public revise contract fixture",
    });
    writeJson(`cadre/tracks/${trackId}/spec.json`, spec("Baseline requirements before revision."));
    writeJson(`cadre/tracks/${trackId}/plan.json`, plan("Implement the baseline requirements"));
    fs.writeFileSync(path.join(root, "cadre", "tracks", trackId, "spec.md"), "# Baseline spec\n");
    fs.writeFileSync(path.join(root, "cadre", "tracks", trackId, "plan.md"), "# Baseline plan\n");
    fs.writeFileSync(path.join(root, "cadre", "tracks", trackId, "learnings.md"), "# Learnings\n");
    spawnSync("git", ["add", "."], { cwd: root });
    assert.equal(spawnSync("git", ["commit", "-m", "seed revise fixture"], { cwd: root, encoding: "utf8" }).status, 0);

    let packet = invoke({
      root,
      workflow: "revise",
      input: {
        trackId,
        reason: "Repository evidence changed requirements and their execution sequence.",
        intent: { revisionScope: "both" },
        spec: spec("Revised requirements are reviewed before plan generation."),
        plan: {},
        commitMode: "off",
      },
      execute: false,
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "spec_changes");
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort(), [
      `cadre/tracks/${trackId}/spec.json`,
      `cadre/tracks/${trackId}/spec.md`,
    ]);
    const sessionId = packet.decision.session_id;
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "revise",
      input: {},
      sessionId,
      writablePaths: inputPaths("spec"),
    });

    packet = invoke({
      root,
      workflow: "revise",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "spec_changes", ...approvalStamp(packet), approved_stages: ["spec_changes"] },
    });
    assert.equal(packet.decision.kind, "clarification");
    assert.equal(packet.decision.current_stage, "plan_changes");
    assert.equal(packet.decision.session_id, sessionId);
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "revise",
      input: {},
      sessionId,
      writablePaths: inputPaths("plan"),
    });
    assert.deepEqual(packet.required, ["plan"]);
    assert.deepEqual(packet.artifacts, []);

    packet = invoke({
      root,
      workflow: "revise",
      input: { plan: plan("Implement the approved revised requirements") },
      execute: false,
      approval: { session_id: sessionId },
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "plan_changes");
    assert.equal(packet.decision.session_id, sessionId);
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "revise",
      input: {},
      sessionId,
      writablePaths: inputPaths("plan"),
    });
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort(), [
      `cadre/tracks/${trackId}/plan.json`,
      `cadre/tracks/${trackId}/plan.md`,
    ]);

    packet = invoke({
      root,
      workflow: "revise",
      input: {},
      execute: false,
      approval: {
        session_id: sessionId,
        stage: "plan_changes",
        ...approvalStamp(packet),
        approved_stages: ["spec_changes", "plan_changes"],
      },
    });
    assert.equal(packet.decision.kind, "ready");
    assert.deepEqual(packet.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "revise",
        input: {},
        execute: true,
        approval: {
          session_id: sessionId,
          approved_stages: ["spec_changes", "plan_changes"],
          complete: true,
        },
      },
    });
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const approvedSnapshots = Object.values(JSON.parse(fs.readFileSync(sessionFile, "utf8")).stage_records)
      .flatMap((record) => record.snapshot_files)
      .map((file) => ({ path: file.path, content: file.content }));
    packet = invoke(packet.next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.decision.kind, "complete");
    for (const snapshot of approvedSnapshots) {
      assert.equal(fs.readFileSync(path.join(root, snapshot.path), "utf8"), snapshot.content, snapshot.path);
    }
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public skill packets execute the exact session-only continuation after lazy stage approval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-skill-staging-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    spawnSync("git", ["config", "user.email", "skill@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Skill Test"], { cwd: root });
    fs.mkdirSync(path.join(root, "cadre"), { recursive: true });
    fs.writeFileSync(path.join(root, "cadre", "config.json"), "{}\n");
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-m", "initial"], { cwd: root });
    const input = {
      operation: "create",
      skillId: "api-guidance",
      changes: [
        { type: "metadata.set", name: "API Guidance", description: "Project API review rules" },
        { type: "selectors.set", workflows: ["implement", "review"], file_patterns: ["src/api/**"] },
        { type: "rule.upsert", id: "compatibility", text: "Preserve API compatibility.", references: ["guide"] },
        { type: "reference.upsert", id: "guide", path: "references/guide.md", content: "# API Guide\n\nReview compatibility." },
      ],
    };
    let packet = invoke({ root, workflow: "skill", input, execute: false });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "skill");
    const sessionId = packet.decision.session_id;
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "api-guidance", "references", "guide.md")), false);

    packet = invoke({
      root,
      workflow: "skill",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "skill", ...approvalStamp(packet), approved_stages: ["skill"] },
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "references");
    assert.equal(packet.decision.session_id, sessionId);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "api-guidance", "references", "guide.md")), true);

    packet = invoke({
      root,
      workflow: "skill",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "references", ...approvalStamp(packet), approved_stages: ["skill", "references"] },
    });
    assert.deepEqual(packet.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "skill",
        input: {},
        execute: true,
        approval: { session_id: sessionId, approved_stages: ["skill", "references"], complete: true },
      },
    });
    packet = invoke(packet.next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.decision.kind, "complete");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "api-guidance", "skill.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "api-guidance", "references", "guide.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public skill packets read and resume formatted references in the same session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-skill-formatting-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    spawnSync("git", ["config", "user.email", "skill@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Skill Test"], { cwd: root });
    fs.mkdirSync(path.join(root, "cadre"), { recursive: true });
    fs.writeFileSync(path.join(root, "cadre", "config.json"), "{}\n");
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.writeFileSync(path.join(root, "notes", "raw.md"), "raw API notes\n");
    fs.writeFileSync(path.join(root, "notes", "secondary.md"), "secondary API notes\n");
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-m", "initial"], { cwd: root });
    const input = {
      operation: "create",
      skillId: "api-formatting",
      changes: [
        { type: "metadata.set", name: "API Formatting", description: "Formatted API references" },
        { type: "selectors.set", workflows: ["review"] },
        { type: "rule.upsert", id: "compatibility", text: "Review API compatibility.", references: ["guide", "secondary"] },
        { type: "reference.upsert", id: "guide", path: "references/guide.md", source_path: "notes/raw.md" },
        { type: "reference.upsert", id: "secondary", path: "references/secondary.md", source_path: "notes/secondary.md" },
      ],
    };
    let packet = invoke({ root, workflow: "skill", input, execute: false });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "skill");
    const sessionId = packet.decision.session_id;

    packet = invoke({
      root,
      workflow: "skill",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "skill", ...approvalStamp(packet), approved_stages: ["skill"] },
    });
    assert.equal(packet.decision.kind, "format_reference");
    assert.equal(packet.decision.session_id, sessionId);
    assert.deepEqual(packet.decision.approved_stages, ["skill"]);
    assert.equal(packet.decision.current_stage, "references");
    assert.deepEqual(packet.next, { tool: "cadre_read", arguments: { uri: packet.resources[0] } });
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "skill",
      input: { formattedReferences: {} },
      sessionId,
      writablePaths: [
        "/arguments/input/formattedReferences/guide",
        "/arguments/input/formattedReferences/secondary",
      ],
    });

    packet = invoke({
      root,
      workflow: "skill",
      input: { formattedReferences: { guide: "# API Guide\n\nReview compatibility." } },
      execute: false,
      approval: { session_id: sessionId },
    });
    assert.equal(packet.decision.kind, "format_reference");
    assert.equal(packet.decision.session_id, sessionId);
    assert.equal(packet.resources.length, 1);
    assert.deepEqual(packet.next, { tool: "cadre_read", arguments: { uri: packet.resources[0] } });
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "skill",
      input: { formattedReferences: {} },
      sessionId,
      writablePaths: ["/arguments/input/formattedReferences/secondary"],
    });

    packet = invoke({
      root,
      workflow: "skill",
      input: { formatted_references: { secondary: "# Secondary API Guide\n\nKeep secondary evidence." } },
      execute: false,
      approval: { session_id: sessionId },
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "references");
    assert.equal(packet.decision.session_id, sessionId);
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean).sort(), [
      "cadre/skills/api-formatting/references/guide.md",
      "cadre/skills/api-formatting/references/secondary.md",
    ]);

    packet = invoke({
      root,
      workflow: "skill",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "references", ...approvalStamp(packet), approved_stages: ["skill", "references"] },
    });
    const next = packet.next;
    assert.equal(next.arguments.approval.session_id, sessionId);
    packet = invoke(next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.decision.kind, "complete");
    assert.equal(fs.readFileSync(path.join(root, "cadre", "skills", "api-formatting", "references", "guide.md"), "utf8"), "# API Guide\n\nReview compatibility.\n");
    assert.equal(fs.readFileSync(path.join(root, "cadre", "skills", "api-formatting", "references", "secondary.md"), "utf8"), "# Secondary API Guide\n\nKeep secondary evidence.\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refresh analysis returns a typed selection call and accepts an explicit empty selection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-refresh-selection-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    fs.mkdirSync(path.join(root, "cadre"), { recursive: true });
    fs.writeFileSync(path.join(root, "cadre", "setup_state.json"), "{\"version\":1}\n");
    const packet = invoke({
      root,
      workflow: "refresh",
      input: { commitMode: "off" },
      execute: false,
    });
    assert.equal(packet.ok, false);
    assert.equal(packet.decision.kind, "clarification");
    assert.equal(packet.decision.session_id, null);
    assert.deepEqual(packet.decision.prompts.map((prompt) => prompt.id), ["refresh-levels"]);
    assert.equal(packet.decision.prompts[0].allowCustom, false);
    assert.equal(packet.decision.prompts[0].customArgument, undefined);
    assert.equal(packet.decision.prompts[0].responseTarget.customArgument, undefined);
    assertWorkflowDecisionContinuation(packet, "resume", {
      root,
      workflow: "refresh",
      input: { commitMode: "off" },
      writablePaths: ["/arguments/input/refreshLevels"],
    });

    const analyzed = invoke({
      root,
      workflow: "refresh",
      input: { commitMode: "off", refreshLevels: [] },
      execute: false,
    });
    assert.equal(analyzed.ok, true, analyzed.errors.join(" "));
    assert.equal(analyzed.phase, "complete");
    assert.deepEqual(analyzed.decision, { kind: "complete" });
    assert.deepEqual(analyzed.data.selected_levels, []);
    assert.equal(analyzed.data.refresh_analysis.kind, "cadre.refresh_analysis.v1");
    assert.equal(analyzed.next, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public refresh packets execute the exact frozen technical-stage continuation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-refresh-staging-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    fs.mkdirSync(path.join(root, "cadre"), { recursive: true });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "cadre", "setup_state.json"), "{\"version\":1}\n");
    fs.writeFileSync(path.join(root, "src", "index.ts"), "export const ready = true;\n");

    let packet = invoke({
      root,
      workflow: "refresh",
      input: { refreshLevels: ["lsp"], commitMode: "off" },
      execute: false,
    });
    assert.equal(packet.decision.kind, "approval");
    assert.equal(packet.decision.stage, "technical");
    assert.deepEqual(packet.artifacts.map((artifact) => artifact.path), ["cadre/lsp.json"]);
    const sessionId = packet.decision.session_id;
    assertWorkflowDecisionContinuation(packet, "amend", {
      root,
      workflow: "refresh",
      input: {},
      sessionId,
      writablePaths: [],
    });
    const approvedContent = fs.readFileSync(path.join(root, "cadre", "lsp.json"), "utf8");

    packet = invoke({
      root,
      workflow: "refresh",
      input: {},
      execute: false,
      approval: { session_id: sessionId, stage: "technical", ...approvalStamp(packet), approved_stages: ["technical"] },
    });
    assert.deepEqual(packet.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "refresh",
        input: {},
        execute: true,
        approval: { session_id: sessionId, approved_stages: ["technical"], complete: true },
      },
    });
    packet = invoke(packet.next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.decision.kind, "complete");
    assert.equal(fs.readFileSync(path.join(root, "cadre", "lsp.json"), "utf8"), approvedContent);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("projection-only refresh continuation preserves execution options", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-public-projection-refresh-"));
  const invoke = (request) => {
    const parsed = parseWorkflowToolRequest(request);
    return core.workflowPacketV1(parsed.root, workflowRuntimeArgs(parsed));
  };
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
    fs.mkdirSync(path.join(root, "cadre"), { recursive: true });
    fs.writeFileSync(path.join(root, "cadre", "setup_state.json"), "{\"version\":1}\n");
    let packet = invoke({
      root,
      workflow: "refresh",
      input: { refreshLevels: ["projections"], commitMode: "off", force: true },
      execute: false,
    });
    assert.deepEqual(packet.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "refresh",
        input: { refreshLevels: ["projections"], commitMode: "off", force: true },
        execute: true,
      },
    });
    packet = invoke(packet.next.arguments);
    assert.equal(packet.ok, true, packet.errors.join(" "));
    assert.equal(packet.decision.kind, "complete");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
