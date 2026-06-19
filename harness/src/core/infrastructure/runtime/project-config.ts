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

import { CoreResult, TopologyWithConfig } from "../../application/runtime/contracts";
import { fileExists, readJson } from "./json-store";
import { runCommand } from "./system";

export function loadTopology(root: string): TopologyWithConfig {
  const reposPath = path.join(root, "cadre", "repos.json");
  const configPath = path.join(root, "cadre", "config.json");
  const repos = readJson<JsonObject | null>(reposPath, null);
  const config = readJson<JsonObject>(configPath, {});
  const polyrepo = Boolean(repos && repos.mode === "polyrepo");
  return {
    polyrepo,
    repos: asJsonObject(repos || {}),
    config,
    defaultRepo: polyrepo ? asString(repos?.default_repo, ".") : ".",
  };
}

export function loadPackageJson(root: string): JsonObject | null {
  return readJson<JsonObject | null>(path.join(root, "package.json"), null);
}

export function normalizeProviderMode(value: unknown): "local" | "github" | "gitlab" | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (["none", "no", "off", "local-only", "local_only"].includes(raw)) return "local";
  return PROVIDER_MODES.has(raw as "local" | "github" | "gitlab") ? raw as "local" | "github" | "gitlab" : null;
}

export function gitRemoteUrls(root: string): string[] {
  const result = runCommand("git", ["remote", "-v"], { cwd: root });
  if (!result.ok) return [];
  return Array.from(new Set(result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[1] || "")
    .filter(Boolean)))
    .sort();
}

export function remoteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    const ssh = url.match(/^[^@]+@([^:/]+)[:/]/);
    if (ssh?.[1]) return ssh[1].toLowerCase();
    const schemeLess = url.match(/^([^:/]+)[:/]/);
    return schemeLess?.[1] ? schemeLess[1].toLowerCase() : null;
  }
}

export function providerModeForHost(host: string | null): "github" | "gitlab" | null {
  if (!host) return null;
  if (host.includes("github")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  return null;
}

export function detectedProviderFromRemotes(root: string): CoreResult {
  const remotes = gitRemoteUrls(root).map((url) => {
    const host = remoteHost(url);
    return { url, host, provider_mode: providerModeForHost(host) };
  });
  const providerModes = Array.from(new Set(remotes.map((remote) => remote.provider_mode).filter(Boolean))).sort();
  const hosts = Array.from(new Set(remotes.map((remote) => remote.host).filter(Boolean))).sort();
  const hasRemotes = remotes.length > 0;
  const ambiguous = providerModes.length > 1 || (hasRemotes && providerModes.length === 0);
  const providerMode = providerModes.length === 1 ? providerModes[0] : (!hasRemotes ? "local" : null);
  return {
    ok: true,
    provider_mode: providerMode,
    remote_host: hosts.length === 1 ? hosts[0] : null,
    remote_hosts: hosts,
    remotes,
    ambiguous,
    source: !hasRemotes ? "no_remote" : (providerModes.length === 0 ? "unknown_remote" : "git_remote"),
  };
}

export function configuredProvider(root: string, args: RuntimeArgs = {}): CoreResult {
  const config = loadTopology(root).config || {};
  const detected = detectedProviderFromRemotes(root);
  const explicit = normalizeProviderMode(args.providerMode || args.provider_mode || args.provider);
  const configured = normalizeProviderMode(config.provider_mode) || normalizeProviderMode(config.pr_provider);
  const providerMode = explicit || configured || (detected.ambiguous ? null : normalizeProviderMode(detected.provider_mode));
  const remoteHostValue = args.remoteHost || args.remote_host || config.remote_host || detected.remote_host || null;
  const mode = providerMode || null;
  return {
    ok: Boolean(mode),
    provider_mode: mode,
    provider_mcp_required: mode === "github" || mode === "gitlab",
    remote_host: remoteHostValue,
    detected,
    source: explicit ? "argument" : (configured ? "config" : "detected"),
    requires_confirmation: !mode && detected.ambiguous === true,
  };
}

export function providerMcpAvailability(root: string, args: RuntimeArgs = {}): CoreResult {
  const provider = configuredProvider(root, args);
  const mode = asOptionalString(provider.provider_mode) || "local";
  if (mode === "local") {
    return { ...provider, available: true, skipped: true, reason: "provider_mode is local" };
  }
  const explicit = args.provider_mcp_available ?? args.providerMcpAvailable;
  const modeSpecific = mode === "github" ? args.githubMcpAvailable : args.gitlabMcpAvailable;
  const available = typeof modeSpecific === "boolean"
    ? modeSpecific
    : (typeof explicit === "boolean" ? explicit : null);
  return {
    ...provider,
    available,
    availability_source: available == null ? "not_verifiable_by_cadre_runtime" : "caller",
    required_provider_mcp: {
      provider: mode,
      server: mode,
      purpose: "Fetch PR/MR metadata, reviews, CI/check status, and discussion evidence.",
    },
  };
}

export function configuredCoverageCommand(root: string, args: RuntimeArgs = {}, workingRoot = root): string | null {
  if (args.command) return String(args.command);
  const topology = loadTopology(root);
  const config = topology.config || {};
  for (const key of ["coverage_command", "test_coverage_command", "test_command"]) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const pkg = loadPackageJson(workingRoot);
  const scripts = isRecord(pkg?.scripts) ? pkg.scripts : null;
  if (scripts) {
    for (const name of ["coverage", "test:coverage", "test:cov", "test"]) {
      if (scripts[name]) {
        if (fileExists(path.join(workingRoot, "pnpm-lock.yaml"))) return `pnpm ${name}`;
        if (fileExists(path.join(workingRoot, "yarn.lock"))) return `yarn ${name}`;
        return `npm run ${name}`;
      }
    }
  }
  if (fileExists(path.join(workingRoot, "pyproject.toml")) || fileExists(path.join(workingRoot, "pytest.ini"))) {
    return "pytest --cov --cov-report=term";
  }
  if (fileExists(path.join(workingRoot, "go.mod"))) return "go test ./...";
  return null;
}

export function parseCoveragePercent(text: unknown): number | null {
  const source = String(text || "");
  const patterns = [
    /All files[^|\n]*(?:\|[^|\n]*){3,}\|\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\||$)/i,
    /\bStatements\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /\bLines\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /\bTOTAL\b[^\n%]*\s([0-9]+(?:\.[0-9]+)?)%/i,
    /\bcoverage[^0-9%]{0,40}([0-9]+(?:\.[0-9]+)?)%/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}
