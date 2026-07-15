import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".worktrees",
  ".agents",
  ".claude",
  ".claude-plugin",
  ".cache",
  ".codex",
  ".codex-plugin",
  ".copilot",
  ".dart_tool",
  ".gemini",
  ".gradle",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".serverless",
  "node_modules",
  "vendor",
  "cadre-ai",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vite",
  ".venv",
  "venv",
  "__pycache__",
  "__generated__",
  "generated",
  "gen",
  "tmp",
  "temp",
  "logs",
  "Pods",
  "DerivedData",
  ".idea",
  ".vscode",
]);

const DEFAULT_IGNORE_PATHS = [
  "plugins/cadre",
  "plugins/cadre-claude",
  "plugins/cadre-copilot",
  "plugins/cadre-antigravity",
];

export function normalizeRel(file: string): string {
  return file.split(path.sep).join("/");
}

function matchesIgnoredPath(rel: string, ignored: string): boolean {
  return rel === ignored
    || rel.startsWith(`${ignored}/`)
    || rel.endsWith(`/${ignored}`)
    || rel.includes(`/${ignored}/`);
}

interface PackageMarkerCacheEntry {
  signature: string;
  isCadre: boolean;
}

const packageMarkerCache = new Map<string, PackageMarkerCacheEntry>();

function cadrePackageDirectory(directory: string): boolean {
  const manifest = path.join(directory, "package.json");
  let signature: string;
  try {
    const stat = fs.statSync(manifest);
    signature = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    try {
      signature = `missing:${fs.statSync(directory).mtimeMs}`;
    } catch {
      return false;
    }
  }
  const cached = packageMarkerCache.get(directory);
  if (cached?.signature === signature) return cached.isCadre;
  let isCadre = false;
  if (!signature.startsWith("missing:")) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
      isCadre = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        && (parsed as { name?: unknown }).name === "cadre-ai";
    } catch {
      // An unreadable package manifest is not affirmative Cadre runtime evidence.
    }
  }
  packageMarkerCache.set(directory, { signature, isCadre });
  return isCadre;
}

function nestedCadrePackagePath(root: string, file: string): boolean {
  if (!root) return false;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(root, file);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) return false;
  let directory: string;
  try {
    directory = fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
  } catch {
    directory = path.dirname(candidate);
  }
  while (directory !== resolvedRoot && directory.startsWith(`${resolvedRoot}${path.sep}`)) {
    if (cadrePackageDirectory(directory)) return true;
    directory = path.dirname(directory);
  }
  return false;
}

export function shouldIgnore(root: string, fullPath: string, name: string): boolean {
  if (DEFAULT_IGNORES.has(name)) return true;
  const rel = normalizeRel(path.relative(root, fullPath));
  return isIgnoredFile(root, rel);
}

export function isIgnoredFile(root: string, file: string): boolean {
  const rel = normalizeRel(file);
  if (rel.split("/").some((part) => DEFAULT_IGNORES.has(part))) return true;
  if (DEFAULT_IGNORE_PATHS.some((ignored) => matchesIgnoredPath(rel, ignored))) return true;
  return nestedCadrePackagePath(root, file);
}
