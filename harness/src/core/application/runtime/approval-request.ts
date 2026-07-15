import crypto from "node:crypto";
import path from "node:path";

import { asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { readApprovalSession } from "./approval-session-store";
import type { ApprovalStage } from "./staged-approval-stages";
import { availableStyleGuideIds, normalizeStyleGuideId, requestedStyleGuideIds } from "./tech-stack";
import { normalizeProviderMode } from "../../infrastructure/runtime/project-config";

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

const COMMON_PAYLOAD_ALIAS_GROUPS = [
  ["productGuidelines", "product_guidelines"],
  ["techStack", "tech_stack"],
  ["workflowPolicy", "workflow_policy"],
  ["styleGuideIds", "style_guide_ids"],
  ["proposedContext", "proposed_context"],
  ["releaseNotes", "release_notes"],
  ["handoffText", "handoff_text"],
] as const;

const SETUP_PAYLOAD_ALIAS_GROUPS = [
  ["providerMode", "provider_mode", "provider"],
  ["syncMode", "sync_mode"],
  ["writeLsp", "write_lsp", "setupLsp", "setup_lsp", "lsp"],
  ["teamSize", "team_size"],
  ["remoteHost", "remote_host"],
  ["ciProvider", "ci_provider"],
  ["writeCi", "write_ci"],
  ["writeGitattributes", "write_gitattributes"],
  ["addSubmodules", "add_submodules"],
  ["executeSubmodules", "execute_submodules"],
] as const;

const REFRESH_PAYLOAD_ALIAS_GROUPS = [
  ["repositoryTopology", "repository_topology", "repos"],
] as const;

const PROPOSED_CONTEXT_ALIAS_GROUPS = [
  ["productGuidelines", "product_guidelines"],
  ["techStack", "tech_stack"],
  ["workflowPolicy", "workflow_policy", "workflow"],
  ["repositoryTopology", "repository_topology", "repos"],
  ["styleGuideIds", "style_guide_ids"],
] as const;

const REFRESH_SEMANTIC_KEYS = [
  "product",
  "productGuidelines",
  "techStack",
  "workflowPolicy",
  "repositoryTopology",
  "styleGuideIds",
] as const;

export const APPROVAL_INPUT_ERROR = "_cadreApprovalInputError";
export const APPROVAL_PERSISTED_PAYLOAD = "_cadreApprovalPersistedPayload";

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

function payloadAliasGroups(workflow?: string): ReadonlyArray<readonly string[]> {
  if (workflow === "setup") return [...COMMON_PAYLOAD_ALIAS_GROUPS, ...SETUP_PAYLOAD_ALIAS_GROUPS];
  if (workflow === "refresh") return [...COMMON_PAYLOAD_ALIAS_GROUPS, ...REFRESH_PAYLOAD_ALIAS_GROUPS];
  return COMMON_PAYLOAD_ALIAS_GROUPS;
}

function normalizedAliasValue(canonicalKey: string, value: unknown, workflow?: string): unknown {
  if (workflow !== "setup") return value;
  if (canonicalKey === "providerMode") return normalizeProviderMode(value) ?? value;
  if (canonicalKey === "syncMode" && typeof value === "string") return value.trim().toLowerCase();
  if (canonicalKey === "styleGuideIds") {
    const validShape = typeof value === "string"
      || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
    return validShape ? requestedStyleGuideIds(value) : value;
  }
  return value;
}

function aliasConflict(
  value: JsonObject,
  groups: ReadonlyArray<readonly string[]>,
  prefix = "",
  workflow?: string,
): string | null {
  for (const aliases of groups) {
    const supplied = aliases.filter((key) => value[key] !== undefined);
    if (supplied.length < 2) continue;
    const canonicalKey = aliases[0] || "";
    const expected = stableJson(normalizedAliasValue(canonicalKey, value[supplied[0]!], workflow));
    const conflict = supplied.find((key) => stableJson(normalizedAliasValue(canonicalKey, value[key], workflow)) !== expected);
    if (conflict) return `${prefix}${supplied.join("/")}`;
  }
  return null;
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

function canonicalPayload(value: JsonObject, workflow?: string): JsonObject {
  const canonical = canonicalAliases(value, payloadAliasGroups(workflow));
  const proposedContext = plainObject(canonical.proposedContext);
  if (proposedContext) canonical.proposedContext = canonicalAliases(proposedContext, PROPOSED_CONTEXT_ALIAS_GROUPS);
  if (workflow === "refresh") {
    const proposed = plainObject(canonical.proposedContext) || {};
    for (const key of REFRESH_SEMANTIC_KEYS) {
      if (proposed[key] === undefined && canonical[key] !== undefined) proposed[key] = canonical[key];
      delete canonical[key];
    }
    if (canonical.patterns !== undefined && typeof canonical.patterns !== "boolean") {
      if (proposed.patterns === undefined) proposed.patterns = canonical.patterns;
      delete canonical.patterns;
    }
    if (Object.keys(proposed).length > 0) canonical.proposedContext = proposed;
  }
  if (workflow === "setup") {
    if (canonical.providerMode !== undefined) canonical.providerMode = normalizeProviderMode(canonical.providerMode);
    if (typeof canonical.syncMode === "string") canonical.syncMode = canonical.syncMode.trim().toLowerCase();
    const styleGuideValue = canonical.styleGuideIds;
    const validStyleGuideShape = (typeof styleGuideValue === "string" && styleGuideValue.trim().length > 0)
      || (Array.isArray(styleGuideValue) && styleGuideValue.every((entry) => typeof entry === "string"));
    if (validStyleGuideShape) canonical.styleGuideIds = requestedStyleGuideIds(styleGuideValue);
  }
  return canonical;
}

function rawApprovalPayload(args: RuntimeArgs): JsonObject {
  const payload: JsonObject = {};
  for (const [key, value] of Object.entries(rawArgs(args))) {
    if (!CONTROL_KEYS.has(key) && key !== APPROVAL_INPUT_ERROR && key !== APPROVAL_PERSISTED_PAYLOAD) {
      payload[key] = value as JsonObject[string];
    }
  }
  return payload;
}

function approvalAliasConflict(payload: JsonObject, workflow?: string): string | null {
  const topLevel = aliasConflict(payload, payloadAliasGroups(workflow), "", workflow);
  if (topLevel) return topLevel;
  const proposed = plainObject(payload.proposedContext) || plainObject(payload.proposed_context);
  const proposedConflict = proposed ? aliasConflict(proposed, PROPOSED_CONTEXT_ALIAS_GROUPS, "proposedContext.") : null;
  if (proposedConflict) return proposedConflict;
  if (workflow !== "refresh" || !proposed) return null;
  const canonicalTop = canonicalAliases(payload, payloadAliasGroups(workflow));
  const canonicalProposed = canonicalAliases(proposed, PROPOSED_CONTEXT_ALIAS_GROUPS);
  for (const key of REFRESH_SEMANTIC_KEYS) {
    if (canonicalTop[key] !== undefined && canonicalProposed[key] !== undefined
      && stableJson(canonicalTop[key]) !== stableJson(canonicalProposed[key])) {
      return `${key}/proposedContext.${key}`;
    }
  }
  if (canonicalTop.patterns !== undefined && typeof canonicalTop.patterns !== "boolean"
    && canonicalProposed.patterns !== undefined
    && stableJson(canonicalTop.patterns) !== stableJson(canonicalProposed.patterns)) {
    return "patterns/proposedContext.patterns";
  }
  return null;
}

function invalidSetupChoice(payload: JsonObject): string | null {
  if (payload.providerMode !== undefined && normalizeProviderMode(payload.providerMode) === null) return "providerMode";
  if (payload.syncMode !== undefined && (typeof payload.syncMode !== "string" || !["local", "shared"].includes(payload.syncMode.trim().toLowerCase()))) {
    return "syncMode";
  }
  if (payload.writeLsp !== undefined && typeof payload.writeLsp !== "boolean") return "writeLsp";
  if (payload.styleGuideIds !== undefined) {
    const value = payload.styleGuideIds;
    if (typeof value !== "string" && !Array.isArray(value)) return "styleGuideIds";
    if (typeof value === "string" && value.trim().length === 0) return "styleGuideIds";
    if (Array.isArray(value) && !value.every((entry) => typeof entry === "string")) return "styleGuideIds";
    const available = new Set(availableStyleGuideIds());
    const requested = typeof value === "string" ? value.split(/[,\s]+/).filter(Boolean) : value;
    if (requested.some((entry) => !available.has(normalizeStyleGuideId(String(entry))))) return "styleGuideIds";
  }
  return null;
}

export function approvalPayload(args: RuntimeArgs, workflow?: string): JsonObject {
  const raw = rawArgs(args);
  if (Object.prototype.hasOwnProperty.call(raw, APPROVAL_PERSISTED_PAYLOAD)) {
    return canonicalPayload(plainObject(raw[APPROVAL_PERSISTED_PAYLOAD]) || {}, workflow);
  }
  return canonicalPayload(rawApprovalPayload(args), workflow);
}

export function approvalReadOnlyRequested(args: RuntimeArgs): boolean {
  return Object.prototype.hasOwnProperty.call(rawArgs(args), APPROVAL_PERSISTED_PAYLOAD);
}

function changedApprovalInput(sessionPayload: JsonObject, args: RuntimeArgs, workflow: string): string | null {
  for (const [key, value] of Object.entries(approvalPayload(args, workflow))) {
    if (stableJson(sessionPayload[key]) !== stableJson(value)) return key;
  }
  return null;
}

function plainObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function sparsePatchKeys(workflow: string): Set<string> {
  if (["setup", "newtrack", "revise"].includes(workflow)) return new Set(["intent"]);
  if (workflow === "refresh") return new Set(["proposedContext"]);
  if (workflow === "skill") return new Set(["formattedReferences"]);
  return new Set();
}

function mergePayload(base: JsonObject, update: JsonObject, workflow: string): JsonObject {
  const patchKeys = sparsePatchKeys(workflow);
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(update)) {
    const left = plainObject(merged[key]);
    const right = plainObject(value);
    merged[key] = patchKeys.has(key) && left && right
      ? { ...left, ...right }
      : value as JsonObject[string];
  }
  return merged;
}

export function applyApprovalSessionPayload(root: string, args: RuntimeArgs = {}, workflow: string): RuntimeArgs {
  const controls = controlPayload(args);
  if (approvalCancelRequested(args)) {
    const sessionId = requestedApprovalSessionId(args);
    const existing = sessionId ? readApprovalSession(root, sessionId) : null;
    return { ...(existing?.workflow === workflow ? existing.payload : {}), ...controls };
  }
  const rawPayload = rawApprovalPayload(args);
  const aliasError = approvalAliasConflict(rawPayload, workflow);
  if (aliasError) {
    const sessionId = requestedApprovalSessionId(args);
    const existing = sessionId ? readApprovalSession(root, sessionId) : null;
    return {
      ...(existing?.workflow === workflow ? existing.payload : canonicalPayload(rawPayload, workflow)),
      ...controls,
      [APPROVAL_INPUT_ERROR]: `Conflicting aliases were supplied for ${aliasError}; send one authoritative value.`,
    };
  }
  const canonicalInput = canonicalPayload(rawPayload, workflow);
  const aliasedInput = canonicalAliases(rawPayload, payloadAliasGroups(workflow));
  const invalidChoice = workflow === "setup" ? invalidSetupChoice(aliasedInput) : null;
  const sessionId = requestedApprovalSessionId(args);
  if (!sessionId) {
    return {
      ...canonicalInput,
      ...controls,
      ...(invalidChoice ? { [APPROVAL_PERSISTED_PAYLOAD]: {} } : {}),
    };
  }
  const session = readApprovalSession(root, sessionId);
  if (!session || session.workflow !== workflow) return { ...canonicalInput, ...controls };
  if (invalidChoice) {
    if (hasApprovalIntent(args)) {
      return {
        ...session.payload,
        ...controls,
        [APPROVAL_INPUT_ERROR]: `Cannot approve while ${invalidChoice} has an invalid value; answer the returned setup prompt first.`,
      };
    }
    return {
      ...mergePayload(canonicalPayload(session.payload, workflow), canonicalInput, workflow),
      ...controls,
      [APPROVAL_PERSISTED_PAYLOAD]: canonicalPayload(session.payload, workflow),
    };
  }
  if (hasApprovalIntent(args)) {
    const changedInput = changedApprovalInput(session.payload, args, workflow);
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
    ...mergePayload(canonicalPayload(session.payload, workflow), canonicalInput, workflow),
    ...controls,
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
    payload: approvalPayload(args, workflow),
    extras,
  }));
}

export function derivedApprovalSessionId(workflow: string, root: string, payloadHash: string): string {
  return sha(`${workflow}\n${path.resolve(root)}\n${payloadHash}`).slice(0, 24);
}

export function approvalStageHash(workflow: string, stage: ApprovalStage, files: JsonObject[], extras: JsonObject): string {
  return sha(stableJson({ workflow, stage: stage.id, files, extras }));
}
