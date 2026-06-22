#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline";
import { LspClient, runReview } from "./cadre-lsp-review";
import type { JsonObject, RuntimeArgs } from "./types";
import { asJsonObject, asOptionalString, errorMessage } from "./guards";

interface DaemonServer extends JsonObject {
  id?: string;
  command: string;
  args?: string[];
}

interface ClientPoolEntry {
  key: string;
  root: string;
  server_id: string;
  command: string;
  client: LspClient;
  started_at: string;
  last_used_at: string;
  uses: number;
}

interface DaemonMessage extends JsonObject {
  id?: string | number | null;
  method?: string;
  params?: JsonObject;
}

export class ClientPool {
  clients: Map<string, ClientPoolEntry>;
  maxClients: number;
  idleEvictionMs: number;

  constructor(options: { maxClients?: number; idleEvictionMs?: number } = {}) {
    this.clients = new Map();
    this.maxClients = Math.max(1, Math.min(32, Number(options.maxClients || process.env.CADRE_LSP_MAX_CLIENTS || 8)));
    this.idleEvictionMs = Math.max(30_000, Number(options.idleEvictionMs || process.env.CADRE_LSP_IDLE_EVICTION_MS || 10 * 60 * 1000));
  }

  key(root: string, server: DaemonServer): string {
    return JSON.stringify({
      root,
      id: server.id || null,
      command: server.command,
      args: server.args || [],
    });
  }

  async get(root: string, server: DaemonServer): Promise<ClientPoolEntry> {
    await this.evictIdle();
    const key = this.key(root, server);
    const existing = this.clients.get(key);
    if (existing) {
      existing.last_used_at = new Date().toISOString();
      existing.uses += 1;
      return existing;
    }
    await this.evictOverflow(this.maxClients - 1);
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

  async evictIdle(now = Date.now()): Promise<number> {
    const stale = Array.from(this.clients.values()).filter((entry) => {
      const lastUsed = Date.parse(entry.last_used_at);
      return Number.isFinite(lastUsed) && now - lastUsed > this.idleEvictionMs;
    });
    for (const entry of stale) {
      this.clients.delete(entry.key);
      await entry.client.shutdown();
    }
    return stale.length;
  }

  async evictOverflow(maxRemaining: number): Promise<number> {
    const entries = Array.from(this.clients.values())
      .sort((left, right) => Date.parse(left.last_used_at) - Date.parse(right.last_used_at));
    let evicted = 0;
    while (this.clients.size > maxRemaining && entries.length > 0) {
      const entry = entries.shift();
      if (!entry) break;
      this.clients.delete(entry.key);
      await entry.client.shutdown();
      evicted += 1;
    }
    return evicted;
  }

  async drop(root: string, server: DaemonServer): Promise<boolean> {
    const key = this.key(root, server);
    const existing = this.clients.get(key);
    if (!existing) return false;
    this.clients.delete(key);
    await existing.client.shutdown();
    return true;
  }

  status(): JsonObject {
    return {
      client_count: this.clients.size,
      max_clients: this.maxClients,
      idle_eviction_ms: this.idleEvictionMs,
      servers: Array.from(this.clients.values()).map((entry) => ({
        root: entry.root,
        server_id: entry.server_id,
        command: entry.command,
        started_at: entry.started_at,
        last_used_at: entry.last_used_at,
        uses: entry.uses,
        open_documents: entry.client.opened ? entry.client.opened.size : 0,
      })),
    };
  }

  async shutdownAll(): Promise<number> {
    const entries = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(entries.map((entry) => entry.client.shutdown()));
    return entries.length;
  }
}

const pool = new ClientPool();

function send(id: string | number | null | undefined, result: unknown, error: JsonObject | null = null): void {
  process.stdout.write(`${JSON.stringify({ id, result, error })}\n`);
}

export async function handleDaemonMessage(message: DaemonMessage): Promise<unknown> {
  if (message.method === "status") {
    const evicted_idle = await pool.evictIdle();
    return { ok: true, evicted_idle, ...pool.status() };
  }
  if (message.method === "review") {
    const params = asJsonObject(message.params) as RuntimeArgs;
    return runReview({ ...params, clientPool: pool });
  }
  if (message.method === "shutdown") {
    const stopped = await pool.shutdownAll();
    setImmediate(() => process.exit(0));
    return { ok: true, stopped };
  }
  throw new Error(`Unknown LSP daemon method: ${message.method}`);
}

export function runLspDaemon(): void {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let message: DaemonMessage | null = null;
    try {
      message = asJsonObject(JSON.parse(line)) as DaemonMessage;
      const result = await handleDaemonMessage(message);
      send(message.id || null, result);
    } catch (error) {
      send(message && message.id ? message.id : null, null, {
        message: errorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  process.on("SIGTERM", () => {
    pool.shutdownAll().finally(() => process.exit(0));
  });
}

if (["cadre-lsp-daemon.js", "cadre-lsp-daemon.ts"].includes(path.basename(process.argv[1] || ""))) {
  runLspDaemon();
}
