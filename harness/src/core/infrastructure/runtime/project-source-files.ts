import fs from "node:fs";
import path from "node:path";

import {
  PROJECT_SKILL_MAX_FILE_BYTES,
  PROJECT_SKILL_REFERENCE_EXTENSIONS,
} from "../../domain/project-skill-policy";

export type ProjectSourceFileResult =
  | {
      ok: true;
      canonicalRoot: string;
      canonicalPath: string;
      relativePath: string;
      bytes: Buffer;
    }
  | { ok: false; kind: "path" | "source" };

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function noSymlinkComponents(root: string, relativePath: string): boolean {
  let current = root;
  const components = relativePath.split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]!);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return false;
    if (index < components.length - 1 && !stat.isDirectory()) return false;
  }
  return true;
}

export function readProjectSourceFile(root: string, requestedPath: string): ProjectSourceFileResult {
  if (
    !requestedPath
    || path.isAbsolute(requestedPath)
    || !PROJECT_SKILL_REFERENCE_EXTENSIONS.has(path.extname(requestedPath).toLowerCase())
  ) return { ok: false, kind: "path" };

  let descriptor: number | null = null;
  try {
    const canonicalRoot = fs.realpathSync(path.resolve(root));
    const candidate = path.resolve(canonicalRoot, requestedPath);
    if (!inside(canonicalRoot, candidate)) return { ok: false, kind: "path" };
    const relativePath = path.relative(canonicalRoot, candidate);
    if (!noSymlinkComponents(canonicalRoot, relativePath)) return { ok: false, kind: "path" };
    const canonicalPath = fs.realpathSync(candidate);
    if (canonicalPath !== candidate || !inside(canonicalRoot, canonicalPath)) {
      return { ok: false, kind: "path" };
    }

    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    descriptor = fs.openSync(canonicalPath, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > PROJECT_SKILL_MAX_FILE_BYTES) {
      return { ok: false, kind: "source" };
    }
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length > PROJECT_SKILL_MAX_FILE_BYTES || bytes.subarray(0, 8192).includes(0)) {
      return { ok: false, kind: "source" };
    }
    return { ok: true, canonicalRoot, canonicalPath, relativePath, bytes };
  } catch {
    return { ok: false, kind: "path" };
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* best-effort cleanup */ }
    }
  }
}
