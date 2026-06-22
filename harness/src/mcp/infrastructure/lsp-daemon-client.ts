import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { JsonObject, RuntimeArgs } from "../../types";
import { asJsonObject, asOptionalString } from "../../guards";
import type { PendingRequest } from "../domain/protocol-types";
import { currentMcpServerPath, mcpRuntimeRoot } from "../../runtime-paths";

export class LspDaemonClient {
  proc: ChildProcessWithoutNullStreams | null;
  nextId: number;
  pending: Map<number, PendingRequest>;
  buffer: string;

  constructor() {
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
  }

  ensure(): void {
    if (this.proc && !this.proc.killed) return;
    const daemon = currentMcpServerPath();
    if (!daemon) throw new Error("Cadre MCP runtime not found for LSP daemon");
    this.proc = spawn(process.execPath, [daemon, "--cadre-lsp-daemon"], {
      cwd: mcpRuntimeRoot(daemon),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (chunk: Buffer) => this.read(chunk));
    this.proc.stderr.on("data", () => {});
    this.proc.on("exit", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("LSP daemon exited"));
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  read(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    while (this.buffer.includes("\n")) {
      const index = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: JsonObject;
      try {
        message = asJsonObject(JSON.parse(line));
      } catch {
        continue;
      }
      const id = Number(message.id);
      if (!Number.isFinite(id)) continue;
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(String(asOptionalString((message.error as JsonObject)?.message) || "LSP daemon error")));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  request(method: string, params: JsonObject = {}, timeoutMs = 120000): Promise<unknown> {
    this.ensure();
    const id = this.nextId++;
    const body = JSON.stringify({ id, method, params });
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP daemon request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.proc?.stdin.write(`${body}\n`);
    return promise;
  }

  shutdown(): Promise<unknown> {
    if (!this.proc || this.proc.killed) {
      return Promise.resolve({ ok: true, alreadyStopped: true });
    }
    const proc = this.proc;
    return new Promise((resolve) => {
      proc.once("exit", () => resolve({ ok: true }));
      proc.kill("SIGTERM");
    });
  }
}
