import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { packagePluginMarketplace } from "./package-plugin.js";
import { configureClaudeMcpApproval, configureCodexMcpApproval } from "./permissions.js";

const args = process.argv.slice(2);
const marketplaceName = "cadre";
const pluginId = "cadre@cadre";

function option(name: string, fallback: string | null = null): string | null {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

function run(command: string, commandArgs: string[], capture = false): string {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit"
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error(`${command} is not installed or not available on PATH`);
  }
  if (result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout).trim() : "command failed";
    throw new Error(`${command} ${commandArgs.join(" ")}: ${detail}`);
  }
  return capture ? (result.stdout ?? "") : "";
}

function runJson<T>(command: string, commandArgs: string[]): T {
  return JSON.parse(run(command, commandArgs, true)) as T;
}

interface MarketplaceEntry {
  name?: string;
  root?: string;
  path?: string;
  installLocation?: string;
  marketplaceSource?: { source?: string };
}

interface InstalledEntry {
  pluginId?: string;
  id?: string;
  installed?: boolean;
  enabled?: boolean;
  scope?: string;
}

function marketplacePath(entry: MarketplaceEntry): string | null {
  return entry.root ?? entry.path ?? entry.installLocation ?? entry.marketplaceSource?.source ?? null;
}

function codexMarketplaces(): MarketplaceEntry[] {
  return runJson<{ marketplaces?: MarketplaceEntry[] }>("codex", ["plugin", "marketplace", "list", "--json"]).marketplaces ?? [];
}

function claudeMarketplaces(): MarketplaceEntry[] {
  return runJson<MarketplaceEntry[]>("claude", ["plugin", "marketplace", "list", "--json"]);
}

function replaceMarketplaceIfNeeded(
  command: "codex" | "claude",
  existing: MarketplaceEntry | undefined,
  targetRoot: string,
  allowReplacement: boolean
): boolean {
  if (!existing) return false;
  const currentPath = marketplacePath(existing);
  if (currentPath && resolve(currentPath) === targetRoot) return true;
  if (!allowReplacement) {
    throw new Error(
      `${command} already has a ${marketplaceName} marketplace at ${currentPath ?? "an unknown path"}; `
      + "review it and rerun with --replace-marketplace"
    );
  }
  if (command === "codex") run("codex", ["plugin", "marketplace", "remove", marketplaceName]);
  else run("claude", ["plugin", "marketplace", "remove", marketplaceName]);
  return false;
}

function installCodex(targetRoot: string, allowReplacement: boolean, autoApproveMcp: boolean): void {
  const existing = codexMarketplaces().find((entry) => entry.name === marketplaceName);
  const retained = replaceMarketplaceIfNeeded("codex", existing, targetRoot, allowReplacement);
  if (!retained) run("codex", ["plugin", "marketplace", "add", targetRoot]);
  run("codex", ["plugin", "add", pluginId]);
  const installed = runJson<{ installed?: InstalledEntry[] }>("codex", ["plugin", "list", "--json"]).installed ?? [];
  if (!installed.some((entry) => entry.pluginId === pluginId && entry.installed && entry.enabled)) {
    throw new Error(`Codex did not report ${pluginId} as installed and enabled`);
  }
  if (autoApproveMcp) {
    const codexRoot = process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex");
    const update = configureCodexMcpApproval(join(codexRoot, "config.toml"));
    process.stdout.write(`${update.changed ? "Added" : "Retained"} Codex Cadre MCP approval in ${update.path}\n`);
  }
}

function installClaude(targetRoot: string, allowReplacement: boolean, autoApproveMcp: boolean): void {
  const existing = claudeMarketplaces().find((entry) => entry.name === marketplaceName);
  const retained = replaceMarketplaceIfNeeded("claude", existing, targetRoot, allowReplacement);
  if (!retained) run("claude", ["plugin", "marketplace", "add", targetRoot, "--scope", "user"]);
  else run("claude", ["plugin", "marketplace", "update", marketplaceName]);
  const installed = runJson<InstalledEntry[]>("claude", ["plugin", "list", "--json"]);
  if (installed.some((entry) => entry.id === pluginId && entry.scope === "user")) {
    run("claude", ["plugin", "update", pluginId, "--scope", "user"]);
  } else {
    run("claude", ["plugin", "install", pluginId, "--scope", "user"]);
  }
  const verified = runJson<InstalledEntry[]>("claude", ["plugin", "list", "--json"]);
  if (!verified.some((entry) => entry.id === pluginId && entry.scope === "user" && entry.enabled)) {
    throw new Error(`Claude did not report ${pluginId} as installed and enabled`);
  }
  if (autoApproveMcp) {
    const update = configureClaudeMcpApproval(join(homedir(), ".claude", "settings.json"));
    process.stdout.write(`${update.changed ? "Added" : "Retained"} Claude Cadre MCP approval in ${update.path}\n`);
  }
}

function assertSafeTarget(targetRoot: string): void {
  if (targetRoot === parse(targetRoot).root || targetRoot === resolve(homedir())) {
    throw new Error(`refusing to use broad marketplace root ${targetRoot}`);
  }
  if (basename(targetRoot) !== "cadre") {
    throw new Error("marketplace root must end in a directory named cadre");
  }
}

function prepareMarketplace(targetRoot: string, cachebuster: string | null): {
  targetRoot: string;
  backupRoot: string | null;
  cachebuster: string;
} {
  const parent = dirname(targetRoot);
  mkdirSync(parent, { recursive: true });
  const stagingRoot = mkdtempSync(join(parent, ".cadre-staging-"));
  const packaged = packagePluginMarketplace(stagingRoot, cachebuster ?? undefined);
  let backupRoot = null;
  if (existsSync(targetRoot)) {
    const codexCatalog = join(targetRoot, ".agents", "plugins", "marketplace.json");
    const claudeCatalog = join(targetRoot, ".claude-plugin", "marketplace.json");
    const owned = [codexCatalog, claudeCatalog].every((path) => {
      if (!existsSync(path)) return false;
      return JSON.parse(readFileSync(path, "utf8")).name === marketplaceName;
    });
    if (!owned) throw new Error(`${targetRoot} exists but is not a Cadre dual-product marketplace`);
    backupRoot = `${targetRoot}.backup-${Date.now()}`;
    renameSync(targetRoot, backupRoot);
  }
  renameSync(packaged.targetRoot, targetRoot);
  return { targetRoot, backupRoot, cachebuster: packaged.cachebuster };
}

try {
  const agent = option("--agent", "all")!;
  if (!["all", "codex", "claude"].includes(agent)) {
    throw new Error("--agent must be all, codex, or claude");
  }
  const targetRoot = resolve(option("--marketplace-root", join(homedir(), ".cadre", "marketplaces", "cadre"))!);
  assertSafeTarget(targetRoot);
  const prepared = prepareMarketplace(targetRoot, option("--cachebuster"));
  process.stdout.write(`Prepared Cadre plugin marketplace at ${prepared.targetRoot}\n`);
  if (prepared.backupRoot) process.stdout.write(`Previous marketplace retained at ${prepared.backupRoot}\n`);
  if (!args.includes("--prepare-only")) {
    const allowReplacement = args.includes("--replace-marketplace");
    const autoApproveMcp = !args.includes("--prompt-mcp-tools");
    if (agent === "all" || agent === "codex") installCodex(targetRoot, allowReplacement, autoApproveMcp);
    if (agent === "all" || agent === "claude") installClaude(targetRoot, allowReplacement, autoApproveMcp);
    process.stdout.write(`Installed ${pluginId} for ${agent === "all" ? "Codex and Claude" : agent}.\n`);
    process.stdout.write("Start a new Codex conversation and run /reload-plugins in Claude Code.\n");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
