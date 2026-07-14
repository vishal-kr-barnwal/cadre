#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const harnessRoot = path.resolve(__dirname, "..", "..");
const serverPath = path.join(__dirname, "cadre-server.js");
const packageVersion = JSON.parse(fs.readFileSync(path.join(harnessRoot, "package.json"), "utf8")).version;
const currentProtocolVersion = "2025-11-25";
const supportedProtocolVersions = [currentProtocolVersion, "2025-06-18"];

function startServer() {
  const child = spawn(process.execPath, [serverPath], {
    cwd: harnessRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let nextId = 1;
  const messages = [];
  const pending = new Map();

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      messages.push(message);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });

  function exchange(line, id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for JSON-RPC id ${id}`));
      }, 3000);
      pending.set(id, { resolve, timer });
      child.stdin.write(`${line}\n`);
    });
  }

  function request(method, params = {}) {
    const id = nextId++;
    return exchange(JSON.stringify({ jsonrpc: "2.0", id, method, params }), id);
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })}\n`);
  }

  async function stop() {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }

  return { child, exchange, messages, notify, request, stop };
}

async function initialize(server, protocolVersion) {
  return server.request("initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "lifecycle-test", version: "1" },
  });
}

test("initialize echoes supported revisions and reports the package version", async () => {
  for (const protocolVersion of supportedProtocolVersions) {
    const server = startServer();
    try {
      const response = await initialize(server, protocolVersion);
      assert.equal(response.error, undefined);
      assert.equal(response.result.protocolVersion, protocolVersion);
      assert.equal(response.result.serverInfo.name, "cadre");
      assert.equal(response.result.serverInfo.version, packageVersion);
      server.notify("notifications/initialized");
    } finally {
      await server.stop();
    }
  }
});

test("initialize falls back to the latest supported revision", async () => {
  const server = startServer();
  try {
    const response = await initialize(server, "2099-01-01");
    assert.equal(response.error, undefined);
    assert.equal(response.result.protocolVersion, currentProtocolVersion);
  } finally {
    await server.stop();
  }
});

test("operation is gated until notifications/initialized and notifications never receive replies", async () => {
  const server = startServer();
  try {
    const beforeInitialize = await server.request("tools/list");
    assert.equal(beforeInitialize.error.code, -32002);

    const initialized = await initialize(server, currentProtocolVersion);
    assert.equal(initialized.result.protocolVersion, currentProtocolVersion);
    const beforeNotification = await server.request("tools/list");
    assert.equal(beforeNotification.error.code, -32002);

    server.notify("notifications/initialized");
    const tools = await server.request("tools/list");
    assert.deepEqual(tools.result.tools.map((tool) => tool.name), ["cadre_workflow", "cadre_action", "cadre_read"]);

    const messageCount = server.messages.length;
    server.notify("notifications/initialized");
    server.notify("notifications/not_supported");
    const ping = await server.request("ping");
    assert.deepEqual(ping.result, {});
    assert.deepEqual(server.messages.slice(messageCount).map((message) => message.id), [ping.id]);
  } finally {
    await server.stop();
  }
});

test("stdio returns standard parse and invalid-request errors", async () => {
  const server = startServer();
  try {
    const parseError = await server.exchange("{", null);
    assert.deepEqual(parseError, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });

    const invalidArray = await server.exchange("[]", null);
    assert.equal(invalidArray.error.code, -32600);
    assert.equal(invalidArray.error.message, "Invalid Request");

    const wrongVersion = await server.exchange(JSON.stringify({ jsonrpc: "1.0", id: 41, method: "ping" }), 41);
    assert.equal(wrongVersion.error.code, -32600);
    assert.equal(wrongVersion.id, 41);

    const invalidParams = await server.exchange(JSON.stringify({ jsonrpc: "2.0", id: 42, method: "ping", params: [] }), 42);
    assert.equal(invalidParams.error.code, -32600);
    assert.equal(invalidParams.id, 42);
  } finally {
    await server.stop();
  }
});

test("installer MCP check performs the complete lifecycle", () => {
  const result = spawnSync(process.execPath, [path.join(harnessRoot, "scripts", "cadre-cli.js"), "doctor"], {
    cwd: harnessRoot,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mcp ping: ok/);
});
