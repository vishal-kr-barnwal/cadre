import path from "node:path";

import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { readJson } from "../../infrastructure/runtime/json-store";
import type { CoreResult, ReviewFile } from "./contracts";
import { plainReviewFile } from "./review-bundles";

export function machineReviewFile(relativePath: string, title: string, source: string, content: string): ReviewFile {
  return { ...plainReviewFile(relativePath, title, source, content), reviewRole: "machine" };
}

export function appendRequiredLine(existing: string, required: string): string {
  const lines = existing.split(/\r?\n/).filter(Boolean);
  if (!lines.includes(required)) lines.push(required);
  return `${lines.join("\n")}\n`;
}

function requestedWorkspaceFolders(repos: JsonObject | null): JsonObject[] | null {
  if (!repos || repos.mode !== "polyrepo" || !Array.isArray(repos.repos)) return null;
  return [
    { name: ".", path: "." },
    ...repos.repos.map(asJsonObject).flatMap((repo) => {
      const name = asOptionalString(repo.name);
      const submodulePath = asOptionalString(repo.submodule_path);
      return repo.enabled !== false && name && submodulePath ? [{ name, path: submodulePath }] : [];
    }),
  ];
}

export function lspPreviewPayload(root: string, recommendations: CoreResult, repos: JsonObject | null = null): JsonObject {
  const existing = readJson<JsonObject>(path.join(root, "cadre", "lsp.json"), {});
  const servers = Array.isArray(existing.servers) ? [...existing.servers] : [];
  const known = new Set(servers.map((server) => asOptionalString(asJsonObject(server).id || asJsonObject(server).command)).filter(Boolean));
  for (const value of Array.isArray(recommendations.recommended) ? recommendations.recommended : []) {
    const recommendation = asJsonObject(value);
    const id = asOptionalString(recommendation.id);
    const command = asOptionalString(recommendation.command);
    if ((!id && !command) || known.has(id || command || "")) continue;
    servers.push({
      ...(id ? { id } : {}),
      ...(command ? { command } : {}),
      args: asStringArray(recommendation.args),
      extensions: asStringArray(recommendation.extensions),
      ...(Array.isArray(recommendation.filenames) ? { filenames: asStringArray(recommendation.filenames) } : {}),
      ...(Array.isArray(recommendation.languageIds) ? { languageIds: asStringArray(recommendation.languageIds) } : {}),
    });
    if (id) known.add(id);
  }
  return {
    ...existing,
    servers,
    workspaceFolders: requestedWorkspaceFolders(repos)
      || (Array.isArray(recommendations.workspaceFolders) ? recommendations.workspaceFolders : []),
  };
}
