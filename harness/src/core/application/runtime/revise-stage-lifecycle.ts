import path from "node:path";
import { isRecord } from "../../../guards";
import type { CadreTrack, JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { readJson } from "../../infrastructure/runtime/json-store";
import { approvalStageCursor, scopedApprovalReviewFiles, type ApprovalStageCursor } from "./approval-stage-cursor";
import type { ReviewFile } from "./contracts";
import { withGeneratedMarker } from "./markdown-docs";
import { renderPlanMarkdown, trackPlanJsonPath, trackSpecJsonPath } from "./plan-docs";
import { documentReviewPair, jsonReviewFile, textReviewFile } from "./review-bundles";
import { renderSpecMarkdown } from "./spec-docs";
import type { ApprovalStage } from "./staged-approval-stages";
import { meaningfulRevisionArtifact } from "./workflow-evidence";
import { normalizePlanJson, normalizeSpecJson } from "./workflow-response";

export interface ReviseStageCollection {
  cursor: ApprovalStageCursor;
  activeKind: "spec" | "plan" | null;
  missingEvidence: string[];
  files: ReviewFile[];
}

function specFiles(root: string, track: CadreTrack, value: JsonObject): ReviewFile[] {
  const canonicalPath = path.relative(root, trackSpecJsonPath(track));
  const projectionPath = path.relative(root, track.spec_path);
  const canonicalContent = `${JSON.stringify(value, null, 2)}\n`;
  return documentReviewPair(
    "spec",
    jsonReviewFile(canonicalPath, "Revised track spec canonical", "spec", value),
    textReviewFile(
      projectionPath,
      "Revised track spec",
      "spec.json",
      withGeneratedMarker(canonicalPath, "cadre.spec.v1", renderSpecMarkdown(value, canonicalPath), {
        canonicalContent,
        projection: projectionPath,
      }),
    ),
  );
}

function planFiles(root: string, track: CadreTrack, value: JsonObject): ReviewFile[] {
  const canonicalPath = path.relative(root, trackPlanJsonPath(track));
  const projectionPath = path.relative(root, track.plan_path);
  const canonicalContent = `${JSON.stringify(value, null, 2)}\n`;
  return documentReviewPair(
    "plan",
    jsonReviewFile(canonicalPath, "Revised track plan canonical", "plan", value),
    textReviewFile(
      projectionPath,
      "Revised track plan",
      "plan.json",
      withGeneratedMarker(canonicalPath, "cadre.plan.v1", renderPlanMarkdown(value, canonicalPath), {
        canonicalContent,
        projection: projectionPath,
      }),
    ),
  );
}

export function reviseStageCollection(
  root: string,
  args: RuntimeArgs,
  track: CadreTrack,
  stages: ApprovalStage[],
): ReviseStageCollection {
  const cursor = approvalStageCursor(root, args, "revise", stages);
  const activeKind = cursor.activeStage?.id === "spec_changes"
    ? "spec"
    : cursor.activeStage?.id === "plan_changes"
      ? "plan"
      : null;
  const raw = args as UnknownRecord;
  const missingEvidence = activeKind && !meaningfulRevisionArtifact(raw[activeKind], activeKind, track.track_id)
    ? [activeKind]
    : [];
  let currentFiles: ReviewFile[] = [];
  if (activeKind && missingEvidence.length === 0) {
    const existingSpec = readJson<JsonObject | null>(trackSpecJsonPath(track), null);
    const revisedSpec = isRecord(raw.spec) ? normalizeSpecJson(track.track_id, raw.spec) : null;
    currentFiles = activeKind === "spec"
      ? specFiles(root, track, revisedSpec!)
      : planFiles(root, track, normalizePlanJson(track.track_id, raw.plan, revisedSpec || existingSpec));
  }
  return {
    cursor,
    activeKind,
    missingEvidence,
    files: scopedApprovalReviewFiles(cursor, currentFiles),
  };
}
