import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defaultMarketplaceRoot, marketplaceFromHome, optionValue, parseClient, type ClientSelection } from "./cli-options.js";
import { CLIENTS, commandExists, runCommand, type ClientName } from "./native-clients.js";

const marketplaceName = "cadre";
const pluginId = "cadre@cadre";

interface UninstallOptions {
  selection: ClientSelection;
  marketplaceRoot: string;
  dryRun: boolean;
}

function parseUninstallOptions(args: string[]): UninstallOptions {
  const options: UninstallOptions = {
    selection: "all",
    marketplaceRoot: defaultMarketplaceRoot(),
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
    } else if (arg === "--scope") {
      if (optionValue(args, index, arg) !== "user") throw new Error("Cadre plugin uninstall supports only --scope user");
      index += 1;
    } else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") continue;
    else throw new Error(`Unknown uninstall option: ${arg}`);
  }
  return options;
}

function selectedClients(selection: ClientSelection): ClientName[] {
  if (selection === "all") return [...CLIENTS];
  if (selection === "auto") return CLIENTS.filter(commandExists);
  return [selection];
}

function ownedMarketplace(root: string): boolean {
  if (!existsSync(root)) return false;
  const catalogs = [
    join(root, ".agents", "plugins", "marketplace.json"),
    join(root, ".claude-plugin", "marketplace.json")
  ];
  return catalogs.every((path) => {
    if (!existsSync(path)) return false;
    try {
      return JSON.parse(readFileSync(path, "utf8")).name === marketplaceName;
    } catch {
      return false;
    }
  });
}

function uninstallClient(client: ClientName): void {
  if (client === "codex") {
    runCommand("codex", ["plugin", "remove", pluginId, "--json"]);
    runCommand("codex", ["plugin", "marketplace", "remove", marketplaceName]);
  } else {
    runCommand("claude", ["plugin", "uninstall", "--scope", "user", "--yes", pluginId]);
    runCommand("claude", ["plugin", "marketplace", "remove", "--scope", "user", marketplaceName]);
  }
}

function removeOwnedMarketplaces(root: string): string[] {
  const removed: string[] = [];
  const candidates = [root];
  const parent = dirname(root);
  const prefix = `${basename(root)}.backup-`;
  if (existsSync(parent)) {
    for (const entry of readdirSync(parent)) {
      if (entry.startsWith(prefix)) candidates.push(join(parent, entry));
    }
  }
  for (const candidate of candidates) {
    if (!ownedMarketplace(candidate)) continue;
    rmSync(candidate, { recursive: true, force: true });
    removed.push(candidate);
  }
  return removed;
}

export function runUninstall(args: string[]): number {
  const options = parseUninstallOptions(args);
  const clients = selectedClients(options.selection);
  if (options.dryRun) {
    for (const client of clients) process.stdout.write(`Would uninstall ${pluginId} from ${client} at user scope\n`);
    if (options.selection === "all") process.stdout.write(`Would remove owned marketplace: ${options.marketplaceRoot}\n`);
    return 0;
  }
  let failed = false;
  for (const client of clients) {
    if (!commandExists(client)) {
      process.stderr.write(`${client} is not available; continuing local cleanup.\n`);
      continue;
    }
    try {
      uninstallClient(client);
      process.stdout.write(`Uninstalled ${pluginId} from ${client}.\n`);
    } catch (error) {
      failed = true;
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}; continuing local cleanup.\n`);
    }
  }
  if (options.selection === "all") {
    const removed = removeOwnedMarketplaces(options.marketplaceRoot);
    if (removed.length) process.stdout.write(`Removed ${removed.join(", ")}\n`);
    else process.stdout.write("No owned Cadre marketplace files found to remove.\n");
  } else if (existsSync(options.marketplaceRoot)) {
    process.stdout.write(`Retained shared marketplace at ${options.marketplaceRoot} for other clients.\n`);
  }
  return failed ? 1 : 0;
}
