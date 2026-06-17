#!/usr/bin/env node
"use strict";

const readline = require("readline");
const { LspClient, runReview } = require("./cadre-lsp-review");

class ClientPool {
  constructor() {
    this.clients = new Map();
  }

  key(root, server) {
    return JSON.stringify({
      root,
      id: server.id || null,
      command: server.command,
      args: server.args || [],
    });
  }

  async get(root, server) {
    const key = this.key(root, server);
    const existing = this.clients.get(key);
    if (existing) {
      existing.last_used_at = new Date().toISOString();
      existing.uses += 1;
      return existing;
    }
    const client = new LspClient(root, server);
    await client.start();
    await client.initialize();
    const entry = {
      key,
      root,
      server_id: server.id || server.command || "unknown",
      command: server.command,
      client,
      started_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      uses: 1,
    };
    this.clients.set(key, entry);
    return entry;
  }

  async drop(root, server) {
    const key = this.key(root, server);
    const existing = this.clients.get(key);
    if (!existing) return false;
    this.clients.delete(key);
    await existing.client.shutdown();
    return true;
  }

  status() {
    return Array.from(this.clients.values()).map((entry) => ({
      root: entry.root,
      server_id: entry.server_id,
      command: entry.command,
      started_at: entry.started_at,
      last_used_at: entry.last_used_at,
      uses: entry.uses,
      open_documents: entry.client.opened ? entry.client.opened.size : 0,
    }));
  }

  async shutdownAll() {
    const entries = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(entries.map((entry) => entry.client.shutdown()));
    return entries.length;
  }
}

const pool = new ClientPool();

function send(id, result, error = null) {
  process.stdout.write(`${JSON.stringify({ id, result, error })}\n`);
}

async function handle(message) {
  if (message.method === "status") {
    return { ok: true, servers: pool.status() };
  }
  if (message.method === "review") {
    const params = message.params || {};
    return runReview({ ...params, clientPool: pool });
  }
  if (message.method === "shutdown") {
    const stopped = await pool.shutdownAll();
    setImmediate(() => process.exit(0));
    return { ok: true, stopped };
  }
  throw new Error(`Unknown LSP daemon method: ${message.method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
    const result = await handle(message);
    send(message.id || null, result);
  } catch (error) {
    send(message && message.id ? message.id : null, null, {
      message: error.message,
      stack: error.stack,
    });
  }
});

process.on("SIGTERM", () => {
  pool.shutdownAll().finally(() => process.exit(0));
});
