import { spawnSync } from "node:child_process";
import path from "node:path";

type CacheEntry<T> = {
  value: T;
  createdAt: number;
};

const CACHE = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 30_000;

function gitHead(root: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() || "unknown" : "nogit";
}

export function workspaceCacheKey(root: string, scope: string, discriminator = ""): string {
  return JSON.stringify({
    root: path.resolve(root),
    head: gitHead(root),
    scope,
    discriminator,
  });
}

export function cachedWorkspaceValue<T>(root: string, scope: string, discriminator: string, producer: () => T, ttlMs = DEFAULT_TTL_MS): T {
  const key = workspaceCacheKey(root, scope, discriminator);
  const now = Date.now();
  const existing = CACHE.get(key) as CacheEntry<T> | undefined;
  if (existing && now - existing.createdAt <= ttlMs) return existing.value;
  const value = producer();
  CACHE.set(key, { value, createdAt: now });
  if (CACHE.size > 200) {
    const oldest = Array.from(CACHE.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, 40);
    for (const [oldKey] of oldest) CACHE.delete(oldKey);
  }
  return value;
}
