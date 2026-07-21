import type { JsonObject, RuntimeArgs } from "../../types";
import { isRecord } from "../../guards";
import { WORKFLOW_INPUT_RESERVED_KEYS } from "../../workflow-control-keys";

interface WorkflowApproval {
  stage?: string;
  stage_hash?: string;
  stage_revision?: number;
  session_id?: string;
  approved_stages?: string[];
  complete?: boolean;
  cancel?: boolean;
  reopen_stage?: string;
  restart?: boolean;
}

export interface WorkflowToolRequest {
  root: string;
  workflow: string;
  input: JsonObject;
  execute: boolean;
  approval?: WorkflowApproval;
}

export interface ActionToolRequest {
  root?: string;
  action: string;
  input: JsonObject;
  execute: boolean;
}

export interface ReadToolRequest {
  uri: string;
}

const ACTION_INTERNAL_KEYS = new Set([
  "root", "action", "execute", "skipSync", "source_manifest", "source_snapshot", "source_files", "source_file_hashes", "lspResult", "lsp_result",
  "configOwnerRoot", "config_owner_root",
  "approval", "approvalStage", "approval_stage", "approvalSessionId", "approval_session_id",
  "approvalStageHash", "approval_stage_hash", "approvalStageRevision", "approval_stage_revision",
  "approvedStages", "approved_stages", "approvalComplete", "approval_complete", "approvalCancel", "approval_cancel",
  "approvalReopenStage", "approval_reopen_stage", "approvalRestart", "approval_restart",
]);

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: -32602 });
}

function object(value: unknown, field: string): JsonObject {
  if (!isRecord(value)) invalid(`${field} must be an object`);
  return value as JsonObject;
}

function optionalObject(value: unknown, field: string): JsonObject {
  return value === undefined ? {} : object(value, field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(`${field} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") invalid(`${field} must be a boolean`);
  return value;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${field} must be a non-negative integer`);
  }
  return value;
}

function onlyKeys(value: JsonObject, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) invalid(`${field} contains unsupported fields: ${unknown.join(", ")}`);
}

function rejectControlKeys(value: JsonObject, reserved: ReadonlySet<string>, field: string): void {
  const found = Object.keys(value).filter((key) => reserved.has(key));
  if (found.length > 0) invalid(`${field} contains reserved control fields: ${found.join(", ")}`);
}

function workflowApproval(value: unknown): WorkflowApproval | undefined {
  if (value === undefined) return undefined;
  const approval = object(value, "cadre_workflow.approval");
  onlyKeys(approval, ["stage", "stage_hash", "stage_revision", "session_id", "approved_stages", "complete", "cancel", "reopen_stage", "restart"], "cadre_workflow.approval");
  const stage = optionalString(approval.stage, "approval.stage");
  const stageHash = optionalString(approval.stage_hash, "approval.stage_hash");
  if (stageHash && !/^[a-f0-9]{64}$/.test(stageHash)) {
    invalid("approval.stage_hash must be a 64-character lowercase hexadecimal stage hash");
  }
  const stageRevision = optionalNonNegativeInteger(approval.stage_revision, "approval.stage_revision");
  const sessionId = optionalString(approval.session_id, "approval.session_id");
  if (sessionId && !/^[a-f0-9]{24}$/.test(sessionId)) {
    invalid("approval.session_id must be a 24-character lowercase hexadecimal Cadre session id");
  }
  if (approval.approved_stages !== undefined && (!Array.isArray(approval.approved_stages) || !approval.approved_stages.every((entry) => typeof entry === "string"))) {
    invalid("approval.approved_stages must be an array of strings");
  }
  const complete = optionalBoolean(approval.complete, "approval.complete");
  const cancel = optionalBoolean(approval.cancel, "approval.cancel");
  const reopenStage = optionalString(approval.reopen_stage, "approval.reopen_stage");
  const restart = optionalBoolean(approval.restart, "approval.restart");
  const stagedTransition = Boolean(
    stage || stageHash || stageRevision !== undefined
    || approval.approved_stages !== undefined || complete,
  );
  const operations = [
    stagedTransition ? "stage approval/complete" : null,
    cancel ? "cancel" : null,
    reopenStage ? "reopen_stage" : null,
    restart ? "restart" : null,
  ].filter((entry): entry is string => Boolean(entry));
  if (operations.length > 1) {
    invalid(`cadre_workflow.approval operations are mutually exclusive: ${operations.join(", ")}`);
  }
  if ((cancel || reopenStage) && !sessionId) {
    invalid(`approval.session_id is required for ${cancel ? "cancel" : "reopen_stage"}`);
  }
  return {
    ...(stage ? { stage } : {}),
    ...(stageHash ? { stage_hash: stageHash } : {}),
    ...(stageRevision !== undefined ? { stage_revision: stageRevision } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(approval.approved_stages ? { approved_stages: approval.approved_stages as string[] } : {}),
    ...(approval.complete !== undefined ? { complete } : {}),
    ...(approval.cancel !== undefined ? { cancel } : {}),
    ...(reopenStage ? { reopen_stage: reopenStage } : {}),
    ...(approval.restart !== undefined ? { restart } : {}),
  };
}

export function parseWorkflowToolRequest(value: unknown): WorkflowToolRequest {
  const request = object(value, "cadre_workflow arguments");
  onlyKeys(request, ["root", "workflow", "input", "execute", "approval"], "cadre_workflow arguments");
  const input = optionalObject(request.input, "cadre_workflow.input");
  rejectControlKeys(input, WORKFLOW_INPUT_RESERVED_KEYS, "cadre_workflow.input");
  const approval = workflowApproval(request.approval);
  return {
    root: requiredString(request.root, "cadre_workflow.root"),
    workflow: requiredString(request.workflow, "cadre_workflow.workflow"),
    input,
    execute: optionalBoolean(request.execute, "cadre_workflow.execute"),
    ...(approval ? { approval } : {}),
  };
}

export function workflowRuntimeArgs(request: WorkflowToolRequest): RuntimeArgs {
  return {
    ...request.input,
    root: request.root,
    workflow: request.workflow,
    execute: request.execute,
    ...(request.approval ? {
      approvalStage: request.approval.stage,
      approvalStageHash: request.approval.stage_hash,
      approvalStageRevision: request.approval.stage_revision,
      approvalSessionId: request.approval.session_id,
      approvedStages: request.approval.approved_stages,
      approvalComplete: request.approval.complete === true,
      approvalCancel: request.approval.cancel === true,
      ...(request.approval.reopen_stage ? { approvalReopenStage: request.approval.reopen_stage } : {}),
      ...(request.approval.restart !== undefined ? { approvalRestart: request.approval.restart === true } : {}),
    } : {}),
  } as RuntimeArgs;
}

export function parseActionToolRequest(value: unknown): ActionToolRequest {
  const request = object(value, "cadre_action arguments");
  onlyKeys(request, ["root", "action", "input", "execute"], "cadre_action arguments");
  const action = requiredString(request.action, "cadre_action.action");
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(action)) {
    invalid("cadre_action.action must be a namespaced action such as task.complete");
  }
  const root = optionalString(request.root, "cadre_action.root");
  const input = optionalObject(request.input, "cadre_action.input");
  rejectControlKeys(input, ACTION_INTERNAL_KEYS, "cadre_action.input");
  return {
    ...(root ? { root } : {}),
    action,
    input,
    execute: optionalBoolean(request.execute, "cadre_action.execute"),
  };
}

export function actionRuntimeArgs(request: ActionToolRequest, action: string): RuntimeArgs {
  return {
    ...request.input,
    root: request.root,
    action,
    execute: request.execute,
  } as RuntimeArgs;
}

export function parseReadToolRequest(value: unknown): ReadToolRequest {
  const request = object(value, "cadre_read arguments");
  onlyKeys(request, ["uri"], "cadre_read arguments");
  return { uri: requiredString(request.uri, "cadre_read.uri") };
}
