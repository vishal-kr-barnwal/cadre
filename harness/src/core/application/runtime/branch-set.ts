import fs from "node:fs";
import path from "node:path";

import type { CadreTrack, JsonObject, PlanTask, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asString, isRecord } from "../../../guards";
import { fileExists, safeName } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { runCommand } from "../../infrastructure/runtime/system";
import type { BranchSetEntry, CoreResult, RepoRuntimeInfo } from "./contracts";
import { parsePlanFile } from "./track-schedule";

export const MONOREPO_REPO_KEY = "root";

function repoSegment(repo: string): string {
  return safeName(repo === "." ? MONOREPO_REPO_KEY : repo);
}

function gitBranch(cwd: string): string | null {
  const result = runCommand("git", ["branch", "--show-current"], { cwd });
  return result.ok ? result.stdout.trim() || null : null;
}

function gitRoot(cwd: string): string | null {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  return result.ok ? path.resolve(result.stdout.trim() || cwd) : null;
}

function branchExists(cwd: string, branch: string): boolean {
  return runCommand("git", ["rev-parse", "--verify", "--quiet", branch], { cwd }).ok;
}

function taskRepos(root: string, track: CadreTrack): Set<string> {
  const topology = loadTopology(root);
  if (!topology.polyrepo) return new Set([MONOREPO_REPO_KEY]);
  const repos = new Set<string>();
  const defaultRepo = asOptionalString(topology.defaultRepo);
  for (const task of parsePlanFile(track.plan_path).tasks || []) {
    const repo = asOptionalString(task.repo) || defaultRepo;
    if (repo) repos.add(repo);
  }
  const metadataRepos = isRecord(track.metadata.repos) ? track.metadata.repos : null;
  if (metadataRepos) {
    for (const [repo, rawInfo] of Object.entries(metadataRepos)) {
      const info = asJsonObject(rawInfo);
      if (info.affected === true || info.git_branch || info.worktree_path) repos.add(repo);
    }
  }
  return repos;
}

export function workerRef(trackId: string, repo: string, taskKey: string): string {
  return `refs/cadre/workers/${safeName(trackId)}/${repoSegment(repo)}/${safeName(taskKey)}`;
}

export function workerWorktreePath(root: string, trackId: string, repo: string, taskKey: string): string {
  return path.resolve(root, ".worktrees", "cadre", "tracks", safeName(trackId), "workers", repoSegment(repo), safeName(taskKey));
}

export function branchSetForTrack(root: string, track: CadreTrack, args: RuntimeArgs = {}): BranchSetEntry[] {
  const topology = loadTopology(root);
  const requestedRepo = asOptionalString(args.repo);
  const affected = taskRepos(root, track);
  if (topology.polyrepo) {
    const metadataRepos = isRecord(track.metadata.repos) ? track.metadata.repos : {};
    const topoRepos = Array.isArray(topology.repos.repos) ? topology.repos.repos.map(asJsonObject) : [];
    const byName = new Map<string, JsonObject>();
    for (const rawRepo of topoRepos) {
      const name = asOptionalString(rawRepo.name);
      if (name) byName.set(name, rawRepo);
    }
    for (const [repo, rawInfo] of Object.entries(metadataRepos)) {
      if (!byName.has(repo)) byName.set(repo, { name: repo, ...asJsonObject(rawInfo) });
    }
    const repoRows = Array.from(byName.values());
    return repoRows
      .filter((rawRepo) => {
        const repo = asOptionalString(rawRepo.name);
        return Boolean(repo && (!requestedRepo || requestedRepo === repo) && affected.has(repo));
      })
      .map((rawRepo) => {
        const repo = asString(rawRepo.name);
        const info = {
          submodule_path: asOptionalString(rawRepo.submodule_path) || "",
          base_branch: asOptionalString(rawRepo.default_branch) || asOptionalString(rawRepo.base_branch) || "main",
          ...(isRecord(metadataRepos[repo]) ? asJsonObject(metadataRepos[repo]) : {}),
        } as RepoRuntimeInfo;
        return branchSetEntry(root, track, repo, info, args, true);
      });
  }
  if (requestedRepo && requestedRepo !== "." && requestedRepo !== MONOREPO_REPO_KEY) return [];
  return [branchSetEntry(root, track, MONOREPO_REPO_KEY, {}, args, false)];
}

export function branchSetEntry(root: string, track: CadreTrack, repo: string, info: RepoRuntimeInfo, args: RuntimeArgs, polyrepo: boolean): BranchSetEntry {
  const segment = repoSegment(repo);
  const sourceRel = polyrepo ? asOptionalString(info.submodule_path) || "" : ".";
  const sourceRoot = polyrepo && sourceRel ? path.resolve(root, sourceRel) : root;
  const baseBranch = asOptionalString(args.base) || asOptionalString(info.base_branch) || "main";
  const trackBranch = asOptionalString(args.head) || asOptionalString(args.branch) || asOptionalString(info.git_branch) || asOptionalString(track.metadata.git_branch) || `track/${track.track_id}`;
  const legacyPath = repo === MONOREPO_REPO_KEY ? asOptionalString(track.metadata.worktree_path) : asOptionalString(info.worktree_path);
  const relIntegration = legacyPath || path.join(".worktrees", "cadre", "tracks", safeName(track.track_id), "integrate", segment);
  const integrationWorktree = path.resolve(root, relIntegration);
  const workerRoot = path.resolve(root, ".worktrees", "cadre", "tracks", safeName(track.track_id), "workers", segment);
  const exists = fileExists(integrationWorktree);
  const currentBranch = exists ? gitBranch(integrationWorktree) : null;
  const expectedRoot = gitRoot(sourceRoot);
  const actualRoot = exists ? gitRoot(integrationWorktree) : null;
  const wrongRepo = Boolean(exists && expectedRoot && actualRoot && expectedRoot !== actualRoot);
  const wrongBranch = Boolean(exists && currentBranch && currentBranch !== trackBranch);
  const health = !exists ? "missing" : wrongRepo ? "wrong_repo" : wrongBranch ? "wrong_branch" : "ready";
  return {
    repo,
    repo_segment: segment,
    source_root: sourceRoot,
    source_path: sourceRel,
    base_branch: baseBranch,
    track_branch: trackBranch,
    integration_worktree: integrationWorktree,
    integration_worktree_path: path.relative(root, integrationWorktree) || ".",
    worker_root: workerRoot,
    worker_root_path: path.relative(root, workerRoot) || ".",
    affected: true,
    exists,
    current_branch: currentBranch,
    health,
    branch_exists: branchExists(sourceRoot, trackBranch),
    commands: integrationCommands(sourceRoot, integrationWorktree, trackBranch, baseBranch, exists),
  };
}

function integrationCommands(sourceRoot: string, integrationWorktree: string, branch: string, base: string, exists: boolean): JsonObject[] {
  if (exists) return [];
  return [{
    command: "git",
    args: ["worktree", "add", integrationWorktree, branch],
    fallback_args: ["worktree", "add", "-b", branch, integrationWorktree, base],
    cwd: sourceRoot,
  }];
}

export function ensureIntegrationWorktree(entry: BranchSetEntry): CoreResult {
  if (entry.exists) {
    if (entry.health !== "ready") return { ok: false, stage: "integration_worktree_health", entry, error: `Integration worktree for ${entry.repo} is ${entry.health}` };
    return { ok: true, entry, created: false };
  }
  fs.mkdirSync(path.dirname(entry.integration_worktree), { recursive: true });
  const args = entry.branch_exists
    ? ["worktree", "add", entry.integration_worktree, entry.track_branch]
    : ["worktree", "add", "-b", entry.track_branch, entry.integration_worktree, entry.base_branch];
  const result = runCommand("git", args, { cwd: entry.source_root });
  return {
    ok: result.ok,
    entry: { ...entry, exists: result.ok, current_branch: result.ok ? entry.track_branch : entry.current_branch, health: result.ok ? "ready" : entry.health },
    created: result.ok,
    command: { command: "git", args, cwd: entry.source_root },
    result,
  };
}

export function branchSetEntryForRepo(root: string, track: CadreTrack, repo: string, args: RuntimeArgs = {}): BranchSetEntry | null {
  return branchSetForTrack(root, track, { ...args, repo: repo === MONOREPO_REPO_KEY ? undefined : repo })
    .find((entry) => entry.repo === repo || (repo === "." && entry.repo === MONOREPO_REPO_KEY)) || null;
}

export function taskRepo(root: string, task: PlanTask | null, args: RuntimeArgs = {}): string {
  const topology = loadTopology(root);
  if (!topology.polyrepo) return MONOREPO_REPO_KEY;
  return asString(args.repo || task?.repo || topology.defaultRepo);
}
