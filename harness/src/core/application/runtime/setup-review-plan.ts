import fs from "node:fs";
import path from "node:path";

import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { fileExists, readJson, utcNow } from "../../infrastructure/runtime/json-store";
import type { CoreResult, ReviewFile } from "./contracts";
import { plainReviewFile } from "./review-bundles";
import { configuredCiProvider } from "./setup-infrastructure";
import { setupFinalReviewFiles } from "./setup-review-files";
import type { ApprovalSession } from "./approval-session-model";
import { trackIndexPayload } from "./status";
import { templateJson, templateText } from "./workflow-response";

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

function lspServerIds(value: JsonObject): string[] {
  return Array.isArray(value.servers)
    ? value.servers.map(asJsonObject)
      .map((server) => asOptionalString(server.id || server.command))
      .filter((id): id is string => Boolean(id))
    : [];
}

function parsedSnapshot(content: string | null | undefined): JsonObject {
  try {
    const value = JSON.parse(content || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
  } catch {
    return {};
  }
}

export function approvedSetupLspAdded(session: ApprovalSession | null): string[] {
  if (!session) return [];
  const snapshot = session.snapshot_files.find((file) => file.path === "cadre/lsp.json");
  if (!snapshot) return [];
  const before = session.before_files.find((file) => file.path === "cadre/lsp.json");
  const previous = new Set(lspServerIds(parsedSnapshot(before?.content)));
  return lspServerIds(parsedSnapshot(snapshot.content)).filter((id) => !previous.has(id));
}

export interface SetupFinalReviewPlan {
  generatedAt: string;
  configPayload: JsonObject;
  setupStatePayload: JsonObject;
  trackIndex: JsonObject;
  gitattributesNeeded: boolean;
  ciProvider: "github" | "gitlab" | null;
  reviewFiles: ReviewFile[];
}

interface SetupFinalReviewPlanArgs {
  root: string;
  args: RuntimeArgs;
  polyrepoRequested: boolean;
  providerMode: string | null;
  providerRemoteHost: string | null;
  integrationsPayload: JsonObject | null;
  syncMode: string;
}

const MANAGED_SETUP_CONFIG_KEYS = new Set([
  "packet_only",
  "sync_mode",
  "provider_mode",
  "provider_mcp_required",
  "remote_host",
  "integrations",
]);

function unmanagedSetupConfig(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !MANAGED_SETUP_CONFIG_KEYS.has(key)),
  );
}

export function setupFinalReviewPlan(input: SetupFinalReviewPlanArgs): SetupFinalReviewPlan {
  const { root, args, polyrepoRequested, providerMode, providerRemoteHost, integrationsPayload, syncMode } = input;
  const rawArgs = args as UnknownRecord;
  const configBase = unmanagedSetupConfig({
    ...templateJson("config.json", { sync_mode: "local", auto_open: false }),
    ...asJsonObject(rawArgs.config),
  });
  const generatedAt = utcNow();
  const hostedProvider = providerMode === "github" || providerMode === "gitlab";
  const configPayload: JsonObject = {
    ...configBase,
    packet_only: true,
    sync_mode: syncMode,
    provider_mode: providerMode || "local",
    provider_mcp_required: hostedProvider,
    ...(hostedProvider && providerRemoteHost ? { remote_host: providerRemoteHost } : {}),
    ...(integrationsPayload ? { integrations: integrationsPayload } : {}),
  };
  const setupStatePayload: JsonObject = {
    version: 1,
    packet_only: true,
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    initialized_at: generatedAt,
    updated_at: generatedAt,
  };
  const trackIndex = trackIndexPayload(root, []);
  const machineFiles: ReviewFile[] = [
    machineReviewFile(
      "cadre/.gitignore",
      "Cadre local-state ignore",
      "setup:native-state",
      appendRequiredLine(fileExists(path.join(root, "cadre", ".gitignore")) ? fs.readFileSync(path.join(root, "cadre", ".gitignore"), "utf8") : "", "/local/"),
    ),
    machineReviewFile("cadre/config.json", "Cadre configuration", "setup:config", `${JSON.stringify(configPayload, null, 2)}\n`),
    machineReviewFile("cadre/setup_state.json", "Cadre setup state", "setup:state", `${JSON.stringify(setupStatePayload, null, 2)}\n`),
    machineReviewFile("cadre/tracks.json", "Initial track index", "setup:track-index", `${JSON.stringify(trackIndex, null, 2)}\n`),
  ];
  const gitattributesNeeded = polyrepoRequested
    || configPayload.sync_mode === "shared"
    || rawArgs.writeGitattributes === true
    || rawArgs.write_gitattributes === true;
  if (gitattributesNeeded) {
    const attributesPath = path.join(root, ".gitattributes");
    machineFiles.push(machineReviewFile(
      ".gitattributes",
      "Cadre merge attributes",
      "setup:gitattributes",
      appendRequiredLine(fileExists(attributesPath) ? fs.readFileSync(attributesPath, "utf8") : "", "cadre/tracks/**/parallel_state.json merge=ours"),
    ));
  }
  const ciProvider = configuredCiProvider(root, args)
    || (providerMode === "github" || providerMode === "gitlab" ? providerMode : null);
  if (ciProvider && rawArgs.writeCi !== false && rawArgs.write_ci !== false) {
    const ciTemplate = polyrepoRequested
      ? (ciProvider === "github" ? "ci/cadre-merge-train.github.yml" : "ci/cadre-merge-train.gitlab.yml")
      : (ciProvider === "github" ? "ci/cadre-monorepo-check.github.yml" : "ci/cadre-monorepo-check.gitlab.yml");
    const ciPath = ciProvider === "github"
      ? `.github/workflows/${polyrepoRequested ? "cadre-merge-train.yml" : "cadre-monorepo-check.yml"}`
      : ".gitlab-ci.yml";
    if (!fileExists(path.join(root, ciPath)) || rawArgs.force === true) {
      machineFiles.push(machineReviewFile(ciPath, "Cadre CI workflow", `template:${ciTemplate}`, templateText(ciTemplate, "")));
    }
  }
  return {
    generatedAt,
    configPayload,
    setupStatePayload,
    trackIndex,
    gitattributesNeeded,
    ciProvider,
    reviewFiles: setupFinalReviewFiles(generatedAt, machineFiles),
  };
}
