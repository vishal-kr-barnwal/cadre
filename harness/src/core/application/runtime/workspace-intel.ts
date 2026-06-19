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

import { normalizeClaimPath } from "./collision";
import { CoreResult, RepoSymbol } from "./contracts";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { likelyTestCandidatesForFile } from "./planning";
import { loadPackageJson } from "../../infrastructure/runtime/project-config";
import { lspReview } from "./project-maintenance";
import { diffSurface } from "./quality-gates";
import { extractRepoSymbols, intelRepoRoots, isIgnoredRepoMapFile, repoMap } from "./repo-map";
import { asArray } from "./status";
import { commandExists, runCommand } from "../../infrastructure/runtime/system";

export function lspImpact(root: string, args: RuntimeArgs = {}): CoreResult {
  const limit = Number(args.limit || 50);
  const symbols = Array.isArray(args.symbols)
    ? args.symbols
    : (args.symbol ? [args.symbol] : []);
  const files = Array.isArray(args.files) ? args.files : [];
  const symbolResults: Record<string, CoreResult> = {};
  for (const symbol of symbols.filter(Boolean)) {
    symbolResults[symbol] = repoMap(root, { symbol, limit });
  }
  const repoEntries = intelRepoRoots(root, args);
  const repoFileSymbols = repoEntries.map((entry) => {
    const fileSymbols: Record<string, RepoSymbol[]> = {};
    for (const file of files) {
      if (isIgnoredRepoMapFile(file)) continue;
      fileSymbols[file] = extractRepoSymbols(entry.root, file, limit).map((symbolEntry) => ({
        ...symbolEntry,
        repo: entry.repo,
      }));
    }
    return { repo: entry.repo, root: entry.root, path: entry.path, files: fileSymbols };
  });
  const fileSymbols: Record<string, RepoSymbol[]> = {};
  for (const entry of repoFileSymbols) {
    for (const [file, symbolsForFile] of Object.entries(asJsonObject(entry.files))) {
      const key = entry.repo === "." ? file : `${entry.repo}:${file}`;
      fileSymbols[key] = asArray(symbolsForFile) as RepoSymbol[];
    }
  }
  const review = args.lspResult || args.lsp_result
    ? (args.lspResult || args.lsp_result)
    : args.base || args.head
      ? lspReview(root, { base: args.base || "main", head: args.head || "HEAD", config: args.config })
    : null;
  return {
    ok: true,
    root,
    symbols: symbolResults,
    files: fileSymbols,
    repos: repoFileSymbols,
    review,
  };
}

export function shellCommandPlan(command: string, cwd: string, adapter: string): CoreResult {
  return { adapter, command, cwd };
}

export function detectWorkspaceAdapters(root: string): CoreResult[] {
  const adapters: CoreResult[] = [];
  const pkg = loadPackageJson(root);
  if (pkg) {
    const scripts = asJsonObject(pkg.scripts);
    const runner = fileExists(path.join(root, "pnpm-lock.yaml"))
      ? "pnpm"
      : fileExists(path.join(root, "yarn.lock"))
        ? "yarn"
        : "npm run";
    const scriptCommands = ["typecheck", "check", "test", "build", "lint"]
      .filter((script) => scripts[script])
      .map((script) => runner === "npm run" ? `npm run ${script}` : `${runner} ${script}`);
    adapters.push({
      id: "node",
      ecosystem: "javascript",
      manifest: "package.json",
      available: commandExists(runner.split(" ")[0] || "npm", root),
      commands: scriptCommands,
    });
    if (fileExists(path.join(root, "nx.json")) || asJsonObject(pkg.devDependencies).nx || asJsonObject(pkg.dependencies).nx) {
      adapters.push({
        id: "nx",
        ecosystem: "javascript",
        manifest: fileExists(path.join(root, "nx.json")) ? "nx.json" : "package.json",
        available: commandExists("nx", root) || commandExists("pnpm", root) || commandExists("npx", root),
        commands: ["nx affected -t test", "nx affected -t build"],
      });
    }
  }
  if (["pyproject.toml", "pytest.ini", "setup.cfg"].some((file) => fileExists(path.join(root, file)))) {
    adapters.push({ id: "pytest", ecosystem: "python", manifest: "pyproject.toml", available: commandExists("pytest", root), commands: ["pytest"] });
  }
  if (fileExists(path.join(root, "go.mod"))) {
    adapters.push({ id: "go", ecosystem: "go", manifest: "go.mod", available: commandExists("go", root), commands: ["go test ./..."] });
  }
  if (fileExists(path.join(root, "Cargo.toml"))) {
    adapters.push({ id: "cargo", ecosystem: "rust", manifest: "Cargo.toml", available: commandExists("cargo", root), commands: ["cargo test"] });
  }
  if (fileExists(path.join(root, "pom.xml"))) {
    adapters.push({ id: "maven", ecosystem: "java", manifest: "pom.xml", available: commandExists("mvn", root), commands: ["mvn test"] });
  }
  const gradleManifest = ["build.gradle", "build.gradle.kts"].find((file) => fileExists(path.join(root, file)));
  if (gradleManifest) {
    const gradlew = fileExists(path.join(root, "gradlew")) ? "./gradlew" : "gradle";
    adapters.push({ id: "gradle", ecosystem: "jvm", manifest: gradleManifest, available: gradlew === "./gradlew" || commandExists("gradle", root), commands: [`${gradlew} test`] });
  }
  if (["MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel"].some((file) => fileExists(path.join(root, file)))) {
    adapters.push({ id: "bazel", ecosystem: "polyglot", manifest: "MODULE.bazel", available: commandExists("bazel", root), commands: ["bazel test //..."] });
  }
  return adapters;
}

export function workspaceDiagnostics(root: string, args: RuntimeArgs = {}): CoreResult {
  const repoEntries = intelRepoRoots(root, args);
  const repoDiagnostics = repoEntries.map((entry) => {
    const adapters: JsonObject[] = detectWorkspaceAdapters(entry.root).map((rawAdapter): JsonObject => {
      const adapter = asJsonObject(rawAdapter);
      return {
      ...adapter,
      repo: entry.repo,
      cwd: entry.root,
      path: entry.path,
      };
    });
    const commands = adapters.flatMap((adapter) =>
      asStringArray(adapter.commands).map((command) => ({
        ...shellCommandPlan(command, entry.root, asString(adapter.id)),
        repo: entry.repo,
        path: entry.path,
      }))
    );
    return { repo: entry.repo, root: entry.root, path: entry.path, adapters, commands };
  });
  const adapters = repoDiagnostics.flatMap((entry) => asArray(entry.adapters));
  const commands = repoDiagnostics.flatMap((entry) => asArray(entry.commands));
  const execute = args.execute === true;
  return {
    ok: true,
    root,
    execute,
    dry_run: !execute,
    adapters,
    commands,
    repos: repoDiagnostics,
    results: execute ? commands.map((entry) => runCommand(asString(entry.command), [], {
      cwd: asString(entry.cwd, root),
      shell: true,
      timeoutMs: Number(args.timeoutMs || 10 * 60 * 1000),
      maxBuffer: 30 * 1024 * 1024,
    })) : [],
  };
}

export function impactedFiles(root: string, args: RuntimeArgs = {}): string[] {
  if (Array.isArray(args.files) && args.files.length > 0) return args.files.map(normalizeClaimPath).filter(Boolean);
  if (args.base || args.head) {
    return diffSurface(root, args.base || "main", args.head || "HEAD").files;
  }
  return [];
}

export function testImpact(root: string, args: RuntimeArgs = {}): CoreResult {
  const repoEntries = intelRepoRoots(root, args);
  const repoImpacts = repoEntries.map((entry) => {
    const files = impactedFiles(entry.root, args);
    const likelyTests = Object.fromEntries(files.map((file) => [file, likelyTestCandidatesForFile(entry.root, file)]));
    const manifests = new Set<string>();
    for (const file of files) {
      let dir = path.dirname(path.join(entry.root, file));
      while (dir.startsWith(entry.root)) {
        for (const manifest of ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "MODULE.bazel", "nx.json"]) {
          const candidate = path.join(dir, manifest);
          if (fileExists(candidate)) manifests.add(normalizeClaimPath(path.relative(entry.root, candidate)));
        }
        if (dir === entry.root) break;
        dir = path.dirname(dir);
      }
    }
    return {
      repo: entry.repo,
      root: entry.root,
      path: entry.path,
      files,
      likely_tests: likelyTests,
      manifests: Array.from(manifests).sort(),
      adapters: detectWorkspaceAdapters(entry.root),
    };
  });
  const primary = repoImpacts[0] || { files: [], likely_tests: {}, manifests: [], adapters: [] };
  const files = asStringArray(primary.files);
  return {
    ok: true,
    root,
    files,
    likely_tests: asJsonObject(primary.likely_tests),
    manifests: asStringArray(primary.manifests),
    adapters: asArray(primary.adapters),
    repos: repoImpacts,
  };
}

export function dependencyGraph(root: string, args: RuntimeArgs = {}): CoreResult {
  const repoEntries = intelRepoRoots(root, args);
  const manifestPatterns = new Set([
    "package.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "MODULE.bazel",
    "WORKSPACE",
    "WORKSPACE.bazel",
    "nx.json",
  ]);
  const repoGraphs = repoEntries.map((entry) => {
    const files = listWorkspaceFiles(entry.root).filter((file) => !isIgnoredRepoMapFile(file));
    const manifests = files
      .filter((file) => manifestPatterns.has(path.basename(file)))
      .map((file) => ({ repo: entry.repo, file, dir: normalizeClaimPath(path.dirname(file)), kind: path.basename(file) }));
    return {
      repo: entry.repo,
      root: entry.root,
      path: entry.path,
      manifests,
      adapters: detectWorkspaceAdapters(entry.root),
      edges: manifests.map((manifest) => ({
        repo: entry.repo,
        from: manifest.file,
        to: manifest.dir || ".",
        kind: "workspace_manifest",
      })),
    };
  });
  const manifests = repoGraphs.flatMap((entry) => asArray(entry.manifests));
  const edges = repoGraphs.flatMap((entry) => asArray(entry.edges));
  return {
    ok: true,
    root,
    manifests,
    adapters: repoGraphs.flatMap((entry) => asArray(entry.adapters)),
    edges,
    repos: repoGraphs,
  };
}
