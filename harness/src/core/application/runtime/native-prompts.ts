import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";

import { normalizeProviderMode } from "../../infrastructure/runtime/project-config";
import { availableStyleGuideIds, normalizeStyleGuideId } from "./tech-stack";

type PromptArgs = {
  provider: JsonObject;
  syncMode: string;
  styleGuides: JsonObject;
  lspSetup: JsonObject;
  integrations: unknown;
  runtimeArgs: RuntimeArgs;
};

export function choice(id: string, label: string, description: string, recommended = false): JsonObject {
  return { id, label, description, recommended };
}

export function nativePrompt(
  id: string,
  title: string,
  question: string,
  selectionMode: "single" | "multi",
  choices: JsonObject[],
  responseTarget: JsonObject,
  customArgument: string | null
): JsonObject {
  const allowCustom = Boolean(customArgument);
  return {
    version: 1,
    schema: "cadre.native_prompt.v1",
    id,
    title,
    question,
    selectionMode,
    choices,
    allowCustom,
    ...(allowCustom ? { customLabel: "Other", customArgument } : {}),
    responseTarget: {
      ...responseTarget,
      ...(customArgument ? { customArgument } : {}),
      valueMode: Object.keys(asJsonObject(responseTarget.valueMap)).length > 0
        ? "value_map"
        : selectionMode === "multi" ? "selected_ids" : "selected_id",
      customMode: selectionMode === "multi" && customArgument === responseTarget.argument
        ? "append_unique"
        : "replace",
    },
  };
}

function recommendedProviderMode(provider: JsonObject): string {
  const mode = asOptionalString(provider.provider_mode) || "local";
  return ["local", "github", "gitlab"].includes(mode) ? mode : "local";
}

function providerPrompt(provider: JsonObject): JsonObject {
  const recommended = recommendedProviderMode(provider);
  return nativePrompt(
    "setup-provider-mode",
    "Provider Mode",
    "Which hosted provider should Cadre use for review and publication evidence?",
    "single",
    [
      choice("local", "Local", "Use local review and no hosted provider MCP.", recommended === "local"),
      choice("github", "GitHub", "Use GitHub provider evidence through the GitHub MCP.", recommended === "github"),
      choice("gitlab", "GitLab", "Use GitLab provider evidence through the GitLab MCP.", recommended === "gitlab"),
    ],
    {
      tool: "cadre_workflow",
      workflow: "setup",
      argument: "providerMode",
      valueMap: {
        local: { providerMode: "local" },
        github: { providerMode: "github" },
        gitlab: { providerMode: "gitlab" },
      },
    },
    null
  );
}

export function hasAnyArg(args: RuntimeArgs, names: string[]): boolean {
  const raw = args as UnknownRecord;
  return names.some((name) => raw[name] !== undefined && raw[name] !== null && raw[name] !== "");
}

function firstProvidedArg(args: RuntimeArgs, names: string[]): unknown {
  const raw = args as UnknownRecord;
  const name = names.find((candidate) => Object.prototype.hasOwnProperty.call(raw, candidate));
  return name ? raw[name] : undefined;
}

function hasValidProviderArg(args: RuntimeArgs): boolean {
  return normalizeProviderMode(firstProvidedArg(args, ["providerMode", "provider_mode", "provider"])) !== null;
}

function hasValidSyncArg(args: RuntimeArgs): boolean {
  return ["local", "shared"].includes(asOptionalString(firstProvidedArg(args, ["syncMode", "sync_mode"])) || "");
}

function hasValidStyleGuideArg(args: RuntimeArgs): boolean {
  const value = firstProvidedArg(args, ["styleGuideIds", "style_guide_ids"]);
  if (value === undefined) return false;
  if (Array.isArray(value) && !value.every((entry) => typeof entry === "string")) return false;
  if (typeof value !== "string" && !Array.isArray(value)) return false;
  if (typeof value === "string" && value.trim().length === 0) return false;
  const available = new Set(availableStyleGuideIds());
  const requested = typeof value === "string" ? value.split(/[,\s]+/).filter(Boolean) : value;
  return requested.every((entry) => available.has(normalizeStyleGuideId(String(entry))));
}

function hasBooleanLspArg(args: RuntimeArgs): boolean {
  return typeof firstProvidedArg(args, ["writeLsp", "write_lsp", "setupLsp", "setup_lsp", "lsp"]) === "boolean";
}

function syncPrompt(syncMode: string): JsonObject {
  const recommended = syncMode === "shared" ? "shared" : "local";
  return nativePrompt(
    "setup-sync-mode",
    "Sync Mode",
    "How should Cadre coordinate control-plane state for this project?",
    "single",
    [
      choice("local", "Local", "Keep Cadre state local to this working copy.", recommended === "local"),
      choice("shared", "Shared", "Use shared sync for team ownership, review queues, and handoffs.", recommended === "shared"),
    ],
    {
      tool: "cadre_workflow",
      workflow: "setup",
      argument: "syncMode",
      valueMap: {
        local: { syncMode: "local" },
        shared: { syncMode: "shared" },
      },
    },
    null
  );
}

function styleGuideDescription(id: string, detected: Set<string>, selected: Set<string>): string {
  if (detected.has(id)) return "Detected from the structured tech stack.";
  if (selected.has(id)) return "Selected from setup arguments or default Cadre guidance.";
  return "Available bundled Cadre style guidance.";
}

function styleGuidePrompt(styleGuides: JsonObject): JsonObject {
  const detected = new Set(asStringArray(styleGuides.detected));
  const selected = new Set(asStringArray(styleGuides.selected));
  const choices = availableStyleGuideIds().map((id) =>
    choice(id, id, styleGuideDescription(id, detected, selected), selected.has(id) || detected.has(id))
  );
  return nativePrompt(
    "setup-style-guides",
    "Style Guides",
    "Which Cadre style guides should setup include?",
    "multi",
    choices,
    {
      tool: "cadre_workflow",
      workflow: "setup",
      argument: "styleGuideIds",
      selectedIds: asStringArray(styleGuides.selected),
    },
    null
  );
}

function lspRecommendationIds(lspSetup: JsonObject): string[] {
  const recommended = Array.isArray(lspSetup.recommended)
    ? lspSetup.recommended.map(asJsonObject).map((rec) => asOptionalString(rec.id)).filter((id): id is string => Boolean(id))
    : [];
  return recommended.length > 0 ? recommended : asStringArray(lspSetup.missingFromConfig || lspSetup.missing_from_config);
}

function lspPrompt(lspSetup: JsonObject, force = false): JsonObject | null {
  const ids = lspRecommendationIds(lspSetup);
  if (ids.length === 0 && !force) return null;
  const label = ids.slice(0, 4).join(", ");
  const suffix = ids.length > 4 ? `, +${ids.length - 4} more` : "";
  return nativePrompt(
    "setup-lsp",
    "Language Servers",
    "Should Cadre write detected language-server recommendations during setup?",
    "single",
    [
      choice("write-lsp", "Write LSP", ids.length > 0
        ? `Write cadre/lsp.json entries for ${label}${suffix}.`
        : "Write cadre/lsp.json when language-server recommendations are available.", true),
      choice("skip-lsp", "Skip LSP", "Do not write cadre/lsp.json during setup.", false),
    ],
    {
      tool: "cadre_workflow",
      workflow: "setup",
      argument: "writeLsp",
      valueMap: {
        "write-lsp": { writeLsp: true },
        "skip-lsp": { writeLsp: false },
      },
    },
    null
  );
}

function optionalMcpRecommendations(integrations: unknown): JsonObject[] {
  const readiness = asJsonObject(asJsonObject(integrations).mcp_readiness);
  const recommendations = Array.isArray(readiness.recommendations) ? readiness.recommendations.map(asJsonObject) : [];
  if (recommendations.length > 0) return recommendations.filter((entry) => asOptionalString(entry.kind));
  const rawOptional = asJsonObject(integrations).optional_mcps;
  const optional = Array.isArray(rawOptional) ? rawOptional.map(asJsonObject) : [];
  return optional.filter((entry) => asOptionalString(entry.kind) && entry.available !== true);
}

function optionalMcpPrompt(integrations: unknown): JsonObject | null {
  const recommendations = optionalMcpRecommendations(integrations);
  if (recommendations.length === 0) return null;
  return nativePrompt(
    "setup-optional-mcps",
    "Optional MCPs",
    "Which optional MCP integrations should Cadre remember as setup intent?",
    "multi",
    recommendations.map((entry) => choice(
      asOptionalString(entry.kind) || "unknown",
      asOptionalString(entry.label) || asOptionalString(entry.kind) || "Unknown",
      asOptionalString(entry.reason) || "Optional MCP improves Cadre evidence and team visibility.",
      true
    )),
    {
      tool: "cadre_workflow",
      workflow: "setup",
      argument: "integrations.optional_mcps",
      customArgument: "integrations.other",
      selectedIds: [],
    },
    "integrations.other"
  );
}

export function setupNativePrompts(args: PromptArgs): JsonObject[] {
  const lspProvided = hasAnyArg(args.runtimeArgs, ["writeLsp", "write_lsp", "setupLsp", "setup_lsp", "lsp"]);
  return [
    hasValidProviderArg(args.runtimeArgs) ? null : providerPrompt(args.provider),
    hasValidSyncArg(args.runtimeArgs) ? null : syncPrompt(args.syncMode),
    hasValidStyleGuideArg(args.runtimeArgs) ? null : styleGuidePrompt(args.styleGuides),
    hasBooleanLspArg(args.runtimeArgs) ? null : lspPrompt(args.lspSetup, lspProvided),
    hasAnyArg(args.runtimeArgs, ["integrations"]) ? null : optionalMcpPrompt(args.integrations),
  ].filter((prompt): prompt is JsonObject => prompt !== null);
}
