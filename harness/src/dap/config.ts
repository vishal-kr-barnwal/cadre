import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { JsonObject, RuntimeArgs } from "../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, isRecord } from "../guards";
import { languageForFile, listWorkspaceFiles } from "../lsp/language-registry";

export interface DapSession {
  adapter: JsonObject;
  configuration: JsonObject;
  request: "launch" | "attach";
  arguments: JsonObject;
  breakpoints: JsonObject[];
  timeoutMs: number;
}

function commandExists(command: string, cwd: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v '${command.replace(/'/g, "'\\''")}'`], { cwd, encoding: "utf8" });
  return result.status === 0;
}

function pythonCommand(root: string): string | null {
  return ["python3", "python"].find((command) => commandExists(command, root)) || null;
}

function pythonDebugpyAvailable(root: string, command: string): boolean {
  const result = spawnSync(command, ["-c", "import debugpy.adapter"], { cwd: root, encoding: "utf8" });
  return result.status === 0;
}

function configPath(root: string, config?: string): string {
  const rel = config || "cadre/dap.json";
  return path.isAbsolute(rel) ? rel : path.join(root, rel);
}

function readConfig(file: string): JsonObject {
  try {
    return asJsonObject(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

function writeConfig(file: string, value: JsonObject): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function scanLanguages(root: string): JsonObject[] {
  const counts = new Map<string, { files: number; samples: string[] }>();
  for (const file of listWorkspaceFiles(root)) {
    const language = languageForFile(file);
    if (!language) continue;
    const entry = counts.get(language) || { files: 0, samples: [] };
    entry.files += 1;
    if (entry.samples.length < 5) entry.samples.push(file);
    counts.set(language, entry);
  }
  return Array.from(counts.entries())
    .map(([language, entry]) => ({ language, files: entry.files, samples: entry.samples }))
    .sort((left, right) => String(left.language).localeCompare(String(right.language)));
}

export function dapRecommendations(root: string): { recommended: JsonObject[]; manual: JsonObject[]; detected: JsonObject[] } {
  const detected = scanLanguages(root);
  const languageSet = new Set(detected.map((entry) => String(entry.language)));
  const recommended: JsonObject[] = [];
  const py = pythonCommand(root);
  if (languageSet.has("python") && py) {
    recommended.push({
      id: "python-debugpy",
      label: "Python debugpy",
      command: py,
      args: ["-m", "debugpy.adapter"],
      languages: ["python"],
      install: "python3 -m pip install debugpy",
      available: pythonDebugpyAvailable(root, py),
    });
  }
  if (languageSet.has("go")) {
    recommended.push({
      id: "go-delve",
      label: "Go Delve",
      command: "dlv",
      args: ["dap"],
      languages: ["go"],
      install: "go install github.com/go-delve/delve/cmd/dlv@latest",
      available: commandExists("dlv", root),
    });
  }
  const covered = new Set(recommended.flatMap((entry) => asStringArray(entry.languages)));
  const manual = detected
    .filter((entry) => !covered.has(String(entry.language)))
    .map((entry) => ({
      ...entry,
      requires_manual_adapter: true,
      note: "Add an adapter entry to cadre/dap.json for this language.",
    }));
  return { recommended, manual, detected };
}

function adapterKey(adapter: JsonObject): string {
  return asOptionalString(adapter.id) || asOptionalString(adapter.command) || "";
}

export function dapSetup(root: string, args: RuntimeArgs = {}): JsonObject {
  const file = configPath(root, args.config);
  const existing = readConfig(file);
  const adapters = Array.isArray(existing.adapters) ? existing.adapters.map(asJsonObject) : [];
  const configurations = Array.isArray(existing.configurations) ? existing.configurations.map(asJsonObject) : [];
  const { recommended, manual, detected } = dapRecommendations(root);
  const existingKeys = new Set(adapters.map(adapterKey).filter(Boolean));
  const missingFromConfig = recommended.filter((adapter) => !existingKeys.has(adapterKey(adapter)));
  const added = args.execute === true ? missingFromConfig : [];
  if (args.execute === true) {
    writeConfig(file, {
      version: 1,
      schema: "cadre.dap.v1",
      ...existing,
      adapters: [...adapters, ...added],
      configurations,
    });
  }
  return {
    ok: true,
    root,
    config: path.relative(root, file),
    execute: args.execute === true,
    dry_run: args.execute !== true,
    recommended,
    manual,
    detected,
    missingFromConfig: missingFromConfig.map((entry) => adapterKey(entry)),
    written: args.execute === true,
    added: added.map((entry) => adapterKey(entry)),
  };
}

export function dapStatus(root: string, args: RuntimeArgs = {}): JsonObject {
  const file = configPath(root, args.config);
  const config = readConfig(file);
  const adapters = Array.isArray(config.adapters) ? config.adapters.map(asJsonObject) : [];
  const configurations = Array.isArray(config.configurations) ? config.configurations.map(asJsonObject) : [];
  const { recommended, manual, detected } = dapRecommendations(root);
  const summarizedAdapters = adapters.map((adapter) => {
    const command = asOptionalString(adapter.command);
    return {
      id: asOptionalString(adapter.id) || command || "unknown",
      label: asOptionalString(adapter.label) || null,
      command: command || null,
      languages: asStringArray(adapter.languages),
      available: command ? commandExists(command, root) : false,
    };
  });
  return {
    ok: true,
    configured: Object.keys(config).length > 0,
    path: path.relative(root, file),
    adapters: summarizedAdapters,
    configurations: configurations.map((entry) => ({
      id: asOptionalString(entry.id) || "unknown",
      adapterId: asOptionalString(entry.adapterId) || asOptionalString(entry.adapter_id) || null,
      request: asOptionalString(entry.request) || null,
      name: asOptionalString(entry.name) || null,
    })),
    missing: summarizedAdapters.filter((entry) => entry.available !== true).map((entry) => entry.id),
    detected,
    recommended,
    manual,
    setup_packet: "cadre_intel action dap_setup",
    snapshot_packet: "cadre_intel action dap_snapshot",
  };
}

function substitute(value: unknown, tokens: Record<string, string>): unknown {
  if (typeof value === "string") {
    return Object.entries(tokens).reduce((text, [token, replacement]) => text.split(token).join(replacement), value);
  }
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, tokens));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry, tokens)]));
}

function normalizeBreakpoints(root: string, raw: unknown): JsonObject[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(asJsonObject).flatMap((entry) => {
    const file = asOptionalString(entry.file) || asOptionalString(entry.path);
    const line = asNumber(entry.line);
    if (!file || line < 1) return [];
    const abs = path.isAbsolute(file) ? file : path.join(root, file);
    return [{
      ...entry,
      file: path.relative(root, abs).split(path.sep).join("/"),
      line,
    }];
  });
}

export function normalizeDapSession(root: string, args: RuntimeArgs = {}): DapSession | { ok: false; error: string } {
  const file = configPath(root, args.config);
  const loaded = readConfig(file);
  const inlineConfiguration = asJsonObject(args.configuration);
  const configurationId = asOptionalString(args.configurationId || args.configuration_id || args.id);
  const configurations = Array.isArray(loaded.configurations) ? loaded.configurations.map(asJsonObject) : [];
  const configuration = Object.keys(inlineConfiguration).length > 0
    ? inlineConfiguration
    : configurations.find((entry) => asOptionalString(entry.id) === configurationId) || configurations[0] || {};
  if (Object.keys(configuration).length === 0) return { ok: false, error: "DAP configuration is required" };
  const adapters = Array.isArray(loaded.adapters) ? loaded.adapters.map(asJsonObject) : [];
  const adapterId = asOptionalString(configuration.adapterId) || asOptionalString(configuration.adapter_id);
  const inlineAdapter = asJsonObject(configuration.adapter);
  const adapter = Object.keys(inlineAdapter).length > 0
    ? inlineAdapter
    : adapters.find((entry) => asOptionalString(entry.id) === adapterId) || {};
  const command = asOptionalString(adapter.command);
  if (!command) return { ok: false, error: "DAP adapter command is required" };
  const request = asOptionalString(configuration.request);
  if (request !== "launch" && request !== "attach") return { ok: false, error: "DAP configuration request must be launch or attach" };
  const tokens = {
    "${workspaceFolder}": root,
    "${root}": root,
    "${cwd}": root,
    "${testCommand}": asOptionalString(args.testCommand || args.test_command) || "",
  };
  return {
    adapter: substitute(adapter, tokens) as JsonObject,
    configuration: substitute(configuration, tokens) as JsonObject,
    request,
    arguments: substitute(configuration.arguments || configuration.args || {}, tokens) as JsonObject,
    breakpoints: normalizeBreakpoints(root, args.breakpoints || configuration.breakpoints),
    timeoutMs: Math.max(1000, Math.min(10 * 60 * 1000, asNumber(args.timeoutMs, 120000))),
  };
}

export function redactDapValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDapValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const sensitive = /token|password|secret|credential|apikey|api_key|authorization/i.test(key);
    return [key, sensitive ? "<redacted>" : redactDapValue(entry)];
  }));
}
