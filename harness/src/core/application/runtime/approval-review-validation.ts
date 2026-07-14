import fs from "node:fs";
import path from "node:path";
import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";

import { approvalHeadExpectation, readApprovalSession, previewFileRecords } from "./approval-session-store";
import { writeArtifactFilesAtomic } from "./artifact-pairs";
import { inspectReviewGitState, reviewOutputMode } from "./review-output";
import { reviewStats } from "./review-bundles";

function approvalComplete(args: RuntimeArgs): boolean {
  const raw = args as Record<string, unknown>;
  return raw.approvalComplete === true || raw.approval_complete === true;
}

function requestedSessionId(args: RuntimeArgs): string | null {
  const raw = args as Record<string, unknown>;
  return asOptionalString(raw.approvalSessionId || raw.approval_session_id) || null;
}

export function approvedTargetReviewPaths(approval: unknown): string[] {
  return asStringArray(asJsonObject(approval).approved_review_paths);
}

export function validateApprovedTargetReviewFiles(root: string, args: RuntimeArgs = {}): JsonObject {
  if (!approvalComplete(args)) return { ok: true, skipped: true, reason: "approval is not complete" };
  const sessionId = requestedSessionId(args);
  if (!sessionId) return { ok: false, stage: "staged_review_drift", error: "approvalSessionId is required to validate target review files" };
  const session = readApprovalSession(root, sessionId);
  if (!session) return { ok: false, stage: "staged_review_drift", error: "Approval session was not found for target review validation" };
  const materializedPaths = session.snapshot_files.filter((file) => file.missing !== true).map((file) => file.path);
  const materializedPathSet = new Set(materializedPaths);
  const gitState = inspectReviewGitState(
    root,
    materializedPaths,
    session.before_files.filter((before) => materializedPathSet.has(before.path)).map(approvalHeadExpectation),
  );
  if (!gitState.ok) {
    const changed = Array.from(new Set([...gitState.stagedPaths, ...gitState.baselinePaths]));
    return {
      ok: false,
      stage: "staged_review_git_drift",
      error: gitState.error || (gitState.stagedPaths.length > 0
        ? `Approved review target has staged Git content: ${gitState.stagedPaths[0]}`
        : `Approved review baseline changed in Git: ${gitState.baselinePaths[0]}`),
      errors: changed.map((file) => `Approved review Git state changed after preview: ${file}`),
      files: changed,
      staged_paths: gitState.stagedPaths,
      baseline_paths: gitState.baselinePaths,
    };
  }
  if (reviewOutputMode(args) !== "target") {
    const driftedBefore = session.before_files.filter((before) => {
      const target = path.join(root, before.path);
      const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
      return current !== (before.existed ? before.content : null);
    }).map((before) => before.path);
    if (driftedBefore.length > 0) {
      return {
        ok: false,
        stage: "staged_review_drift",
        error: `Review targets changed after bundle generation: ${driftedBefore[0]}`,
        errors: driftedBefore.map((file) => `Review target changed after bundle generation: ${file}`),
      };
    }
    const materializedFiles = session.snapshot_files.filter((file) => file.missing !== true);
    const mutation = writeArtifactFilesAtomic(root, materializedFiles.map((file) => ({ path: file.path, content: file.content })));
    return {
      ok: mutation.ok !== false,
      stage: mutation.ok === false ? "staged_review_materialize" : undefined,
      error: mutation.ok === false ? mutation.error : undefined,
      files: materializedFiles.map((file) => file.path),
      materialized_bundle: mutation.ok !== false,
      mutation: asJsonObject(mutation),
    };
  }
  const files = previewFileRecords(session);
  const errors: string[] = [];
  const paths: string[] = [];
  for (const file of files) {
    const relativePath = asOptionalString(file.path);
    const expectedHash = asOptionalString(file.sha256);
    if (!relativePath || !expectedHash) continue;
    const target = path.resolve(root, relativePath);
    try {
      const stats = reviewStats(fs.readFileSync(target, "utf8"));
      if (stats.sha256 !== expectedHash) errors.push(`Approved target review file changed after review: ${relativePath}`);
      paths.push(relativePath);
    } catch {
      errors.push(`Approved target review file is missing: ${relativePath}`);
    }
  }
  return {
    ok: errors.length === 0,
    stage: errors.length > 0 ? "staged_review_drift" : undefined,
    error: errors[0],
    errors,
    files: Array.from(new Set(paths)).sort(),
  };
}
