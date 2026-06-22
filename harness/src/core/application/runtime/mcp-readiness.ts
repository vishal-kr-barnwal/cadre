import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, isRecord } from "../../../guards";
import { loadTopology, providerMcpAvailability } from "../../infrastructure/runtime/project-config";

type CapabilityProbe = {
  available: boolean | null;
  source: string;
  evidence: JsonObject | null;
  missing: string[];
};

type ReadinessCategory = {
  kind: string;
  label: string;
  aliases: string[];
  purpose: string;
  required: boolean;
  recommended: boolean;
};

const OPTIONAL_CATEGORIES: ReadinessCategory[] = [
  {
    kind: "code_search",
    label: "Code search",
    aliases: ["code_search", "codeSearch", "sourcegraph", "search"],
    purpose: "Cross-repo semantic or indexed code search for repo maps, impact analysis, and claim suggestions.",
    required: false,
    recommended: true,
  },
  {
    kind: "issue_tracker",
    label: "Issue tracker",
    aliases: ["issue_tracker", "issueTracker", "jira", "linear", "github_issues", "gitlab_issues"],
    purpose: "Link tracks, Beads tasks, and provider issues without forcing agents through local CLI fallbacks.",
    required: false,
    recommended: true,
  },
  {
    kind: "ci",
    label: "CI/checks",
    aliases: ["ci", "checks", "github_actions", "gitlab_ci", "buildkite", "circleci"],
    purpose: "Fetch check, pipeline, and workflow evidence for review/ship gates.",
    required: false,
    recommended: true,
  },
  {
    kind: "observability",
    label: "Observability",
    aliases: ["observability", "logging", "telemetry", "sentry", "datadog", "honeycomb"],
    purpose: "Pull production error, log, and telemetry context for review and release readiness.",
    required: false,
    recommended: true,
  },
  {
    kind: "knowledge_base",
    label: "Knowledge base",
    aliases: ["knowledge_base", "knowledgeBase", "kb", "docs", "confluence", "notion"],
    purpose: "Retrieve team documentation and runbooks without embedding large docs in packet responses.",
    required: false,
    recommended: true,
  },
];

function capabilityEvidence(args: RuntimeArgs): JsonObject {
  const raw = args.mcpCapabilities || args.mcp_capabilities || null;
  return isRecord(raw) ? asJsonObject(raw) : {};
}

function valueAvailable(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (!lower) return null;
    if (["false", "0", "no", "off", "missing", "unavailable", "disabled"].includes(lower)) return false;
    return true;
  }
  if (!isRecord(value)) return null;
  const object = asJsonObject(value);
  if (typeof object.available === "boolean") return object.available;
  if (typeof object.enabled === "boolean") return object.enabled;
  if (typeof object.configured === "boolean") return object.configured;
  if (object.server || object.tool || object.tools || object.capability) return true;
  return null;
}

function probeNestedMap(map: JsonObject, aliases: string[], source: string): CapabilityProbe | null {
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(map, alias)) continue;
    const value = map[alias];
    return {
      available: valueAvailable(value),
      source: `${source}.${alias}`,
      evidence: isRecord(value) ? asJsonObject(value) : { value: value as string | number | boolean | null },
      missing: [],
    };
  }
  return null;
}

function probeTools(evidence: JsonObject, aliases: string[]): CapabilityProbe | null {
  const tools = Array.isArray(evidence.tools) ? evidence.tools : [];
  const servers = Array.isArray(evidence.servers) ? evidence.servers : [];
  const values = [...tools, ...servers].map((item) => {
    if (typeof item === "string") return item;
    if (isRecord(item)) {
      const object = asJsonObject(item);
      return asOptionalString(object.name) || asOptionalString(object.id) || asOptionalString(object.server) || "";
    }
    return "";
  }).filter(Boolean);
  const found = values.find((value) => aliases.some((alias) => value.toLowerCase().includes(alias.toLowerCase())));
  if (!found) return null;
  return {
    available: true,
    source: "mcpCapabilities.tools",
    evidence: { match: found },
    missing: [],
  };
}

function probeCapability(args: RuntimeArgs, aliases: string[], argFallbacks: string[] = []): CapabilityProbe {
  for (const fallback of argFallbacks) {
    const value = (args as JsonObject)[fallback];
    if (typeof value === "boolean") {
      return {
        available: value,
        source: `args.${fallback}`,
        evidence: { [fallback]: value },
        missing: [],
      };
    }
  }
  const evidence = capabilityEvidence(args);
  if (Object.keys(evidence).length === 0) {
    return {
      available: null,
      source: "not_provided",
      evidence: null,
      missing: ["mcpCapabilities"],
    };
  }
  const direct = probeNestedMap(evidence, aliases, "mcpCapabilities");
  if (direct) return direct;
  for (const containerName of ["servers", "mcpServers", "capabilities", "apps", "connectors"]) {
    const container = evidence[containerName];
    if (isRecord(container)) {
      const nested = probeNestedMap(asJsonObject(container), aliases, `mcpCapabilities.${containerName}`);
      if (nested) return nested;
    }
  }
  const tools = probeTools(evidence, aliases);
  if (tools) return tools;
  return {
    available: null,
    source: "not_detected",
    evidence: null,
    missing: aliases.map((alias) => `mcpCapabilities.${alias}`),
  };
}

function configConfigured(root: string, aliases: string[]): boolean {
  const config = loadTopology(root).config || {};
  const integrations = isRecord(config.integrations) ? asJsonObject(config.integrations) : {};
  return aliases.some((alias) =>
    Object.prototype.hasOwnProperty.call(config, alias)
    || Object.prototype.hasOwnProperty.call(integrations, alias)
  );
}

function readinessEntry(root: string, category: ReadinessCategory, args: RuntimeArgs): JsonObject {
  const probe = probeCapability(args, category.aliases);
  return {
    kind: category.kind,
    label: category.label,
    required: category.required,
    recommended: category.recommended,
    configured: configConfigured(root, category.aliases),
    available: probe.available,
    evidence_source: probe.source,
    detected_agent_capability_evidence: probe.evidence,
    missing_evidence_fields: probe.available == null ? probe.missing : [],
    purpose: category.purpose,
  };
}

export function providerReadiness(root: string, args: RuntimeArgs = {}): JsonObject {
  const provider = providerMcpAvailability(root, args);
  const mode = asOptionalString(provider.provider_mode) || "local";
  if (mode === "local") {
    return {
      kind: "provider",
      label: "Provider MCP",
      provider_mode: "local",
      required: false,
      recommended: false,
      available: true,
      evidence_source: "provider_mode_local",
      detected_agent_capability_evidence: null,
      missing_evidence_fields: [],
      required_provider_mcp: null,
      exact_write_back_packet: null,
      reason: "provider_mode is local; provider MCP evidence is not required",
    };
  }
  const probe = probeCapability(args, [mode, `${mode}_mcp`, `${mode}Mcp`, "provider", "provider_mcp"], [
    "providerMcpAvailable",
    "provider_mcp_available",
    mode === "github" ? "githubMcpAvailable" : "gitlabMcpAvailable",
  ]);
  const available = probe.available ?? (typeof provider.available === "boolean" ? provider.available : null);
  return {
    kind: "provider",
    label: "Provider MCP",
    provider_mode: mode,
    required: true,
    recommended: true,
    available,
    evidence_source: probe.available == null && provider.available != null
      ? asOptionalString(provider.availability_source) || "caller"
      : probe.source,
    detected_agent_capability_evidence: probe.evidence,
    missing_evidence_fields: available == null ? probe.missing : [],
    required_provider_mcp: isRecord(provider.required_provider_mcp) ? asJsonObject(provider.required_provider_mcp) : {
      provider: mode,
      server: mode,
      purpose: "Fetch PR/MR metadata, reviews, CI/check status, and discussion evidence.",
    },
    exact_write_back_packet: {
      tool: "cadre_review",
      action: "provider_evidence",
      required_fields: ["root", "trackId", "providerEvidence"],
    },
    reason: available == null
      ? `${mode} provider mode requires packet-owned evidence that the agent can access the ${mode} MCP`
      : null,
  };
}

export function mcpReadiness(root: string, args: RuntimeArgs = {}): JsonObject {
  const provider = providerReadiness(root, args);
  const optional = OPTIONAL_CATEGORIES.map((category) => readinessEntry(root, category, args));
  const all = [provider, ...optional];
  const missingRequired = all.filter((entry) => entry.required === true && entry.available !== true);
  const optionalAvailable = optional.filter((entry) => entry.available === true).length;
  return {
    ok: missingRequired.length === 0,
    root,
    provider,
    optional_mcps: optional,
    summary: {
      required_count: all.filter((entry) => entry.required === true).length,
      missing_required_count: missingRequired.length,
      optional_recommended_count: optional.length,
      optional_available_count: optionalAvailable,
      optional_configured_count: optional.filter((entry) => entry.configured === true).length,
      packet_owned_evidence_only: true,
    },
    recommendations: optional
      .filter((entry) => entry.available !== true)
      .map((entry) => ({
        kind: entry.kind,
        label: entry.label,
        required: false,
        reason: "Optional MCP improves team-scale visibility but is not mandatory.",
      })),
  };
}
