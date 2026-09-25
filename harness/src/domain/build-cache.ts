import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentHash, readSafeArtifact } from "./memory.js";
import { safeProjectRoot } from "./paths.js";

/** Only this owned subtree is ignored; unrelated .build-cache files remain visible. */
export function executionBuildCache(rootInput: string, trackId: string, executionId: string): string {
  const root = safeProjectRoot(rootInput), parent = ".cadre/.build-cache/cadre", marker = `${parent}/owner.json`;
  if (!/^[a-z0-9-]+$/.test(trackId) || !/^[a-zA-Z0-9-]+$/.test(executionId)) throw new Error("Invalid cache owner");
  const ignore = readSafeArtifact(root, ".cadre/.gitignore");
  if (!ignore.split(/\r?\n/).includes("/.build-cache/cadre/")) throw new Error("Owned build cache must be explicitly ignored by approved project setup/refresh");
  const content = JSON.stringify({ schemaVersion: 1, owner: "cadre", project: contentHash(root) });
  if (existsSync(join(root, marker))) {
    if (readSafeArtifact(root, marker) !== content) throw new Error("Build cache belongs to another project");
  } else {
    if (existsSync(join(root, parent)) && readdirSync(join(root, parent)).length) throw new Error("Refusing to adopt an unowned build cache");
    // Safe read checks every existing ancestor, including symlinks.
    try { readSafeArtifact(root, marker); } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
    mkdirSync(join(root, parent), { recursive: true }); writeFileSync(join(root, marker), content, { flag: "wx" });
  }
  const path = join(root, parent, trackId, executionId);
  try { readSafeArtifact(root, `${parent}/${trackId}/${executionId}/.ownership-check`); } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
  mkdirSync(path, { recursive: true });
  return path;
}
