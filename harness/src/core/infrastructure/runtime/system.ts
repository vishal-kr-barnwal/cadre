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

import { PlannedGitAction, RunCommandOptions, WorkflowPhaseState } from "../../application/runtime/contracts";
import { fileExists, textHash } from "./json-store";

export const commandExistsCache = new Map<string, boolean>();

export function isCadreProjectRoot(root: string): boolean {
  const cadreDir = path.join(root, "cadre");
  if (!fileExists(cadreDir)) return false;
  return [
    "tracks.json",
    "setup_state.json",
    "product.json",
    "tech-stack.json",
    "workflow.json",
    "config.json",
    "repos.json",
  ].some((name) => fileExists(path.join(cadreDir, name))) || fileExists(path.join(cadreDir, "tracks"));
}

export function gitIdentity(root: string): string | null {
  for (const key of ["user.email", "user.name"]) {
    const result = spawnSync("git", ["config", key], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return null;
}

export function runCommand(command: string, args: string[], options: RunCommandOptions = {}): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: options.shell === true,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
  });
  const commandResult: CommandResult = {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command: options.shell === true ? command : [command, ...args].join(" "),
    args,
  };
  if (options.cwd !== undefined) commandResult.cwd = options.cwd;
  return commandResult;
}

export function plannedGitAction(id: string, kind: string, repo: string, cwd: string, args: string[], description: string): PlannedGitAction {
  return {
    id,
    kind,
    repo,
    cwd,
    command: "git",
    args,
    description,
  };
}

export function runPlannedGitActions(actions: PlannedGitAction[]): CommandResult[] {
  return actions.map((action) => runCommand(action.command, action.args, { cwd: action.cwd }));
}

export function actionResultsOk(results: CommandResult[]): boolean {
  return results.every((result) => result.ok);
}

export function hasProviderEvidence(args: RuntimeArgs = {}): boolean {
  return Boolean(args.evidence || args.providerEvidence || args.provider_evidence);
}

export function workflowPhaseState(args: RuntimeArgs, blocked: boolean, pendingProvider = false): WorkflowPhaseState {
  if (blocked) return "blocked";
  if (pendingProvider) return "pending_provider";
  return args.execute === true ? "executed" : "ready";
}

export function continuationToken(workflow: string, trackId: string | null | undefined, actions: unknown[]): string {
  return textHash(JSON.stringify({ workflow, trackId, actions })).slice(0, 24);
}

export function parsePorcelainFiles(text: unknown): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const raw = line.slice(3).trim();
      if (!raw) return [];
      if (raw.includes(" -> ")) return [raw.split(" -> ").pop() ?? ""];
      return [raw.replace(/^"|"$/g, "")];
    })
    .filter(Boolean);
}

export function isControlPlaneFile(file: unknown): boolean {
  const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return true;
  if (normalized.startsWith("cadre/")) return true;
  if (normalized === ".gitattributes" || normalized === ".gitmodules") return true;
  if (normalized === "cadre-merge-train.gitlab-ci.yml") return true;
  if (normalized === ".gitlab-ci.yml") return true;
  if (normalized.startsWith(".github/workflows/cadre-")) return true;
  return false;
}

export function controlPlaneSyncSafety(root: string, mode: string, remote: string, branch: string): JsonObject {
  const status = runCommand("git", ["status", "--porcelain"], { cwd: root });
  const dirtyFiles = parsePorcelainFiles(status.stdout);
  const unsafeDirtyFiles = dirtyFiles.filter((file) => !isControlPlaneFile(file));
  const safety = {
    ok: true,
    mode,
    remote,
    branch,
    dirty_files: dirtyFiles,
    unsafe_dirty_files: unsafeDirtyFiles,
    ahead_files: [] as string[],
    unsafe_ahead_files: [] as string[],
    warnings: [] as string[],
  };
  if (!status.ok) {
    return { ...safety, ok: false, reason: "Unable to inspect git status", status };
  }
  if (unsafeDirtyFiles.length > 0) {
    return {
      ...safety,
      ok: false,
      reason: "Working tree has non-control-plane changes; refusing control-plane sync",
    };
  }
  if (mode !== "post") return safety;

  const remoteRef = `${remote}/${branch}`;
  const fetch = runCommand("git", ["fetch", "--quiet", remote, branch], { cwd: root });
  const rev = runCommand("git", ["rev-parse", "--verify", remoteRef], { cwd: root });
  let diff;
  if (fetch.ok && rev.ok) {
    diff = runCommand("git", ["diff", "--name-only", `${remoteRef}..HEAD`], { cwd: root });
  } else {
    return {
      ...safety,
      ok: false,
      reason: `Unable to verify ${remoteRef}; refusing control-plane post-sync rather than classifying only the last commit`,
      fetch,
      rev,
    };
  }
  const aheadFiles = diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const unsafeAheadFiles = aheadFiles.filter((file) => !isControlPlaneFile(file));
  safety.ahead_files = aheadFiles;
  safety.unsafe_ahead_files = unsafeAheadFiles;
  if (!diff.ok) {
    return { ...safety, ok: false, reason: "Unable to classify unpushed commits", diff };
  }
  if (unsafeAheadFiles.length > 0) {
    return {
      ...safety,
      ok: false,
      reason: "Unpushed commits include non-control-plane files; refusing control-plane push",
    };
  }
  return safety;
}

export function commandExists(command: string, cwd: string): boolean {
  const key = `${process.env.PATH || ""}\u0000${cwd}\u0000${command}`;
  if (commandExistsCache.has(key)) return commandExistsCache.get(key) === true;
  const result = spawnSync("sh", ["-lc", `command -v '${String(command).replace(/'/g, "'\\''")}'`], {
    cwd,
    encoding: "utf8",
  });
  const exists = result.status === 0;
  commandExistsCache.set(key, exists);
  return exists;
}
