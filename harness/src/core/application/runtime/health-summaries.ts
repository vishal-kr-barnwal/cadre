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
import { lspSetup } from "./setup-infrastructure";
import { lspConfigStatus } from "./workspace-health";

export function countRecords(records: unknown): number {
  return Array.isArray(records) ? records.length : 0;
}

export function workspaceHealthDetailResources(root: string): string[] {
  const encodedRoot = encodeURIComponent(root);
  return [
    `cadre://workspace-health?root=${encodedRoot}&responseMode=detail`,
    `cadre://workspace-diagnostics?root=${encodedRoot}`,
    `cadre://repo-topology?root=${encodedRoot}`,
    `cadre://repo-map?root=${encodedRoot}`,
    `cadre://lsp-status?root=${encodedRoot}`,
    `cadre://integrations?root=${encodedRoot}`,
  ];
}

export function summarizeWorkspaceDiagnosticsResult(result: CoreResult): CoreResult {
  return {
    ok: result.ok !== false,
    repo_count: countRecords(result.repos),
    adapter_count: countRecords(result.adapters),
    command_count: countRecords(result.commands),
    result_count: countRecords(result.results),
  };
}

export function summarizeDependencyGraphResult(result: CoreResult): CoreResult {
  return {
    ok: result.ok !== false,
    repo_count: countRecords(result.repos),
    manifest_count: countRecords(result.manifests),
    edge_count: countRecords(result.edges),
  };
}

export function summarizeLspSetupResult(result: CoreResult): CoreResult {
  return {
    ok: result.ok !== false,
    available: result.available !== false,
    execute: result.execute === true,
    dry_run: result.dry_run !== false,
    written: result.written === true,
    added: Array.isArray(result.added) ? result.added.slice(0, 10) : [],
    added_count: countRecords(result.added),
    missing_from_config_count: countRecords(result.missingFromConfig),
    missing_commands_count: countRecords(result.missingCommands),
  };
}

export function summarizeLspCoverage(root: string, args: RuntimeArgs = {}): CoreResult {
  const status = asJsonObject(lspConfigStatus(root));
  const setup = asJsonObject(lspSetup(root, { ...args, execute: false }));
  const configured = Array.isArray(status.servers)
    ? status.servers
      .map((server) => asJsonObject(server).id || null)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const recommended = Array.isArray(setup.recommended)
    ? setup.recommended
      .map((entry) => asJsonObject(entry).id || null)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const missing = recommended.filter((id) => !configured.includes(id));
  const covered = recommended.filter((id) => configured.includes(id));
  return {
    ok: status.configured !== false && setup.ok !== false,
    status_configured: status.configured !== false,
    configured_count: configured.length,
    recommended_count: recommended.length,
    covered_count: covered.length,
    missing_count: missing.length,
    coverage: recommended.length > 0 ? Math.round((covered.length / recommended.length) * 100) : null,
    configured: configured.slice(0, 10),
    recommended: recommended.slice(0, 10),
    missing: missing.slice(0, 10),
  };
}
