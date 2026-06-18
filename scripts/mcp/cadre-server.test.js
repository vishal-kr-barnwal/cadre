#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
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
      "cadre_mutate",
      "cadre_complete_task",
      "cadre_beads",
      "cadre_job",
      "cadre_review",
      "cadre_intel",
    ]) {
      assert.ok(names.includes(name), `expected ${name} in tools/list`);
    }

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
