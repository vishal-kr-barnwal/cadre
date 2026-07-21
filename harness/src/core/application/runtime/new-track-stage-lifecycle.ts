import { asJsonObject, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, TrackMetadata, UnknownRecord } from "../../../types";

import { safeName } from "../../infrastructure/runtime/json-store";
import { approvalStageCursor, scopedApprovalReviewFiles, type ApprovalStageCursor } from "./approval-stage-cursor";
import { stageRecord } from "./approval-session-model";
import type { ReviewFile } from "./contracts";
import { newTrackSchemaIssues } from "./intent-prompts";
import { withGeneratedMarker } from "./markdown-docs";
import { renderPlanMarkdown } from "./plan-docs";
import {
  documentReviewPair,
  jsonReviewFile,
  plainReviewFile,
  textReviewFile,
  trackLearningsSeed,
  trackLearningsText,
} from "./review-bundles";
import { renderSpecMarkdown } from "./spec-docs";
import type { ApprovalStage } from "./staged-approval-stages";
import { meaningfulRevisionArtifact } from "./workflow-evidence";
import { normalizePlanJson, normalizeSpecJson } from "./workflow-response";

export interface NewTrackStageCollection {
  cursor: ApprovalStageCursor;
  activeKind: "spec" | "plan" | null;
  missingEvidence: string[];
  schemaIssues: JsonObject[];
  files: ReviewFile[];
  specJson: JsonObject | null;
  planJson: JsonObject | null;
  metadata: TrackMetadata | null;
  learningsEntry: JsonObject | null;
}

function specPaths(trackId: string): { canonical: string; projection: string } {
  const base = `cadre/tracks/${safeName(trackId)}`;
  return { canonical: `${base}/spec.json`, projection: `${base}/spec.md` };
}

function planPaths(trackId: string): { canonical: string; projection: string } {
  const base = `cadre/tracks/${safeName(trackId)}`;
  return { canonical: `${base}/plan.json`, projection: `${base}/plan.md` };
}

function specReviewFiles(trackId: string, spec: JsonObject): ReviewFile[] {
  const paths = specPaths(trackId);
  const canonicalContent = `${JSON.stringify(spec, null, 2)}\n`;
  return documentReviewPair(
    "spec",
    jsonReviewFile(paths.canonical, "Track spec canonical", "spec", spec),
    textReviewFile(
      paths.projection,
      "Track spec",
      "spec.json",
      withGeneratedMarker(paths.canonical, "cadre.spec.v1", renderSpecMarkdown(spec, paths.canonical), {
        canonicalContent,
        projection: paths.projection,
      }),
    ),
  );
}

function planReviewFiles(trackId: string, plan: JsonObject): ReviewFile[] {
  const paths = planPaths(trackId);
  const canonicalContent = `${JSON.stringify(plan, null, 2)}\n`;
  return documentReviewPair(
    "plan",
    jsonReviewFile(paths.canonical, "Track plan canonical", "plan", plan),
    textReviewFile(
      paths.projection,
      "Track plan",
      "plan.json",
      withGeneratedMarker(paths.canonical, "cadre.plan.v1", renderPlanMarkdown(plan, paths.canonical), {
        canonicalContent,
        projection: paths.projection,
      }),
    ),
  );
}

function finalTrackFiles(trackId: string, metadata: TrackMetadata): ReviewFile[] {
  const base = `cadre/tracks/${safeName(trackId)}`;
  const learningsEntry = trackLearningsSeed(trackId);
  const learningsCanonical = `${JSON.stringify(learningsEntry)}\n`;
  return [
    {
      ...jsonReviewFile(`${base}/metadata.json`, "Track metadata", "metadata", metadata),
      documentId: "metadata",
      reviewRole: "machine",
    },
    ...documentReviewPair(
      "learnings",
      plainReviewFile(`${base}/learnings.jsonl`, "Track learnings canonical", "template:learnings_seed.json", learningsCanonical),
      textReviewFile(
        `${base}/learnings.md`,
        "Track learnings",
        "learnings.jsonl",
        withGeneratedMarker(`${base}/learnings.jsonl`, "cadre.learnings.v1", trackLearningsText(trackId), {
          canonicalContent: learningsCanonical,
          projection: `${base}/learnings.md`,
        }),
      ),
      undefined,
      "generated",
    ),
  ];
}

function parsedJsonFile(files: ReviewFile[], targetPath: string): JsonObject | null {
  const file = files.find((candidate) => candidate.path === targetPath && candidate.missing !== true);
  if (!file) return null;
  try {
    const parsed: unknown = JSON.parse(file.content);
    return isRecord(parsed) ? asJsonObject(parsed) : null;
  } catch {
    return null;
  }
}

function approvedSpec(cursor: ApprovalStageCursor, trackId: string, rawSpec: unknown): JsonObject | null {
  const frozen = cursor.session
    ? stageRecord(cursor.session, "spec")?.snapshot_files.find((file) => file.path === specPaths(trackId).canonical)
    : null;
  if (frozen) {
    try {
      const parsed: unknown = JSON.parse(frozen.content);
      if (isRecord(parsed)) return asJsonObject(parsed);
    } catch {
      return null;
    }
  }
  return isRecord(rawSpec) ? normalizeSpecJson(trackId, rawSpec) : null;
}

export function newTrackStageCollection(
  root: string,
  args: RuntimeArgs,
  trackId: string,
  stages: ApprovalStage[],
  metadata: TrackMetadata,
): NewTrackStageCollection {
  const cursor = approvalStageCursor(root, args, "newtrack", stages);
  const activeKind = cursor.activeStage?.id === "spec"
    ? "spec"
    : cursor.activeStage?.id === "plan"
      ? "plan"
      : null;
  const raw = args as UnknownRecord;
  const activeValue = activeKind ? raw[activeKind] : null;
  const missingEvidence = activeKind && !meaningfulRevisionArtifact(activeValue, activeKind, trackId)
    ? [activeKind]
    : [];
  const schemaIssues = activeKind && isRecord(activeValue)
    ? newTrackSchemaIssues(args, [activeKind])
    : [];
  let currentFiles: ReviewFile[] = [];
  let newFinalFiles: ReviewFile[] = [];
  if (activeKind && missingEvidence.length === 0 && schemaIssues.length === 0) {
    if (activeKind === "spec") {
      currentFiles = specReviewFiles(trackId, normalizeSpecJson(trackId, activeValue));
    } else {
      const spec = approvedSpec(cursor, trackId, raw.spec);
      if (spec) {
        currentFiles = planReviewFiles(trackId, normalizePlanJson(trackId, activeValue, spec));
        newFinalFiles = finalTrackFiles(trackId, metadata);
      }
    }
  }
  const files = scopedApprovalReviewFiles(cursor, currentFiles, newFinalFiles);
  const base = `cadre/tracks/${safeName(trackId)}`;
  return {
    cursor,
    activeKind,
    missingEvidence,
    schemaIssues,
    files,
    specJson: parsedJsonFile(files, `${base}/spec.json`),
    planJson: parsedJsonFile(files, `${base}/plan.json`),
    metadata: parsedJsonFile(files, `${base}/metadata.json`) as TrackMetadata | null,
    learningsEntry: parsedJsonFile(files, `${base}/learnings.jsonl`),
  };
}
