import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asOptionalString } from "../../../guards";
import type { ReviewFile } from "./contracts";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { hasGeneratedMarker } from "./markdown-docs";
import { writeArtifactFilesAtomic } from "./artifact-pairs";

export function reviewOutputMode(args: RuntimeArgs = {}): "target" | "bundle" {
  const rawArgs = args as UnknownRecord;
  const requested = asOptionalString(rawArgs.reviewOutputMode || rawArgs.review_output_mode)?.toLowerCase();
  if (requested === "bundle" || requested === "temp" || requested === "temporary") return "bundle";
  if (rawArgs.reviewBundleDir || rawArgs.review_bundle_dir || rawArgs.reviewDir || rawArgs.review_dir) return "bundle";
  return "target";
}

function safeTargetPath(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function targetFileDirty(root: string, relativePath: string): boolean {
  const result = spawnSync("git", ["status", "--porcelain", "--", relativePath], { cwd: root, encoding: "utf8" });
  return result.status !== 0 || result.stdout.trim().length > 0;
}

function git(root: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

function gitAvailable(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"]).status === 0;
}

export interface ReviewGitInspection {
  ok: boolean;
  stagedPaths: string[];
  baselinePaths: string[];
  error?: string;
}

export interface ReviewHeadFile {
  path: string;
  existed: boolean;
  content: string | null;
}

export interface ReviewHeadExpectation extends ReviewHeadFile {
  allowMissing?: boolean;
}

interface ReviewHeadFilesResult {
  ok: boolean;
  available: boolean;
  files: ReviewHeadFile[];
  error?: string;
}

export function reviewHeadFiles(root: string, relativePaths: string[]): ReviewHeadFilesResult {
  if (!gitAvailable(root)) return { ok: true, available: false, files: [] };
  const paths = Array.from(new Set(relativePaths));
  const head = git(root, ["rev-parse", "--verify", "HEAD"]);
  if (head.status === 128) {
    return { ok: true, available: true, files: paths.map((path) => ({ path, existed: false, content: null })) };
  }
  if (head.status !== 0) {
    return {
      ok: false,
      available: true,
      files: [],
      error: String(head.stderr || "").trim() || "Unable to inspect the Git review baseline",
    };
  }
  const files: ReviewHeadFile[] = [];
  for (const relativePath of paths) {
    const tree = git(root, ["ls-tree", "-z", "--full-tree", "HEAD", "--", relativePath]);
    if (tree.status !== 0) {
      return {
        ok: false,
        available: true,
        files,
        error: String(tree.stderr || "").trim() || `Unable to inspect Git baseline for ${relativePath}`,
      };
    }
    if (String(tree.stdout).length === 0) {
      files.push({ path: relativePath, existed: false, content: null });
      continue;
    }
    const blob = git(root, ["cat-file", "blob", `HEAD:${relativePath}`]);
    if (blob.status === 0) {
      files.push({ path: relativePath, existed: true, content: String(blob.stdout) });
      continue;
    }
    return {
      ok: false,
      available: true,
      files,
      error: String(blob.stderr || "").trim() || `Unable to read Git baseline for ${relativePath}`,
    };
  }
  return { ok: true, available: true, files };
}

export function inspectReviewGitState(
  root: string,
  relativePaths: string[],
  headExpectations: ReviewHeadExpectation[] = [],
): ReviewGitInspection {
  if (!gitAvailable(root)) return { ok: true, stagedPaths: [], baselinePaths: [] };
  const stagedPaths: string[] = [];
  for (const relativePath of Array.from(new Set(relativePaths))) {
    const result = git(root, ["diff", "--cached", "--quiet", "--ita-invisible-in-index", "--", relativePath]);
    if (result.status === 1) {
      stagedPaths.push(relativePath);
      continue;
    }
    if (result.status !== 0) {
      return {
        ok: false,
        stagedPaths,
        baselinePaths: [],
        error: String(result.stderr || "").trim() || `Unable to inspect staged review target ${relativePath}`,
      };
    }
  }

  const head = reviewHeadFiles(root, headExpectations.map((expectation) => expectation.path));
  if (!head.ok) {
    return {
      ok: false,
      stagedPaths,
      baselinePaths: [],
      error: head.error || "Unable to inspect the Git review baseline",
    };
  }
  const currentByPath = new Map(head.files.map((file) => [file.path, file]));
  const baselinePaths = head.available
    ? headExpectations.filter((expected) => {
        const current = currentByPath.get(expected.path) || { path: expected.path, existed: false, content: null };
        if (expected.allowMissing === true && !current.existed) return false;
        return current.existed !== expected.existed
          || (current.existed && current.content !== expected.content);
      }).map((expected) => expected.path)
    : [];
  return {
    ok: stagedPaths.length === 0 && baselinePaths.length === 0,
    stagedPaths,
    baselinePaths: Array.from(new Set(baselinePaths)),
  };
}

function addIntentToAdd(root: string, relativePaths: string[]): { paths: string[]; warnings: string[]; error?: string } {
  if (relativePaths.length === 0 || !gitAvailable(root)) return { paths: [], warnings: [] };
  const paths: string[] = [];
  const warnings: string[] = [];
  for (const relativePath of relativePaths) {
    if (git(root, ["check-ignore", "-q", "--", relativePath]).status === 0) {
      warnings.push(`Review artifact is ignored and cannot be made visible with intent-to-add: ${relativePath}`);
      continue;
    }
    if (git(root, ["ls-files", "--error-unmatch", "--", relativePath]).status === 0) continue;
    const added = git(root, ["add", "-N", "--", relativePath]);
    if (added.status !== 0) {
      removeReviewIntentToAdd(root, paths);
      return { paths: [], warnings, error: String(added.stderr || "").trim() || `Unable to mark ${relativePath} intent-to-add` };
    }
    paths.push(relativePath);
  }
  return { paths, warnings };
}

export function removeReviewIntentToAdd(root: string, relativePaths: string[]): string[] {
  if (!gitAvailable(root)) return [];
  const removed: string[] = [];
  for (const relativePath of Array.from(new Set(relativePaths))) {
    if (git(root, ["cat-file", "-e", `HEAD:${relativePath}`]).status === 0) continue;
    const stagedContent = git(root, ["diff", "--cached", "--quiet", "--ita-invisible-in-index", "--", relativePath]);
    if (stagedContent.status !== 0) continue;
    const result = git(root, ["update-index", "--force-remove", "--", relativePath]);
    if (result.status === 0) removed.push(relativePath);
  }
  return removed;
}

function reviewStats(text: string): JsonObject {
  const normalized = text.replace(/\n*$/, "\n");
  return {
    bytes: Buffer.byteLength(normalized, "utf8"),
    lines: normalized.split("\n").length - 1,
    sha256: crypto.createHash("sha256").update(normalized).digest("hex"),
  };
}

export function targetReviewBundle(root: string, workflow: string, args: RuntimeArgs, reviewFiles: ReviewFile[], manifestExtras: JsonObject): JsonObject | null {
  const stage = asOptionalString(manifestExtras.approval_stage);
  if (!stage) return null;
  const warnings: string[] = [];
  const errors: string[] = [];
  const files: JsonObject[] = [];
  const pendingWrites: Array<{ path: string; content: string }> = [];
  const before = new Map<string, { existed: boolean; content: string }>();
  const newPaths: string[] = [];
  const continuingSession = Boolean(args.approvalSessionId || args.approval_session_id);
  for (const file of reviewFiles) {
    const targetPath = safeTargetPath(root, file.path);
    if (!targetPath) {
      errors.push(`Refusing unsafe review target path: ${file.path}`);
      continue;
    }
    const exists = fileExists(targetPath);
    const existing = exists ? fs.readFileSync(targetPath, "utf8") : "";
    before.set(file.path, { existed: exists, content: existing });
    const changed = file.missing !== true && (!exists || existing !== file.content);
    const generatedProjection = exists && hasGeneratedMarker(existing);
    if (continuingSession && changed) {
      errors.push(`Review target changed after the approval snapshot was created: ${file.path}`);
      files.push({
        path: file.path,
        review_path: targetPath,
        target_path: targetPath,
        title: file.title,
        kind: file.kind,
        source: file.source,
        missing: file.missing === true,
        conflict: true,
        ...reviewStats(file.content),
      });
      continue;
    }
    if (exists && changed && targetFileDirty(root, file.path) && !generatedProjection && args.force !== true) {
      errors.push(`Refusing to overwrite dirty review target ${file.path}`);
      files.push({
        path: file.path,
        review_path: targetPath,
        target_path: targetPath,
        title: file.title,
        kind: file.kind,
        source: file.source,
        missing: file.missing === true,
        conflict: true,
        ...reviewStats(file.content),
      });
      continue;
    }
    if (changed) pendingWrites.push({ path: file.path, content: file.content });
    if (!exists && file.missing !== true) newPaths.push(file.path);
    files.push({
      path: file.path,
      review_path: targetPath,
      target_path: targetPath,
      title: file.title,
      kind: file.kind,
      source: file.source,
      document_id: file.documentId || null,
      review_role: file.reviewRole || null,
      canonical_path: file.canonicalPath || null,
      projection_path: file.projectionPath || null,
      approval_group: file.approvalGroup || null,
      missing: file.missing === true,
      changed,
      ...reviewStats(file.content),
    });
  }
  if (errors.length === 0 && pendingWrites.length > 0) {
    const write = writeArtifactFilesAtomic(root, pendingWrites, { lockName: `review-${workflow}` });
    if (write.ok === false) errors.push(asOptionalString(write.error) || "Unable to materialize review files atomically");
  }
  let intentPaths: string[] = [];
  if (errors.length === 0) {
    const intent = addIntentToAdd(root, newPaths);
    warnings.push(...intent.warnings);
    if (intent.error) {
      errors.push(intent.error);
      const restoreWrites: Array<{ path: string; content: string }> = [];
      for (const [relativePath, original] of before) {
        if (original.existed) restoreWrites.push({ path: relativePath, content: original.content });
        else fs.rmSync(path.join(root, relativePath), { force: true });
      }
      if (restoreWrites.length > 0) writeArtifactFilesAtomic(root, restoreWrites, { lockName: `review-${workflow}-rollback` });
    } else {
      intentPaths = intent.paths;
    }
  }
  const error = errors[0] || null;
  return {
    ok: errors.length === 0,
    mode: "target",
    workflow,
    directory: root,
    manifest_path: null,
    content_in_response: false,
    mutates_worktree: true,
    intent_to_add_paths: intentPaths,
    warnings,
    errors,
    ...(error ? { error } : {}),
    files,
    ...manifestExtras,
  };
}
