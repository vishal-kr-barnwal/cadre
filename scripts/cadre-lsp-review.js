#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");

function usage() {
  console.log(`Usage: node scripts/cadre-lsp-review.js [--base main] [--head HEAD] [--config cadre/lsp.json] [--json]

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

function changedFiles(root, base, head) {
  return runGit(root, ["diff", "--name-only", `${base}...${head}`])
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(root, file)));
}

function changedSymbolCandidates(root, base, head, file) {
  const diff = runGit(root, ["diff", "--unified=0", `${base}...${head}`, "--", file]);
  const symbols = new Set();
  const patterns = [
    /^[+-]\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)\b/,
    /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
    /^[+-]\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
  ];
  for (const line of diff.split(/\r?\n/)) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) symbols.add(match[1]);
    }
  }
  return Array.from(symbols).sort();
}

class LspClient {
  constructor(root, server) {
    this.root = root;
    this.server = server;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
  }

  start() {
    this.proc = spawn(this.server.command, this.server.args || [], {
      cwd: this.root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (chunk) => this.read(chunk));
    this.proc.stderr.on("data", () => {});
    this.proc.on("exit", () => {
      for (const { reject } of this.pending.values()) reject(new Error("LSP server exited"));
      this.pending.clear();
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
      const message = JSON.parse(body);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    }
  }

  write(message) {
    const body = JSON.stringify(message);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  request(method, params) {
    const id = this.nextId++;
    this.write({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(abs).href,
        languageId: languageId(file),
        version: 1,
        text: fs.readFileSync(abs, "utf8"),
      },
    });
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

  async shutdown() {
    try {
      await this.request("shutdown", null);
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

async function run() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const configPath = path.resolve(root, args.config);
  if (!fs.existsSync(configPath)) {
    return {
      available: false,
      reason: `No LSP config found at ${args.config}`,
      changedFiles: [],
      findings: [],
    };
  }
  const files = changedFiles(root, args.base, args.head);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const servers = Array.isArray(config.servers) ? config.servers : [];
  const findings = [];
  const changedSet = new Set(files.map((file) => path.resolve(root, file)));

  for (const server of servers) {
    const extensions = new Set(server.extensions || []);
    const serverFiles = files.filter((file) => extensions.has(path.extname(file)));
    if (serverFiles.length === 0) continue;
    const client = new LspClient(root, server);
    try {
      client.start();
      await client.initialize();
      for (const file of serverFiles) client.open(file);

      for (const file of serverFiles) {
        const candidates = changedSymbolCandidates(root, args.base, args.head, file);
        if (candidates.length === 0) continue;
        const symbols = flattenSymbols(await client.documentSymbols(file));
        for (const name of candidates) {
          const symbol = symbols.find((item) => item.name === name);
          if (!symbol) continue;
          const refs = (await client.references(file, symbol.selectionRange.start)) || [];
          const externalRefs = refs
            .map((ref) => ({
              file: fileURLToPath(ref.uri),
              line: (ref.range && ref.range.start ? ref.range.start.line : 0) + 1,
            }))
            .filter((ref) => !changedSet.has(path.resolve(ref.file)));
          if (externalRefs.length > 0) {
            findings.push({
              severity: "warning",
              server: server.id || server.command,
              symbol: name,
              changedFile: file,
              externalReferences: externalRefs,
            });
          }
        }
      }
    } catch (error) {
      findings.push({
        severity: "info",
        server: server.id || server.command,
        message: `LSP scan skipped: ${error.message}`,
      });
    } finally {
      await client.shutdown();
    }
  }

  return {
    available: true,
    changedFiles: files,
    findings,
  };
}

run()
  .then((result) => {
    if (process.argv.includes("--json")) {
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
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
