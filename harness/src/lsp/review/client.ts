import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "../../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "../../guards";
import { isIgnoredFile, normalizeRel, shouldIgnore } from "../ignore-policy";

import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS } from "./constants";
import { languageId } from "./language-ids";
import { LspDiagnostic, LspPosition, LspServerConfig, PendingRequest } from "./types";
import { positiveInt, withTimeout } from "./utils";

export class LspClient {
  root: string;
  server: LspServerConfig;
  requestTimeoutMs: number;
  nextId: number;
  pending: Map<number, PendingRequest>;
  buffer: Buffer;
  opened: Map<string, number>;
  publishedDiagnostics: Map<string, LspDiagnostic[]>;
  proc: ChildProcessWithoutNullStreams | null = null;

  constructor(root: string, server: LspServerConfig) {
    this.root = root;
    this.server = server;
    this.requestTimeoutMs = positiveInt(server.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.opened = new Map();
    this.publishedDiagnostics = new Map();
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      this.proc = spawn(this.server.command, this.server.args || [], {
        cwd: this.root,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc.once("spawn", finishResolve);
      this.proc.once("error", (error) => {
        finishReject(new Error(`Unable to start ${this.server.command}: ${errorMessage(error)}`));
      });
      this.proc.stdout.on("data", (chunk: Buffer) => this.read(chunk));
      this.proc.stderr.on("data", () => {});
      this.proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        const message = signal
          ? `LSP server exited with signal ${signal}`
          : `LSP server exited with code ${code}`;
        finishReject(new Error(message));
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error(message));
        }
        this.pending.clear();
      });
    });
  }

  read(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);
      let message: JsonObject;
      try {
        message = asJsonObject(JSON.parse(body));
      } catch {
        continue;
      }
      const messageId = typeof message.id === "number" ? message.id : null;
      if (messageId != null && this.pending.has(messageId)) {
        const pending = this.pending.get(messageId);
        if (!pending) continue;
        this.pending.delete(messageId);
        clearTimeout(pending.timer);
        const error = asJsonObject(message.error);
        if (Object.keys(error).length > 0) pending.reject(new Error(asOptionalString(error.message) || "LSP request failed"));
        else pending.resolve(message.result);
      } else if (message.method === "textDocument/publishDiagnostics") {
        const params = asJsonObject(message.params);
        const uri = asOptionalString(params.uri);
        if (uri) {
          const diagnostics = Array.isArray(params.diagnostics)
            ? params.diagnostics.map((diagnostic) => asJsonObject(diagnostic) as LspDiagnostic)
            : [];
          this.publishedDiagnostics.set(uri, diagnostics);
        }
      }
    }
  }

  write(message: JsonObject): void {
    if (!this.proc) throw new Error("LSP process is not running");
    const body = JSON.stringify(message);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  request(method: string, params: JsonObject | null): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params: JsonObject): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.root).href,
      capabilities: {
        textDocument: {
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          references: {},
        },
        workspace: { workspaceFolders: true },
      },
      workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }],
    });
    this.notify("initialized", {});
  }

  open(file: string): void {
    const abs = path.join(this.root, file);
    const uri = pathToFileURL(abs).href;
    const text = fs.readFileSync(abs, "utf8");
    const version = (this.opened.get(file) || 0) + 1;
    const alreadyOpen = this.opened.has(file);
    this.opened.set(file, version);
    if (alreadyOpen) {
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    } else {
      this.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: languageId(file, this.server),
          version,
          text,
        },
      });
    }
  }

  async documentSymbols(file: string): Promise<unknown> {
    return this.request("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
    });
  }

  async references(file: string, position: LspPosition): Promise<unknown> {
    return this.request("textDocument/references", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
      context: { includeDeclaration: false },
    });
  }

  async definition(file: string, position: LspPosition): Promise<unknown> {
    return this.request("textDocument/definition", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
    });
  }

  async typeDefinition(file: string, position: LspPosition): Promise<unknown> {
    return this.request("textDocument/typeDefinition", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
    });
  }

  async implementation(file: string, position: LspPosition): Promise<unknown> {
    return this.request("textDocument/implementation", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
    });
  }

  diagnostics(file: string): LspDiagnostic[] {
    return this.publishedDiagnostics.get(pathToFileURL(path.join(this.root, file)).href) || [];
  }

  async shutdown(): Promise<void> {
    try {
      await withTimeout(
        this.request("shutdown", null),
        DEFAULT_SHUTDOWN_TIMEOUT_MS,
        `shutdown timed out after ${DEFAULT_SHUTDOWN_TIMEOUT_MS}ms`
      );
      this.notify("exit", {});
    } catch {
      // Best effort.
    }
    if (this.proc && !this.proc.killed) this.proc.kill();
  }
}
