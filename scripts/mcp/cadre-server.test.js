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

test("MCP root resolution rejects harness skill directories without project state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-server-test-"));
  const { server, request } = startServer();
  try {
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });
    const tools = await request("tools/list", {});
    const names = tools.tools.map((tool) => tool.name);
    for (const name of [
      "cadre_prepare_implementation",
      "cadre_create_beads_tree",
      "cadre_complete_task",
      "cadre_record_parallel_worker",
      "cadre_team_board",
      "cadre_review_assist",
      "cadre_lsp_impact",
    ]) {
      assert.ok(names.includes(name), `expected ${name} in tools/list`);
    }

    write(path.join(root, "harness", "skills", "cadre", "SKILL.md"), "# Harness copy\n");
    await assert.rejects(
      request("tools/call", {
        name: "cadre_current_root",
        arguments: { root: path.join(root, "harness", "skills", "cadre") },
      }),
      /requires a per-call root/
    );

    write(path.join(root, "project", "cadre", "setup_state.json"), "{}\n");
    const valid = await request("tools/call", {
      name: "cadre_current_root",
      arguments: { root: path.join(root, "project", "cadre") },
    });
    assert.equal(parseTextJson(valid).root, path.join(root, "project"));

    const doctor = await request("tools/call", {
      name: "cadre_doctor",
      arguments: { root: path.join(root, "harness", "skills", "cadre") },
    });
    assert.equal(parseTextJson(doctor).checks.cadre_project.ok, false);
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
