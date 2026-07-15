import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { asJsonObject, isRecord } from "../guards";
import { resolveProjectControlJsonPath, writeProjectControlJson } from "../infrastructure/project-control-file";
import type { JsonObject } from "../types";
import { reconcileLspConfig, type LspConfig } from "./config-reconciliation";
import { LANGUAGE_RULES, type LanguageRule, type WorkspaceScanResult } from "./language-registry";
import { scanWorkspaceRoots } from "./workspace-root-scanner";

const DEFAULT_LSP_CONFIG = "cadre/lsp.json";

interface LspSetupArgs {
  root: string;
  config: string;
  configPath: string;
  write: boolean;
  json: boolean;
  workspaceRoots: string[];
}

interface CommandAvailability {
  state: "available" | "missing";
  command: string;
  path?: string;
  message?: string;
}

interface Recommendation extends LanguageRule {
  files: number;
  samples: string[];
  available: boolean;
  availability: CommandAvailability;
}

function usage(): void {
  console.log(`Usage: node <cadre-lsp-setup.js> [--root DIR] [--config cadre/lsp.json] [--write] [--json]

Scans the codebase, recommends language servers, detects whether the server
commands are installed, and optionally reconciles Cadre-managed server entries
in cadre/lsp.json while preserving user-owned configuration.`);
}

function parseArgs(argv: string[]): LspSetupArgs {
  const args = {
    root: process.cwd(),
    config: "cadre/lsp.json",
    write: false,
    json: false,
    workspaceRoots: [] as string[],
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
    } else if (arg === "--workspace-root") {
      args.workspaceRoots.push(argv[++i] ?? "");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const root = path.resolve(args.root);
  const configPath = resolveProjectControlJsonPath(root, args.config, DEFAULT_LSP_CONFIG);
  if (!configPath.ok) throw new Error(configPath.error);
  return { ...args, root, config: configPath.relative, configPath: configPath.file };
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

function scanFiles(root: string, additionalRoots: string[] = []): WorkspaceScanResult {
  return scanWorkspaceRoots(root, [
    ...workspaceFolders(root).map((folder) => String(folder.path || "")).filter((folder) => folder !== "."),
    ...additionalRoots,
  ]);
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

function saveConfig(root: string, requested: string, config: LspConfig): void {
  const written = writeProjectControlJson(root, requested, DEFAULT_LSP_CONFIG, config);
  if (!written.ok) throw new Error(written.error);
}

function recommend(root: string, additionalRoots: string[] = []): Recommendation[] {
  const scan = scanFiles(root, additionalRoots);
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

function workspaceFolders(root: string): JsonObject[] {
  const folders: JsonObject[] = [{ name: ".", path: "." }];
  const reposPath = path.join(root, "cadre", "repos.json");
  let repos: JsonObject = {};
  try {
    repos = asJsonObject(JSON.parse(fs.readFileSync(reposPath, "utf8")));
  } catch {
    return folders;
  }
  if (repos.mode !== "polyrepo" || !Array.isArray(repos.repos)) return folders;
  for (const raw of repos.repos) {
    const repo = asJsonObject(raw);
    const declaredPath = typeof repo.submodule_path === "string"
      ? repo.submodule_path
      : typeof repo.path === "string" ? repo.path : null;
    if (repo.enabled === false || typeof repo.name !== "string" || !declaredPath) continue;
    const resolved = path.resolve(root, declaredPath);
    const relative = path.relative(path.resolve(root), resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    folders.push({ name: repo.name, path: relative.split(path.sep).join("/") });
  }
  return folders;
}

function mergeConfig(config: LspConfig, recommendations: Recommendation[], root: string): { config: LspConfig; added: string[]; removed: string[] } {
  return reconcileLspConfig(config, recommendations, workspaceFolders(root));
}

function runCli(): void {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.configPath);
  const recommendations = recommend(args.root, args.workspaceRoots);
  const existingIds = new Set((config.servers ?? []).map(serverKey).filter(Boolean));
  const missingFromConfig = recommendations.filter(
    (rec) => !existingIds.has(rec.id) && !existingIds.has(rec.command)
  );
  const missingCommands = recommendations.filter((rec) => !rec.available);
  const reconciliation = mergeConfig(config, recommendations, args.root);
  let written = false;
  let added: string[] = [];
  let removed: string[] = [];

  if (args.write) {
    saveConfig(args.root, args.config, reconciliation.config);
    written = true;
    added = reconciliation.added;
    removed = reconciliation.removed;
  }

  const result = {
    root: args.root,
    config: args.config,
    recommended: recommendations,
    missingFromConfig: missingFromConfig.map((rec) => rec.id),
    missingCommands: missingCommands.map((rec) => ({
      id: rec.id,
      command: rec.command,
      availability: rec.availability,
      install: rec.install,
    })),
    workspaceFolders: workspaceFolders(args.root),
    written,
    added,
    removed,
    staleManaged: reconciliation.removed,
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
    console.log(`Updated ${args.config}; added: ${added.join(", ") || "none"}; removed stale managed: ${removed.join(", ") || "none"}.`);
  } else if (missingFromConfig.length > 0) {
    console.log("Run with --write to reconcile Cadre-managed server entries in cadre/lsp.json.");
  }
}

export {
  commandAvailability,
  loadConfig,
  mergeConfig,
  parseArgs,
  recommend,
  runCli,
  scanFiles,
};
