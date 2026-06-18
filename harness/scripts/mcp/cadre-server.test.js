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

function startServer() {
  const server = spawn(process.execPath, [path.join(__dirname, "cadre-server.js")], {
    cwd: path.resolve(__dirname, "..", ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();

  server.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;
      const message = JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
      buffer = buffer.slice(bodyEnd);
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
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 3000);
    });
  }

  return { server, request };
}

function parseTextJson(result) {
  return JSON.parse(result.content[0].text);
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

async function waitForJob(request, jobId) {
  for (let i = 0; i < 20; i += 1) {
    const result = await request("tools/call", {
      name: "cadre_job",
      arguments: { action: "result", jobId },
    });
    const parsed = parseTextJson(result);
    if (parsed.data.job.status !== "running") return parsed;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

test("LSP setup JSON and daemon status/shutdown smoke", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-lsp-smoke-"));
  const daemon = spawn(process.execPath, [path.join(__dirname, "..", "cadre-lsp-daemon.js")], {
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
      path.join(__dirname, "..", "cadre-lsp-setup.js"),
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

    const status = await requestDaemon(daemon, "status");
    assert.equal(status.ok, true);
    assert.deepEqual(status.servers, []);
    const shutdown = await requestDaemon(daemon, "shutdown");
    assert.equal(shutdown.ok, true);
  } finally {
    daemon.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP root resolution rejects harness skill directories without project state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-server-test-"));
  const { server, request } = startServer();
  try {
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });
    const tools = await request("tools/list", {});
    const names = tools.tools.map((tool) => tool.name);
    for (const name of [
      "cadre_project",
      "cadre_status",
      "cadre_track",
      "cadre_parallel",
      "cadre_mutate",
      "cadre_complete_task",
      "cadre_beads",
      "cadre_job",
      "cadre_review",
      "cadre_intel",
    ]) {
      assert.ok(names.includes(name), `expected ${name} in tools/list`);
    }
    const trackTool = tools.tools.find((tool) => tool.name === "cadre_track");
    const trackActions = trackTool.inputSchema.properties.action.enum;
    assert.ok(trackActions.includes("plan_assist"));
    assert.ok(trackActions.includes("worktree_plan"));
    const parallelTool = tools.tools.find((tool) => tool.name === "cadre_parallel");
    const parallelActions = parallelTool.inputSchema.properties.action.enum;
    assert.ok(parallelActions.includes("next_wave"));
    assert.ok(parallelActions.includes("setup_workers"));
    const reviewTool = tools.tools.find((tool) => tool.name === "cadre_review");
    const reviewActions = reviewTool.inputSchema.properties.action.enum;
    assert.ok(reviewActions.includes("provider_evidence"));
    const intelTool = tools.tools.find((tool) => tool.name === "cadre_intel");
    const intelActions = intelTool.inputSchema.properties.action.enum;
    assert.ok(intelActions.includes("workspace_diagnostics"));
    assert.ok(intelActions.includes("test_impact"));
    assert.ok(intelActions.includes("dependency_graph"));
    const statusTool = tools.tools.find((tool) => tool.name === "cadre_status");
    const statusActions = statusTool.inputSchema.properties.action.enum;
    assert.ok(statusActions.includes("fleet"));
    assert.ok(statusActions.includes("beads_summary"));
    const resources = await request("resources/list", {});
    const uris = resources.resources.map((resource) => resource.uri);
    assert.ok(uris.includes("cadre://fleet-board"));
    assert.ok(uris.includes("cadre://beads-summary"));
    assert.ok(uris.includes("cadre://review-evidence"));
    assert.ok(uris.includes("cadre://workspace-diagnostics"));

    write(path.join(root, "harness", "skills", "cadre", "SKILL.md"), "# Harness copy\n");
    await assert.rejects(
      request("tools/call", {
        name: "cadre_project",
        arguments: { action: "root", root: path.join(root, "harness", "skills", "cadre") },
      }),
      /requires \{ root \}/
    );

    write(path.join(root, "project", "cadre", "setup_state.json"), "{}\n");
    const valid = await request("tools/call", {
      name: "cadre_project",
      arguments: { action: "root", root: path.join(root, "project", "cadre") },
    });
    assert.equal(parseTextJson(valid).data.root, path.join(root, "project"));

    const doctor = await request("tools/call", {
      name: "cadre_project",
      arguments: { action: "doctor", root: path.join(root, "harness", "skills", "cadre") },
    });
    assert.equal(parseTextJson(doctor).data.checks.cadre_project.ok, false);

    const job = await request("tools/call", {
      name: "cadre_job",
      arguments: {
        action: "start",
        type: "coverage",
        root: path.join(root, "project"),
        args: { command: "printf 'Statements : 91%%\\n'", coverageThreshold: 80 },
      },
    });
    const jobId = parseTextJson(job).job.id;
    const completed = await waitForJob(request, jobId);
    assert.equal(completed.ok, true);
    assert.equal(completed.data.result.coverage, 91);
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
