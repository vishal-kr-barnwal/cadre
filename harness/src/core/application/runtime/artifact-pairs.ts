import fs from "node:fs";
import path from "node:path";

import type { JsonObject } from "../../../types";
import { errorMessage } from "../../../guards";
import { withLock } from "../../infrastructure/runtime/locking";
import type { CoreResult } from "./contracts";

export interface AtomicArtifactFile {
  path: string;
  content: string | null;
}

export interface AtomicArtifactWriteOptions {
  lock?: boolean;
  lockName?: string;
  simulateFailureAfter?: number;
}

interface BeforeFile {
  path: string;
  existed: boolean;
  content: Buffer | null;
}

function normalizedPath(root: string, file: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, file);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function temporaryPath(file: string, index: number): string {
  return `${file}.${process.pid}.${Date.now()}.${index}.cadre-tmp`;
}

function restore(before: BeforeFile[]): string[] {
  const errors: string[] = [];
  for (const item of before.slice().reverse()) {
    try {
      if (!item.existed) {
        fs.rmSync(item.path, { force: true });
      } else if (item.content) {
        const temporary = temporaryPath(item.path, 0);
        fs.writeFileSync(temporary, item.content);
        fs.renameSync(temporary, item.path);
      }
    } catch (error) {
      errors.push(`${item.path}: ${errorMessage(error)}`);
    }
  }
  return errors;
}

function writeUnlocked(root: string, files: AtomicArtifactFile[], options: AtomicArtifactWriteOptions): CoreResult {
  const unique = new Set<string>();
  const prepared: Array<AtomicArtifactFile & { target: string; temporary: string | null }> = [];
  for (const [index, file] of files.entries()) {
    const target = normalizedPath(root, file.path);
    if (!target) return { ok: false, stage: "artifact_path", error: `Unsafe or empty artifact path: ${file.path}` };
    if (unique.has(target)) return { ok: false, stage: "artifact_path", error: `Duplicate artifact path: ${file.path}` };
    unique.add(target);
    prepared.push({ ...file, target, temporary: file.content === null ? null : temporaryPath(target, index) });
  }
  const before: BeforeFile[] = prepared.map((file) => ({
    path: file.target,
    existed: fs.existsSync(file.target),
    content: fs.existsSync(file.target) ? fs.readFileSync(file.target) : null,
  }));
  try {
    for (const file of prepared) {
      if (file.content === null || !file.temporary) continue;
      fs.mkdirSync(path.dirname(file.target), { recursive: true });
      fs.writeFileSync(file.temporary, file.content);
    }
    for (const [index, file] of prepared.entries()) {
      if (file.content === null) fs.rmSync(file.target, { force: true });
      else if (file.temporary) fs.renameSync(file.temporary, file.target);
      if (options.simulateFailureAfter === index + 1) throw new Error(`Simulated failure after ${index + 1} artifact write(s)`);
    }
    return {
      ok: true,
      files: prepared.map((file) => path.relative(root, file.target).split(path.sep).join("/")),
    };
  } catch (error) {
    for (const file of prepared) if (file.temporary) fs.rmSync(file.temporary, { force: true });
    const rollbackErrors = restore(before);
    return {
      ok: false,
      stage: "artifact_pair_write",
      error: errorMessage(error),
      rolled_back: rollbackErrors.length === 0,
      rollback_errors: rollbackErrors,
    };
  }
}

export function writeArtifactFilesAtomic(
  root: string,
  files: AtomicArtifactFile[],
  options: AtomicArtifactWriteOptions = {}
): CoreResult {
  const operation = () => writeUnlocked(root, files, options);
  if (options.lock === false) return operation();
  return withLock(root, options.lockName || "artifact-projections", operation) as CoreResult;
}

export function writeArtifactPairAtomic(
  root: string,
  canonicalPath: string,
  canonicalContent: string,
  projectionPath: string,
  projectionContent: string,
  options: AtomicArtifactWriteOptions = {}
): CoreResult {
  return writeArtifactFilesAtomic(root, [
    { path: canonicalPath, content: canonicalContent },
    { path: projectionPath, content: projectionContent },
  ], options);
}

export function jsonContent(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
