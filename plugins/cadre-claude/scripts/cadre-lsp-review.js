#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");

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

function usage() {
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
    }
  ]
}`);
}

function parseArgs(argv) {
  const args = {
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
    } else if (["--base", "--head", "--config"].includes(arg)) {
      args[arg.slice(2)] = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function runGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandAvailability(command) {
  if (!command || typeof command !== "string") {
    return {
      state: "invalid",
      command: command || null,
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

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function shouldIgnore(root, fullPath, name) {
  if (DEFAULT_IGNORES.has(name)) return true;
  const rel = normalizeRel(path.relative(root, fullPath));
  return DEFAULT_IGNORE_PATHS.some(
    (ignored) => rel === ignored || rel.startsWith(`${ignored}/`)
  );
}

function isIgnoredFile(root, file) {
  const rel = normalizeRel(file);
  if (rel.split("/").some((part) => DEFAULT_IGNORES.has(part))) return true;
  return DEFAULT_IGNORE_PATHS.some(
    (ignored) => rel === ignored || rel.startsWith(`${ignored}/`)
  );
}

function changedEntries(root, base, head) {
  return runGit(root, ["diff", "--name-status", "--find-renames", `${base}...${head}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      const status = parts[0];
      const code = status[0];
      const oldPath = code === "R" || code === "C" ? parts[1] : null;
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
        path: file,
        oldPath,
        exists: file ? fs.existsSync(path.join(root, file)) : false,
      };
    })
    .filter((entry) => entry.path && !isIgnoredFile(root, entry.path));
}

function changedSymbolCandidates(root, base, head, entry) {
  const paths = Array.from(new Set([entry.oldPath, entry.path].filter(Boolean)));
  const diff = runGit(root, [
    "diff",
    "--unified=0",
    "--find-renames",
    `${base}...${head}`,
    "--",
    ...paths,
  ]);
  const byName = new Map();
  const patterns = [
    /^[+-]\s*(?:export\s+)?(?:async\s+)?(?:function|def)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:class|interface|type|enum|struct|module|namespace)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
    /^[+-]\s*(?:public|private|protected|internal|static|final|open|override|async|\s)*(?:fun|func)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
  ];
  for (const line of diff.split(/\r?\n/)) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const direction = line[0] === "-" ? "removed" : "added";
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1];
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          added: false,
          removed: false,
          changedFile: entry.path,
          oldPath: entry.oldPath,
          status: entry.kind,
          evidence: [],
        });
      }
      const candidate = byName.get(name);
      candidate[direction] = true;
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

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

class LspClient {
  constructor(root, server) {
    this.root = root;
    this.server = server;
    this.requestTimeoutMs = positiveInt(server.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.opened = new Map();
    this.publishedDiagnostics = new Map();
  }

  start() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      this.proc = spawn(this.server.command, this.server.args || [], {
        cwd: this.root,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc.once("spawn", () => finish(resolve));
      this.proc.once("error", (error) => {
        finish(reject, new Error(`Unable to start ${this.server.command}: ${error.message}`));
      });
      this.proc.stdout.on("data", (chunk) => this.read(chunk));
      this.proc.stderr.on("data", () => {});
      this.proc.on("exit", (code, signal) => {
        const message = signal
          ? `LSP server exited with signal ${signal}`
          : `LSP server exited with code ${code}`;
        finish(reject, new Error(message));
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error(message));
        }
        this.pending.clear();
      });
    });
  }

  read(chunk) {
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
      let message;
      try {
        message = JSON.parse(body);
      } catch (_) {
        continue;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if (message.method === "textDocument/publishDiagnostics" && message.params && message.params.uri) {
        this.publishedDiagnostics.set(message.params.uri, message.params.diagnostics || []);
      }
    }
  }

  write(message) {
    const body = JSON.stringify(message);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  request(method, params) {
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

  notify(method, params) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async initialize() {
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

  open(file) {
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
          languageId: languageId(file),
          version,
          text,
        },
      });
    }
  }

  async documentSymbols(file) {
    return this.request("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
    });
  }

  async references(file, position) {
    return this.request("textDocument/references", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
      context: { includeDeclaration: false },
    });
  }

  async definition(file, position) {
    return this.request("textDocument/definition", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
    });
  }

  async typeDefinition(file, position) {
    return this.request("textDocument/typeDefinition", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
    });
  }

  async implementation(file, position) {
    return this.request("textDocument/implementation", {
      textDocument: { uri: pathToFileURL(path.join(this.root, file)).href },
      position,
    });
  }

  diagnostics(file) {
    return this.publishedDiagnostics.get(pathToFileURL(path.join(this.root, file)).href) || [];
  }

  async shutdown() {
    try {
      await withTimeout(
        this.request("shutdown", null),
        DEFAULT_SHUTDOWN_TIMEOUT_MS,
        `shutdown timed out after ${DEFAULT_SHUTDOWN_TIMEOUT_MS}ms`
      );
      this.notify("exit", {});
    } catch (_) {
      // Best effort.
    }
    if (this.proc && !this.proc.killed) this.proc.kill();
  }
}

function languageId(file) {
  const ext = path.extname(file);
  return {
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
  }[ext] || "plaintext";
}

function flattenSymbols(symbols, out = []) {
  if (!Array.isArray(symbols)) return out;
  for (const symbol of symbols) {
    if (symbol.name && symbol.selectionRange) out.push(symbol);
    if (symbol.children) flattenSymbols(symbol.children, out);
  }
  return out;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanTextReferences(root, symbol, changedPathSet, extensions) {
  const results = [];
  const allowedExtensions = new Set(extensions || []);
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_$])${escapeRegExp(symbol)}([^A-Za-z0-9_$]|$)`
  );

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
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
      const ext = path.extname(entry.name);
      if (allowedExtensions.size > 0 && !allowedExtensions.has(ext)) continue;
      if (changedPathSet.has(path.resolve(full))) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (_) {
        continue;
      }
      if (stat.size > MAX_SCAN_FILE_BYTES) continue;
      let text;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch (_) {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (!pattern.test(lines[i])) continue;
        results.push({
          file: full,
          relativeFile: normalizeRel(path.relative(root, full)),
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160),
        });
        if (results.length >= MAX_TEXT_REFERENCE_RESULTS) return;
      }
    }
  }

  visit(root);
  return results;
}

function externalReferenceFinding(server, candidate, refs, engine) {
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

function skipFinding(server, code, message, extra) {
  return {
    severity: "info",
    type: "skip",
    code,
    server: server.id || server.command || "unknown",
    message,
    ...(extra || {}),
  };
}

function lspRefToLocation(root, ref) {
  try {
    const file = fileURLToPath(ref.uri);
    return {
      file,
      relativeFile: normalizeRel(path.relative(root, file)),
      line: (ref.range && ref.range.start ? ref.range.start.line : 0) + 1,
    };
  } catch (_) {
    return null;
  }
}

function locationsFromResult(root, value) {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  return items
    .map((item) => {
      const ref = item.targetUri
        ? { uri: item.targetUri, range: item.targetSelectionRange || item.targetRange }
        : item;
      return lspRefToLocation(root, ref);
    })
    .filter(Boolean)
    .slice(0, 20);
}

async function optionalLocations(client, kind, file, position, root) {
  try {
    if (kind === "definition") return locationsFromResult(root, await client.definition(file, position));
    if (kind === "typeDefinition") return locationsFromResult(root, await client.typeDefinition(file, position));
    if (kind === "implementation") return locationsFromResult(root, await client.implementation(file, position));
  } catch (_) {
    return [];
  }
  return [];
}

function diagnosticFinding(server, file, diagnostic) {
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

function nearbyFileHints(root, files) {
  const manifests = new Set();
  const tests = new Set();
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

async function runReview(options = {}) {
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
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const servers = Array.isArray(config.servers) ? config.servers : [];
  const findings = [];
  const serverReports = [];
  const changedSet = new Set();
  for (const entry of entries) {
    if (entry.path) changedSet.add(path.resolve(root, entry.path));
    if (entry.oldPath) changedSet.add(path.resolve(root, entry.oldPath));
  }

  for (const server of servers) {
    const extensions = new Set(server.extensions || []);
    const serverEntries = entries.filter((entry) => {
      const currentExt = path.extname(entry.path || "");
      const oldExt = path.extname(entry.oldPath || "");
      return extensions.has(currentExt) || extensions.has(oldExt);
    });
    if (serverEntries.length === 0) continue;
    const availability = commandAvailability(server.command);
    const serverReport = {
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
    const allCandidates = new Map();
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
        const refs = scanTextReferences(root, candidate.name, changedSet, server.extensions);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
      continue;
    }
    let pooled = null;
    let client = null;
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
            const refs = scanTextReferences(root, candidate.name, changedSet, server.extensions);
            if (refs.length > 0) {
              findings.push(externalReferenceFinding(server, candidate, refs, "text"));
            }
            continue;
          }
          const refs = (await client.references(file, symbol.selectionRange.start)) || [];
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
            .filter(Boolean)
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
        const refs = scanTextReferences(root, candidate.name, changedSet, server.extensions);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
    } catch (error) {
      serverReport.skipped = true;
      findings.push(skipFinding(server, "server_unavailable", `LSP scan skipped: ${error.message}`));
      if (clientPool && pooled) await clientPool.drop(root, server);
      for (const candidate of allCandidates.values()) {
        if (candidate.changeType !== "removed") continue;
        const refs = scanTextReferences(root, candidate.name, changedSet, server.extensions);
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

async function runCli() {
  const args = parseArgs(process.argv);
  const result = await runReview({ ...args, root: process.cwd() });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.available) {
    console.log(`LSP review helper unavailable: ${result.reason}`);
  } else if (result.findings.length === 0) {
    console.log("LSP review helper found no external reference risks.");
  } else {
    for (const finding of result.findings) {
      console.log(JSON.stringify(finding));
    }
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  LspClient,
  commandAvailability,
  runReview,
};
