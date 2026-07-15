import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeArgs } from "../../types";

function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function jsonName(file: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && typeof (parsed as { name?: unknown }).name === "string"
      ? (parsed as { name: string }).name
      : null;
  } catch {
    return null;
  }
}

function packageName(dir: string): string | null {
  return jsonName(path.join(dir, "package.json"));
}

function hasCadrePluginManifest(dir: string): boolean {
  return [".codex-plugin", ".claude-plugin"]
    .some((folder) => jsonName(path.join(dir, folder, "plugin.json")) === "cadre");
}

function isCadreRuntimeDirectory(dir: string): boolean {
  if (
    packageName(dir) === "cadre-ai"
    && isDirectory(path.join(dir, "scripts", "mcp"))
    && fs.existsSync(path.join(dir, "scripts", "mcp", "cadre-server.js"))
  ) return true;
  return hasCadrePluginManifest(dir)
    && isDirectory(path.join(dir, "skills"))
    && [".mcp.json", "mcp-config.json"].some((file) => fs.existsSync(path.join(dir, file)));
}

function containingCadreRuntime(start: string): string | null {
  let dir = start;
  while (true) {
    if (isCadreRuntimeDirectory(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function hasCadreDirectory(dir: string): boolean {
  return isDirectory(path.join(dir, "cadre"));
}

function isCadreStateDirectory(dir: string): boolean {
  return [
    "tracks.json",
    "setup_state.json",
    "product.json",
    "tech-stack.json",
    "workflow.json",
    "config.json",
    "repos.json",
  ].some((name) => fs.existsSync(path.join(dir, name))) || isDirectory(path.join(dir, "tracks"));
}

function hasCadreProjectState(dir: string): boolean {
  return hasCadreDirectory(dir) && isCadreStateDirectory(path.join(dir, "cadre"));
}

function normalizePathCandidate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  let candidate = value.trim();
  if (candidate.startsWith("file://")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      return null;
    }
  }
  if (!path.isAbsolute(candidate)) return null;
  try {
    if (!fs.statSync(candidate).isDirectory()) return null;
    candidate = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  return candidate;
}

export function findCadreRoot(start: unknown): string | null {
  let dir = normalizePathCandidate(start);
  if (!dir) return null;
  while (true) {
    if (hasCadreProjectState(dir)) return dir;
    if (path.basename(dir) === "cadre" && isCadreStateDirectory(dir)) return path.dirname(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function rootFromCandidate(candidate: unknown): { root: string; has_cadre: boolean } | null {
  const normalized = normalizePathCandidate(candidate);
  if (!normalized) return null;
  if (containingCadreRuntime(normalized)) return null;
  const cadreRoot = findCadreRoot(normalized);
  return cadreRoot
    ? { root: cadreRoot, has_cadre: true }
    : { root: normalized, has_cadre: false };
}

export function setupRootFromCandidate(candidate: unknown): { root: string; has_cadre: boolean } | null {
  const normalized = normalizePathCandidate(candidate);
  if (!normalized || containingCadreRuntime(normalized)) return null;
  if (path.basename(normalized) === "cadre" && isCadreStateDirectory(normalized)) {
    return { root: path.dirname(normalized), has_cadre: true };
  }
  return { root: normalized, has_cadre: hasCadreProjectState(normalized) };
}

export function requireCadreRoot(args: RuntimeArgs = {}): string {
  const root = findCadreRoot(args.root);
  if (root && !containingCadreRuntime(root)) return root;
  throw Object.assign(
    new Error(
      `This Cadre MCP tool requires { root } pointing at, or inside, a project containing cadre/. Received: ${args.root || "(missing)"}`
    ),
    { code: -32602 }
  );
}
