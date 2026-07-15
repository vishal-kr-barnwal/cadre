import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../guards";
import type { JsonObject } from "../types";
import { LANGUAGE_RULES } from "./language-registry";

export interface LspConfig extends JsonObject {
  servers?: JsonObject[];
  workspaceFolders?: JsonObject[];
}

export interface LspConfigReconciliation {
  config: LspConfig;
  added: string[];
  removed: string[];
}

function serverKeys(server: JsonObject): string[] {
  return [asOptionalString(server.id), asOptionalString(server.command)]
    .filter((value): value is string => Boolean(value));
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  const actual = asStringArray(value);
  return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
}

function sameLanguageIds(value: unknown, expected: Record<string, string> | undefined): boolean {
  if (value === undefined) return true;
  if (!expected || !isRecord(value)) return false;
  const actual = asJsonObject(value);
  const keys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return keys.length === expectedKeys.length
    && keys.every((key) => actual[key] === expected[key]);
}

function legacyCadreManagedServer(server: JsonObject): boolean {
  const id = asOptionalString(server.id);
  const command = asOptionalString(server.command);
  const rule = LANGUAGE_RULES.find((entry) => entry.id === id && entry.command === command);
  if (!rule) return false;
  const managedKeys = new Set(["id", "command", "args", "extensions", "filenames", "languageIds"]);
  if (Object.keys(server).some((key) => !managedKeys.has(key))) return false;
  return sameStringArray(server.args, rule.args)
    && sameStringArray(server.extensions, rule.extensions)
    && (server.filenames === undefined || sameStringArray(server.filenames, rule.filenames || []))
    && sameLanguageIds(server.languageIds, rule.languageIds);
}

export function cadreManagedLspServer(server: JsonObject): boolean {
  const owner = asOptionalString(server.managed_by || server.managedBy)?.toLowerCase();
  return owner === "cadre" || legacyCadreManagedServer(server);
}

function managedServer(recommendation: JsonObject): JsonObject {
  const id = asOptionalString(recommendation.id);
  const command = asOptionalString(recommendation.command);
  return {
    ...(id ? { id } : {}),
    ...(command ? { command } : {}),
    args: asStringArray(recommendation.args),
    extensions: asStringArray(recommendation.extensions),
    ...(recommendation.filenames !== undefined ? { filenames: asStringArray(recommendation.filenames) } : {}),
    ...(isRecord(recommendation.languageIds) ? { languageIds: asJsonObject(recommendation.languageIds) } : {}),
    managed_by: "cadre",
  };
}

function serverLabel(server: JsonObject): string {
  return asOptionalString(server.id || server.command) || "unidentified-server";
}

function reconciledWorkspaceFolders(current: LspConfig, requested: JsonObject[]): JsonObject[] {
  const existing = Array.isArray(current.workspaceFolders) ? current.workspaceFolders.map(asJsonObject) : [];
  const paths = new Set(existing.map((folder) => asOptionalString(folder.path)).filter(Boolean));
  return [
    ...existing,
    ...requested.filter((folder) => {
      const folderPath = asOptionalString(folder.path);
      if (!folderPath || paths.has(folderPath)) return false;
      paths.add(folderPath);
      return true;
    }),
  ];
}

export function reconcileLspConfig(
  current: LspConfig,
  rawRecommendations: unknown[],
  folders: JsonObject[],
): LspConfigReconciliation {
  const recommendations = rawRecommendations.map(asJsonObject)
    .filter((entry) => serverKeys(entry).length > 0);
  const recommendationByKey = new Map<string, JsonObject>();
  for (const recommendation of recommendations) {
    for (const key of serverKeys(recommendation)) recommendationByKey.set(key, recommendation);
  }
  const existing = Array.isArray(current.servers) ? current.servers.map(asJsonObject) : [];
  const userCoverage = new Set<JsonObject>();
  for (const server of existing.filter((entry) => !cadreManagedLspServer(entry))) {
    const recommendation = serverKeys(server).map((key) => recommendationByKey.get(key)).find(Boolean);
    if (recommendation) userCoverage.add(recommendation);
  }

  const covered = new Set<JsonObject>(userCoverage);
  const servers: JsonObject[] = [];
  const removed: string[] = [];
  for (const server of existing) {
    if (!cadreManagedLspServer(server)) {
      servers.push(server);
      continue;
    }
    const recommendation = serverKeys(server).map((key) => recommendationByKey.get(key)).find(Boolean);
    if (!recommendation || userCoverage.has(recommendation) || covered.has(recommendation)) {
      removed.push(serverLabel(server));
      continue;
    }
    servers.push(managedServer(recommendation));
    covered.add(recommendation);
  }

  const added: string[] = [];
  for (const recommendation of recommendations) {
    if (covered.has(recommendation)) continue;
    servers.push(managedServer(recommendation));
    covered.add(recommendation);
    added.push(serverLabel(recommendation));
  }
  return {
    config: { ...current, servers, workspaceFolders: reconciledWorkspaceFolders(current, folders) },
    added: Array.from(new Set(added)),
    removed: Array.from(new Set(removed)),
  };
}
