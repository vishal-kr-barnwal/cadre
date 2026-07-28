import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CLIENTS, type ClientName } from "./native-clients.js";

export type ClientSelection = ClientName | "all" | "auto";

export interface CommonCliOptions {
  selection: ClientSelection;
  marketplaceRoot: string;
  dryRun: boolean;
}

export function parseClient(value: string | undefined): ClientSelection {
  if (value === "all" || value === "auto" || CLIENTS.includes(value as ClientName)) return value as ClientSelection;
  throw new Error("--target/--agent must be auto, all, codex, or claude");
}

export function defaultMarketplaceRoot(): string {
  const cadreHome = process.env.CADRE_HOME ? resolve(process.env.CADRE_HOME) : join(homedir(), ".cadre");
  return join(cadreHome, "marketplaces", "cadre");
}

export function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

export function marketplaceFromHome(home: string): string {
  return join(resolve(home), "marketplaces", "cadre");
}
