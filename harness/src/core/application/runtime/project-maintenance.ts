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
import { fileExists, writeJson } from "../../infrastructure/runtime/json-store";
import { withLock } from "../../infrastructure/runtime/locking";
import { hasGeneratedMarker } from "./markdown-docs";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { trackIndexPayload } from "./status";
import { runCommand } from "../../infrastructure/runtime/system";
import { listTracks } from "./track-schedule";
import { mcpServerPathCandidates } from "../../../runtime-paths";

export function lspReview(root: string, args: RuntimeArgs = {}): CoreResult {
  const candidates = mcpServerPathCandidates(root);
  const helper = candidates.find(fileExists);
  if (!helper) return { available: false, reason: "No Cadre MCP runtime found for LSP review", checked: candidates };
  const commandArgs = [helper, "--cadre-lsp-review", "--base", args.base || "main", "--head", args.head || "HEAD", "--json"];
  if (args.config) commandArgs.push("--config", args.config);
  const result = runCommand("node", commandArgs, { cwd: root });
  if (!result.ok) {
    return { available: false, reason: "LSP review helper failed", helper, result };
  }
  try {
    return { helper, ...asJsonObject(JSON.parse(result.stdout || "{}")) };
  } catch {
    return { available: false, reason: "LSP review helper returned invalid JSON", helper, result };
  }
}

export function polyrepoPreflight(root: string): CoreResult {
  const topology = loadTopology(root);
  if (!topology.polyrepo) {
    return { ok: true, polyrepo: false, checks: ["monorepo mode"] };
  }
  const checks: string[] = [];
  const errors: string[] = [];
  const gitmodules = path.join(root, ".gitmodules");
  for (const repo of topology.repos.repos || []) {
    if (repo.enabled === false) continue;
    const repoPath = path.join(root, repo.submodule_path || "");
    if (!repo.name) errors.push("repo entry missing name");
    if (!repo.submodule_path) errors.push(`repo ${repo.name || "?"} missing submodule_path`);
    if (repo.submodule_path && !fileExists(repoPath)) {
      errors.push(`repo ${repo.name} path is missing: ${repo.submodule_path}`);
    }
    if (fileExists(gitmodules) && repo.name) {
      const result = spawnSync(
        "git",
        ["config", "-f", ".gitmodules", "--get", `submodule.${repo.name}.path`],
        { cwd: root, encoding: "utf8" }
      );
      if (result.status === 0 && result.stdout.trim() !== repo.submodule_path) {
        errors.push(
          `repo ${repo.name} submodule_path mismatch: repos.json=${repo.submodule_path}, .gitmodules=${result.stdout.trim()}`
        );
      }
    }
    if (repo.name) checks.push(repo.name);
  }
  return { ok: errors.length === 0, polyrepo: true, checks, errors };
}

export function regenIndex(root: string, options: RuntimeArgs = {}): CoreResult {
  if (options.lock !== false) {
    return withLock(root, "tracks-index", () => regenIndex(root, { ...options, lock: false }));
  }
  const tracksFile = path.join(root, "cadre", "tracks.json");
  const legacyMarkdownFile = path.join(root, "cadre", "tracks.md");
  const tracks = listTracks(root).sort((a, b) => a.track_id.localeCompare(b.track_id));
  const payload = trackIndexPayload(root, tracks);
  fs.mkdirSync(path.dirname(tracksFile), { recursive: true });
  writeJson(tracksFile, payload);
  let removedLegacyMarkdown: string | null = null;
  if (fileExists(legacyMarkdownFile)) {
    const legacy = fs.readFileSync(legacyMarkdownFile, "utf8");
    if (hasGeneratedMarker(legacy) || legacy.includes("<!-- cadre:index:start -->") || legacy.includes("<!-- cadre:index:end -->")) {
      fs.rmSync(legacyMarkdownFile, { force: true });
      removedLegacyMarkdown = path.relative(root, legacyMarkdownFile);
    }
  }
  return {
    ok: true,
    tracks_file: tracksFile,
    tracks: tracks.length,
    removed_legacy_markdown: removedLegacyMarkdown,
    stdout: `Regenerated ${tracksFile} index from ${tracks.length} tracks' metadata.\n`,
    stderr: "",
  };
}
