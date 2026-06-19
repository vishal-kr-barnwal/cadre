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

function hasCadreDirectory(dir: string): boolean {
  return isDirectory(path.join(dir, "cadre"));
}

function isCadreStateDirectory(dir: string): boolean {
  return [
    "tracks.json",
    "setup_state.json",
    "product.md",
    "tech-stack.json",
    "workflow.md",
    "beads.json",
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
  candidate = path.resolve(candidate);
  try {
    if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) candidate = path.dirname(candidate);
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
  const cadreRoot = findCadreRoot(normalized);
  if (cadreRoot) return { root: cadreRoot, has_cadre: true };
  return { root: normalized, has_cadre: false };
}

export function requireCadreRoot(args: RuntimeArgs = {}): string {
  const info = rootFromCandidate(args.root);
  if (info && info.has_cadre) return info.root;
  throw Object.assign(
    new Error(
      `This Cadre MCP tool requires { root } pointing at, or inside, a project containing cadre/. Received: ${args.root || "(missing)"}`
    ),
    { code: -32602 }
  );
}
