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

import { CoreResult, PlannedGitAction } from "./contracts";
import { fileExists, safeName } from "../../infrastructure/runtime/json-store";
import { loadTopology, normalizeProviderMode } from "../../infrastructure/runtime/project-config";
import { actionResultsOk, commandExists, plannedGitAction, runCommand, runPlannedGitActions } from "../../infrastructure/runtime/system";
import { templateSourceLabel, templateText } from "./workflow-response";
import { mcpServerPathCandidates } from "../../../runtime-paths";

export function configuredCiProvider(root: string, args: RuntimeArgs = {}): "github" | "gitlab" | null {
  const raw = asOptionalString(args.ciProvider || args.ci_provider)
    || asOptionalString(args.providerMode || args.provider_mode || args.provider)
    || asOptionalString(loadTopology(root).config.provider_mode);
  const provider = normalizeProviderMode(raw);
  return provider === "github" || provider === "gitlab" ? provider : null;
}

export function setupGitattributes(root: string): CoreResult {
  const file = path.join(root, ".gitattributes");
  const required = [
    "cadre/tracks/**/parallel_state.json merge=ours",
  ];
  const existing = fileExists(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter(Boolean);
  let changed = false;
  for (const line of required) {
    if (!lines.includes(line)) {
      lines.push(line);
      changed = true;
    }
  }
  if (changed || !fileExists(file)) {
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
  }
  const mergeDriver = runCommand("git", ["config", "merge.ours.driver", "true"], { cwd: root });
  return {
    ok: mergeDriver.ok,
    path: path.relative(root, file),
    changed,
    merge_driver: mergeDriver,
  };
}

export function setupCiTemplates(root: string, provider: "github" | "gitlab" | null, args: RuntimeArgs = {}): CoreResult {
  if (!provider) return { ok: true, skipped: true, reason: "No hosted provider selected" };
  if (args.writeCi === false || args.write_ci === false) {
    return { ok: true, skipped: true, reason: "writeCi=false" };
  }
  const topology = asOptionalString((args as UnknownRecord).topology)?.toLowerCase();
  const polyrepo = topology === "polyrepo" || asJsonObject((args as UnknownRecord).repos).mode === "polyrepo" || (args as UnknownRecord).polyrepo === true;
  const template = polyrepo
    ? (provider === "github" ? "ci/cadre-merge-train.github.yml" : "ci/cadre-merge-train.gitlab.yml")
    : (provider === "github" ? "ci/cadre-monorepo-check.github.yml" : "ci/cadre-monorepo-check.gitlab.yml");
  const sourceText = templateText(template, "");
  const source = templateSourceLabel(template) || template;
  if (!sourceText) return { ok: false, error: `Missing CI template ${template}` };
  const target = provider === "github"
    ? path.join(root, ".github", "workflows", polyrepo ? "cadre-merge-train.yml" : "cadre-monorepo-check.yml")
    : path.join(root, ".gitlab-ci.yml");
  if (fileExists(target) && args.force !== true) {
    return { ok: true, skipped: true, provider, source, path: path.relative(root, target) };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sourceText);
  return { ok: true, provider, source, path: path.relative(root, target), written: true };
}

export function setupSubmodulePlan(root: string, repos: JsonObject, args: RuntimeArgs = {}): CoreResult {
  const entries = Array.isArray(repos.repos) ? repos.repos.map(asJsonObject) : [];
  const commands: PlannedGitAction[] = [];
  for (const repo of entries) {
    const name = asOptionalString(repo.name);
    const url = asOptionalString(repo.url);
    const submodulePath = asOptionalString(repo.submodule_path);
    if (!name || !url || !submodulePath || repo.enabled === false) continue;
    if (fileExists(path.join(root, submodulePath))) continue;
    commands.push(plannedGitAction(
      `submodule-${safeName(name)}`,
      "submodule_add",
      name,
      root,
      ["submodule", "add", url, submodulePath],
      `Register ${name} as a product submodule`
    ));
  }
  const execute = args.addSubmodules === true || args.add_submodules === true || args.executeSubmodules === true || args.execute_submodules === true;
  const results = execute ? runPlannedGitActions(commands) : [];
  return {
    ok: !execute || actionResultsOk(results),
    execute,
    dry_run: !execute,
    commands,
    results,
  };
}

export function lspSetupHelperCandidates(root: string): string[] {
  return mcpServerPathCandidates(root);
}

export function redactRuntimeHelperPaths(text: string): string {
  return text
    .replace(/[^\s"'`]*cadre-lsp-(?:setup|review|daemon)\.js/g, "<cadre-lsp-helper>")
    .replace(/[^\s"'`]*cadre-server\.js/g, "<cadre-mcp-server>");
}

export function summarizeRuntimeCommandResult(result: CommandResult): JsonObject {
  return {
    ok: result.ok,
    status: result.status,
    signal: result.signal || null,
    timed_out: result.timed_out === true,
    stdout: redactRuntimeHelperPaths(result.stdout || "").slice(0, 4000),
    stderr: redactRuntimeHelperPaths(result.stderr || "").slice(0, 4000),
    error: result.error ? redactRuntimeHelperPaths(result.error) : undefined,
  };
}

export function lspSetup(root: string, args: RuntimeArgs = {}): CoreResult {
  const helper = lspSetupHelperCandidates(root).find(fileExists);
  if (!helper) {
    return {
      ok: false,
      available: false,
      reason: "Cadre MCP runtime was not found for LSP setup",
      checked_count: lspSetupHelperCandidates(root).length,
    };
  }
  const config = asOptionalString(args.config) || "cadre/lsp.json";
  const commandArgs = [helper, "--cadre-lsp-setup", "--root", root, "--config", config, "--json"];
  if (args.execute === true) commandArgs.push("--write");
  const result = runCommand("node", commandArgs, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  if (!result.ok) {
    return { ok: false, available: true, result: summarizeRuntimeCommandResult(result), reason: "LSP setup helper failed" };
  }
  try {
    return {
      ok: true,
      available: true,
      execute: args.execute === true,
      dry_run: args.execute !== true,
      ...asJsonObject(JSON.parse(result.stdout || "{}")),
    };
  } catch {
    return { ok: false, available: true, result: summarizeRuntimeCommandResult(result), reason: "LSP setup helper returned invalid JSON" };
  }
}
