import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { JsonObject } from "../types";
import { asJsonObject, asOptionalString, errorMessage } from "../guards";
import { DapMessageBuffer, encodeDapMessage } from "./protocol";

interface PendingRequest {
  resolve: (value: JsonObject) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface EventWaiter {
  events: string[];
  resolve: (event: JsonObject | null) => void;
  timer: NodeJS.Timeout;
}

interface DapClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  requestTimeoutMs?: number;
  outputLimit?: number;
}

export class DapClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextSeq = 1;
  private pending = new Map<number, PendingRequest>();
  private waiters: EventWaiter[] = [];
  private reader = new DapMessageBuffer();
  private stderr = "";
  readonly events: JsonObject[] = [];
  readonly outputs: JsonObject[] = [];

  constructor(private options: DapClientOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      this.proc = spawn(this.options.command, this.options.args || [], {
        cwd: this.options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc.once("spawn", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      this.proc.once("error", (error) => fail(new Error(`Unable to start DAP adapter ${this.options.command}: ${errorMessage(error)}`)));
      this.proc.stdout.on("data", (chunk: Buffer) => this.read(chunk));
      this.proc.stderr.on("data", (chunk: Buffer) => {
        this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-(this.options.outputLimit || 8000));
      });
      this.proc.on("exit", (code, signal) => this.rejectAll(signal ? `DAP adapter exited with signal ${signal}` : `DAP adapter exited with code ${code}`));
    });
  }

  private read(chunk: Buffer): void {
    for (const message of this.reader.push(chunk)) this.handleMessage(message);
  }

  private handleMessage(message: JsonObject): void {
    if (message.type === "response") {
      const requestSeq = Number(message.request_seq);
      const pending = this.pending.get(requestSeq);
      if (!pending) return;
      this.pending.delete(requestSeq);
      clearTimeout(pending.timer);
      if (message.success === false) {
        pending.reject(new Error(asOptionalString(message.message) || `${message.command || "request"} failed`));
      } else {
        pending.resolve(asJsonObject(message.body));
      }
      return;
    }
    if (message.type === "event") {
      this.events.push(message);
      if (message.event === "output") this.outputs.push(message);
      this.resolveWaiters(message);
    }
  }

  private resolveWaiters(message: JsonObject): void {
    const eventName = asOptionalString(message.event);
    if (!eventName) return;
    const ready = this.waiters.filter((waiter) => waiter.events.includes(eventName));
    this.waiters = this.waiters.filter((waiter) => !waiter.events.includes(eventName));
    for (const waiter of ready) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.waiters = [];
  }

  request(command: string, args: JsonObject = {}, timeoutMs = this.options.requestTimeoutMs || 10000): Promise<JsonObject> {
    if (!this.proc) return Promise.reject(new Error("DAP adapter is not running"));
    const seq = this.nextSeq++;
    const message: JsonObject = { seq, type: "request", command, arguments: args };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      this.proc?.stdin.write(encodeDapMessage(message));
    });
  }

  waitForAny(events: string[], timeoutMs: number): Promise<JsonObject | null> {
    const existing = this.events.find((message) => events.includes(asOptionalString(message.event) || ""));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== resolve);
        resolve(null);
      }, timeoutMs);
      this.waiters.push({ events, resolve, timer });
    });
  }

  stderrTail(): string {
    return this.stderr;
  }

  async shutdown(): Promise<void> {
    try {
      await this.request("disconnect", { terminateDebuggee: true, restart: false }, 2000);
    } catch {
      // Best effort; adapters vary in disconnect support.
    }
    if (this.proc && !this.proc.killed) this.proc.kill("SIGTERM");
  }
}
