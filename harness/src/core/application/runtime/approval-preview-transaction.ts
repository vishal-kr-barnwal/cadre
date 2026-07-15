import fs from "node:fs";
import path from "node:path";

import { asJsonObject, asOptionalString, errorMessage } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { withLock } from "../../infrastructure/runtime/locking";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import type { ReviewFile } from "./contracts";
import type { ApprovalSession, ApprovalStageRecord } from "./approval-session-model";
import { readApprovalSession, recordApprovalPreview, writeApprovalSession } from "./approval-session-store";
import { workflowReviewBundle } from "./review-bundles";
import {
  removeReviewIntentToAddAtomic,
  restoreReviewIntentToAdd,
  reviewOutputMode,
} from "./review-output";

export interface ApprovalPreviewTransactionResult {
  ok: boolean;
  bundle: JsonObject | null;
  error?: string;
  recovery_required?: boolean;
}

interface TargetBaseline {
  path: string;
  content: string | null;
}

function safeTarget(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? target : null;
}

function targetBaselines(
  root: string,
  activeFiles: ReviewFile[],
  previousStage: ApprovalStageRecord | null,
): TargetBaseline[] {
  const paths = new Set([
    ...activeFiles.map((file) => file.path),
    ...(previousStage?.snapshot_files || []).map((file) => file.path),
  ]);
  return Array.from(paths, (relativePath) => {
    const target = safeTarget(root, relativePath);
    if (!target) throw new Error(`Unsafe approval preview path: ${relativePath}`);
    return {
      path: relativePath,
      content: fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null,
    };
  });
}

function explicitBundleDirectory(root: string, args: RuntimeArgs): string | null {
  const rawArgs = args as UnknownRecord;
  const explicit = asOptionalString(rawArgs.reviewBundleDir || rawArgs.review_bundle_dir || rawArgs.reviewDir || rawArgs.review_dir);
  if (!explicit) return null;
  const directory = path.resolve(root, explicit);
  const resolvedRoot = path.resolve(root);
  const resolvedCadre = path.join(resolvedRoot, "cadre");
  const relativeToCadre = path.relative(resolvedCadre, directory);
  const insideCadre = relativeToCadre === ""
    || (!relativeToCadre.startsWith("..") && !path.isAbsolute(relativeToCadre));
  return directory === resolvedRoot || insideCadre ? null : directory;
}

function bundleBaselines(
  directory: string,
  activeFiles: ReviewFile[],
  previousStage: ApprovalStageRecord | null,
): TargetBaseline[] {
  const paths = new Set([
    "manifest.json",
    ...activeFiles.map((file) => file.path),
    ...(previousStage?.snapshot_files || []).map((file) => file.path),
  ]);
  return Array.from(paths, (relativePath) => {
    const target = safeTarget(directory, relativePath);
    if (!target) throw new Error(`Unsafe explicit review bundle path: ${relativePath}`);
    return {
      path: relativePath,
      content: fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null,
    };
  });
}

function rollbackTargetPreview(
  root: string,
  baselines: TargetBaseline[],
  previousIntentPaths: string[],
): string[] {
  const errors: string[] = [];
  const previousIntent = new Set(previousIntentPaths);
  const candidatePaths = baselines.map((entry) => entry.path);
  const removeIntent = removeReviewIntentToAddAtomic(
    root,
    candidatePaths.filter((relativePath) => !previousIntent.has(relativePath)),
  );
  if (!removeIntent.ok) errors.push(removeIntent.error || "Unable to remove new review intent-to-add entries");
  const restoreFiles = writeArtifactFilesAtomic(root, baselines, { lockName: "approval-preview-rollback" });
  if (!restoreFiles.ok) errors.push(asOptionalString(restoreFiles.error) || "Unable to restore approval preview targets");
  const restoreIntent = restoreReviewIntentToAdd(root, previousIntentPaths);
  if (!restoreIntent.ok) errors.push(restoreIntent.error || "Unable to restore prior review intent-to-add entries");
  return errors;
}

function rollbackExplicitBundle(directory: string, baselines: TargetBaseline[]): string[] {
  const restore = writeArtifactFilesAtomic(directory, baselines, { lock: false });
  return restore.ok
    ? []
    : [asOptionalString(restore.error) || "Unable to restore the explicit review bundle"];
}

export function materializeApprovalPreview(
  root: string,
  workflow: string,
  args: RuntimeArgs,
  activeFiles: ReviewFile[],
  manifestExtras: JsonObject,
  previousStage: ApprovalStageRecord | null,
  persistedSession: ApprovalSession,
  candidateSession: ApprovalSession,
  stageId: string,
  payloadHash: string,
): ApprovalPreviewTransactionResult {
  const locked = withLock(root, "approval-target-lifecycle", () => {
    const currentSession = readApprovalSession(root, persistedSession.session_id);
    if (!currentSession || JSON.stringify(currentSession) !== JSON.stringify(persistedSession)) {
      return {
        ok: false,
        bundle: null,
        error: "Approval session changed while this preview was waiting for the target lifecycle lock; reload the current session before retrying.",
      };
    }
    const targetMode = reviewOutputMode(args) === "target";
    const explicitDirectory = targetMode ? null : explicitBundleDirectory(root, args);
    const baselines = targetMode ? targetBaselines(root, activeFiles, previousStage) : [];
    const explicitBaselines = explicitDirectory
      ? bundleBaselines(explicitDirectory, activeFiles, previousStage)
      : [];
    const previousIntentPaths = previousStage?.intent_to_add_paths || [];
    const rollbackPreview = (): string[] => targetMode
      ? rollbackTargetPreview(root, baselines, previousIntentPaths)
      : explicitDirectory
        ? rollbackExplicitBundle(explicitDirectory, explicitBaselines)
        : [];
    let bundle: JsonObject | null = null;
    try {
      const materialized = workflowReviewBundle(root, workflow, args, activeFiles, manifestExtras, previousStage);
      bundle = materialized ? asJsonObject(materialized) : null;
      const bundleError = asOptionalString(bundle?.error);
      if (!bundle || bundle.ok === false) {
        const rollbackErrors = rollbackPreview();
        return {
          ok: false,
          bundle,
          error: [bundleError || "Approval preview could not be materialized", ...rollbackErrors].join("; "),
          recovery_required: rollbackErrors.length > 0,
        };
      }
      const recorded = recordApprovalPreview(
        root,
        candidateSession.session_id,
        workflow,
        payloadHash,
        stageId,
        bundle,
        candidateSession,
      );
      if (!recorded.ok) throw new Error(asOptionalString(recorded.error) || "Unable to persist approval preview session");
      return { ok: true, bundle };
    } catch (error) {
      const rollbackErrors = rollbackPreview();
      try {
        writeApprovalSession(root, persistedSession);
      } catch (sessionRollbackError) {
        rollbackErrors.push(`session rollback failed: ${errorMessage(sessionRollbackError)}`);
      }
      return {
        ok: false,
        bundle: null,
        error: [`Approval preview transaction failed: ${errorMessage(error)}`, ...rollbackErrors].join("; "),
        recovery_required: rollbackErrors.length > 0,
      };
    }
  }) as unknown as ApprovalPreviewTransactionResult;
  if (locked.ok) return { ok: true, bundle: locked.bundle };
  return {
    ok: false,
    bundle: locked.bundle || null,
    error: locked.error || "Unable to acquire the approval target lifecycle lock",
    recovery_required: locked.recovery_required === true,
  };
}
