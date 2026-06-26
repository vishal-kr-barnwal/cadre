import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asOptionalString } from "../../../guards";
import type { ReviewFile } from "./contracts";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { hasGeneratedMarker } from "./markdown-docs";

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
  for (const file of reviewFiles) {
    const targetPath = safeTargetPath(root, file.path);
    if (!targetPath) {
      errors.push(`Refusing unsafe review target path: ${file.path}`);
      continue;
    }
    const exists = fileExists(targetPath);
    const existing = exists ? fs.readFileSync(targetPath, "utf8") : "";
    const changed = !exists || existing !== file.content;
    const generatedProjection = exists && hasGeneratedMarker(existing);
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
    if (changed) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, file.content);
    }
    files.push({
      path: file.path,
      review_path: targetPath,
      target_path: targetPath,
      title: file.title,
      kind: file.kind,
      source: file.source,
      missing: file.missing === true,
      changed,
      ...reviewStats(file.content),
    });
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
    warnings,
    errors,
    ...(error ? { error } : {}),
    files,
    ...manifestExtras,
  };
}
