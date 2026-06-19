import fs from "node:fs";
import path from "node:path";

import type { JsonObject, RuntimeArgs } from "../../types";
import { asJsonObject, asOptionalString, errorMessage } from "../../guards";
import type { RuntimeDependencies } from "./ports";

function selectedRepos(args: RuntimeArgs): Set<string> | null {
  const values = [
    asOptionalString(args.repo),
    ...(Array.isArray(args.repos) ? args.repos.filter((item): item is string => typeof item === "string") : []),
  ].filter((item): item is string => Boolean(item));
  return values.length > 0 ? new Set(values) : null;
}

function repoReviewTargets(deps: Pick<RuntimeDependencies, "core">, root: string, args: RuntimeArgs): JsonObject[] {
  const trackId = asOptionalString(args.trackId) || asOptionalString(args.track_id);
  const selected = selectedRepos(args);
  if (!trackId) return [{ repo: ".", path: ".", cwd: root, base: args.base || "main", head: args.head || "HEAD", source: "project-root" }];
  const context = asJsonObject(deps.core.trackContext(root, trackId));
  const topology = asJsonObject(context.topology);
  if (topology.polyrepo !== true) {
    return [{ repo: ".", path: ".", cwd: root, base: args.base || "main", head: args.head || "HEAD", source: "project-root" }];
  }
  const track = asJsonObject(context.track);
  const fromContext = Array.isArray(context.worktrees)
    ? context.worktrees.map((entry) => asJsonObject(entry))
    : [];
  const topologyInfo = asJsonObject(deps.core.loadTopology(root));
  const topologyRepos = asJsonObject(topologyInfo.repos);
  const fromTopology = Array.isArray(topologyRepos.repos)
    ? topologyRepos.repos.map((entry) => asJsonObject(entry))
    : [];
  const rawTargets = fromContext.length > 0 ? fromContext : fromTopology;
  const seen = new Set<string>();
  return rawTargets
    .map((entry): JsonObject | null => {
      const repo = asOptionalString(entry.repo) || asOptionalString(entry.name) || ".";
      if (selected && !selected.has(repo)) return null;
      const rel = asOptionalString(entry.path)
        || asOptionalString(entry.worktree_path)
        || asOptionalString(entry.submodule_path)
        || ".";
      const key = `${repo}:${rel}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        repo,
        path: rel,
        cwd: path.isAbsolute(rel) ? rel : path.resolve(root, rel),
        base: args.base || asOptionalString(entry.base_branch) || asOptionalString(entry.default_branch) || "main",
        head: args.head || asOptionalString(entry.git_branch) || asOptionalString(track.git_branch) || `track/${trackId}`,
        source: asOptionalString(entry.source) || (entry.worktree_path ? "metadata.repos.worktree_path" : "repos.json"),
      };
    })
    .filter((entry): entry is JsonObject => entry !== null);
}

function annotateRepoFindings(result: JsonObject, target: JsonObject): JsonObject[] {
  const findings = Array.isArray(result.findings)
    ? result.findings.map((finding) => asJsonObject(finding))
    : [];
  const repoPath = asOptionalString(target.path) || ".";
  const cwd = asOptionalString(target.cwd) || "";
  return findings.map((finding) => ({
    ...finding,
    repo: target.repo,
    path: asOptionalString(finding.path) || asOptionalString(finding.file) || repoPath,
    cwd,
    repo_path: repoPath,
  }));
}

async function warmLspReview(deps: Pick<RuntimeDependencies, "core" | "lspDaemon">, root: string, args: RuntimeArgs): Promise<JsonObject> {
  const targets = repoReviewTargets(deps, root, args);
  const timeoutMs = Number(args.timeoutMs || 120000);
  const rawConfig = asOptionalString(args.config) || path.join(root, "cadre", "lsp.json");
  const config = path.isAbsolute(rawConfig) ? rawConfig : path.resolve(root, rawConfig);
  if (targets.length <= 1 && targets[0]?.repo === ".") {
    return asJsonObject(await deps.lspDaemon.request(
      "review",
      { ...args, root, base: args.base || "main", head: args.head || "HEAD", config },
      timeoutMs
    ).catch((error) => ({ available: false, reason: errorMessage(error), findings: [] })));
  }
  const repos = await Promise.all(targets.map(async (target) => {
    const cwd = asOptionalString(target.cwd) || root;
    const repo = asOptionalString(target.repo) || ".";
    if (!fs.existsSync(cwd)) {
      const result = {
        available: false,
        reason: `Repo working root is missing: ${cwd}`,
        findings: [],
      };
      return { ...target, result, findings: [] };
    }
    const result = asJsonObject(await deps.lspDaemon.request(
      "review",
      {
        ...args,
        root: cwd,
        base: asOptionalString(target.base) || args.base || "main",
        head: asOptionalString(target.head) || args.head || "HEAD",
        config,
      },
      timeoutMs
    ).catch((error) => ({ available: false, reason: errorMessage(error), findings: [] })));
    const findings = annotateRepoFindings(result, target);
    return {
      ...target,
      repo,
      result: { ...result, findings },
      findings,
    };
  }));
  const findings = repos.flatMap((entry) => Array.isArray(entry.findings) ? entry.findings : []);
  return {
    available: repos.some((entry) => asJsonObject(entry.result).available !== false),
    polyrepo: true,
    config,
    repos,
    findings,
  };
}

export { warmLspReview };
