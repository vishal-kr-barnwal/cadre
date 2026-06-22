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
import { countRecords, summarizeDependencyGraphResult, summarizeLspCoverage, summarizeWorkspaceDiagnosticsResult, workspaceHealthDetailResources } from "./health-summaries";
import { integrationInventory } from "./integrations";
import { fileExists, readJson } from "../../infrastructure/runtime/json-store";
import { loadTopology, providerMcpAvailability } from "../../infrastructure/runtime/project-config";
import { lspSetup } from "./setup-infrastructure";
import { availableWork } from "./status";
import { commandExists, gitIdentity, isCadreProjectRoot, runCommand } from "../../infrastructure/runtime/system";
import { techStackSummary } from "./tech-stack";
import { workflowResponseMode } from "./workflow-response";
import { dependencyGraph, workspaceDiagnostics } from "./workspace-intel";

export function workspaceHealth(root: string, args: RuntimeArgs = {}): CoreResult {
  const mode = workflowResponseMode(args);
  const topology = loadTopology(root);
  const techStack = techStackSummary(root, args);
  const workspace = workspaceDiagnostics(root, { execute: false });
  const dependencyGraphResult = dependencyGraph(root);
  const lspCoverage = summarizeLspCoverage(root, args);
  const availableWorkResult = availableWork(root);
  const integrations = integrationInventory(root, { ...args, responseMode: mode });
  const compactIntegrations = {
    ok: integrations.ok !== false,
    provider: asJsonObject(integrations.provider),
    mcp_readiness: isRecord(integrations.mcp_readiness)
      ? {
        ok: asJsonObject(integrations.mcp_readiness).ok !== false,
        provider: asJsonObject(asJsonObject(integrations.mcp_readiness).provider),
        summary: asJsonObject(asJsonObject(integrations.mcp_readiness).summary),
      }
      : null,
    optional_mcps: Array.isArray(integrations.optional_mcps) ? integrations.optional_mcps : [],
    summary: asJsonObject(integrations.summary),
  };
  const detailResources = workspaceHealthDetailResources(root);
  if (mode === "detail") {
    return {
      ok: true,
      root,
      response_mode: mode,
      detail_available: true,
      topology: {
        polyrepo: topology.polyrepo,
        default_repo: topology.defaultRepo || null,
        sync_mode: topology.config.sync_mode || "local",
        repos: topology.repos,
      },
      tech_stack: techStack,
      workspace,
      dependency_graph: dependencyGraphResult,
      parallel: availableWorkResult,
      languages: {
        detected: lspCoverage.recommended,
        configured: lspCoverage.configured,
      },
      lsp: {
        coverage: lspCoverage,
        status: lspConfigStatus(root),
        setup: lspSetup(root, { ...args, execute: false }),
      },
      integrations,
      detail_resources: detailResources,
    };
  }
  return {
    ok: true,
    root,
    response_mode: mode,
    detail_available: true,
    topology: {
      polyrepo: topology.polyrepo,
      default_repo: topology.defaultRepo || null,
      sync_mode: topology.config.sync_mode || "local",
      repo_count: countRecords(asJsonObject(topology.repos).repos),
    },
    tech_stack: techStack.ok === false
      ? { ok: false, error: techStack.error || "Missing tech stack" }
      : {
        ok: true,
        path: techStack.path,
        summary: techStack.summary,
        styleGuideIds: techStack.styleGuideIds,
    },
    workspace: summarizeWorkspaceDiagnosticsResult(workspace),
    dependency_graph: summarizeDependencyGraphResult(dependencyGraphResult),
    parallel: availableWorkResult.ok === false
      ? { ok: false, error: availableWorkResult.error || "Available work unavailable" }
      : {
        ok: true,
        available_count: countRecords(availableWorkResult.available),
        reclaimable_count: countRecords(availableWorkResult.reclaimable),
        available: Array.isArray(availableWorkResult.available) ? availableWorkResult.available.slice(0, 5) : [],
        reclaimable: Array.isArray(availableWorkResult.reclaimable) ? availableWorkResult.reclaimable.slice(0, 5) : [],
      },
    languages: {
      detected: lspCoverage.recommended,
      configured: lspCoverage.configured,
    },
    lsp: lspCoverage,
    integrations: compactIntegrations,
    detail_resources: detailResources,
  };
}

export function lspConfigStatus(root: string): CoreResult {
  const configPath = path.join(root, "cadre", "lsp.json");
  const config = readJson<unknown>(configPath, null);
  if (!config) {
    return {
      configured: false,
      path: path.relative(root, configPath),
      servers: [],
      missing: [],
      daemon: {
        status_packet: "cadre_intel action lsp_daemon_status",
        shutdown_packet: "cadre_intel action lsp_daemon_shutdown",
        max_clients_default: 8,
        idle_eviction_ms_default: 600000,
      },
    };
  }
  const configObject = asJsonObject(config);
  const servers = Array.isArray(configObject.servers) ? configObject.servers.map((server) => asJsonObject(server)) : [];
  return {
    configured: true,
    path: path.relative(root, configPath),
    servers: servers.map((server) => {
      const command = asOptionalString(server.command);
      return {
        id: asOptionalString(server.id) || command || "unknown",
        command: command || null,
        available: command ? commandExists(command, root) : false,
      };
    }),
    missing: servers
      .filter((server) => {
        const command = asOptionalString(server.command);
        return !command || !commandExists(command, root);
      })
      .map((server) => asOptionalString(server.id) || asOptionalString(server.command) || "unknown"),
    daemon: {
      status_packet: "cadre_intel action lsp_daemon_status",
      shutdown_packet: "cadre_intel action lsp_daemon_shutdown",
      max_clients_default: 8,
      idle_eviction_ms_default: 600000,
    },
  };
}

export function mergeDriverStatus(root: string): CoreResult {
  const result = runCommand("git", ["config", "merge.ours.driver"], { cwd: root });
  return {
    configured: result.ok && result.stdout.trim() !== "",
    value: result.stdout.trim() || null,
  };
}

export function doctor(root: string, options: RuntimeArgs = {}): CoreResult {
  const candidateRoot = path.resolve(root || process.cwd());
  const generatedCheck = path.join(candidateRoot, "scripts", "generate-skills.sh");
  const lspStatus = lspConfigStatus(candidateRoot);
  const lspMissing = asStringArray(lspStatus.missing);
  const checks = {
    mcp_runtime: { ok: true, server: "cadre" },
    cadre_project: {
      ok: Boolean(options.hasCadreProject || isCadreProjectRoot(candidateRoot)),
      root: candidateRoot,
      markers: [
        "cadre/tracks.json",
        "cadre/setup_state.json",
        "cadre/product.json",
        "cadre/config.json",
        "cadre/lsp.json",
      ].filter((name) => fileExists(path.join(candidateRoot, name))),
    },
    git: {
      available: commandExists("git", candidateRoot),
      identity: gitIdentity(candidateRoot),
      merge_ours: mergeDriverStatus(candidateRoot),
    },
    lsp: lspStatus,
    provider: providerMcpAvailability(candidateRoot, options),
    generated_bundles: {
      check_available: fileExists(generatedCheck),
      command: fileExists(generatedCheck) ? "bash scripts/generate-skills.sh --check" : null,
    },
  };
  const warnings: string[] = [];
  if (!checks.cadre_project.ok) {
    warnings.push("No Cadre project markers found. This is fine for the Cadre harness/source repo, but project-scoped Cadre workflows need setup first.");
  }
  if (checks.lsp.configured && lspMissing.length > 0) {
    warnings.push(`LSP config exists but missing server commands: ${lspMissing.join(", ")}`);
  }
  return {
    ok: warnings.length === 0,
    root: candidateRoot,
    checks,
    warnings,
  };
}
