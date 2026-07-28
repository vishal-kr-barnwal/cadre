import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { defaultMarketplaceRoot, marketplaceFromHome, optionValue, parseClient, type ClientSelection } from "./cli-options.js";
import { CLIENTS, commandExists, runCommand, runJson, type ClientName } from "./native-clients.js";
import { packagePluginMarketplace } from "./package-plugin.js";
import { configureClaudeMcpApproval, configureCodexMcpApproval } from "./permissions.js";

const marketplaceName = "cadre";
const pluginId = "cadre@cadre";

interface InstallOptions {
  selection: ClientSelection;
  marketplaceRoot: string;
  cachebuster: string | null;
  replaceMarketplace: boolean;
  promptMcpTools: boolean;
  prepareOnly: boolean;
  dryRun: boolean;
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

function parseInstallOptions(args: string[]): InstallOptions {
  const options: InstallOptions = {
    selection: "auto",
    marketplaceRoot: defaultMarketplaceRoot(),
    cachebuster: null,
    replaceMarketplace: false,
    promptMcpTools: false,
    prepareOnly: false,
    dryRun: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--agent" || arg === "--target") {
      options.selection = parseClient(optionValue(args, index, arg));
      index += 1;
    } else if (arg === "--marketplace-root") {
      options.marketplaceRoot = resolve(optionValue(args, index, arg));
      index += 1;
    } else if (arg === "--home") {
      options.marketplaceRoot = marketplaceFromHome(optionValue(args, index, arg));
      index += 1;
    } else if (arg === "--cachebuster") {
      options.cachebuster = optionValue(args, index, arg);
      index += 1;
    } else if (arg === "--scope") {
      if (optionValue(args, index, arg) !== "user") throw new Error("Cadre plugin installation supports only --scope user");
      index += 1;
    } else if (arg === "--replace-marketplace" || arg === "--force") options.replaceMarketplace = true;
    else if (arg === "--prompt-mcp-tools") options.promptMcpTools = true;
    else if (arg === "--prepare-only") options.prepareOnly = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") continue;
    else throw new Error(`Unknown install option: ${arg}`);
  }
  return options;
}

function selectedClients(selection: ClientSelection): ClientName[] {
  if (selection === "all") return [...CLIENTS];
  if (selection !== "auto") return [selection];
  return CLIENTS.filter(commandExists);
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
  client: ClientName,
  existing: MarketplaceEntry | undefined,
  targetRoot: string,
  allowReplacement: boolean
): boolean {
  if (!existing) return false;
  const currentPath = marketplacePath(existing);
  if (currentPath && resolve(currentPath) === targetRoot) return true;
  if (!allowReplacement) {
    throw new Error(
      `${client} already has a ${marketplaceName} marketplace at ${currentPath ?? "an unknown path"}; `
      + "review it and rerun with --replace-marketplace"
    );
  }
  if (client === "codex") runCommand("codex", ["plugin", "marketplace", "remove", marketplaceName]);
  else runCommand("claude", ["plugin", "marketplace", "remove", marketplaceName]);
  return false;
}

function installCodex(targetRoot: string, allowReplacement: boolean, autoApproveMcp: boolean): void {
  const existing = codexMarketplaces().find((entry) => entry.name === marketplaceName);
  const retained = replaceMarketplaceIfNeeded("codex", existing, targetRoot, allowReplacement);
  if (!retained) runCommand("codex", ["plugin", "marketplace", "add", targetRoot]);
  runCommand("codex", ["plugin", "add", pluginId]);
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
  if (!retained) runCommand("claude", ["plugin", "marketplace", "add", targetRoot, "--scope", "user"]);
  else runCommand("claude", ["plugin", "marketplace", "update", marketplaceName]);
  const installed = runJson<InstalledEntry[]>("claude", ["plugin", "list", "--json"]);
  if (installed.some((entry) => entry.id === pluginId && entry.scope === "user")) {
    runCommand("claude", ["plugin", "update", pluginId, "--scope", "user"]);
  } else {
    runCommand("claude", ["plugin", "install", pluginId, "--scope", "user"]);
  }
  const verified = runJson<InstalledEntry[]>("claude", ["plugin", "list", "--json"]);
  if (!verified.some((entry) => entry.id === pluginId && entry.scope === "user" && entry.enabled)) {
    throw new Error(`Claude did not report ${pluginId} as installed and enabled`);
  }
  if (autoApproveMcp) {
    const claudeRoot = process.env.CLAUDE_HOME ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
    const update = configureClaudeMcpApproval(join(resolve(claudeRoot), "settings.json"));
    process.stdout.write(`${update.changed ? "Added" : "Retained"} Claude Cadre MCP approval in ${update.path}\n`);
  }
}

function assertSafeTarget(targetRoot: string): void {
  if (targetRoot === parse(targetRoot).root || targetRoot === resolve(homedir())) {
    throw new Error(`refusing to use broad marketplace root ${targetRoot}`);
  }
  if (basename(targetRoot) !== "cadre") throw new Error("marketplace root must end in a directory named cadre");
}

function prepareMarketplace(targetRoot: string, cachebuster: string | null): string | null {
  const parent = dirname(targetRoot);
  mkdirSync(parent, { recursive: true });
  const stagingRoot = mkdtempSync(join(parent, ".cadre-staging-"));
  const packaged = packagePluginMarketplace(stagingRoot, cachebuster ?? undefined);
  let backupRoot = null;
  if (existsSync(targetRoot)) {
    const catalogs = [
      join(targetRoot, ".agents", "plugins", "marketplace.json"),
      join(targetRoot, ".claude-plugin", "marketplace.json")
    ];
    const owned = catalogs.every((path) => (
      existsSync(path) && JSON.parse(readFileSync(path, "utf8")).name === marketplaceName
    ));
    if (!owned) throw new Error(`${targetRoot} exists but is not a Cadre dual-product marketplace`);
    backupRoot = `${targetRoot}.backup-${Date.now()}`;
    renameSync(targetRoot, backupRoot);
  }
  renameSync(packaged.targetRoot, targetRoot);
  return backupRoot;
}

export function runInstall(args: string[]): number {
  const options = parseInstallOptions(args);
  assertSafeTarget(options.marketplaceRoot);
  const clients = selectedClients(options.selection);
  if (!options.prepareOnly && clients.length === 0) {
    throw new Error("No supported client detected. Install Codex or Claude, or pass --target codex|claude|all");
  }
  for (const client of clients) {
    if (!commandExists(client) && !options.prepareOnly && !options.dryRun) {
      throw new Error(`${client} is not installed or not available on PATH`);
    }
  }
  if (options.dryRun) {
    process.stdout.write(`Would prepare Cadre marketplace at ${options.marketplaceRoot}\n`);
    for (const client of clients) process.stdout.write(`Would install ${pluginId} for ${client} at user scope\n`);
    return 0;
  }
  const backupRoot = prepareMarketplace(options.marketplaceRoot, options.cachebuster);
  process.stdout.write(`Prepared Cadre plugin marketplace at ${options.marketplaceRoot}\n`);
  if (backupRoot) process.stdout.write(`Previous marketplace retained at ${backupRoot}\n`);
  if (options.prepareOnly) return 0;
  const autoApproveMcp = !options.promptMcpTools;
  for (const client of clients) {
    if (client === "codex") installCodex(options.marketplaceRoot, options.replaceMarketplace, autoApproveMcp);
    else installClaude(options.marketplaceRoot, options.replaceMarketplace, autoApproveMcp);
  }
  process.stdout.write(`Installed ${pluginId} for ${clients.join(" and ")}.\n`);
  process.stdout.write("Start a new Codex conversation and run /reload-plugins in Claude Code.\n");
  return 0;
}
