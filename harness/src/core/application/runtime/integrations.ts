import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { CoreResult } from "./contracts";
import { summarizeLspCoverage, workspaceHealthDetailResources } from "./health-summaries";
import { mcpReadiness } from "./mcp-readiness";
import { loadTopology, providerMcpAvailability } from "../../infrastructure/runtime/project-config";
import { lspSetup } from "./setup-infrastructure";
import { workflowResponseMode } from "./workflow-response";
import { lspConfigStatus } from "./workspace-health";

export function normalizeIntegrationValue(value: unknown): JsonObject {
  if (value == null) {
    return { configured: false, available: null };
  }
  if (typeof value === "boolean") {
    return { configured: true, available: value };
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { configured: false, available: null };
    const lower = text.toLowerCase();
    if (["false", "0", "no", "off", "disabled"].includes(lower)) {
      return { configured: true, available: false, label: text };
    }
    return { configured: true, available: true, label: text };
  }
  if (isRecord(value)) {
    const entry = asJsonObject(value);
    const configured = Object.keys(entry).length > 0;
    const available = typeof entry.available === "boolean"
      ? entry.available
      : typeof entry.enabled === "boolean"
        ? entry.enabled
        : typeof entry.configured === "boolean"
          ? entry.configured
          : (entry.command || entry.server || entry.url ? true : null);
    return {
      configured,
      available,
      label: asOptionalString(entry.label) || asOptionalString(entry.name),
      command: asOptionalString(entry.command),
      server: asOptionalString(entry.server),
      url: asOptionalString(entry.url),
      provider: asOptionalString(entry.provider),
      platform: asOptionalString(entry.platform),
      kind: asOptionalString(entry.kind),
    };
  }
  return { configured: false, available: null };
}

export function pickIntegrationCandidate(scopes: Array<{ source: string; scope: UnknownRecord | JsonObject | null | undefined }>, keys: string[]): { source: string; value: unknown } | null {
  for (const { source, scope } of scopes) {
    if (!isRecord(scope)) continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(scope, key)) {
        const value = asJsonObject(scope)[key];
        if (value !== undefined && value !== null) return { source: `${source}.${key}`, value };
      }
    }
  }
  return null;
}

export function integrationStatus(root: string, args: RuntimeArgs, kind: string, label: string, keys: string[], mode: "compact" | "detail"): JsonObject {
  const topology = loadTopology(root);
  const config = asJsonObject(topology.config || {});
  const configIntegrations = isRecord(config.integrations) ? asJsonObject(config.integrations) : {};
  const candidate = pickIntegrationCandidate([
    { source: "config.integrations", scope: configIntegrations },
    { source: "config", scope: config },
    { source: "args", scope: args as UnknownRecord },
  ], keys);
  const normalized = normalizeIntegrationValue(candidate?.value);
  const status: JsonObject = {
    kind,
    label,
    configured: normalized.configured === true || candidate != null,
    available: normalized.available,
    source: candidate?.source || "not_configured",
  };
  if (normalized.label) status.value = normalized.label;
  if (normalized.command) status.command = normalized.command;
  if (normalized.server) status.server = normalized.server;
  if (normalized.url) status.url = normalized.url;
  if (normalized.provider) status.provider = normalized.provider;
  if (normalized.platform) status.platform = normalized.platform;
  if (normalized.kind) status.integration_kind = normalized.kind;
  if (mode === "detail") {
    status.candidates = keys;
  }
  return status;
}

export function integrationInventory(root: string, args: RuntimeArgs = {}): CoreResult {
  const mode = workflowResponseMode(args);
  const provider = providerMcpAvailability(root, args);
  const readiness = mcpReadiness(root, args);
  const lsp = summarizeLspCoverage(root, args);
  const optionalMcps = [
    integrationStatus(root, args, "code_search", "Code search", ["code_search", "codeSearch", "sourcegraph", "sourcegraph_mcp", "sourcegraphMcp", "search"], mode),
    integrationStatus(root, args, "issue_tracker", "Issue tracker", ["issue_tracker", "issueTracker", "jira", "jira_mcp", "jiraMcp", "linear", "linear_mcp", "linearMcp"], mode),
    integrationStatus(root, args, "ci", "CI", ["ci", "ci_provider", "ciProvider", "ci_mcp", "ciMcp", "ci_mcp_available", "ciMcpAvailable"], mode),
    integrationStatus(root, args, "logging", "Logging", ["logging", "observability", "telemetry", "sentry", "sentry_mcp", "datadog", "datadog_mcp", "honeycomb", "honeycomb_mcp"], mode),
    integrationStatus(root, args, "knowledge_base", "Knowledge base", ["knowledge_base", "knowledgeBase", "kb", "docs", "confluence", "notion", "knowledge_base_mcp", "knowledgeBaseMcp"], mode),
  ];
  const configuredOptionalCount = optionalMcps.filter((entry) => entry.configured === true).length;
  const availableOptionalCount = optionalMcps.filter((entry) => entry.available === true).length;
  const unavailableOptionalCount = optionalMcps.filter((entry) => entry.configured === true && entry.available === false).length;
  const detailResources = workspaceHealthDetailResources(root);
  const summary = {
    provider_mode: asOptionalString(provider.provider_mode) || "local",
    provider_available: provider.available ?? null,
    optional_configured_count: configuredOptionalCount,
    optional_available_count: availableOptionalCount,
    optional_unavailable_count: unavailableOptionalCount,
    lsp_configured_count: asOptionalNumber(lsp.configured_count),
    lsp_recommended_count: asOptionalNumber(lsp.recommended_count),
    lsp_covered_count: asOptionalNumber(lsp.covered_count),
    lsp_missing_count: asOptionalNumber(lsp.missing_count),
    lsp_coverage: asOptionalNumber(lsp.coverage),
  };
  if (mode === "detail") {
    return {
      ok: true,
      root,
      response_mode: mode,
      detail_available: true,
      provider,
      mcp_readiness: readiness,
      optional_mcps: optionalMcps,
      lsp: {
        coverage: lsp,
        status: lspConfigStatus(root),
        setup: lspSetup(root, { ...args, execute: false }),
      },
      summary,
      detail_resources: detailResources,
    };
  }
  return {
    ok: true,
    root,
    response_mode: mode,
    detail_available: true,
    provider: {
      ok: provider.ok !== false,
      provider_mode: provider.provider_mode || "local",
      available: provider.available ?? null,
      required_provider_mcp: provider.required_provider_mcp || null,
      source: provider.source || null,
      remote_host: provider.remote_host || null,
      requires_confirmation: provider.requires_confirmation === true,
    },
    mcp_readiness: {
      ok: readiness.ok !== false,
      provider: asJsonObject(readiness.provider),
      summary: asJsonObject(readiness.summary),
      recommendations: Array.isArray(readiness.recommendations) ? readiness.recommendations : [],
    },
    optional_mcps: optionalMcps.map((entry) => ({
      kind: entry.kind,
      label: entry.label,
      configured: entry.configured,
      available: entry.available,
      source: entry.source,
    })),
    lsp,
    summary,
    detail_resources: detailResources,
  };
}
