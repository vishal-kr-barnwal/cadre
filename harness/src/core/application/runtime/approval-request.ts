import crypto from "node:crypto";
import path from "node:path";

import { asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { readApprovalSession } from "./approval-session-store";
import type { ApprovalStage } from "./staged-approval-stages";

const CONTROL_KEYS = new Set([
  "root",
  "workflow",
  "action",
  "execute",
  "approvalComplete",
  "approval_complete",
  "approvalCancel",
  "approval_cancel",
  "approvalStage",
  "approval_stage",
  "approvalStageHash",
  "approval_stage_hash",
  "approvalStageRevision",
  "approval_stage_revision",
  "approvedStages",
  "approved_stages",
  "approvalSessionId",
  "approval_session_id",
  "responseMode",
  "response_mode",
  "detail",
  "compact",
  "skipSync",
]);

const PAYLOAD_ALIAS_GROUPS = [
  ["productGuidelines", "product_guidelines"],
  ["techStack", "tech_stack"],
  ["workflowPolicy", "workflow_policy"],
  ["styleGuideIds", "style_guide_ids"],
  ["styleGuides", "style_guides"],
  ["proposedContext", "proposed_context"],
] as const;

const PROPOSED_CONTEXT_ALIAS_GROUPS = [
  ["productGuidelines", "product_guidelines"],
  ["techStack", "tech_stack"],
  ["workflowPolicy", "workflow_policy"],
  ["repositoryTopology", "repository_topology"],
] as const;

export const APPROVAL_INPUT_ERROR = "_cadreApprovalInputError";

function rawArgs(args: RuntimeArgs): UnknownRecord {
  return args as UnknownRecord;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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

export function requestedApprovalStageHash(args: RuntimeArgs = {}): string | null {
  const raw = rawArgs(args);
  return asOptionalString(raw.approvalStageHash || raw.approval_stage_hash) || null;
}

export function requestedApprovalStageRevision(args: RuntimeArgs = {}): number | null {
  const raw = rawArgs(args);
  const value = raw.approvalStageRevision ?? raw.approval_stage_revision;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function requestedApprovalSessionId(args: RuntimeArgs = {}): string | null {
  const raw = rawArgs(args);
  return asOptionalString(raw.approvalSessionId || raw.approval_session_id) || null;
}

export function hasApprovalIntent(args: RuntimeArgs): boolean {
  const raw = rawArgs(args);
  return approvedStageIds(args).length > 0
    || approvalComplete(args)
    || raw.approvalStage !== undefined
    || raw.approval_stage !== undefined
    || raw.approvalCancel === true
    || raw.approval_cancel === true;
}

export function approvalCancelRequested(args: RuntimeArgs): boolean {
  const raw = rawArgs(args);
  return raw.approvalCancel === true || raw.approval_cancel === true;
}

function controlPayload(args: RuntimeArgs): JsonObject {
  const controls: JsonObject = {};
  for (const [key, value] of Object.entries(rawArgs(args))) {
    if (CONTROL_KEYS.has(key)) controls[key] = value as JsonObject[string];
  }
  return controls;
}

function canonicalAliases(value: JsonObject, groups: ReadonlyArray<readonly string[]>): JsonObject {
  const canonical = { ...value };
  for (const aliases of groups) {
    const canonicalKey = aliases[0];
    if (!canonicalKey) continue;
    const selected = aliases.find((key) => canonical[key] !== undefined);
    if (!selected) continue;
    const selectedValue = canonical[selected];
    for (const alias of aliases) delete canonical[alias];
    canonical[canonicalKey] = selectedValue;
  }
  return canonical;
}

function canonicalPayload(value: JsonObject): JsonObject {
  const canonical = canonicalAliases(value, PAYLOAD_ALIAS_GROUPS);
  const proposedContext = plainObject(canonical.proposedContext);
  if (proposedContext) canonical.proposedContext = canonicalAliases(proposedContext, PROPOSED_CONTEXT_ALIAS_GROUPS);
  return canonical;
}

export function approvalPayload(args: RuntimeArgs): JsonObject {
  const payload: JsonObject = {};
  for (const [key, value] of Object.entries(rawArgs(args))) {
    if (!CONTROL_KEYS.has(key) && key !== APPROVAL_INPUT_ERROR) payload[key] = value as JsonObject[string];
  }
  return canonicalPayload(payload);
}

function changedApprovalInput(sessionPayload: JsonObject, args: RuntimeArgs): string | null {
  for (const [key, value] of Object.entries(approvalPayload(args))) {
    if (stableJson(sessionPayload[key]) !== stableJson(value)) return key;
  }
  return null;
}

function plainObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function mergePayload(base: JsonObject, update: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(update)) {
    const left = plainObject(merged[key]);
    const right = plainObject(value);
    merged[key] = left && right ? mergePayload(left, right) : value as JsonObject[string];
  }
  return merged;
}

export function applyApprovalSessionPayload(root: string, args: RuntimeArgs = {}, workflow: string): RuntimeArgs {
  const sessionId = requestedApprovalSessionId(args);
  if (!sessionId) return args;
  const session = readApprovalSession(root, sessionId);
  if (!session || session.workflow !== workflow) return args;
  if (hasApprovalIntent(args)) {
    const changedInput = changedApprovalInput(session.payload, args);
    const controls = controlPayload(args);
    if (approvalComplete(args) && !controls.approvedStages && !controls.approved_stages) {
      controls.approvedStages = session.approved_stages;
    }
    return {
      ...session.payload,
      ...controls,
      ...(changedInput ? { [APPROVAL_INPUT_ERROR]: `Approval packets cannot amend staged input (${changedInput}); update the current stage in a separate call before approving it.` } : {}),
    };
  }
  return {
    ...mergePayload(canonicalPayload(session.payload), approvalPayload(args)),
    ...controlPayload(args),
  };
}

export function approvalPayloadHash(workflow: string, stages: ApprovalStage[], args: RuntimeArgs, extras: JsonObject): string {
  return sha(stableJson({
    workflow,
    stages: stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      description: stage.description,
      documentIds: stage.documentIds,
      inputKeys: stage.inputKeys || [],
      fileMatches: stage.fileMatches || [],
    })),
    payload: approvalPayload(args),
    extras,
  }));
}

export function derivedApprovalSessionId(workflow: string, root: string, payloadHash: string): string {
  return sha(`${workflow}\n${path.resolve(root)}\n${payloadHash}`).slice(0, 24);
}

export function approvalStageHash(workflow: string, stage: ApprovalStage, files: JsonObject[], extras: JsonObject): string {
  return sha(stableJson({ workflow, stage: stage.id, files, extras }));
}
