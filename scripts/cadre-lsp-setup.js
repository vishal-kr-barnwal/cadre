#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

const LANGUAGE_RULES = [
  {
    id: "typescript",
    label: "TypeScript / JavaScript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    command: "typescript-language-server",
    args: ["--stdio"],
    install: "npm install -g typescript-language-server typescript",
  },
  {
    id: "python",
    label: "Python",
    extensions: [".py", ".pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
    install: "npm install -g pyright",
  },
  {
    id: "go",
    label: "Go",
    extensions: [".go"],
    command: "gopls",
    args: [],
    install: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "rust",
    label: "Rust",
    extensions: [".rs"],
    command: "rust-analyzer",
    args: [],
    install: "rustup component add rust-analyzer",
  },
  {
    id: "java",
    label: "Java",
    extensions: [".java"],
    command: "jdtls",
    args: [],
    install: "brew install jdtls  # or install Eclipse JDT LS for your platform",
  },
  {
    id: "kotlin",
    label: "Kotlin",
    extensions: [".kt", ".kts"],
    command: "kotlin-language-server",
    args: [],
    install: "brew install fwcd/kotlin-language-server/kotlin-language-server",
  },
  {
    id: "swift",
    label: "Swift",
    extensions: [".swift"],
    command: "sourcekit-lsp",
    args: [],
    install: "Install Xcode or Swift toolchain; sourcekit-lsp ships with it",
  },
  {
    id: "c-cpp",
    label: "C / C++ / Objective-C",
    extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".m", ".mm"],
    command: "clangd",
    args: [],
    install: "brew install llvm  # or install clangd for your platform",
  },
  {
    id: "csharp",
    label: "C#",
    extensions: [".cs"],
    command: "csharp-ls",
    args: [],
    install: "dotnet tool install --global csharp-ls",
  },
  {
    id: "php",
    label: "PHP",
    extensions: [".php"],
    command: "intelephense",
    args: ["--stdio"],
    install: "npm install -g intelephense",
  },
  {
    id: "ruby",
    label: "Ruby",
    extensions: [".rb"],
    command: "ruby-lsp",
    args: [],
    install: "gem install ruby-lsp",
  },
  {
    id: "dart",
    label: "Dart / Flutter",
    extensions: [".dart"],
    command: "dart",
    args: ["language-server", "--protocol=lsp"],
    install: "Install the Dart or Flutter SDK and ensure `dart` is on PATH",
  },
];

function usage() {
  console.log(`Usage: node <cadre-lsp-setup.js> [--root DIR] [--config cadre/lsp.json] [--write] [--json]

Scans the codebase, recommends language servers, detects whether the server
commands are installed, and optionally appends missing server entries to
cadre/lsp.json.`);
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    config: "cadre/lsp.json",
    write: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--write") {
      args.write = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--root" || arg === "--config") {
      args[arg.slice(2)] = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  args.root = path.resolve(args.root);
  args.configPath = path.resolve(args.root, args.config);
  return args;
}

function commandAvailability(command) {
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
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

function scanFiles(root) {
  const counts = new Map();
  const samples = new Map();

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
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!ext) continue;
      const rel = path.relative(root, full);
      counts.set(ext, (counts.get(ext) || 0) + 1);
      if (!samples.has(ext)) samples.set(ext, []);
      if (samples.get(ext).length < 5) samples.get(ext).push(rel);
    }
  }

  visit(root);
  return { counts, samples };
}

function loadConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (_) {
    return { servers: [] };
  }
}

function saveConfig(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function recommend(root) {
  const scan = scanFiles(root);
  return LANGUAGE_RULES.map((rule) => {
    const files = rule.extensions.reduce(
      (sum, ext) => sum + (scan.counts.get(ext) || 0),
      0
    );
    if (files === 0) return null;
    const sampleFiles = [];
    for (const ext of rule.extensions) {
      sampleFiles.push(...(scan.samples.get(ext) || []));
    }
    const availability = commandAvailability(rule.command);
    return {
      id: rule.id,
      label: rule.label,
      command: rule.command,
      args: rule.args,
      extensions: rule.extensions,
      install: rule.install,
      files,
      samples: sampleFiles.slice(0, 8),
      available: availability.state === "available",
      availability,
    };
  }).filter(Boolean);
}

function mergeConfig(config, recommendations) {
  const next = {
    ...config,
    servers: Array.isArray(config.servers) ? [...config.servers] : [],
  };
  const existing = new Set(next.servers.map((server) => server.id || server.command));
  const added = [];
  for (const rec of recommendations) {
    if (existing.has(rec.id) || existing.has(rec.command)) continue;
    next.servers.push({
      id: rec.id,
      command: rec.command,
      args: rec.args,
      extensions: rec.extensions,
    });
    existing.add(rec.id);
    added.push(rec.id);
  }
  return { config: next, added };
}

function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.configPath);
  const recommendations = recommend(args.root);
  const existingIds = new Set((config.servers || []).map((server) => server.id || server.command));
  const missingFromConfig = recommendations.filter(
    (rec) => !existingIds.has(rec.id) && !existingIds.has(rec.command)
  );
  const missingCommands = recommendations.filter((rec) => !rec.available);
  let written = false;
  let added = [];

  if (args.write) {
    const merged = mergeConfig(config, recommendations);
    saveConfig(args.configPath, merged.config);
    written = true;
    added = merged.added;
  }

  const result = {
    root: args.root,
    config: path.relative(args.root, args.configPath),
    recommended: recommendations,
    missingFromConfig: missingFromConfig.map((rec) => rec.id),
    missingCommands: missingCommands.map((rec) => ({
      id: rec.id,
      command: rec.command,
      availability: rec.availability,
      install: rec.install,
    })),
    written,
    added,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (recommendations.length === 0) {
    console.log("No LSP recommendations found from source file extensions.");
    return;
  }
  console.log("Cadre LSP recommendations:");
  for (const rec of recommendations) {
    const status = rec.available ? "available" : "missing";
    const configured = existingIds.has(rec.id) || existingIds.has(rec.command)
      ? "configured"
      : "not configured";
    console.log(`- ${rec.label}: ${rec.command} (${status}, ${configured}, ${rec.files} files)`);
    if (!rec.available) console.log(`  install: ${rec.install}`);
  }
  if (written) {
    console.log(`Updated ${path.relative(args.root, args.configPath)}; added: ${added.join(", ") || "none"}.`);
  } else if (missingFromConfig.length > 0) {
    console.log("Run with --write to append missing server entries to cadre/lsp.json.");
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
