#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(root, args) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (args[0] === "init") {
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "tag.gpgsign", "false"], { cwd: root, encoding: "utf8" });
  }
  return result;
}

function sampleSpec(id) {
  return {
    version: 1,
    schema: "cadre.spec.v1",
    track_id: id,
    title: `Spec: ${id}`,
    description: `Deliver the reviewed ${id} behavior with explicit acceptance and scope.`,
    functional_requirements: [{ heading: "Reviewed behavior", body: `Implement the ${id} behavior described by the track plan and review bundle.` }],
    non_functional_requirements: [],
    acceptance_criteria: [{ heading: "Verified behavior", body: `Tests or manual verification confirm the ${id} behavior is complete.` }],
    out_of_scope: [{ heading: "Unplanned changes", body: `Changes outside ${id} behavior remain out of scope.` }],
  };
}

function planTask(phaseIndex, taskIndex, title, files = [], extra = {}) {
  return {
    task_index: taskIndex,
    task_key: `phase${phaseIndex}_task${taskIndex}`,
    title,
    status: "pending",
    files,
    depends_on: [],
    commit_shas: [],
    repo_shas: {},
    ...extra,
  };
}

function renderPlanProjection(plan) {
  const lines = [`<!-- cadre:generated from="cadre/tracks/${plan.track_id}/plan.json" schema="cadre.plan.v1" hash="test" -->`, `# Plan: ${plan.track_id}`, ""];
  for (const phase of plan.phases || []) {
    lines.push(`## ${phase.title}`, "");
    for (const task of phase.tasks || []) {
      lines.push(`- [ ] Task ${task.task_index}: ${task.title}`);
      if (task.files?.length) lines.push(`  <!-- files: ${task.files.join(", ")} -->`);
      if (task.repo) lines.push(`  <!-- repo: ${task.repo} -->`);
      lines.push("");
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function writeTrack(root, id, plan, metadata = {}) {
  write(path.join(root, "cadre", "tracks.json"), JSON.stringify({
    version: 1,
    schema: "cadre.tracks_index.v1",
    generated_at: "2026-06-17T00:00:00.000Z",
    counts: { new: 1, in_progress: 0, completed: 0, blocked: 0, skipped: 0 },
    tracks: [],
  }, null, 2));
  const dir = path.join(root, "cadre", "tracks", id);
  write(path.join(dir, "metadata.json"), JSON.stringify({
    track_id: id,
    type: "feature",
    status: "new",
    priority: "medium",
    description: id,
    git_branch: `track/${id}`,
    depends_on: [],
    ...metadata,
  }, null, 2));
  write(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  write(path.join(dir, "spec.json"), JSON.stringify(sampleSpec(id), null, 2));
  write(path.join(dir, "plan.md"), renderPlanProjection(plan));
  write(path.join(dir, "spec.md"), `<!-- cadre:generated from="cadre/tracks/${id}/spec.json" schema="cadre.spec.v1" hash="test" -->\n# Spec: ${id}\n`);
}

function startServer(options = {}) {
  const server = spawn(process.execPath, [options.serverPath || path.join(__dirname, "cadre-server.js")], {
    cwd: options.cwd || path.resolve(__dirname, "..", ".."),
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();

  server.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd).toString("utf8").replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { mcpError: message.error }));
      else waiter.resolve(message.result);
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    server.stdin.write(`${body}\n`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 3000);
    });
  }

  function notify(method, params = {}) {
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async function initialize(params = {}) {
    const result = await request("initialize", params);
    notify("notifications/initialized");
    return result;
  }

  return { server, request, notify, initialize };
}

function parseTextJson(result) {
  return JSON.parse(result.content[0].text);
}

function callAction(request, action, root, input = {}, execute = false) {
  const arguments_ = { action, input };
  if (root) arguments_.root = root;
  if (execute) arguments_.execute = true;
  return request("tools/call", { name: "cadre_action", arguments: arguments_ });
}

async function callApprovedWorkflow(request, args) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const input = clone(args);
  delete input.root;
  delete input.workflow;
  delete input.execute;
  delete input.approvalComplete;
  if (args.workflow === "setup") {
    if (input.productGuidelines == null && input.product_guidelines == null) {
      input.productGuidelines = {
        title: "Product Guidelines",
        summary: "Preserve explicit intent, evidence, and safe review boundaries.",
      };
    }
    if (input.workflowPolicy == null && input.workflow_policy == null) {
      input.workflowPolicy = {
        title: "Project Workflow",
        summary: "Review each Cadre stage and run focused validation before completion.",
      };
    }
  }
  const base = { root: args.root, workflow: args.workflow, input, execute: false };
  let preview = parseTextJson(await request("tools/call", {
    name: "cadre_workflow",
    arguments: base,
  }));
  let sessionId = null;
  let approved = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(preview.ok, true, JSON.stringify(preview.errors));
    sessionId = preview.decision?.session_id || sessionId;
    if (Array.isArray(preview.decision?.approved_stages)) approved = preview.decision.approved_stages;
    if (preview.decision?.kind === "clarification") {
      assert.equal(args.workflow, "setup", `unexpected clarification for ${args.workflow}`);
      const answers = {};
      for (const prompt of preview.decision.prompts || []) {
        const recommended = (prompt.choices || []).filter((choice) => choice.recommended).map((choice) => choice.id);
        if (prompt.id === "setup-provider-mode") answers.providerMode = recommended[0] || "local";
        else if (prompt.id === "setup-sync-mode") answers.syncMode = recommended[0] || "local";
        else if (prompt.id === "setup-style-guides") answers.styleGuideIds = recommended;
        else if (prompt.id === "setup-lsp") answers.writeLsp = recommended[0] !== "skip-lsp";
        else if (prompt.id === "setup-optional-mcps") answers.integrations = {};
        else assert.fail(`setup test payload left unresolved intent prompt ${prompt.id}`);
      }
      assert.ok(Object.keys(answers).length > 0, `setup test payload is missing required evidence: ${(preview.decision.required || []).join(", ")}`);
      Object.assign(base.input, answers);
      preview = parseTextJson(await request("tools/call", {
        name: "cadre_workflow",
        arguments: {
          root: base.root,
          workflow: base.workflow,
          input: answers,
          execute: false,
          ...(sessionId ? { approval: { session_id: sessionId } } : {}),
        },
      }));
      continue;
    }
    if (preview.decision?.kind === "approval" && preview.decision.stage) {
      sessionId = preview.decision.session_id || sessionId;
      approved = [...(preview.decision.approved_stages || []), preview.decision.stage];
      preview = parseTextJson(await request("tools/call", {
        name: "cadre_workflow",
        arguments: {
          root: base.root,
          workflow: base.workflow,
          input: {},
          execute: false,
          approval: { session_id: sessionId, stage: preview.decision.stage, approved_stages: approved },
        },
      }));
      continue;
    }
    if (preview.next?.tool === "cadre_workflow") {
      return parseTextJson(await request("tools/call", {
        name: preview.next.tool,
        arguments: preview.next.arguments,
      }));
    }
    return parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: {
        root: base.root,
        workflow: base.workflow,
        input: {},
        execute: true,
        approval: { session_id: sessionId, approved_stages: approved, complete: true },
      },
    }));
  }
  assert.fail(`approval loop did not complete for ${args.workflow}`);
}

function requestDaemon(daemon, method, params = {}) {
  const id = requestDaemon.nextId++;
  daemon.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const onLine = (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== id) return;
      cleanup();
      if (message.error) reject(new Error(message.error.message || "daemon error"));
      else resolve(message.result);
    };
    const cleanup = () => {
      clearTimeout(timer);
      requestDaemon.listeners.delete(id);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for daemon ${method}`));
    }, 3000);
    requestDaemon.listeners.set(id, onLine);
  });
}
requestDaemon.nextId = 1;
requestDaemon.listeners = new Map();

async function waitForJob(request, root, jobId) {
  for (let i = 0; i < 20; i += 1) {
    const result = await callAction(request, "job.result", root, { jobId });
    const parsed = parseTextJson(result);
    if (parsed.data.job.status !== "running") return parsed;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

function fakeDapAdapterSource() {
  return `
let seq = 1;
let buffer = Buffer.alloc(0);
function send(message) {
  message.seq = seq++;
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
}
function response(request, body = {}) {
  send({ type: "response", request_seq: request.seq, command: request.command, success: true, body });
}
function event(name, body = {}) {
  send({ type: "event", event: name, body });
}
function handle(request) {
  if (request.command === "initialize") response(request, { supportsConfigurationDoneRequest: true });
  else if (request.command === "launch" || request.command === "attach") {
    response(request, {});
    event("initialized", {});
  } else if (request.command === "setBreakpoints") {
    const bps = (request.arguments.breakpoints || []).map((bp, index) => ({ id: index + 1, verified: true, line: bp.line }));
    response(request, { breakpoints: bps });
  } else if (request.command === "configurationDone") {
    response(request, {});
    setTimeout(() => event("stopped", { reason: "breakpoint", threadId: 1, allThreadsStopped: true }), 10);
  } else if (request.command === "threads") response(request, { threads: [{ id: 1, name: "main" }] });
  else if (request.command === "stackTrace") response(request, { stackFrames: [{ id: 11, name: "main", source: { path: process.cwd() + "/src/app.py" }, line: 2, column: 1 }] });
  else if (request.command === "scopes") response(request, { scopes: [{ name: "locals", variablesReference: 21, expensive: false }] });
  else if (request.command === "variables") response(request, { variables: [{ name: "result", value: "42", variablesReference: 0 }, { name: "password", value: "password=opensesame", variablesReference: 0 }] });
  else if (request.command === "disconnect") {
    response(request, {});
    event("terminated", {});
    setTimeout(() => process.exit(0), 5);
  } else response(request, {});
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) return;
    const start = headerEnd + 4;
    const end = start + Number(match[1]);
    if (buffer.length < end) return;
    const body = buffer.slice(start, end).toString("utf8");
    buffer = buffer.slice(end);
    handle(JSON.parse(body));
  }
});
`;
}

test("LSP setup JSON and daemon status/shutdown smoke", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-lsp-smoke-"));
  const outsideConfig = `${root}-outside.json`;
  const symlinkTarget = `${root}-symlink-target.json`;
  const symlinkRoot = `${root}-symlink-root`;
  const symlinkControlDir = `${root}-symlink-control`;
  const serverPath = path.join(__dirname, "cadre-server.js");
  const daemon = spawn(process.execPath, [serverPath, "--cadre-lsp-daemon"], {
    cwd: path.resolve(__dirname, "..", ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let daemonBuffer = "";
  daemon.stdout.setEncoding("utf8");
  daemon.stdout.on("data", (chunk) => {
    daemonBuffer += chunk;
    while (daemonBuffer.includes("\n")) {
      const index = daemonBuffer.indexOf("\n");
      const line = daemonBuffer.slice(0, index).trim();
      daemonBuffer = daemonBuffer.slice(index + 1);
      if (!line) continue;
      for (const listener of requestDaemon.listeners.values()) listener(line);
    }
  });

  try {
    write(path.join(root, "src", "index.ts"), "export function typedSmoke() { return true; }\n");
    write(path.join(root, "app", "main.py"), "def python_smoke():\n    return True\n");
    write(path.join(root, "crates", "core", "lib.rs"), "pub fn rust_smoke() -> bool { true }\n");
    write(path.join(root, "Dockerfile"), "FROM alpine\n");
    write(path.join(root, "deploy", "service.yaml"), "name: smoke\n");
    const setup = spawnSync(process.execPath, [
      serverPath,
      "--cadre-lsp-setup",
      "--root",
      root,
      "--write",
      "--json",
    ], { encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const parsed = JSON.parse(setup.stdout);
    assert.equal(parsed.root, root);
    assert.ok(Array.isArray(parsed.recommended));
    for (const id of ["typescript", "python", "rust", "dockerfile", "yaml"]) {
      assert.ok(parsed.recommended.some((entry) => entry.id === id), `expected ${id} recommendation`);
      assert.ok(parsed.added.includes(id), `expected ${id} to be written`);
    }
    const config = JSON.parse(fs.readFileSync(path.join(root, "cadre", "lsp.json"), "utf8"));
    const docker = config.servers.find((server) => server.id === "dockerfile");
    assert.deepEqual(docker.filenames, ["Dockerfile", "Containerfile"]);
    assert.equal(docker.languageIds.Dockerfile, "dockerfile");

    const productConfig = path.join(root, "cadre", "product.json");
    write(productConfig, "{\"sentinel\":\"product\"}\n");
    const crossPurpose = spawnSync(process.execPath, [
      serverPath,
      "--cadre-lsp-setup",
      "--root",
      root,
      "--config",
      "cadre/product.json",
      "--write",
      "--json",
    ], { encoding: "utf8" });
    assert.notEqual(crossPurpose.status, 0);
    assert.equal(fs.readFileSync(productConfig, "utf8"), "{\"sentinel\":\"product\"}\n");

    write(outsideConfig, "{\"sentinel\":\"outside\"}\n");
    const traversal = spawnSync(process.execPath, [
      serverPath,
      "--cadre-lsp-setup",
      "--root",
      root,
      "--config",
      `../${path.basename(outsideConfig)}`,
      "--write",
      "--json",
    ], { encoding: "utf8" });
    assert.notEqual(traversal.status, 0);
    assert.equal(fs.readFileSync(outsideConfig, "utf8"), "{\"sentinel\":\"outside\"}\n");

    const absolute = spawnSync(process.execPath, [
      serverPath,
      "--cadre-lsp-setup",
      "--root",
      root,
      "--config",
      outsideConfig,
      "--write",
      "--json",
    ], { encoding: "utf8" });
    assert.notEqual(absolute.status, 0);
    assert.equal(fs.readFileSync(outsideConfig, "utf8"), "{\"sentinel\":\"outside\"}\n");

    write(symlinkTarget, "{\"sentinel\":\"symlink\"}\n");
    fs.rmSync(path.join(root, "cadre", "lsp.json"));
    fs.symlinkSync(symlinkTarget, path.join(root, "cadre", "lsp.json"));
    const symlinkFile = spawnSync(process.execPath, [
      serverPath,
      "--cadre-lsp-setup",
      "--root",
      root,
      "--write",
      "--json",
    ], { encoding: "utf8" });
    assert.notEqual(symlinkFile.status, 0);
    assert.equal(fs.readFileSync(symlinkTarget, "utf8"), "{\"sentinel\":\"symlink\"}\n");

    fs.mkdirSync(symlinkRoot);
    fs.mkdirSync(symlinkControlDir);
    fs.symlinkSync(symlinkControlDir, path.join(symlinkRoot, "cadre"));
    write(path.join(symlinkRoot, "src", "index.ts"), "export const guarded = true;\n");
    const symlinkDirectory = spawnSync(process.execPath, [
      serverPath,
      "--cadre-lsp-setup",
      "--root",
      symlinkRoot,
      "--write",
      "--json",
    ], { encoding: "utf8" });
    assert.notEqual(symlinkDirectory.status, 0);
    assert.deepEqual(fs.readdirSync(symlinkControlDir), []);

    const status = await requestDaemon(daemon, "status");
    assert.equal(status.ok, true);
    assert.deepEqual(status.servers, []);
    const shutdown = await requestDaemon(daemon, "shutdown");
    assert.equal(shutdown.ok, true);
  } finally {
    daemon.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideConfig, { force: true });
    fs.rmSync(symlinkTarget, { force: true });
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
    fs.rmSync(symlinkControlDir, { recursive: true, force: true });
  }
});

test("Global embedded MCP runtime writes setup and newtrack artifacts while plugins stay thin", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-plugin-embedded-test-"));
  const pluginRoot = path.resolve(__dirname, "..", "..", "plugins", "cadre");
  const serverPath = path.join(__dirname, "cadre-server.js");
  assert.equal(fs.existsSync(path.join(pluginRoot, "templates")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "references")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "cadre", "skill.json")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "assets")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "agents")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "scripts")), false);
  const { server, request, initialize } = startServer({
    serverPath,
    cwd: path.resolve(__dirname, "..", ".."),
  });
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "reviewer@example.com"]);
    git(root, ["config", "user.name", "Reviewer"]);
    await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });

    const setup = await callApprovedWorkflow(request, {
        root,
        workflow: "setup",
        execute: true,
        approvalComplete: true,
        providerMode: "github",
        ciProvider: "github",
        product: { title: "Embedded Product", summary: "Validate bundled setup templates." },
        productGuidelines: { title: "Guidelines", summary: "Keep packet ownership intact." },
        workflowPolicy: { title: "Workflow", summary: "Use Cadre packets." },
        techStack: { languages: ["TypeScript"], frameworks: ["React"] },
    });
    assert.equal(setup.ok, true);
    assert.ok(setup.artifacts.some((artifact) => artifact.path === "cadre/product.json"));
    assert.ok(setup.artifacts.some((artifact) => artifact.path === "cadre/workflow.json"));
    assert.equal(fs.existsSync(path.join(root, "cadre", "styleguides", "typescript.json")), true);
    assert.equal(fs.existsSync(path.join(root, ".github", "workflows", "cadre-monorepo-check.yml")), true);

    const trackId = "embedded_20260622";
    const created = await callApprovedWorkflow(request, {
        root,
        workflow: "newtrack",
        execute: true,
        approvalComplete: true,
        trackId,
        spec: sampleSpec(trackId),
        plan: {
          version: 1,
          schema: "cadre.plan.v1",
          track_id: trackId,
          title: `Plan: ${trackId}`,
          phases: [{
            phase_index: 1,
            title: "Phase 1: Wire embedded runtime templates",
            execution_mode: "sequential",
            depends_on: [],
            tasks: [planTask(1, 1, "Implement embedded template path", ["src/index.ts"])],
          }],
        },
    });
    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "learnings.jsonl")), true);
    const learnings = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "learnings.jsonl"), "utf8").trim());
    assert.equal(learnings.kind, "learnings_seed");
    assert.equal(learnings.track_id, trackId);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP root resolution rejects harness skill directories without project state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-server-test-"));
  const { server, request, initialize } = startServer();
  try {
    const initialized = await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });
    assert.match(initialized.instructions, /root/);
    assert.match(initialized.instructions, /packet-led/);
    const tools = await request("tools/list", {});
    const names = tools.tools.map((tool) => tool.name);
    assert.deepEqual(names, ["cadre_workflow", "cadre_action", "cadre_read"]);
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
    const fieldsFor = (name) => Object.keys(byName.get(name).inputSchema.properties).sort();
    assert.deepEqual(fieldsFor("cadre_workflow"), ["approval", "execute", "input", "root", "workflow"]);
    assert.deepEqual(fieldsFor("cadre_action"), ["action", "execute", "input", "root"]);
    assert.deepEqual(fieldsFor("cadre_read"), ["uri"]);
    assert.ok(Math.ceil(JSON.stringify(tools.tools).length / 4) <= 1700);
    assert.ok(tools.tools.every((tool) => tool.inputSchema.additionalProperties === false));
    for (const legacyName of [
      "cadre_resource",
      "cadre_project",
      "cadre_status",
      "cadre_track",
      "cadre_parallel",
      "cadre_mutate",
      "cadre_complete_task",
      "cadre_job",
      "cadre_review",
      "cadre_intel",
      "cadre_artifact",
    ]) {
      await assert.rejects(
        request("tools/call", { name: legacyName, arguments: {} }),
        new RegExp(`Unknown tool: ${legacyName}`),
      );
    }
    await assert.rejects(
      request("tools/call", {
        name: "cadre_workflow",
        arguments: { root, workflow: "status", mode: "fleet" },
      }),
      /unsupported fields: mode/,
    );
    await assert.rejects(
      request("tools/call", {
        name: "cadre_action",
        arguments: { action: "project.ping", trackId: "flat-input" },
      }),
      /unsupported fields: trackId/,
    );
    await assert.rejects(
      request("tools/call", {
        name: "cadre_read",
        arguments: { uri: "cadre://template-inventory", root },
      }),
      /unsupported fields: root/,
    );
    await assert.rejects(
      request("tools/call", {
        name: "cadre_workflow",
        arguments: { root, workflow: "status", input: { approvalComplete: true } },
      }),
      /reserved control fields: approvalComplete/,
    );
    await assert.rejects(
      request("tools/call", {
        name: "cadre_workflow",
        arguments: { root, workflow: "skill", input: { source_snapshot: "injected" } },
      }),
      /reserved control fields: source_snapshot/,
    );
    await assert.rejects(
      request("tools/call", {
        name: "cadre_action",
        arguments: { root, action: "project.ping", input: { skipSync: true } },
      }),
      /reserved control fields: skipSync/,
    );
    await assert.rejects(
      request("tools/call", {
        name: "cadre_action",
        arguments: { root, action: "parallel.record_finish", input: { force: true, approvalComplete: true }, execute: true },
      }),
      /reserved control fields: approvalComplete/,
    );
    const ping = parseTextJson(await callAction(request, "project.ping", null));
    assert.equal(ping.data.ok, true);
    const resources = await request("resources/list", {});
    const uris = resources.resources.map((resource) => resource.uri);
    assert.deepEqual(uris, ["cadre://template-inventory"]);
    const templates = await request("resources/templates/list", {});
    const templateUris = templates.resourceTemplates.map((template) => template.uriTemplate);
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://track-context")));
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://dependency-graph{?root")));
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://provider-actions{?root,trackId,workflow")));
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://workspace-health{?root,responseMode,detail,compact")));
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://project-skills{?root,workflow,trackId,repos,files,skillRuleBudget")));
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://project-skill-source{?root,path,token")));
    assert.equal(templateUris.some((uri) => uri.startsWith("cadre://release-plan")), false);
    for (const retired of ["skill-contract", "workflow-protocol", "workflow-protocols", "agent-reference", "agent-references"]) {
      assert.equal(templateUris.some((uri) => uri.startsWith(`cadre://${retired}`)), false);
    }

    const templateInventory = await request("resources/read", { uri: "cadre://template-inventory" });
    const templateInventoryTool = parseTextJson(await request("tools/call", {
      name: "cadre_read",
      arguments: { uri: "cadre://template-inventory" },
    }));
    assert.deepEqual(templateInventoryTool, JSON.parse(templateInventory.contents[0].text));
    assert.equal(templateInventoryTool.data.ok, true);

    const freshRoot = path.join(root, "fresh");
    write(path.join(freshRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    write(path.join(freshRoot, "src", "index.ts"), "export const fresh = true;\n");
    const freshProjectRoot = parseTextJson(await callAction(request, "project.root", freshRoot)).data;
    assert.equal(freshProjectRoot.root, freshRoot);
    assert.equal(freshProjectRoot.has_cadre, false);
    assert.equal(freshProjectRoot.setup_candidate, true);
    write(path.join(freshRoot, "cadre", "skills", "setup-rules", "skill.json"), JSON.stringify({
      version: 1, schema: "cadre.project-skill.v1", id: "setup-rules", name: "setup-rules", description: "Setup rules",
      selectors: { workflows: ["setup"] }, rules: [{ id: "layout", text: "Preserve the repository layout.", priority: 10, required: true }], references: [],
    }, null, 2));
    const setupSkills = JSON.parse((await request("resources/read", {
      uri: `cadre://project-skills?root=${encodeURIComponent(freshRoot)}&workflow=setup&skillRuleBudget=5000`,
    })).contents[0].text);
    assert.equal(setupSkills.data.ok, true);
    assert.deepEqual(setupSkills.data.selected_ids, ["setup-rules"]);
    assert.equal(setupSkills.data.inline_rule_budget, 5000);
    assert.equal(setupSkills.data.inline_rule_budget_source, "argument");

    const freshTechStack = parseTextJson(await callAction(
      request,
      "project.tech_stack_summary",
      freshRoot,
      { techStack: { languages: ["TypeScript"] } },
    )).data;
    assert.equal(freshTechStack.ok, true);
    assert.equal(freshTechStack.root, freshRoot);

    const freshIntegrations = parseTextJson(await callAction(request, "project.integrations", freshRoot)).data;
    assert.equal(freshIntegrations.ok, true);
    assert.equal(freshIntegrations.root, freshRoot);

    const freshRepoMap = parseTextJson(await callAction(request, "intel.repo_map", freshRoot, { limit: 20 })).data;
    assert.equal(freshRepoMap.ok, true);
    assert.equal(freshRepoMap.root, freshRoot);

    const freshDiagnostics = parseTextJson(await callAction(request, "intel.workspace_diagnostics", freshRoot)).data;
    assert.equal(freshDiagnostics.ok, true);
    assert.equal(freshDiagnostics.root, freshRoot);

    await assert.rejects(callAction(request, "status.live", freshRoot), /requires \{ root \}/);
    assert.ok(templateInventoryTool.data.templates.templates.some((template) => template.id === "product"));

    write(path.join(root, "harness", "skills", "cadre", "SKILL.md"), "# Harness copy\n");
    await assert.rejects(
      callAction(request, "project.root", path.join(root, "harness", "skills", "cadre")),
      /requires \{ root \}/
    );

    write(path.join(root, "project", "cadre", "setup_state.json"), "{}\n");
    const valid = await callAction(request, "project.root", path.join(root, "project", "cadre"));
    assert.equal(parseTextJson(valid).data.root, path.join(root, "project"));
    const injectedJob = parseTextJson(await callAction(
      request,
      "review.anything",
      path.join(root, "project"),
      { async: true, type: "complete_task" },
      true,
    ));
    assert.equal(injectedJob.ok, false);
    assert.match(injectedJob.errors.join(" "), /does not support input\.async/i);
    assert.equal(fs.existsSync(path.join(root, "project", "cadre", "jobs")), false);
    const guardedMutation = parseTextJson(await callAction(request, "mutate.regen_index", path.join(root, "project")));
    assert.equal(guardedMutation.ok, false);
    assert.deepEqual(guardedMutation.required, ["execute"]);
    write(path.join(root, "project", "cadre", "skills", "project-rules", "skill.json"), JSON.stringify({
      version: 1, schema: "cadre.project-skill.v1", id: "project-rules", name: "project-rules", description: "Project rules",
      selectors: { workflows: ["implement"] },
      rules: [{ id: "local", text: "Apply the local rules.", priority: 10, required: true, references: ["rules"] }],
      references: [{ id: "rules", path: "references/rules.md" }],
    }, null, 2));
    write(path.join(root, "project", "cadre", "skills", "project-rules", "references", "rules.md"), "Keep changes scoped.\n");
    const projectSkills = JSON.parse((await request("resources/read", {
      uri: `cadre://project-skills?root=${encodeURIComponent(path.join(root, "project"))}&workflow=implement`,
    })).contents[0].text);
    assert.equal(projectSkills.data.ok, true);
    assert.deepEqual(projectSkills.data.selected_ids, ["project-rules"]);
    assert.match(projectSkills.data.selected[0].rules[0].text, /Apply the local rules/);
    const projectSkill = JSON.parse((await request("resources/read", {
      uri: `cadre://project-skill?root=${encodeURIComponent(path.join(root, "project"))}&id=project-rules`,
    })).contents[0].text);
    assert.equal(projectSkill.data.ok, true);
    assert.equal(projectSkill.data.skill.references[0].content, "Keep changes scoped.\n");

    write(path.join(root, "project", "notes", "raw.md"), "Workflow-authorized source.\n");
    write(path.join(root, "project", ".env"), "SECRET=not-authorized\n");
    const sourcePacket = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: {
        root: path.join(root, "project"),
        workflow: "skill",
        input: {
          operation: "create",
          skillId: "source-rules",
          changes: [
            { type: "metadata.set", name: "Source rules", description: "Rules formatted from a project source." },
            { type: "selectors.set", workflows: ["review"] },
            { type: "rule.upsert", id: "source", text: "Use the formatted source.", references: ["raw"] },
            { type: "reference.upsert", id: "raw", path: "references/raw.md", source_path: "notes/raw.md" },
          ],
        },
      },
    }));
    assert.equal(sourcePacket.ok, true);
    assert.equal(sourcePacket.phase, "awaiting_formatting");
    assert.equal(sourcePacket.resources.length, 1);
    const sourceUri = sourcePacket.resources[0];
    const sourceUrl = new URL(sourceUri);
    assert.match(sourceUrl.searchParams.get("token"), /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(sourcePacket.next.tool, "cadre_read");
    assert.equal(sourcePacket.next.arguments.uri, sourceUri);
    const authorizedSource = JSON.parse((await request("resources/read", { uri: sourceUri })).contents[0].text);
    assert.equal(authorizedSource.ok, true);
    assert.equal(authorizedSource.data.content, "Workflow-authorized source.\n");

    await assert.rejects(
      request("resources/read", {
        uri: `cadre://project-skill-source?root=${encodeURIComponent(path.join(root, "project"))}&path=notes%2Fraw.md`,
      }),
      /requires query parameter 'token'/,
    );
    const inventedUrl = new URL(sourceUri);
    inventedUrl.searchParams.set("token", "invented-token");
    const invented = JSON.parse((await request("resources/read", { uri: inventedUrl.toString() })).contents[0].text);
    assert.equal(invented.ok, false);
    const retargetedUrl = new URL(sourceUri);
    retargetedUrl.searchParams.set("path", ".env");
    const retargeted = JSON.parse((await request("resources/read", { uri: retargetedUrl.toString() })).contents[0].text);
    assert.equal(retargeted.ok, false);
    const secretSource = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: {
        root: path.join(root, "project"),
        workflow: "skill",
        input: {
          operation: "create",
          skillId: "secret-source",
          changes: [
            { type: "metadata.set", name: "Secret source", description: "Must not expose hidden environment files." },
            { type: "selectors.set", workflows: ["review"] },
            { type: "rule.upsert", id: "secret", text: "Use a source.", references: ["secret"] },
            { type: "reference.upsert", id: "secret", path: "references/secret.md", source_path: ".env" },
          ],
        },
      },
    }));
    assert.equal(secretSource.ok, false);
    assert.match(secretSource.errors.join(" "), /unsupported extension/);
    assert.deepEqual(secretSource.resources, []);

    const integrations = await callAction(request, "project.integrations", path.join(root, "project"));
    assert.equal(parseTextJson(integrations).data.ok, true);

    const doctor = await callAction(request, "project.doctor", path.join(root, "harness", "skills", "cadre"));
    assert.equal(parseTextJson(doctor).data.checks.project_state.ok, false);

    const setupAssist = await request("tools/call", {
      name: "cadre_workflow",
      arguments: { workflow: "setup", root: path.join(root, "uninitialized"), input: {} },
    });
    const parsedSetupAssist = parseTextJson(setupAssist);
    assert.equal(parsedSetupAssist.ok, true);
    assert.equal(parsedSetupAssist.workflow, "setup");
    assert.equal(parsedSetupAssist.decision.kind, "clarification");
    assert.ok(parsedSetupAssist.decision.prompts.some((prompt) => prompt.id === "setup-product-intent"));
    assert.equal(fs.existsSync(path.join(root, "uninitialized", "cadre", "product.json")), false);
    assert.equal(fs.existsSync(path.join(root, "uninitialized", "cadre", "product.md")), false);
    const selectedSetupIntent = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: {
        workflow: "setup",
        root: path.join(root, "uninitialized"),
        input: {
          providerMode: "local",
          syncMode: "local",
          setupLsp: false,
          styleGuideIds: [],
          integrations: {},
          intent: { product: "use-readme", techStack: "detect" },
        },
      },
    }));
    assert.equal(selectedSetupIntent.decision.kind, "clarification");
    assert.deepEqual(selectedSetupIntent.decision.prompts, []);
    assert.deepEqual(selectedSetupIntent.decision.required, ["product"]);
    assert.deepEqual(selectedSetupIntent.required, ["product"]);
    assert.equal(fs.existsSync(path.join(root, "uninitialized", "cadre", "product.json")), false);
    for (const key of ["phase", "decision", "required", "next", "artifacts", "resources", "warnings", "errors"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(parsedSetupAssist, key), true, `missing workflow envelope key ${key}`);
    }

    const job = await callAction(
      request,
      "job.start",
      path.join(root, "project"),
      {
        type: "coverage",
        args: { command: "printf 'Statements : 91%%\\n'", coverageThreshold: 80 },
      },
      true,
    );
    const jobId = parseTextJson(job).job.id;
    const completed = await waitForJob(request, path.join(root, "project"), jobId);
    assert.equal(completed.ok, true);
    assert.equal(completed.data.result.coverage, 91);
    assert.equal(fs.existsSync(path.join(root, "project", "cadre", "jobs", `${jobId}.json`)), true);
    const jobResource = await request("resources/read", {
      uri: `cadre://job-result?root=${encodeURIComponent(path.join(root, "project"))}&jobId=${jobId}`,
    });
    assert.equal(JSON.parse(jobResource.contents[0].text).data.status, "succeeded");
    const traversal = parseTextJson(await callAction(
      request,
      "job.result",
      path.join(root, "project"),
      { jobId: "../../outside" },
    ));
    assert.equal(traversal.ok, false);
    assert.match(traversal.errors.join(" "), /invalid|not found/i);
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP async jobs survive restarts and persist list/result snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-job-restart-test-"));
  const projectRoot = path.join(root, "project");
  const first = startServer();
  try {
    write(path.join(projectRoot, "cadre", "setup_state.json"), "{}\n");
    write(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "project",
      private: true,
      type: "module",
    }, null, 2));
    write(path.join(projectRoot, "src", "index.ts"), "export const value = 1;\n");

    await first.initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });
    const started = parseTextJson(await callAction(
      first.request,
      "job.start",
      projectRoot,
      {
        type: "coverage",
        args: { command: "printf 'Statements : 91%%\\n'", coverageThreshold: 80 },
      },
      true,
    ));
    const jobId = started.job.id;
    assert.match(jobId, /^job_[0-9a-f-]{36}$/i);
    const completed = await waitForJob(first.request, projectRoot, jobId);
    assert.equal(completed.data.result.coverage, 91);

    const health = JSON.parse((await first.request("resources/read", {
      uri: `cadre://workspace-health?root=${encodeURIComponent(projectRoot)}`,
    })).contents[0].text);
    assert.equal(health.data.ok, true);
    assert.equal(health.data.root, projectRoot);
    assert.ok(Array.isArray(health.data.languages.detected));
    assert.equal(health.data.workspace.repo_count, 1);
    assert.ok(Array.isArray(health.data.integrations.optional_mcps));
    assert.equal(typeof health.data.parallel.available_count, "number");

    await new Promise((resolve) => {
      first.server.once("exit", resolve);
      first.server.kill("SIGTERM");
    });

    const second = startServer();
    try {
      await second.initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });
      const listed = parseTextJson(await callAction(second.request, "job.list", projectRoot));
      const persisted = listed.data.jobs.find((job) => job.id === jobId);
      assert.equal(Boolean(persisted), true);
      assert.equal(persisted.persisted, true);
      assert.equal(persisted.stale, false);

      const result = parseTextJson(await callAction(second.request, "job.result", projectRoot, { jobId }));
      assert.equal(result.data.job.id, jobId);
      assert.equal(result.data.result.coverage, 91);

      const otherRoot = path.join(root, "other-project");
      write(path.join(otherRoot, "cadre", "setup_state.json"), "{}\n");
      const crossProject = parseTextJson(await callAction(second.request, "job.result", otherRoot, { jobId }));
      assert.equal(crossProject.ok, false);
      assert.match(crossProject.errors.join(" "), /not found/i);
      const crossList = parseTextJson(await callAction(second.request, "job.list", otherRoot));
      assert.equal(crossList.data.jobs.some((job) => job.id === jobId), false);
      const crossCancel = parseTextJson(await callAction(second.request, "job.cancel", otherRoot, { jobId }, true));
      assert.equal(crossCancel.ok, false);
      assert.match(crossCancel.errors.join(" "), /not found/i);

      const restarted = parseTextJson(await callAction(
        second.request,
        "job.start",
        projectRoot,
        {
          type: "coverage",
          args: { command: "printf 'Statements : 88%%\\n'", coverageThreshold: 80 },
        },
        true,
      ));
      assert.notEqual(restarted.job.id, jobId);
      await waitForJob(second.request, projectRoot, restarted.job.id);
    } finally {
      await new Promise((resolve) => {
        second.server.once("exit", resolve);
        second.server.kill("SIGTERM");
      });
    }
  } finally {
    first.server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP job persistence rejects symlinked project storage", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-job-symlink-test-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-job-symlink-outside-"));
  const { server, request, initialize } = startServer();
  try {
    write(path.join(root, "cadre", "setup_state.json"), "{}\n");
    fs.symlinkSync(outside, path.join(root, "cadre", "jobs"));
    await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "job-symlink-test" } });
    const started = parseTextJson(await callAction(
      request,
      "job.start",
      root,
      { type: "coverage", args: { command: "printf 'Statements : 91%%\\n'", coverageThreshold: 80 } },
      true,
    ));
    assert.equal(started.ok, true);
    assert.equal(started.job.artifact_path, null);
    const completed = await waitForJob(request, root, started.job.id);
    assert.equal(completed.ok, true);
    assert.equal(completed.job.artifact_path, null);
    assert.deepEqual(fs.readdirSync(outside), []);
    const resourceUri = `cadre://job-result?root=${encodeURIComponent(root)}&jobId=${started.job.id}`;
    const persisted = JSON.parse((await request("resources/read", { uri: resourceUri })).contents[0].text);
    assert.equal(persisted.data.ok, false);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("MCP LSP reviews reject unowned configs without spawning commands", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-lsp-config-guard-"));
  const outsideConfig = `${root}-outside.json`;
  const marker = `${root}-spawned`;
  const { server, request, initialize } = startServer();
  try {
    write(path.join(root, "cadre", "setup_state.json"), "{}\n");
    git(root, ["init"]);
    git(root, ["config", "user.email", "reviewer@example.com"]);
    git(root, ["config", "user.name", "Reviewer"]);
    write(path.join(root, "src", "index.ts"), "export function guarded() { return true; }\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "initial"]);
    git(root, ["branch", "-M", "main"]);
    git(root, ["checkout", "-b", "track/lsp-config-guard"]);
    write(path.join(root, "src", "index.ts"), "export function guarded() { return false; }\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "change guarded source"]);

    const markerCommand = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`;
    const hostileConfig = JSON.stringify({
      servers: [{
        id: "hostile",
        command: process.execPath,
        args: ["-e", markerCommand],
        extensions: [".ts"],
      }],
    }, null, 2);
    write(outsideConfig, hostileConfig);
    write(path.join(root, "cadre", "product.json"), hostileConfig);
    fs.symlinkSync(outsideConfig, path.join(root, "cadre", "lsp-linked.json"));

    await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "lsp-config-guard" } });
    await assert.rejects(
      callAction(
        request,
        "intel.lsp_warm_review",
        root,
        { base: "main", head: "HEAD", configOwnerRoot: path.dirname(outsideConfig) },
      ),
      /reserved control fields: configOwnerRoot/i,
    );

    for (const action of ["intel.lsp_review", "intel.lsp_warm_review"]) {
      for (const config of [
        outsideConfig,
        `../${path.basename(outsideConfig)}`,
        "cadre/product.json",
        "cadre/lsp-linked.json",
      ]) {
        const review = parseTextJson(await callAction(
          request,
          action,
          root,
          { base: "main", head: "HEAD", config, timeoutMs: 5000 },
        ));
        assert.equal(review.data.available, false, `${action} should reject ${config}`);
        assert.match(String(review.data.reason), /Cadre config|symbolic link/i);
        assert.equal(fs.existsSync(marker), false, `${action} spawned the rejected config ${config}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideConfig, { force: true });
    fs.rmSync(marker, { force: true });
  }
});

test("MCP warm LSP review qualifies polyrepo findings with repo context", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-lsp-test-"));
  const appRoot = path.join(root, "products", "app");
  const { server, request, initialize } = startServer();
  try {
    write(path.join(root, "cadre", "setup_state.json"), "{}\n");
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "app",
      repos: [
        { name: "app", submodule_path: "products/app", default_branch: "main" },
      ],
    }, null, 2));
    write(path.join(root, "cadre", "lsp.json"), JSON.stringify({
      servers: [
        {
          id: "javascript",
          command: "cadre-missing-js-language-server",
          args: ["--stdio"],
          extensions: [".js"],
        },
      ],
    }, null, 2));
    writeTrack(root, "poly_lsp", {
      version: 1,
      schema: "cadre.plan.v1",
      track_id: "poly_lsp",
      phases: [{
        phase_index: 1,
        title: "Phase 1: App",
        execution_mode: "sequential",
        depends_on: [],
        tasks: [planTask(1, 1, "Update app", ["src/app.js"], { repo: "app" })],
      }],
    }, {
      repos: {
        app: {
          submodule_path: "products/app",
          base_branch: "main",
          git_branch: "track/poly_lsp",
        },
      },
    });

    fs.mkdirSync(appRoot, { recursive: true });
    git(appRoot, ["init"]);
    git(appRoot, ["config", "user.email", "reviewer@example.com"]);
    git(appRoot, ["config", "user.name", "Reviewer"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() { return true; }\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "initial app"]);
    git(appRoot, ["branch", "-M", "main"]);
    git(appRoot, ["checkout", "-b", "track/poly_lsp"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() { return 'changed'; }\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "change app"]);

    await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });
    const review = parseTextJson(await callAction(
      request,
      "intel.lsp_warm_review",
      root,
      {
        trackId: "poly_lsp",
        timeoutMs: 10000,
      },
    ));
    assert.equal(review.data.polyrepo, true);
    const appResult = review.data.repos.find((repo) => repo.repo === "app");
    assert.equal(appResult.path, "products/app");
    assert.equal(appResult.cwd, appRoot);
    assert.ok(review.data.findings.length > 0);
    for (const finding of review.data.findings) {
      assert.equal(finding.repo, "app");
      assert.equal(typeof finding.path, "string");
      assert.equal(finding.cwd, appRoot);
    }

    await callAction(request, "intel.lsp_daemon_shutdown", null, {}, true);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP DAP setup, snapshot, workflow, async job, and resource compose", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-dap-test-"));
  const outsideConfig = `${root}-outside.json`;
  const outsideSource = `${root}-outside.py`;
  const inlineMarker = `${root}-inline-marker`;
  const breakpointMarker = `${root}-breakpoint-marker`;
  const { server, request, initialize } = startServer();
  try {
    write(path.join(root, "cadre", "setup_state.json"), "{}\n");
    write(path.join(root, "src", "app.py"), "def main():\n    return 42\n");
    const adapterPath = path.join(root, "fake-dap-adapter.js");
    write(adapterPath, fakeDapAdapterSource());
    write(path.join(root, "cadre", "dap.json"), JSON.stringify({
      version: 1,
      schema: "cadre.dap.v1",
      adapters: [{
        id: "fake",
        label: "Fake DAP",
        command: process.execPath,
        args: [adapterPath],
        languages: ["python"],
      }],
      configurations: [{
        id: "fake-launch",
        adapterId: "fake",
        request: "launch",
        name: "Fake launch",
        arguments: { program: "${workspaceFolder}/src/app.py", token: "secret-value" },
      }],
    }, null, 2));

    await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });

    const setup = parseTextJson(await callAction(request, "intel.dap_setup", root));
    assert.equal(setup.data.ok, true);
    assert.equal(setup.data.dry_run, true);
    assert.ok(setup.data.recommended.some((entry) => entry.id === "python-debugpy"));

    const status = parseTextJson(await callAction(request, "intel.dap_status", root));
    assert.equal(status.data.configured, true);
    assert.equal(status.data.adapters[0].available, true);

    const dryRun = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "debug", input: { configurationId: "fake-launch" } },
    }));
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.next, null);
    assert.deepEqual(dryRun.required, ["execute"]);

    const snapshotInput = {
      configurationId: "fake-launch",
      breakpoints: [{ file: "src/app.py", line: 2 }],
      timeoutMs: 5000,
    };
    const guardedSnapshot = parseTextJson(await callAction(request, "intel.dap_snapshot", root, snapshotInput));
    assert.equal(guardedSnapshot.ok, false);
    assert.deepEqual(guardedSnapshot.required, ["execute"]);
    const snapshot = parseTextJson(await callAction(request, "intel.dap_snapshot", root, snapshotInput, true));
    assert.equal(snapshot.data.ok, true);
    assert.equal(snapshot.data.snapshot.event, "stopped");
    assert.equal(snapshot.data.breakpoints[0].breakpoints[0].verified, true);
    assert.equal(snapshot.data.configuration.arguments.token, "<redacted>");
    assert.match(snapshot.data.snapshot.threads[0].frames[0].scopes[0].variables[1].value, /<redacted>/);

    const workflowSnapshot = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "debug", input: snapshotInput, execute: true },
    }));
    assert.equal(workflowSnapshot.ok, true);
    assert.equal(workflowSnapshot.phase, "ready");

    const asyncStart = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "debug", input: { ...snapshotInput, async: true }, execute: true },
    }));
    const jobId = asyncStart.next.arguments.input.jobId;
    const completed = await waitForJob(request, root, jobId);
    assert.equal(completed.ok, true);
    assert.equal(completed.data.result.snapshot.event, "stopped");

    const resource = await request("resources/read", {
      uri: `cadre://dap-status?root=${encodeURIComponent(root)}`,
    });
    const parsedResource = JSON.parse(resource.contents[0].text);
    assert.equal(parsedResource.data.status.configured, true);

    const productConfig = path.join(root, "cadre", "product.json");
    write(productConfig, "{\"sentinel\":\"product\"}\n");
    const crossPurpose = parseTextJson(await callAction(
      request,
      "intel.dap_setup",
      root,
      { config: "cadre/product.json" },
      true,
    ));
    assert.equal(crossPurpose.ok, false);
    assert.match(crossPurpose.errors.join(" "), /cadre\/dap/i);
    assert.equal(fs.readFileSync(productConfig, "utf8"), "{\"sentinel\":\"product\"}\n");

    write(outsideConfig, "{\"sentinel\":\"outside\"}\n");
    const traversal = parseTextJson(await callAction(
      request,
      "intel.dap_setup",
      root,
      { config: `../${path.basename(outsideConfig)}` },
      true,
    ));
    assert.equal(traversal.ok, false);
    assert.equal(fs.readFileSync(outsideConfig, "utf8"), "{\"sentinel\":\"outside\"}\n");

    fs.symlinkSync(outsideConfig, path.join(root, "cadre", "dap-linked.json"));
    const linkedConfig = parseTextJson(await callAction(
      request,
      "intel.dap_setup",
      root,
      { config: "cadre/dap-linked.json" },
      true,
    ));
    assert.equal(linkedConfig.ok, false);
    assert.match(linkedConfig.errors.join(" "), /symbolic link/i);
    assert.equal(fs.readFileSync(outsideConfig, "utf8"), "{\"sentinel\":\"outside\"}\n");

    const inlineCommand = `require("node:fs").writeFileSync(${JSON.stringify(inlineMarker)}, "spawned")`;
    const inlineSnapshot = parseTextJson(await callAction(
      request,
      "intel.dap_snapshot",
      root,
      {
        configuration: {
          request: "launch",
          adapter: { command: process.execPath, args: ["-e", inlineCommand] },
          arguments: {},
        },
      },
      true,
    ));
    assert.equal(inlineSnapshot.ok, false);
    assert.match(inlineSnapshot.errors.join(" "), /inline DAP configuration/i);
    assert.equal(fs.existsSync(inlineMarker), false);

    const markerCommand = `require("node:fs").writeFileSync(${JSON.stringify(breakpointMarker)}, "spawned")`;
    write(path.join(root, "cadre", "dap.json"), JSON.stringify({
      version: 1,
      schema: "cadre.dap.v1",
      adapters: [{ id: "marker", command: process.execPath, args: ["-e", markerCommand] }],
      configurations: [{ id: "marker-launch", adapterId: "marker", request: "launch", arguments: {} }],
    }, null, 2));
    write(outsideSource, "print('outside')\n");
    const outsideBreakpoint = parseTextJson(await callAction(
      request,
      "intel.dap_snapshot",
      root,
      { configurationId: "marker-launch", breakpoints: [{ file: outsideSource, line: 1 }] },
      true,
    ));
    assert.equal(outsideBreakpoint.ok, false);
    assert.match(outsideBreakpoint.errors.join(" "), /breakpoint path.*inside the project root/i);
    assert.equal(fs.existsSync(breakpointMarker), false);

    fs.symlinkSync(outsideSource, path.join(root, "src", "linked.py"));
    const linkedBreakpoint = parseTextJson(await callAction(
      request,
      "intel.dap_snapshot",
      root,
      { configurationId: "marker-launch", breakpoints: [{ file: "src/linked.py", line: 1 }] },
      true,
    ));
    assert.equal(linkedBreakpoint.ok, false);
    assert.match(linkedBreakpoint.errors.join(" "), /breakpoint path.*outside the project root/i);
    assert.equal(fs.existsSync(breakpointMarker), false);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideConfig, { force: true });
    fs.rmSync(outsideSource, { force: true });
    fs.rmSync(inlineMarker, { force: true });
    fs.rmSync(breakpointMarker, { force: true });
  }
});

test("MCP typed continuations and execution guards compose end to end", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-continuation-test-"));
  const { server, request, notify, initialize } = startServer();
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), JSON.stringify({ provider_mode: "github" }, null, 2));
    write(path.join(root, "src", "sequential.ts"), "export const sequential = true;\n");
    write(path.join(root, "src", "api.ts"), "export const api = true;\n");
    write(path.join(root, "src", "ui.ts"), "export const ui = true;\n");
    writeTrack(root, "sequential_next", {
      version: 1,
      schema: "cadre.plan.v1",
      track_id: "sequential_next",
      phases: [{
        phase_index: 1,
        title: "Sequential",
        execution_mode: "sequential",
        depends_on: [],
        tasks: [planTask(1, 1, "Sequential task", ["src/sequential.ts"])],
      }],
    }, {
      review: { verdict: "approved", blocking_count: 0, reviewed_sha: "reviewed-sequential" },
    });
    writeTrack(root, "parallel_next", {
      version: 1,
      schema: "cadre.plan.v1",
      track_id: "parallel_next",
      phases: [{
        phase_index: 1,
        title: "Parallel",
        execution_mode: "parallel",
        depends_on: [],
        tasks: [
          planTask(1, 1, "API task", ["src/api.ts"]),
          planTask(1, 2, "UI task", ["src/ui.ts"]),
        ],
      }],
    });

    await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "continuation-test" } });

    const tracksBeforeNotification = fs.readFileSync(path.join(root, "cadre", "tracks.json"), "utf8");
    notify("tools/call", {
      name: "cadre_action",
      arguments: { root, action: "mutate.regen_index", input: {}, execute: true },
    });
    await request("ping");
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tracks.json"), "utf8"), tracksBeforeNotification);

    const sequential = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "implement", input: { trackId: "sequential_next" } },
    }));
    assert.deepEqual(sequential.next, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "task.complete",
        input: { trackId: "sequential_next", phaseIndex: 1, taskIndex: 1 },
        execute: true,
      },
    });

    const parallelBlocked = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "implement", input: { trackId: "parallel_next" } },
    }));
    assert.equal(parallelBlocked.next, null);
    assert.deepEqual(parallelBlocked.required, ["agentIdentifier"]);

    const parallel = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: {
        root,
        workflow: "implement",
        input: { trackId: "parallel_next", agentIdentifier: "codex", maxWorkers: 2 },
      },
    }));
    assert.equal(parallel.next.tool, "cadre_action");
    assert.equal(parallel.next.arguments.action, "parallel.next_wave");
    const wave = parseTextJson(await request("tools/call", {
      name: parallel.next.tool,
      arguments: parallel.next.arguments,
    }));
    assert.equal(wave.next.tool, "cadre_action");
    assert.equal(wave.next.arguments.action, "parallel.setup_workers");
    assert.equal(wave.next.arguments.root, root);
    assert.equal(wave.next.arguments.input.agentIdentifier, "codex");
    assert.equal(wave.next.arguments.execute, true);

    const provider = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "ship", input: { trackId: "sequential_next", providerMode: "github" } },
    }));
    assert.equal(provider.phase, "pending_provider");
    assert.equal(provider.next.tool, "cadre_read");
    assert.match(provider.next.arguments.uri, /^cadre:\/\/provider-actions\?/);
    assert.match(provider.next.arguments.uri, /workflow=ship/);

    const statusBeforeReads = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
    for (const uri of [
      provider.next.arguments.uri,
      `cadre://ship-plan?root=${encodeURIComponent(root)}&trackId=sequential_next`,
      `cadre://land-plan?root=${encodeURIComponent(root)}&trackId=sequential_next`,
    ]) {
      await request("resources/read", { uri });
    }
    assert.equal(
      git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout,
      statusBeforeReads,
      "MCP resource reads must not write files or alter the Git index",
    );

    const guardedTask = parseTextJson(await callAction(
      request,
      "task.complete",
      root,
      { trackId: "sequential_next", phaseIndex: 1, taskIndex: 1 },
    ));
    assert.equal(guardedTask.ok, false);
    assert.deepEqual(guardedTask.required, ["execute"]);

    const guardedJob = parseTextJson(await callAction(
      request,
      "job.start",
      root,
      { type: "coverage", args: { command: "printf 'Statements : 91%%\\n'" } },
    ));
    assert.equal(guardedJob.ok, false);
    assert.deepEqual(guardedJob.required, ["execute"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "jobs")), false);

    const guardedCancel = parseTextJson(await callAction(
      request,
      "job.cancel",
      root,
      { jobId: "job_00000000-0000-0000-0000-000000000000" },
    ));
    assert.equal(guardedCancel.ok, false);
    assert.deepEqual(guardedCancel.required, ["execute"]);

    const evidencePath = path.join(root, "cadre", "tracks", "sequential_next", "review-evidence.jsonl");
    const guardedEvidence = parseTextJson(await callAction(
      request,
      "review.provider_evidence",
      root,
      { trackId: "sequential_next", provider: "github", evidence: { pr: 1 } },
    ));
    assert.equal(guardedEvidence.ok, false);
    assert.deepEqual(guardedEvidence.required, ["execute"]);
    assert.equal(fs.existsSync(evidencePath), false);

    const started = parseTextJson(await callAction(
      request,
      "job.start",
      root,
      { type: "coverage", args: { command: "printf 'Statements : 91%%\\n'", coverageThreshold: 80 } },
      true,
    ));
    assert.deepEqual(started.next, {
      tool: "cadre_action",
      arguments: { root, action: "job.result", input: { jobId: started.job.id } },
    });
    await waitForJob(request, root, started.job.id);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP team-scale workflow packets compose on one track", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-server-packets-test-"));
  const { server, request, initialize } = startServer();
  try {
    spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "reviewer@example.com"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "Reviewer"], { cwd: root, encoding: "utf8" });
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    write(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.test.ts"), "test('app', () => {});\n");
    writeTrack(root, "packets_20260618", {
      version: 1,
      schema: "cadre.plan.v1",
      track_id: "packets_20260618",
      phases: [{
        phase_index: 1,
        title: "Phase 1: Packet Flow",
        execution_mode: "parallel",
        depends_on: [],
        tasks: [
          planTask(1, 1, "Update app", ["src/app.ts"]),
          planTask(1, 2, "Update test", ["src/app.test.ts"]),
        ],
      }],
    });

    await initialize({ protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });

    const planAssist = parseTextJson(await callAction(
      request,
      "track.plan_assist",
      root,
      { trackId: "packets_20260618" },
    ));
    assert.equal(planAssist.data.ok, true);
    assert.ok(planAssist.data.likely_tests.includes("src/app.test.ts"));

    const wave = parseTextJson(await callAction(
      request,
      "parallel.next_wave",
      root,
      { trackId: "packets_20260618" },
    ));
    assert.equal(wave.data.ok, true);
    assert.equal(wave.data.workers.length, 2);

    const readiness = parseTextJson(await callAction(
      request,
      "intel.mcp_readiness",
      root,
      { providerMode: "github", mcpCapabilities: { github: { available: true } } },
    ));
    assert.equal(readiness.data.provider.available, true);
    assert.equal(readiness.data.summary.packet_owned_evidence_only, true);

    const fleet = parseTextJson(await callAction(request, "status.fleet", root, { includeCollisions: false }));
    assert.equal(fleet.data.ok, true);
    assert.ok(fleet.data.repos.some((repo) => repo.name === "."));

    const workflowStatus = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "status", input: { mode: "fleet", includeCollisions: false } },
    }));
    assert.equal(workflowStatus.ok, true);
    assert.equal(workflowStatus.data.status.ok, true);

    const workflowValidate = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "validate", input: { trackId: "packets_20260618" } },
    }));
    assert.equal(workflowValidate.ok, false);
    assert.equal(workflowValidate.data.integrity.ok, true);

    const artifactCatalog = parseTextJson(await callAction(
      request,
      "artifact.catalog",
      root,
      { scope: "track:packets_20260618" },
    ));
    assert.equal(artifactCatalog.data.ok, true);
    assert.ok(artifactCatalog.data.artifacts.some((artifact) => artifact.id === "track:packets_20260618:plan"));

    const artifactSync = parseTextJson(await callAction(
      request,
      "artifact.sync",
      root,
      { scope: "track:packets_20260618" },
    ));
    assert.equal(artifactSync.data.ok, true);
    assert.equal(artifactSync.data.dry_run, true);
    assert.ok(artifactSync.data.artifacts.some((artifact) => artifact.artifact_id === "track:packets_20260618:plan"));

    const diagnostics = parseTextJson(await callAction(request, "intel.workspace_diagnostics", root));
    assert.equal(diagnostics.data.ok, true);
    assert.ok(diagnostics.data.adapters.some((adapter) => adapter.id === "node"));

    const lspSetup = parseTextJson(await callAction(request, "intel.lsp_setup", root));
    assert.equal(lspSetup.data.ok, true);
    assert.equal(lspSetup.data.dry_run, true);
    assert.ok(lspSetup.data.recommended.some((entry) => entry.id === "typescript"));

    const evidence = parseTextJson(await callAction(
      request,
      "review.provider_evidence",
      root,
      {
        trackId: "packets_20260618",
        provider: "github",
        fetch: false,
        evidence: { pr: 7 },
        findings: [{ severity: "blocking", message: "example" }],
      },
      true,
    ));
    assert.equal(evidence.data.ok, true);
    assert.equal(evidence.data.entry.blocking_count, 1);

    const resource = await request("resources/read", {
      uri: `cadre://review-evidence?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    const parsedResource = JSON.parse(resource.contents[0].text);
    assert.equal(parsedResource.data.evidence.entries.length, 1);

    const trackSpecResource = await request("resources/read", {
      uri: `cadre://track-spec?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    assert.equal(JSON.parse(trackSpecResource.contents[0].text).data.ok, true);

    const artifactPreviewResource = await request("resources/read", {
      uri: `cadre://artifact-preview?root=${encodeURIComponent(root)}&artifact=${encodeURIComponent("track:packets_20260618:plan")}`,
    });
    assert.equal(JSON.parse(artifactPreviewResource.contents[0].text).data.ok, true);

    const artifactSyncResource = await request("resources/read", {
      uri: `cadre://artifact-sync-plan?root=${encodeURIComponent(root)}&scope=${encodeURIComponent("track:packets_20260618")}`,
    });
    assert.equal(JSON.parse(artifactSyncResource.contents[0].text).data.dry_run, true);

    const topologyResource = await request("resources/read", {
      uri: `cadre://repo-topology?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(topologyResource.contents[0].text).data.ok, true);

    const lspResource = await request("resources/read", {
      uri: `cadre://lsp-status?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(lspResource.contents[0].text).data.ok, true);

    const healthResource = await request("resources/read", {
      uri: `cadre://workspace-health?root=${encodeURIComponent(root)}`,
    });
    const parsedHealth = JSON.parse(healthResource.contents[0].text);
    assert.equal(parsedHealth.data.response_mode, "compact");
    assert.equal(parsedHealth.data.workspace.repo_count, 1);
    assert.ok(Array.isArray(parsedHealth.data.languages.detected));
    assert.equal(typeof parsedHealth.data.parallel.available_count, "number");
    assert.ok(parsedHealth.data.integrations.optional_mcps.some((entry) => entry.kind === "code_search"));

    const healthDetailResource = await request("resources/read", {
      uri: `cadre://workspace-health?root=${encodeURIComponent(root)}&responseMode=detail`,
    });
    const parsedHealthDetail = JSON.parse(healthDetailResource.contents[0].text);
    assert.equal(parsedHealthDetail.data.response_mode, "detail");
    assert.ok(Array.isArray(parsedHealthDetail.data.workspace.adapters));

    const integrationsResource = await request("resources/read", {
      uri: `cadre://integrations?root=${encodeURIComponent(root)}&responseMode=detail`,
    });
    const parsedIntegrations = JSON.parse(integrationsResource.contents[0].text);
    assert.equal(parsedIntegrations.data.response_mode, "detail");
    assert.ok(Array.isArray(parsedIntegrations.data.optional_mcps));

    const parallelResource = await request("resources/read", {
      uri: `cadre://parallel-state?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    assert.equal(JSON.parse(parallelResource.contents[0].text).data.track_id, "packets_20260618");

    const gateResource = await request("resources/read", {
      uri: `cadre://quality-gate?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    assert.equal(JSON.parse(gateResource.contents[0].text).data.review_gate.track_id, "packets_20260618");

    const actionsResource = await request("resources/read", {
      uri: `cadre://my-next-actions?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(actionsResource.contents[0].text).data.ok, true);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
