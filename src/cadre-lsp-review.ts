#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "./types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "./guards";

const DEFAULT_STARTUP_TIMEOUT_MS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;
const MAX_TEXT_REFERENCE_RESULTS = 50;
const MAX_SCAN_FILE_BYTES = 1024 * 1024;

const DEFAULT_IGNORES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".beads",
  ".worktrees",
  ".agents",
  ".claude",
  ".cache",
  ".codex",
  ".dart_tool",
  ".gradle",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".serverless",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vite",
  ".venv",
  "venv",
  "__pycache__",
  "__generated__",
  "generated",
  "gen",
  "tmp",
  "temp",
  "logs",
  "Pods",
  "DerivedData",
  ".idea",
  ".vscode",
]);

const DEFAULT_IGNORE_PATHS = [
  "plugins/cadre",
  "plugins/cadre-claude",
];

interface CliArgs extends JsonObject {
  base: string;
  head: string;
  config: string;
  json: boolean;
}

interface CommandAvailability extends JsonObject {
  state: "invalid" | "available" | "missing";
  command: string | null;
  path?: string;
  message?: string;
}

interface LspServerConfig extends JsonObject {
  id?: string | undefined;
  command: string;
  args?: string[] | undefined;
  extensions?: string[] | undefined;
  filenames?: string[] | undefined;
  languageIds?: JsonObject | undefined;
  requestTimeoutMs?: number | undefined;
  startupTimeoutMs?: number | undefined;
  diagnosticsDelayMs?: number | undefined;
}

interface ChangedEntry extends JsonObject {
  status: string;
  kind: string;
  path: string;
  oldPath: string | null;
  exists: boolean;
}

interface SymbolCandidate extends JsonObject {
  name: string;
  added: boolean;
  removed: boolean;
  changeType: string;
  changedFile: string;
  oldPath: string | null;
  status: string;
  evidence: JsonObject[];
}

interface LspPosition extends JsonObject {
  line: number;
  character: number;
}

interface LspRange extends JsonObject {
  start: LspPosition;
  end?: LspPosition;
}

interface LspLocation extends JsonObject {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetRange?: LspRange;
  targetSelectionRange?: LspRange;
}

interface RelativeLocation extends JsonObject {
  file: string;
  relativeFile: string;
  line: number;
}

interface LspDiagnostic extends JsonObject {
  severity?: number;
  code?: string | number;
  range?: LspRange;
  message?: string;
}

interface LspSymbol extends JsonObject {
  name: string;
  selectionRange: LspRange;
  children?: LspSymbol[];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface LspClientPool {
  get(root: string, server: LspServerConfig): Promise<{ client: LspClient }>;
  drop(root: string, server: LspServerConfig): Promise<boolean>;
}

interface RunReviewOptions {
  base?: string | undefined;
  head?: string | undefined;
  config?: string | undefined;
  root?: string | undefined;
  clientPool?: LspClientPool | null | undefined;
}

interface ServerReport extends JsonObject {
  id: string;
  command: string | null;
  availability: CommandAvailability;
  files: JsonObject[];
  candidates: JsonObject[];
  skipped: boolean;
  warm?: boolean;
  diagnostics?: JsonObject[];
  symbolEvidence?: JsonObject[];
}

function usage(): void {
  console.log(`Usage: node <cadre-lsp-review.js> [--base main] [--head HEAD] [--config cadre/lsp.json] [--json]

Runs a best-effort LSP reference scan for changed/removed symbols. If no
cadre/lsp.json exists, exits successfully with available=false.

Example cadre/lsp.json:
{
  "servers": [
    {
      "id": "typescript",
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    },
    {
      "id": "python",
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "extensions": [".py", ".pyi"]
    }
  ]
}`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    base: "main",
    head: "HEAD",
    config: "cadre/lsp.json",
    json: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--base" || arg === "--head" || arg === "--config") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === "--base") args.base = value;
      else if (arg === "--head") args.head = value;
      else args.config = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandAvailability(command: unknown): CommandAvailability {
  if (!command || typeof command !== "string") {
    return {
      state: "invalid",
      command: typeof command === "string" ? command : null,
      message: "Server command is missing or invalid",
    };
  }
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    return {
      state: "available",
      command,
      path: result.stdout.trim().split(/\r?\n/)[0] || command,
    };
  }
  return {
    state: "missing",
    command,
    message: (result.stderr || result.stdout || "Command not found on PATH").trim(),
  };
}

function normalizeRel(file: string): string {
  return file.split(path.sep).join("/");
}

function shouldIgnore(root: string, fullPath: string, name: string): boolean {
  if (DEFAULT_IGNORES.has(name)) return true;
  const rel = normalizeRel(path.relative(root, fullPath));
  return DEFAULT_IGNORE_PATHS.some(
    (ignored) => rel === ignored || rel.startsWith(`${ignored}/`)
  );
}

function isIgnoredFile(root: string, file: string): boolean {
  const rel = normalizeRel(file);
  if (rel.split("/").some((part) => DEFAULT_IGNORES.has(part))) return true;
  return DEFAULT_IGNORE_PATHS.some(
    (ignored) => rel === ignored || rel.startsWith(`${ignored}/`)
  );
}

function changedEntries(root: string, base: string, head: string): ChangedEntry[] {
  return runGit(root, ["diff", "--name-status", "--find-renames", `${base}...${head}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      const status = parts[0] || "M";
      const code = status[0] || "M";
      const oldPath = (code === "R" || code === "C" ? parts[1] : null) || null;
      const file = code === "R" || code === "C" ? parts[2] : parts[1];
      const kind = {
        A: "added",
        C: "copied",
        D: "deleted",
        M: "modified",
        R: "renamed",
        T: "type_changed",
        U: "unmerged",
        X: "unknown",
      }[code] || "modified";
      return {
        status,
        kind,
        path: file || "",
        oldPath,
        exists: file ? fs.existsSync(path.join(root, file)) : false,
      };
    })
    .filter((entry) => Boolean(entry.path) && !isIgnoredFile(root, entry.path));
}

function changedSymbolCandidates(root: string, base: string, head: string, entry: ChangedEntry): SymbolCandidate[] {
  const paths = Array.from(new Set([entry.oldPath, entry.path].filter((item): item is string => typeof item === "string" && item.length > 0)));
  const diff = runGit(root, [
    "diff",
    "--unified=0",
    "--find-renames",
    `${base}...${head}`,
    "--",
    ...paths,
  ]);
  const byName = new Map<string, SymbolCandidate>();
  const patterns = [
    /^[+-]\s*(?:export\s+)?(?:async\s+)?(?:function|def)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:class|interface|type|enum|struct|module|namespace)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
    /^[+-]\s*(?:public|private|protected|internal|static|final|open|override|async|\s)*(?:fun|func)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
    /^[+-]\s*(?:local\s+)?function\s+([A-Za-z_][\w.]*)\b/,
    /^[+-]\s*(?:defp?|defmacro)\s+([A-Za-z_][\w!?]*)\b/,
    /^[+-]\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/,
    /^[+-]\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TYPE)\s+([A-Za-z_][\w."]*)\b/i,
    /^[+-]\s*(?:resource|module|variable|output|data)\s+"?([A-Za-z0-9_.-]+)"?/,
  ];
  for (const line of diff.split(/\r?\n/)) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const direction = line[0] === "-" ? "removed" : "added";
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1];
      if (!name) continue;
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          added: false,
          removed: false,
          changeType: "changed",
          changedFile: entry.path,
          oldPath: entry.oldPath,
          status: entry.kind,
          evidence: [],
        });
      }
      const candidate = byName.get(name);
      if (!candidate) continue;
      if (direction === "removed") candidate.removed = true;
      else candidate.added = true;
      if (candidate.evidence.length < 4) {
        candidate.evidence.push({
          direction,
          text: line.slice(1).trim().slice(0, 160),
        });
      }
    }
  }
  return Array.from(byName.values())
    .map((candidate) => ({
      ...candidate,
      changeType: candidate.removed
        ? (candidate.added ? "changed" : "removed")
        : "added",
    }))
    .filter((candidate) => candidate.changeType !== "added")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function positiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

class LspClient {
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

const DEFAULT_LANGUAGE_IDS: Record<string, string> = {
  ".bash": "shellscript",
  ".c": "c",
  ".cc": "cpp",
  ".clj": "clojure",
  ".cljc": "clojure",
  ".cljs": "clojure",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".cxx": "cpp",
  ".dart": "dart",
  ".edn": "clojure",
  ".elm": "elm",
  ".ex": "elixir",
  ".exs": "elixir",
  ".go": "go",
  ".gql": "graphql",
  ".graphql": "graphql",
  ".h": "c",
  ".hcl": "terraform",
  ".hpp": "cpp",
  ".hs": "haskell",
  ".html": "html",
  ".htm": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "jsonc",
  ".jsx": "javascriptreact",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".less": "less",
  ".lhs": "haskell",
  ".lua": "lua",
  ".m": "objective-c",
  ".md": "markdown",
  ".mdx": "markdown",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".mm": "objective-cpp",
  ".nix": "nix",
  ".php": "php",
  ".prisma": "prisma",
  ".proto": "proto",
  ".py": "python",
  ".pyi": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sass": "sass",
  ".scala": "scala",
  ".sc": "scala",
  ".scss": "scss",
  ".sh": "shellscript",
  ".svelte": "svelte",
  ".swift": "swift",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".vue": "vue",
  ".xml": "xml",
  ".xsd": "xml",
  ".xsl": "xml",
  ".xslt": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zig": "zig",
  ".zsh": "shellscript",
  "containerfile": "dockerfile",
  "dockerfile": "dockerfile",
};

function languageId(file: string, server?: LspServerConfig): string {
  const ext = path.extname(file);
  const basename = path.basename(file).toLowerCase();
  const overrides = server ? asJsonObject(server.languageIds) : {};
  return asOptionalString(overrides[ext])
    || asOptionalString(overrides[basename])
    || DEFAULT_LANGUAGE_IDS[ext]
    || DEFAULT_LANGUAGE_IDS[basename]
    || "plaintext";
}

function flattenSymbols(symbols: unknown, out: LspSymbol[] = []): LspSymbol[] {
  if (!Array.isArray(symbols)) return out;
  for (const symbol of symbols) {
    const candidate = asJsonObject(symbol) as LspSymbol;
    if (candidate.name && candidate.selectionRange) out.push(candidate);
    if (candidate.children) flattenSymbols(candidate.children, out);
  }
  return out;
}

function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serverFileMatch(file: string, server: Pick<LspServerConfig, "extensions" | "filenames">): boolean {
  const extensionSet = new Set(server.extensions || []);
  const filenameSet = new Set((server.filenames || []).map((name) => name.toLowerCase()));
  const ext = path.extname(file);
  const basename = path.basename(file).toLowerCase();
  return extensionSet.has(ext) || filenameSet.has(basename);
}

function scanTextReferences(root: string, symbol: string, changedPathSet: Set<string>, server: Pick<LspServerConfig, "extensions" | "filenames">): RelativeLocation[] {
  const results: RelativeLocation[] = [];
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_$])${escapeRegExp(symbol)}([^A-Za-z0-9_$]|$)`
  );

  function visit(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (shouldIgnore(root, full, entry.name)) continue;
      if (entry.isDirectory()) {
        visit(full);
        if (results.length >= MAX_TEXT_REFERENCE_RESULTS) return;
        continue;
      }
      if (!entry.isFile()) continue;
      if (!serverFileMatch(full, server)) continue;
      if (changedPathSet.has(path.resolve(full))) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_SCAN_FILE_BYTES) continue;
      let text: string;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] || "";
        if (!pattern.test(line)) continue;
        results.push({
          file: full,
          relativeFile: normalizeRel(path.relative(root, full)),
          line: i + 1,
          snippet: line.trim().slice(0, 160),
        });
        if (results.length >= MAX_TEXT_REFERENCE_RESULTS) return;
      }
    }
  }

  visit(root);
  return results;
}

function externalReferenceFinding(server: LspServerConfig, candidate: SymbolCandidate, refs: RelativeLocation[], engine: string): JsonObject {
  const removed = candidate.changeType === "removed";
  return {
    severity: removed ? "blocking" : "warning",
    type: "external_reference",
    code: removed
      ? "external_reference_to_removed_symbol"
      : "external_reference_to_changed_symbol",
    server: server.id || server.command,
    engine,
    symbol: {
      name: candidate.name,
      changeType: candidate.changeType,
      status: candidate.status,
      changedFile: candidate.changedFile,
      oldPath: candidate.oldPath,
    },
    changedFile: candidate.changedFile,
    externalReferences: refs,
    message: `${candidate.name} has references outside the track diff after being ${removed ? "removed" : "changed"}.`,
  };
}

function skipFinding(server: LspServerConfig, code: string, message: string, extra: JsonObject = {}): JsonObject {
  return {
    severity: "info",
    type: "skip",
    code,
    server: server.id || server.command || "unknown",
    message,
    ...(extra || {}),
  };
}

function lspRefToLocation(root: string, ref: unknown): RelativeLocation | null {
  const location = asJsonObject(ref) as LspLocation;
  const uri = location.uri || location.targetUri;
  if (!uri) return null;
  try {
    const file = fileURLToPath(uri);
    const range = location.range || location.targetSelectionRange || location.targetRange;
    return {
      file,
      relativeFile: normalizeRel(path.relative(root, file)),
      line: (range?.start ? range.start.line : 0) + 1,
    };
  } catch {
    return null;
  }
}

function locationsFromResult(root: string, value: unknown): RelativeLocation[] {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  return items
    .map((item) => {
      const object = asJsonObject(item);
      const ref = object.targetUri
        ? { uri: object.targetUri, range: object.targetSelectionRange || object.targetRange }
        : item;
      return lspRefToLocation(root, ref);
    })
    .filter((location): location is RelativeLocation => location !== null)
    .slice(0, 20);
}

async function optionalLocations(client: LspClient, kind: string, file: string, position: LspPosition, root: string): Promise<RelativeLocation[]> {
  try {
    if (kind === "definition") return locationsFromResult(root, await client.definition(file, position));
    if (kind === "typeDefinition") return locationsFromResult(root, await client.typeDefinition(file, position));
    if (kind === "implementation") return locationsFromResult(root, await client.implementation(file, position));
  } catch {
    return [];
  }
  return [];
}

function diagnosticFinding(server: LspServerConfig, file: string, diagnostic: LspDiagnostic): JsonObject {
  const severity = diagnostic.severity === 1 ? "blocking" : "warning";
  return {
    severity,
    type: "diagnostic",
    code: diagnostic.code || "lsp_diagnostic",
    server: server.id || server.command,
    file,
    line: diagnostic.range && diagnostic.range.start ? diagnostic.range.start.line + 1 : null,
    message: diagnostic.message || "LSP diagnostic",
  };
}

function nearbyFileHints(root: string, files: string[]): JsonObject {
  const manifests = new Set<string>();
  const tests = new Set<string>();
  const manifestNames = new Set([
    "package.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
  ]);
  for (const file of files || []) {
    let dir = path.dirname(path.join(root, file));
    while (dir.startsWith(root)) {
      for (const name of manifestNames) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) manifests.add(normalizeRel(path.relative(root, candidate)));
      }
      if (dir === root) break;
      dir = path.dirname(dir);
    }
    const parsed = path.parse(file);
    const candidates = [
      path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
      path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`),
      path.join(parsed.dir, `${parsed.name}_test${parsed.ext}`),
      path.join("test", file),
      path.join("tests", file),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(root, candidate))) tests.add(normalizeRel(candidate));
    }
  }
  return {
    package_manifests: Array.from(manifests).slice(0, 20),
    likely_tests: Array.from(tests).slice(0, 30),
  };
}

async function runReview(options: RunReviewOptions = {}) {
  const args = {
    base: options.base || "main",
    head: options.head || "HEAD",
    config: options.config || "cadre/lsp.json",
  };
  const root = options.root || process.cwd();
  const clientPool = options.clientPool || null;
  const configPath = path.resolve(root, args.config);
  if (!fs.existsSync(configPath)) {
    return {
      available: false,
      reason: `No LSP config found at ${args.config}`,
      changedFiles: [],
      changedEntries: [],
      servers: [],
      findings: [],
    };
  }
  const entries = changedEntries(root, args.base, args.head);
  const files = entries.map((entry) => entry.path);
  const config = asJsonObject(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const servers: LspServerConfig[] = Array.isArray(config.servers)
    ? config.servers
      .map((server) => asJsonObject(server))
      .map((server) => ({
        ...server,
        id: asOptionalString(server.id),
        command: asOptionalString(server.command) || "",
        args: asStringArray(server.args),
        extensions: asStringArray(server.extensions),
        filenames: asStringArray(server.filenames),
        languageIds: asJsonObject(server.languageIds),
        requestTimeoutMs: asNumber(server.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
        startupTimeoutMs: asNumber(server.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS),
        diagnosticsDelayMs: asNumber(server.diagnosticsDelayMs, 250),
      }))
    : [];
  const findings: JsonObject[] = [];
  const serverReports: ServerReport[] = [];
  const changedSet = new Set<string>();
  for (const entry of entries) {
    if (entry.path) changedSet.add(path.resolve(root, entry.path));
    if (entry.oldPath) changedSet.add(path.resolve(root, entry.oldPath));
  }

  for (const server of servers) {
    const serverEntries = entries.filter((entry) => {
      return serverFileMatch(entry.path, server)
        || (entry.oldPath ? serverFileMatch(entry.oldPath, server) : false);
    });
    if (serverEntries.length === 0) continue;
    const availability = commandAvailability(server.command);
    const serverReport: ServerReport = {
      id: server.id || server.command || "unknown",
      command: server.command || null,
      availability,
      files: serverEntries.map((entry) => ({
        path: entry.path,
        oldPath: entry.oldPath,
        status: entry.status,
        kind: entry.kind,
        exists: entry.exists,
      })),
      candidates: [],
      skipped: false,
    };
    serverReports.push(serverReport);
    const allCandidates = new Map<string, SymbolCandidate>();
    for (const entry of serverEntries) {
      for (const candidate of changedSymbolCandidates(root, args.base, args.head, entry)) {
        const key = `${candidate.name}\0${candidate.changedFile}\0${candidate.oldPath || ""}`;
        allCandidates.set(key, candidate);
      }
    }
    serverReport.candidates = Array.from(allCandidates.values()).map((candidate) => ({
      name: candidate.name,
      changeType: candidate.changeType,
      status: candidate.status,
      changedFile: candidate.changedFile,
      oldPath: candidate.oldPath,
    }));
    if (availability.state !== "available") {
      serverReport.skipped = true;
      findings.push(skipFinding(
        server,
        availability.state === "invalid" ? "server_invalid" : "server_missing",
        availability.message || `LSP server command ${server.command} is unavailable`,
        { availability }
      ));
      for (const candidate of allCandidates.values()) {
        if (candidate.changeType !== "removed") continue;
        const refs = scanTextReferences(root, candidate.name, changedSet, server);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
      continue;
    }
    let pooled: { client: LspClient } | null = null;
    let client: LspClient | null = null;
    try {
      pooled = clientPool ? await clientPool.get(root, server) : null;
      client = pooled ? pooled.client : new LspClient(root, server);
      if (!pooled) {
        const startupTimeoutMs = positiveInt(server.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
        await withTimeout(
          client.start(),
          startupTimeoutMs,
          `${server.command} did not spawn within ${startupTimeoutMs}ms`
        );
        await withTimeout(
          client.initialize(),
          startupTimeoutMs,
          `${server.command} did not initialize within ${startupTimeoutMs}ms`
        );
      }
      serverReport.warm = Boolean(pooled);
      const openFiles = Array.from(new Set(
        serverEntries
          .filter((entry) => entry.exists)
          .map((entry) => entry.path)
      ));
      for (const file of openFiles) client.open(file);
      await new Promise((resolve) => setTimeout(resolve, positiveInt(server.diagnosticsDelayMs, 250)));
      serverReport.diagnostics = [];
      serverReport.symbolEvidence = [];
      for (const file of openFiles) {
        for (const diagnostic of client.diagnostics(file)) {
          const item = {
            file,
            line: diagnostic.range && diagnostic.range.start ? diagnostic.range.start.line + 1 : null,
            severity: diagnostic.severity || null,
            code: diagnostic.code || null,
            message: diagnostic.message || "",
          };
          serverReport.diagnostics.push(item);
          if (diagnostic.severity === 1 || diagnostic.severity === 2) {
            findings.push(diagnosticFinding(server, file, diagnostic));
          }
        }
      }

      for (const file of openFiles) {
        const candidates = Array.from(allCandidates.values())
          .filter((candidate) => candidate.changedFile === file);
        if (candidates.length === 0) continue;
        const symbols = flattenSymbols(await client.documentSymbols(file));
        for (const candidate of candidates) {
          const symbol = symbols.find((item) => item.name === candidate.name);
          if (!symbol) {
            const refs = scanTextReferences(root, candidate.name, changedSet, server);
            if (refs.length > 0) {
              findings.push(externalReferenceFinding(server, candidate, refs, "text"));
            }
            continue;
          }
          const rawRefs = await client.references(file, symbol.selectionRange.start);
          const refs = Array.isArray(rawRefs) ? rawRefs : [];
          const definitions = await optionalLocations(client, "definition", file, symbol.selectionRange.start, root);
          const typeDefinitions = await optionalLocations(client, "typeDefinition", file, symbol.selectionRange.start, root);
          const implementations = await optionalLocations(client, "implementation", file, symbol.selectionRange.start, root);
          serverReport.symbolEvidence.push({
            symbol: candidate.name,
            file,
            definitions,
            typeDefinitions,
            implementations,
          });
          const externalRefs = refs
            .map((ref) => lspRefToLocation(root, ref))
            .filter((ref): ref is RelativeLocation => ref !== null)
            .filter((ref) => !changedSet.has(path.resolve(ref.file)))
            .filter((ref) => !isIgnoredFile(root, ref.relativeFile));
          if (externalRefs.length > 0) {
            findings.push(externalReferenceFinding(server, candidate, externalRefs, "lsp"));
          }
        }
      }

      for (const candidate of allCandidates.values()) {
        if (candidate.changeType !== "removed") continue;
        if (candidate.changedFile && fs.existsSync(path.join(root, candidate.changedFile))) continue;
        const refs = scanTextReferences(root, candidate.name, changedSet, server);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
    } catch (error) {
      serverReport.skipped = true;
      findings.push(skipFinding(server, "server_unavailable", `LSP scan skipped: ${errorMessage(error)}`));
      if (clientPool && pooled) await clientPool.drop(root, server);
      for (const candidate of allCandidates.values()) {
        if (candidate.changeType !== "removed") continue;
        const refs = scanTextReferences(root, candidate.name, changedSet, server);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
    } finally {
      if (!clientPool && client) await client.shutdown();
    }
  }

  return {
    available: true,
    base: args.base,
    head: args.head,
    config: args.config,
    changedFiles: files,
    changedEntries: entries,
    fileHints: nearbyFileHints(root, files),
    servers: serverReports,
    findings,
  };
}

async function runCli(): Promise<void> {
  const args = parseArgs(process.argv);
  const result = await runReview({ ...args, root: process.cwd() });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.available) {
    console.log(`LSP review helper unavailable: ${asOptionalString(result.reason) || "unknown reason"}`);
  } else if (result.findings.length === 0) {
    console.log("LSP review helper found no external reference risks.");
  } else {
    for (const finding of result.findings) {
      console.log(JSON.stringify(finding));
    }
  }
}

if (["cadre-lsp-review.js", "cadre-lsp-review.ts"].includes(path.basename(process.argv[1] || ""))) {
  runCli().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}

export {
  LspClient,
  commandAvailability,
  runReview,
};
