#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { asJsonObject, asStringArray, isRecord } from "./guards";
import type { JsonObject } from "./types";

interface LspSetupArgs {
  root: string;
  config: string;
  configPath: string;
  write: boolean;
  json: boolean;
}

interface CommandAvailability {
  state: "available" | "missing";
  command: string;
  path?: string;
  message?: string;
}

interface LanguageRule {
  id: string;
  label: string;
  extensions: string[];
  filenames?: string[];
  command: string;
  args: string[];
  install: string;
  languageIds?: Record<string, string>;
}

interface ScanResult {
  counts: Map<string, number>;
  samples: Map<string, string[]>;
  filenameCounts: Map<string, number>;
  filenameSamples: Map<string, string[]>;
}

interface Recommendation extends LanguageRule {
  files: number;
  samples: string[];
  available: boolean;
  availability: CommandAvailability;
}

interface LspConfig extends JsonObject {
  servers?: JsonObject[];
}

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

const LANGUAGE_RULES: LanguageRule[] = [
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
  { id: "go", label: "Go", extensions: [".go"], command: "gopls", args: [], install: "go install golang.org/x/tools/gopls@latest" },
  { id: "rust", label: "Rust", extensions: [".rs"], command: "rust-analyzer", args: [], install: "rustup component add rust-analyzer" },
  { id: "java", label: "Java", extensions: [".java"], command: "jdtls", args: [], install: "brew install jdtls  # or install Eclipse JDT LS for your platform" },
  { id: "kotlin", label: "Kotlin", extensions: [".kt", ".kts"], command: "kotlin-language-server", args: [], install: "brew install fwcd/kotlin-language-server/kotlin-language-server" },
  { id: "swift", label: "Swift", extensions: [".swift"], command: "sourcekit-lsp", args: [], install: "Install Xcode or Swift toolchain; sourcekit-lsp ships with it" },
  { id: "c-cpp", label: "C / C++ / Objective-C", extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".m", ".mm"], command: "clangd", args: [], install: "brew install llvm  # or install clangd for your platform" },
  { id: "csharp", label: "C#", extensions: [".cs"], command: "csharp-ls", args: [], install: "dotnet tool install --global csharp-ls" },
  { id: "php", label: "PHP", extensions: [".php"], command: "intelephense", args: ["--stdio"], install: "npm install -g intelephense" },
  { id: "ruby", label: "Ruby", extensions: [".rb"], command: "ruby-lsp", args: [], install: "gem install ruby-lsp" },
  { id: "dart", label: "Dart / Flutter", extensions: [".dart"], command: "dart", args: ["language-server", "--protocol=lsp"], install: "Install the Dart or Flutter SDK and ensure `dart` is on PATH" },
  { id: "html", label: "HTML", extensions: [".html", ".htm"], command: "vscode-html-language-server", args: ["--stdio"], install: "npm install -g vscode-langservers-extracted" },
  { id: "css", label: "CSS / Sass / Less", extensions: [".css", ".scss", ".sass", ".less"], command: "vscode-css-language-server", args: ["--stdio"], install: "npm install -g vscode-langservers-extracted" },
  { id: "json", label: "JSON", extensions: [".json", ".jsonc"], command: "vscode-json-language-server", args: ["--stdio"], install: "npm install -g vscode-langservers-extracted" },
  { id: "yaml", label: "YAML", extensions: [".yaml", ".yml"], command: "yaml-language-server", args: ["--stdio"], install: "npm install -g yaml-language-server" },
  { id: "markdown", label: "Markdown", extensions: [".md", ".mdx"], command: "marksman", args: ["server"], install: "brew install marksman  # or download Marksman for your platform" },
  { id: "toml", label: "TOML", extensions: [".toml"], command: "taplo", args: ["lsp", "stdio"], install: "cargo install taplo-cli --locked" },
  { id: "lua", label: "Lua", extensions: [".lua"], command: "lua-language-server", args: [], install: "brew install lua-language-server  # or install LuaLS for your platform" },
  { id: "shell", label: "Shell", extensions: [".sh", ".bash", ".zsh", ".ksh"], command: "bash-language-server", args: ["start"], install: "npm install -g bash-language-server" },
  { id: "terraform", label: "Terraform / HCL", extensions: [".tf", ".tfvars", ".hcl"], command: "terraform-ls", args: ["serve"], install: "brew install hashicorp/tap/terraform-ls" },
  { id: "elixir", label: "Elixir", extensions: [".ex", ".exs"], command: "elixir-ls", args: [], install: "Install ElixirLS and ensure `elixir-ls` is on PATH" },
  { id: "scala", label: "Scala", extensions: [".scala", ".sc"], command: "metals", args: [], install: "coursier install metals" },
  { id: "clojure", label: "Clojure", extensions: [".clj", ".cljs", ".cljc", ".edn"], command: "clojure-lsp", args: [], install: "brew install clojure-lsp/brew/clojure-lsp-native" },
  { id: "haskell", label: "Haskell", extensions: [".hs", ".lhs"], command: "haskell-language-server-wrapper", args: ["--lsp"], install: "ghcup install hls" },
  { id: "ocaml", label: "OCaml", extensions: [".ml", ".mli"], command: "ocamllsp", args: [], install: "opam install ocaml-lsp-server" },
  { id: "zig", label: "Zig", extensions: [".zig"], command: "zls", args: [], install: "Install zls and ensure it is on PATH" },
  { id: "nix", label: "Nix", extensions: [".nix"], command: "nil", args: [], install: "nix profile install nixpkgs#nil" },
  { id: "elm", label: "Elm", extensions: [".elm"], command: "elm-language-server", args: ["--stdio"], install: "npm install -g @elm-tooling/elm-language-server" },
  { id: "vue", label: "Vue", extensions: [".vue"], command: "vue-language-server", args: ["--stdio"], install: "npm install -g @vue/language-server" },
  { id: "svelte", label: "Svelte", extensions: [".svelte"], command: "svelteserver", args: ["--stdio"], install: "npm install -g svelte-language-server" },
  { id: "dockerfile", label: "Dockerfile", extensions: [], filenames: ["Dockerfile", "Containerfile"], command: "docker-langserver", args: ["--stdio"], install: "npm install -g dockerfile-language-server-nodejs", languageIds: { Dockerfile: "dockerfile", Containerfile: "dockerfile" } },
  { id: "xml", label: "XML", extensions: [".xml", ".xsd", ".xsl", ".xslt"], command: "lemminx", args: [], install: "Install Eclipse LemMinX and ensure `lemminx` is on PATH" },
  { id: "graphql", label: "GraphQL", extensions: [".graphql", ".gql"], command: "graphql-lsp", args: ["server", "-m", "stream"], install: "npm install -g graphql-language-service-cli" },
  { id: "prisma", label: "Prisma", extensions: [".prisma"], command: "prisma-language-server", args: ["--stdio"], install: "npm install -g @prisma/language-server" },
  { id: "protobuf", label: "Protocol Buffers", extensions: [".proto"], command: "buf", args: ["beta", "lsp", "--timeout=0"], install: "brew install bufbuild/buf/buf" },
];

function usage(): void {
  console.log(`Usage: node <cadre-lsp-setup.js> [--root DIR] [--config cadre/lsp.json] [--write] [--json]

Scans the codebase, recommends language servers, detects whether the server
commands are installed, and optionally appends missing server entries to
cadre/lsp.json.`);
}

function parseArgs(argv: string[]): LspSetupArgs {
  const args = {
    root: process.cwd(),
    config: "cadre/lsp.json",
    write: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--write") {
      args.write = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--root") {
      args.root = argv[++i] ?? args.root;
    } else if (arg === "--config") {
      args.config = argv[++i] ?? args.config;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const root = path.resolve(args.root);
  return { ...args, root, configPath: path.resolve(root, args.config) };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandAvailability(command: string): CommandAvailability {
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

function scanFiles(root: string): ScanResult {
  const counts = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const filenameCounts = new Map<string, number>();
  const filenameSamples = new Map<string, string[]>();

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
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const rel = path.relative(root, full);
      if (ext) {
        counts.set(ext, (counts.get(ext) ?? 0) + 1);
        const extSamples = samples.get(ext) ?? [];
        if (extSamples.length < 5) extSamples.push(rel);
        samples.set(ext, extSamples);
      }
      const filename = entry.name.toLowerCase();
      filenameCounts.set(filename, (filenameCounts.get(filename) ?? 0) + 1);
      const nameSamples = filenameSamples.get(filename) ?? [];
      if (nameSamples.length < 5) nameSamples.push(rel);
      filenameSamples.set(filename, nameSamples);
    }
  }

  visit(root);
  return { counts, samples, filenameCounts, filenameSamples };
}

function normalizeServer(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  return asJsonObject(value);
}

function loadConfig(configPath: string): LspConfig {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const config = asJsonObject(parsed) as LspConfig;
    const servers = Array.isArray(config.servers)
      ? config.servers.map(normalizeServer).filter((server): server is JsonObject => server !== null)
      : [];
    return { ...config, servers };
  } catch {
    return { servers: [] };
  }
}

function saveConfig(configPath: string, config: LspConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function recommend(root: string): Recommendation[] {
  const scan = scanFiles(root);
  return LANGUAGE_RULES.flatMap((rule) => {
    const extensionFiles = rule.extensions.reduce(
      (sum, ext) => sum + (scan.counts.get(ext) ?? 0),
      0
    );
    const filenameFiles = (rule.filenames ?? []).reduce(
      (sum, filename) => sum + (scan.filenameCounts.get(filename.toLowerCase()) ?? 0),
      0
    );
    const files = extensionFiles + filenameFiles;
    if (files === 0) return [];
    const sampleFiles = [
      ...rule.extensions.flatMap((ext) => scan.samples.get(ext) ?? []),
      ...(rule.filenames ?? []).flatMap((filename) => scan.filenameSamples.get(filename.toLowerCase()) ?? []),
    ];
    const availability = commandAvailability(rule.command);
    return [{
      ...rule,
      files,
      samples: sampleFiles.slice(0, 8),
      available: availability.state === "available",
      availability,
    }];
  });
}

function serverKey(server: JsonObject): string {
  const id = typeof server.id === "string" ? server.id : "";
  const command = typeof server.command === "string" ? server.command : "";
  return id || command;
}

function mergeConfig(config: LspConfig, recommendations: Recommendation[]): { config: LspConfig; added: string[] } {
  const servers = Array.isArray(config.servers) ? [...config.servers] : [];
  const next: LspConfig = {
    ...config,
    servers,
  };
  const existing = new Set(servers.map(serverKey).filter(Boolean));
  const added: string[] = [];
  for (const rec of recommendations) {
    if (existing.has(rec.id) || existing.has(rec.command)) continue;
    servers.push({
      id: rec.id,
      command: rec.command,
      args: rec.args,
      extensions: rec.extensions,
      ...(rec.filenames ? { filenames: rec.filenames } : {}),
      ...(rec.languageIds ? { languageIds: rec.languageIds } : {}),
    });
    existing.add(rec.id);
    added.push(rec.id);
  }
  return { config: next, added };
}

function runCli(): void {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.configPath);
  const recommendations = recommend(args.root);
  const existingIds = new Set((config.servers ?? []).map(serverKey).filter(Boolean));
  const missingFromConfig = recommendations.filter(
    (rec) => !existingIds.has(rec.id) && !existingIds.has(rec.command)
  );
  const missingCommands = recommendations.filter((rec) => !rec.available);
  let written = false;
  let added: string[] = [];

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
  runCli();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

export {
  commandAvailability,
  loadConfig,
  mergeConfig,
  parseArgs,
  recommend,
  scanFiles,
};
