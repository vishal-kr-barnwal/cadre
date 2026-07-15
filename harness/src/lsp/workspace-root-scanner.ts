import fs from "node:fs";
import path from "node:path";

import { shouldIgnore } from "./ignore-policy";
import { listWorkspaceFiles, type WorkspaceScanResult } from "./language-registry";

function normalizedRelativePath(value: string): string {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

function safeNestedRoot(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    if (!fs.statSync(target).isDirectory()) return null;
    const realRoot = fs.realpathSync(resolvedRoot);
    const realTarget = fs.realpathSync(target);
    const realRelative = path.relative(realRoot, realTarget);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) return null;
  } catch {
    return null;
  }
  return target;
}

export function scanWorkspaceRoots(root: string, nestedRoots: string[]): WorkspaceScanResult {
  const files = new Set(listWorkspaceFiles(root).map(normalizedRelativePath));
  for (const declared of Array.from(new Set(nestedRoots))) {
    const nestedRoot = safeNestedRoot(root, declared);
    if (!nestedRoot) continue;
    const prefix = normalizedRelativePath(path.relative(root, nestedRoot));
    for (const nestedFile of listWorkspaceFiles(nestedRoot)) {
      files.add(`${prefix}/${normalizedRelativePath(nestedFile)}`);
    }
  }

  const counts = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const filenameCounts = new Map<string, number>();
  const filenameSamples = new Map<string, string[]>();
  for (const relative of Array.from(files).sort()) {
    const full = path.join(root, relative);
    const name = path.basename(relative);
    if (shouldIgnore(root, full, name)) continue;
    const extension = path.extname(name).toLowerCase();
    if (extension) {
      counts.set(extension, (counts.get(extension) || 0) + 1);
      const extensionSamples = samples.get(extension) || [];
      if (extensionSamples.length < 5) extensionSamples.push(relative);
      samples.set(extension, extensionSamples);
    }
    const lowerName = name.toLowerCase();
    filenameCounts.set(lowerName, (filenameCounts.get(lowerName) || 0) + 1);
    const nameSamples = filenameSamples.get(lowerName) || [];
    if (nameSamples.length < 5) nameSamples.push(relative);
    filenameSamples.set(lowerName, nameSamples);
  }
  return { counts, samples, filenameCounts, filenameSamples };
}
