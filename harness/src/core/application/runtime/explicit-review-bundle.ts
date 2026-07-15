import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { asOptionalString } from "../../../guards";
import type { ReviewFile } from "./contracts";
import type { ApprovalStageRecord } from "./approval-session-model";

interface ExplicitBundleRemoval {
  path: string;
  target: string;
  content: string;
}

export interface ExplicitBundleCleanupResult {
  ok: boolean;
  error?: string;
}

function explicitBundleTarget(directory: string, relativePath: string): string | null {
  const resolvedDirectory = path.resolve(directory);
  const target = path.resolve(resolvedDirectory, relativePath);
  const relative = path.relative(resolvedDirectory, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function restoreExplicitBundleRemoval(removal: ExplicitBundleRemoval): void {
  fs.mkdirSync(path.dirname(removal.target), { recursive: true });
  const temporary = `${removal.target}.cadre-rollback-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, removal.content, { flag: "wx" });
    fs.renameSync(temporary, removal.target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function reconcileExplicitBundleMembership(
  directory: string,
  reviewFiles: ReviewFile[],
  previousStage: ApprovalStageRecord,
): ExplicitBundleCleanupResult {
  const nextPaths = new Set(reviewFiles.map((file) => file.path));
  const removedSnapshots = previousStage.snapshot_files.filter((file) => !nextPaths.has(file.path));
  if (removedSnapshots.length === 0) return { ok: true };

  const previews = new Map(previousStage.preview_files.flatMap((preview) => {
    const previewPath = asOptionalString(preview.path);
    return previewPath ? [[previewPath, preview] as const] : [];
  }));
  const removals: ExplicitBundleRemoval[] = [];
  let realDirectory: string;
  try {
    realDirectory = fs.realpathSync(directory);
  } catch (error) {
    return { ok: false, error: `Cannot reconcile the explicit review bundle because its directory is unavailable: ${String(error)}` };
  }

  for (const snapshot of removedSnapshots) {
    const target = explicitBundleTarget(directory, snapshot.path);
    const previewTarget = asOptionalString(previews.get(snapshot.path)?.review_path);
    if (!target || !previewTarget || path.resolve(previewTarget) !== target) {
      return { ok: false, error: `Cannot safely remove obsolete explicit review file ${snapshot.path}; its prior preview location is invalid.` };
    }
    try {
      const targetStat = fs.lstatSync(target);
      const realParent = fs.realpathSync(path.dirname(target));
      const relativeParent = path.relative(realDirectory, realParent);
      const parentInsideBundle = relativeParent === ""
        || (!relativeParent.startsWith("..") && !path.isAbsolute(relativeParent));
      if (!targetStat.isFile() || !parentInsideBundle) {
        return { ok: false, error: `Cannot safely remove obsolete explicit review file ${snapshot.path}; it is not a regular file inside the review bundle.` };
      }
      const content = fs.readFileSync(target, "utf8");
      if (content !== snapshot.content) {
        return { ok: false, error: `Explicit review bundle drift detected for ${snapshot.path}; the prior preview changed after it was generated.` };
      }
      removals.push({ path: snapshot.path, target, content });
    } catch (error) {
      return { ok: false, error: `Cannot verify obsolete explicit review file ${snapshot.path}: ${String(error)}` };
    }
  }

  const removed: ExplicitBundleRemoval[] = [];
  try {
    for (const removal of removals) {
      fs.unlinkSync(removal.target);
      removed.push(removal);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const removal of removed.reverse()) {
      try {
        restoreExplicitBundleRemoval(removal);
      } catch (rollbackError) {
        rollbackErrors.push(`${removal.path}: ${String(rollbackError)}`);
      }
    }
    const rollback = rollbackErrors.length > 0 ? ` Rollback also failed for ${rollbackErrors.join("; ")}.` : "";
    return { ok: false, error: `Cannot remove obsolete files from the explicit review bundle: ${String(error)}.${rollback}` };
  }
  return { ok: true };
}
