import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";

import { availableStyleGuideIds } from "./tech-stack";

type PromptArgs = {
  provider: JsonObject;
  syncMode: string;
  styleGuides: JsonObject;
  lspSetup: JsonObject;
  integrations: unknown;
  runtimeArgs: RuntimeArgs;
};

function choice(id: string, label: string, description: string, recommended = false): JsonObject {
  return { id, label, description, recommended };
}

function nativePrompt(
  id: string,
  title: string,
  question: string,
  selectionMode: "single" | "multi",
  choices: JsonObject[],
  responseTarget: JsonObject,
  customArgument: string
): JsonObject {
  return {
    version: 1,
    schema: "cadre.native_prompt.v1",
    id,
    title,
    question,
    selectionMode,
    choices,
    allowCustom: true,
    customLabel: "Other",
    customArgument,
    responseTarget,
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
      customArgument: "providerModeOther",
      valueMap: {
        local: { providerMode: "local" },
        github: { providerMode: "github" },
        gitlab: { providerMode: "gitlab" },
      },
    },
    "providerModeOther"
  );
}

function hasAnyArg(args: RuntimeArgs, names: string[]): boolean {
  const raw = args as UnknownRecord;
  return names.some((name) => raw[name] !== undefined && raw[name] !== null && raw[name] !== "");
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
      customArgument: "syncModeOther",
      valueMap: {
        local: { syncMode: "local" },
        shared: { syncMode: "shared" },
      },
    },
    "syncModeOther"
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
    choice(id, id, styleGuideDescription(id, detected, selected), selected.has(id))
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
      customArgument: "styleGuideIds",
      selectedIds: asStringArray(styleGuides.selected),
    },
    "styleGuideIds"
  );
}

function lspRecommendationIds(lspSetup: JsonObject): string[] {
  const recommended = Array.isArray(lspSetup.recommended)
    ? lspSetup.recommended.map(asJsonObject).map((rec) => asOptionalString(rec.id)).filter((id): id is string => Boolean(id))
    : [];
  return recommended.length > 0 ? recommended : asStringArray(lspSetup.missingFromConfig || lspSetup.missing_from_config);
}

function lspPrompt(lspSetup: JsonObject): JsonObject | null {
  const ids = lspRecommendationIds(lspSetup);
  if (ids.length === 0) return null;
  const label = ids.slice(0, 4).join(", ");
  const suffix = ids.length > 4 ? `, +${ids.length - 4} more` : "";
  return nativePrompt(
    "setup-lsp",
    "Language Servers",
    "Should Cadre write detected language-server recommendations during setup?",
    "single",
    [
      choice("write-lsp", "Write LSP", `Write cadre/lsp.json entries for ${label}${suffix}.`, true),
      choice("skip-lsp", "Skip LSP", "Do not write cadre/lsp.json during setup.", false),
    ],
    {
      tool: "cadre_workflow",
      workflow: "setup",
      argument: "writeLsp",
      customArgument: "lspSetupOther",
      valueMap: {
        "write-lsp": { writeLsp: true },
        "skip-lsp": { writeLsp: false },
      },
    },
    "lspSetupOther"
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
      argument: "integrations",
      customArgument: "integrations.other",
      selectedIds: [],
    },
    "integrations.other"
  );
}

export function setupNativePrompts(args: PromptArgs): JsonObject[] {
  return [
    hasAnyArg(args.runtimeArgs, ["providerMode", "provider_mode", "provider"]) ? null : providerPrompt(args.provider),
    hasAnyArg(args.runtimeArgs, ["syncMode", "sync_mode"]) ? null : syncPrompt(args.syncMode),
    styleGuidePrompt(args.styleGuides),
    hasAnyArg(args.runtimeArgs, ["writeLsp", "write_lsp", "setupLsp", "setup_lsp", "lsp"]) ? null : lspPrompt(args.lspSetup),
    optionalMcpPrompt(args.integrations),
  ].filter((prompt): prompt is JsonObject => prompt !== null);
}
