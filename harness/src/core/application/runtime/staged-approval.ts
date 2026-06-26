import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";

import type { ReviewFile } from "./contracts";
import { reviewArtifactsFromFiles, reviewStats, workflowReviewBundle } from "./review-bundles";
import { reviewOutputMode } from "./review-output";

import type { ApprovalStage } from "./staged-approval-stages";
export {
  artifactApprovalStages,
  handoffApprovalStages,
  newTrackApprovalStages,
  refreshApprovalStages,
  releaseApprovalStages,
  reviseApprovalStages,
  setupApprovalStages,
} from "./staged-approval-stages";

function stageApprovalPrompt(workflow: string, stage: ApprovalStage, sessionId: string): string {
  return `Approve Cadre ${workflow} stage "${stage.id}" (${stage.title})? Reply "approve ${stage.id}" to allow one staged approval for session ${sessionId}.`;
}

type ApprovalSession = {
  session_id: string;
  workflow: string;
  payload_hash: string;
  payload: JsonObject;
  approved_stages: string[];
  preview_files?: Record<string, JsonObject[]>;
  updated_at: string;
};

function rawArgs(args: RuntimeArgs): UnknownRecord {
  return args as UnknownRecord;
}

export function approvalComplete(args: RuntimeArgs = {}): boolean {
  const raw = rawArgs(args);
  return raw.approvalComplete === true || raw.approval_complete === true;
}

export function approvedStageIds(args: RuntimeArgs = {}): string[] {
  const raw = rawArgs(args);
  return Array.from(new Set(asStringArray(raw.approvedStages || raw.approved_stages)));
}

export function requestedApprovalStage(args: RuntimeArgs = {}): string | null {
  const raw = rawArgs(args);
  return asOptionalString(raw.approvalStage || raw.approval_stage) || null;
}

export function requestedApprovalSessionId(args: RuntimeArgs = {}): string | null {
  const raw = rawArgs(args);
  return asOptionalString(raw.approvalSessionId || raw.approval_session_id) || null;
}

function filesForStage(files: ReviewFile[], stage: ApprovalStage): ReviewFile[] {
  if (stage.fileMatches.includes("*")) return files;
  return files.filter((file) => stage.fileMatches.some((needle) => file.path.includes(needle)));
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function approvalSessionDir(): string {
  return path.join(os.tmpdir(), "cadre-approval-sessions");
}

function approvalSessionFile(sessionId: string): string {
  return path.join(approvalSessionDir(), `${sessionId}.json`);
}

function readApprovalSession(sessionId: string): ApprovalSession | null {
  try {
    return JSON.parse(fs.readFileSync(approvalSessionFile(sessionId), "utf8")) as ApprovalSession;
  } catch {
    return null;
  }
}

function writeApprovalSession(session: ApprovalSession): void {
  fs.mkdirSync(approvalSessionDir(), { recursive: true });
  fs.writeFileSync(approvalSessionFile(session.session_id), `${JSON.stringify(session, null, 2)}\n`);
}

function hasApprovalIntent(args: RuntimeArgs): boolean {
  const raw = rawArgs(args);
  return approvedStageIds(args).length > 0
    || approvalComplete(args)
    || raw.approvalStage !== undefined
    || raw.approval_stage !== undefined;
}

function approvalControlPayload(args: RuntimeArgs): JsonObject {
  const raw = rawArgs(args);
  const controls: JsonObject = {};
  for (const key of [
    "execute",
    "approvalComplete",
    "approval_complete",
    "approvalStage",
    "approval_stage",
    "approvedStages",
    "approved_stages",
    "approvalSessionId",
    "approval_session_id",
    "reviewBundleDir",
    "review_bundle_dir",
    "reviewDir",
    "review_dir",
    "reviewOutputMode",
    "review_output_mode",
    "responseMode",
    "response_mode",
    "detail",
    "compact",
  ]) {
    if (raw[key] !== undefined) controls[key] = raw[key] as JsonObject[string];
  }
  return controls;
}

export function applyStagedApprovalSessionPayload(args: RuntimeArgs = {}, workflow: string): RuntimeArgs {
  if (!hasApprovalIntent(args)) return args;
  const sessionId = requestedApprovalSessionId(args);
  if (!sessionId) return args;
  const session = readApprovalSession(sessionId);
  if (!session || session.workflow !== workflow) return args;
  const controls = approvalControlPayload(args);
  if (approvalComplete(args) && !controls.approvedStages && !controls.approved_stages) {
    controls.approvedStages = session.approved_stages;
  }
  return {
    ...session.payload,
    ...controls,
  };
}

function stageHash(workflow: string, stage: ApprovalStage, files: ReviewFile[], extras: JsonObject): string {
  return sha(stableJson({
    workflow,
    stage: stage.id,
    files: filesForStage(files, stage).map((file) => ({
      path: file.path,
      source: file.source,
      kind: file.kind,
      missing: file.missing === true,
      content: file.content,
    })),
    extras,
  }));
}

function approvalPayload(args: RuntimeArgs): JsonObject {
  const raw = rawArgs(args);
  const ignored = new Set([
    "execute",
    "approvalComplete",
    "approval_complete",
    "approvalStage",
    "approval_stage",
    "approvedStages",
    "approved_stages",
    "approvalSessionId",
    "approval_session_id",
    "reviewBundleDir",
    "review_bundle_dir",
    "reviewDir",
    "review_dir",
    "reviewOutputMode",
    "review_output_mode",
    "responseMode",
    "response_mode",
    "detail",
    "compact",
  ]);
  const payload: JsonObject = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ignored.has(key)) payload[key] = value as JsonObject[string];
  }
  return payload;
}

function approvalPayloadHash(workflow: string, stages: ApprovalStage[], args: RuntimeArgs, extras: JsonObject): string {
  return sha(stableJson({
    workflow,
    stages: stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      description: stage.description,
    })),
    payload: approvalPayload(args),
    extras,
  }));
}

function approvalSessionId(workflow: string, root: string, payloadHash: string): string {
  return sha(`${workflow}\n${path.resolve(root)}\n${payloadHash}`).slice(0, 24);
}

function approvalOrderError(stageIds: string[], approved: string[]): string | null {
  const known = new Set(stageIds);
  const unknown = approved.find((stage) => !known.has(stage));
  if (unknown) return `Unknown approval stage: ${unknown}`;
  for (let index = 0; index < approved.length; index += 1) {
    if (approved[index] !== stageIds[index]) return `Approval stages must be approved in order; expected ${stageIds[index]} before ${approved[index]}.`;
  }
  return null;
}

function approvalTransitionError(
  args: RuntimeArgs,
  workflow: string,
  sessionId: string,
  payloadHash: string,
  stageIds: string[],
  approved: string[]
): string | null {
  const raw = rawArgs(args);
  if (stageIds.length === 0) return null;
  const orderError = approvalOrderError(stageIds, approved);
  if (orderError) return orderError;
  const requestedSession = requestedApprovalSessionId(args);
  const payload = approvalPayload(args);
  const approvalIntent = hasApprovalIntent(args);
  if (!approvalIntent) {
    writeApprovalSession({ session_id: sessionId, workflow, payload_hash: payloadHash, payload, approved_stages: [], preview_files: {}, updated_at: new Date().toISOString() });
    return null;
  }
  if (!requestedSession) return "approvalSessionId is required when approving staged workflow output.";
  if (approvalComplete(args)) {
    const requested = readApprovalSession(requestedSession);
    if (
      requested
      && requested.workflow === workflow
      && approved.length === stageIds.length
      && requested.approved_stages.length === stageIds.length
      && requested.approved_stages.every((stage, index) => stage === stageIds[index] && approved[index] === stage)
    ) {
      return null;
    }
  }
  if (requestedSession !== sessionId) return "Approval session is stale for the current generated payload; restart staged review from the current stage.";
  const session = readApprovalSession(sessionId);
  if (!session || session.workflow !== workflow || session.payload_hash !== payloadHash) {
    writeApprovalSession({ session_id: sessionId, workflow, payload_hash: payloadHash, payload, approved_stages: [], preview_files: {}, updated_at: new Date().toISOString() });
    return "Approval session was not found for this payload; review the current stage before approving.";
  }
  const previous = session.approved_stages || [];
  const previousOrderError = approvalOrderError(stageIds, previous);
  if (previousOrderError) return previousOrderError;
  if (approved.length < previous.length || previous.some((stage, index) => approved[index] !== stage)) {
    return "Approved stages must preserve the current approval session history.";
  }
  const delta = approved.slice(previous.length);
  if (approvalComplete(args)) {
    if (approved.length !== stageIds.length) return "approvalComplete requires every staged approval to be recorded first.";
    if (delta.length > 0) return "Record the final stage approval in a dry-run call before using approvalComplete.";
    return null;
  }
  if (delta.length !== 1) return "Approve exactly one new stage per packet call.";
  const nextExpected = stageIds[previous.length];
  if (delta[0] !== nextExpected) return `Next approval stage must be ${nextExpected}.`;
  const requestedStage = requestedApprovalStage(args);
  if (requestedStage && requestedStage !== delta[0]) return `approvalStage must match the newly approved stage ${delta[0]}.`;
  writeApprovalSession({
    session_id: sessionId,
    workflow,
    payload_hash: payloadHash,
    payload: session.payload || payload,
    approved_stages: approved,
    preview_files: session.preview_files || {},
    updated_at: new Date().toISOString(),
  });
  return null;
}

function recordApprovalSessionPreview(sessionId: string, workflow: string, payloadHash: string, stageId: string, bundle: JsonObject | null): void {
  if (!bundle || bundle.ok === false) return;
  const session = readApprovalSession(sessionId);
  if (!session || session.workflow !== workflow || session.payload_hash !== payloadHash) return;
  const files = Array.isArray(bundle.files) ? bundle.files.map(asJsonObject) : [];
  const previewFiles = { ...(session.preview_files || {}) };
  previewFiles[stageId] = files.map((file) => ({
    path: asOptionalString(file.path) || null,
    review_path: asOptionalString(file.review_path) || null,
    target_path: asOptionalString(file.target_path) || asOptionalString(file.review_path) || null,
    sha256: asOptionalString(file.sha256) || null,
    bytes: file.bytes,
    lines: file.lines,
  }));
  writeApprovalSession({ ...session, preview_files: previewFiles, updated_at: new Date().toISOString() });
}

function approvedPreviewFiles(session: ApprovalSession | null, approvedIds: string[]): JsonObject[] {
  if (!session?.preview_files) return [];
  return approvedIds.flatMap((stageId) => (session.preview_files?.[stageId] || []).map(asJsonObject));
}

export function approvedTargetReviewPaths(approval: unknown): string[] {
  return asStringArray(asJsonObject(approval).approved_review_paths);
}

export function validateApprovedTargetReviewFiles(root: string, args: RuntimeArgs = {}): JsonObject {
  if (reviewOutputMode(args) !== "target") return { ok: true, skipped: true, reason: "review output mode is bundle" };
  if (!approvalComplete(args)) return { ok: true, skipped: true, reason: "approval is not complete" };
  const sessionId = requestedApprovalSessionId(args);
  if (!sessionId) return { ok: false, stage: "staged_review_drift", error: "approvalSessionId is required to validate target review files" };
  const session = readApprovalSession(sessionId);
  if (!session) return { ok: false, stage: "staged_review_drift", error: "Approval session was not found for target review validation" };
  const approvedIds = approvedStageIds(args);
  const files = approvedPreviewFiles(session, approvedIds);
  const errors: string[] = [];
  const paths: string[] = [];
  for (const file of files) {
    const relativePath = asOptionalString(file.path);
    const expectedHash = asOptionalString(file.sha256);
    if (!relativePath || !expectedHash) continue;
    const target = path.resolve(root, relativePath);
    try {
      const content = fs.readFileSync(target, "utf8");
      const stats = reviewStats(content);
      if (stats.sha256 !== expectedHash) errors.push(`Approved target review file changed after review: ${relativePath}`);
      paths.push(relativePath);
    } catch {
      errors.push(`Approved target review file is missing: ${relativePath}`);
    }
  }
  const uniquePaths = Array.from(new Set(paths)).sort();
  return {
    ok: errors.length === 0,
    stage: errors.length > 0 ? "staged_review_drift" : undefined,
    error: errors[0],
    errors,
    files: uniquePaths,
  };
}

export function stagedApprovalState(
  root: string,
  workflow: string,
  args: RuntimeArgs,
  stages: ApprovalStage[],
  reviewFiles: ReviewFile[],
  extras: JsonObject = {}
): JsonObject {
  const stageIds = stages.map((stage) => stage.id);
  const approvedIds = approvedStageIds(args);
  const payloadHash = approvalPayloadHash(workflow, stages, args, extras);
  const sessionId = approvalSessionId(workflow, root, payloadHash);
  let approvalError = approvalTransitionError(args, workflow, sessionId, payloadHash, stageIds, approvedIds);
  const approved = new Set(approvedIds);
  const pending = stages.filter((stage) => !approved.has(stage.id));
  const requested = requestedApprovalStage(args);
  const active = stages.find((stage) => stage.id === requested && !approved.has(stage.id))
    || pending[0]
    || null;
  const activeFiles = active ? filesForStage(reviewFiles, active) : [];
  const stageBundle = active
    ? workflowReviewBundle(root, `${workflow}-${active.id}`, args, activeFiles, {
      ...extras,
      approval_stage: active.id,
      approved_stages: Array.from(approved),
      pending_stages: pending.map((stage) => stage.id),
    })
    : null;
  if (active) recordApprovalSessionPreview(sessionId, workflow, payloadHash, active.id, asJsonObject(stageBundle));
  const bundleError = asOptionalString(asJsonObject(stageBundle).error);
  if (!approvalError && bundleError) approvalError = bundleError;
  const session = readApprovalSession(sessionId);
  const approvedFiles = approvedPreviewFiles(session, approvedIds);
  const approvedPaths = Array.from(new Set(approvedFiles.map((file) => asOptionalString(file.path)).filter((file): file is string => Boolean(file)))).sort();
  const complete = approvalComplete(args);
  const stageHashes = Object.fromEntries(stages.map((stage) => [stage.id, stageHash(workflow, stage, reviewFiles, extras)]));
  const validForExecute = !approvalError && complete && approvedIds.length === stages.length;
  const manualPrompt = active ? stageApprovalPrompt(workflow, active, sessionId) : null;
  return {
    version: 1,
    kind: "cadre.staged_approval.v1",
    workflow,
    required: true,
    session_id: sessionId,
    payload_hash: payloadHash,
    approval_session_argument: "approvalSessionId",
    approval_argument: "approvalComplete",
    explicit_user_approval_required: true,
    manual_approval_required: true,
    manual_approval_prompt: manualPrompt,
    approval_instruction: active
      ? `Ask the user for explicit approval of only ${active.id}; if no native prompt exists, ask manually and wait.`
      : "Ask the user for explicit staged approval before sending any staged approval packet.",
    not_approval: [
      "Agent review is not approval.",
      "No warnings is not approval.",
      "Recommended setup choices are not approval.",
      "Different session/payload approval is stale.",
    ],
    approval_complete: complete,
    valid_for_execute: validForExecute,
    approval_error: approvalError,
    current_stage: active?.id || null,
    current_stage_title: active?.title || null,
    current_stage_hash: active ? stageHashes[active.id] : null,
    stage_hashes: stageHashes,
    approved_stages: Array.from(approved),
    pending_stages: pending.map((stage) => stage.id),
    stages: stages.map((stage) => {
      const stageFiles = filesForStage(reviewFiles, stage);
      return {
        id: stage.id,
        title: stage.title,
        description: stage.description,
        approved: approved.has(stage.id),
        file_count: stageFiles.length,
      };
    }),
    current_review_artifacts: reviewArtifactsFromFiles(activeFiles),
    current_review_bundle: stageBundle,
    approved_review_files: approvedFiles,
    approved_review_paths: approvedPaths,
    next_actions: complete
      ? approvalError
        ? [approvalError, "Restart review from the returned current stage and packet-issued approvalSessionId."]
        : [`Call ${workflow} with execute:true, approvalComplete:true, and approvalSessionId:${sessionId} to apply the approved staged payload.`]
      : active
        ? [
          `Ask the user to approve only the ${active.id} stage; do not approve it yourself after review.`,
          `Only after explicit user approval, call ${workflow} again with approvalSessionId:${sessionId}, approvalStage:${active.id}, and approvedStages including exactly the next stage.`,
          "After all stages are approved in dry-run calls, call the mutating packet with execute:true, approvalComplete:true, and the same approvalSessionId.",
        ]
        : [],
  };
}

export function stagedApprovalReady(approval: unknown): boolean {
  const state = asJsonObject(approval);
  return state.valid_for_execute === true;
}

export function stagedApprovalError(approval: unknown): string | null {
  return asOptionalString(asJsonObject(approval).approval_error) || null;
}
