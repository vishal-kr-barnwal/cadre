import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { JsonObject, RuntimeArgs } from "../types";
import { asJsonObject, asOptionalString } from "../guards";
import type { PendingRequest } from "./protocol-types";

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
    const daemon = path.resolve(__dirname, "..", "cadre-lsp-daemon.js");
    this.proc = spawn(process.execPath, [daemon], {
      cwd: path.resolve(__dirname, "..", ".."),
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
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let message: JsonObject;
      try {
        message = asJsonObject(JSON.parse(line));
      } catch {
        continue;
      }
      const id = typeof message.id === "number" ? message.id : null;
      if (id == null || !this.pending.has(id)) continue;
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      const messageError = asJsonObject(message.error);
      if (Object.keys(messageError).length > 0) pending.reject(new Error(asOptionalString(messageError.message) || "LSP daemon error"));
      else pending.resolve(message.result);
    }
  }

  request(method: string, params: RuntimeArgs | JsonObject = {}, timeoutMs = 60000): Promise<unknown> {
    this.ensure();
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP daemon ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.proc) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("LSP daemon process is not running"));
        return;
      }
      this.proc.stdin.write(`${payload}\n`);
    });
  }

  async shutdown(): Promise<unknown> {
    if (!this.proc) return { ok: true, stopped: 0, skipped: true };
    return this.request("shutdown", {}, 5000);
  }
}
