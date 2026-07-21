import type { JsonObject, JsonValue, RuntimeArgs } from "../../../types";
import { asJsonArray, asJsonObject, asOptionalString, asStringArray, isJsonValue } from "../../../guards";

import type { CoreResult } from "./contracts";
import { approvalPayload } from "./approval-request";
import { implementationNext, implementationRequired } from "./implementation-orchestration";
import {
  approvalStageInputKeys,
  promptWritableInputPaths,
  publicWorkflowInput,
  workflowContinuationCall,
  writableInputPaths,
} from "./workflow-continuations";
import { workflowPacket } from "./workflow-packet";

export type CadrePublicTool = "cadre_workflow" | "cadre_action" | "cadre_read";

export interface WorkflowNextCall extends JsonObject {
  tool: CadrePublicTool;
  arguments: JsonObject;
}

export interface WorkflowPacketV1 extends JsonObject {
  ok: boolean;
  workflow: string;
  phase: string;
  decision: JsonObject;
  required: string[];
  next: WorkflowNextCall | null;
  artifacts: JsonObject[];
  resources: string[];
  data: JsonObject;
  warnings: string[];
  errors: string[];
}

const ROOTLESS_RESOURCES = new Set(["cadre://template-inventory"]);
const MAX_DATA_ARRAY_ITEMS = 30;
const MAX_DATA_DEPTH = 6;
const MAX_DATA_OBJECT_KEYS = 50;
const MAX_DATA_STRING_CHARS = 4_000;
function jsonValue(value: unknown): JsonValue | undefined {
  return isJsonValue(value) ? value : undefined;
}

function boundedJsonValue(value: unknown, depth = 0): JsonValue | undefined {
  if (typeof value === "string") {
    return value.length > MAX_DATA_STRING_CHARS
      ? `${value.slice(0, MAX_DATA_STRING_CHARS)}\n...[truncated]`
      : value;
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") return jsonValue(value);
  if (depth >= MAX_DATA_DEPTH) return "[depth-limit]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DATA_ARRAY_ITEMS)
      .map((entry) => boundedJsonValue(entry, depth + 1))
      .filter((entry): entry is JsonValue => entry !== undefined);
  }
  const result: JsonObject = {};
  for (const [key, entry] of Object.entries(asJsonObject(value)).slice(0, MAX_DATA_OBJECT_KEYS)) {
    const bounded = boundedJsonValue(entry, depth + 1);
    if (bounded !== undefined) result[key] = bounded;
  }
  return result;
}

function boundedJsonObject(value: unknown): JsonObject {
  const bounded = boundedJsonValue(value);
  return bounded && typeof bounded === "object" && !Array.isArray(bounded) ? bounded : {};
}

function approvalReopenOptions(root: string, workflow: string, approval: JsonObject): JsonObject[] {
  const sessionId = asOptionalString(approval.session_id);
  if (!sessionId) return [];
  return asStringArray(approval.approved_stages).map((stage) => ({
    stage,
    call: {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow,
        input: {},
        execute: false,
        approval: { session_id: sessionId, reopen_stage: stage },
      },
    },
  }));
}

function approvalDecision(root: string, workflow: string, result: JsonObject): JsonObject | null {
  const approval = asJsonObject(result.approval);
  if (approval.cancelled === true) return null;
  const currentStage = asOptionalString(approval.current_stage);
  if (!currentStage) {
    if (
      approval.session_id
      && asStringArray(approval.pending_stages).length === 0
      && approval.approval_error == null
    ) {
      if (result.dry_run === false || ["executed", "complete", "completed"].includes(String(result.phase_state || ""))) {
        return null;
      }
      return {
        kind: "ready",
        session_id: asOptionalString(approval.session_id) || null,
        approved_stages: asStringArray(approval.approved_stages),
        pending_stages: [],
        reopen: approvalReopenOptions(root, workflow, approval),
        review_set: {
          version: 1,
          schema: "cadre.review_set.collection.v1",
          complete: true,
          truncated: false,
          stages: asJsonArray(approval.review_documents),
          files: asJsonArray(approval.review_files),
        },
        prompt: "All stages are approved. Execute the returned next call, or reopen an approved stage to revise it and every dependent stage.",
      };
    }
    const human = asJsonObject(result.human_review);
    if (human.required === true && human.confirmed !== true) {
      return {
        kind: "approval",
        stage: "human_review",
        session_id: null,
        prompt: jsonValue(human.approval_instruction) || "Review the proposed change and ask for explicit user approval.",
      };
    }
    return null;
  }
  const sessionId = asOptionalString(approval.session_id) || null;
  const writable = writableInputPaths(approvalStageInputKeys(approval, currentStage));
  if (writable.error) return { kind: "blocked", reason: writable.error };
  return {
    kind: "approval",
    stage: currentStage,
    title: asOptionalString(approval.current_stage_title) || null,
    session_id: sessionId,
    stage_hash: asOptionalString(approval.current_stage_hash) || null,
    stage_revision: typeof approval.current_stage_revision === "number" ? approval.current_stage_revision : null,
    approved_stages: asStringArray(approval.approved_stages),
    pending_stages: asStringArray(approval.pending_stages),
    amend: sessionId && approval.session_resumable === true ? workflowContinuationCall(root, workflow, {}, sessionId) : null,
    reopen: approvalReopenOptions(root, workflow, approval),
    review_set: asJsonObject(approval.current_review_set),
    writable_paths: writable.paths,
    prompt: asOptionalString(approval.manual_approval_prompt) || "Review the current stage and ask for explicit user approval.",
  };
}

function workflowDecisionBase(root: string, workflow: string, result: JsonObject, args: RuntimeArgs): JsonObject {
  const approvalState = asJsonObject(result.approval);
  const approvalError = asOptionalString(approvalState.approval_error);
  if (approvalState.approval_recovery_required === true) {
    return {
      kind: "recovery_required",
      reason: approvalError || "Approval target/session rollback requires manual recovery",
      session_id: asOptionalString(approvalState.session_id) || null,
      current_stage: asOptionalString(approvalState.current_stage) || null,
      approved_stages: asStringArray(approvalState.approved_stages),
      pending_stages: asStringArray(approvalState.pending_stages),
      resume: null,
      writable_paths: [],
    };
  }
  if (approvalState.cancelled === true) {
    const cancellation = asJsonObject(approvalState.cancellation);
    return {
      kind: "cancelled",
      session_id: asOptionalString(approvalState.session_id) || null,
      cleanup_pending: cancellation.cleanup_pending === true,
      warning: asOptionalString(cancellation.warning) || null,
    };
  }
  if (result.recovery_required === true || result.phase_state === "recovery_required") {
    return {
      kind: "recovery_required",
      reason: asOptionalString(result.error || result.reason || result.stage) || "Cadre recovery must complete before continuing",
      session_id: asOptionalString(approvalState.session_id) || null,
      resume: null,
      writable_paths: [],
    };
  }
  const explicit = asJsonObject(result.decision);
  if (Object.keys(explicit).length > 0) return explicit;
  const skills = asJsonObject(result.project_skills);
  const skillDecision = asJsonObject(skills.decision);
  if (Object.keys(skillDecision).length > 0) return skillDecision;
  if (approvalError) {
    const sessionId = asOptionalString(approvalState.session_id) || null;
    const currentStage = asOptionalString(approvalState.current_stage) || null;
    const writable = writableInputPaths(approvalStageInputKeys(approvalState, currentStage));
    return {
      kind: "blocked",
      reason: writable.error || approvalError,
      session_id: sessionId,
      current_stage: currentStage,
      stage_hash: asOptionalString(approvalState.current_stage_hash) || null,
      stage_revision: typeof approvalState.current_stage_revision === "number"
        ? approvalState.current_stage_revision
        : null,
      approved_stages: asStringArray(approvalState.approved_stages),
      pending_stages: asStringArray(approvalState.pending_stages),
      resume: sessionId && approvalState.session_resumable === true
        ? workflowContinuationCall(root, workflow, {}, sessionId)
        : null,
      writable_paths: writable.paths,
    };
  }
  const intentPrompts = asJsonArray(result.intent_prompts);
  const prompts = (intentPrompts.length > 0 ? intentPrompts : asJsonArray(result.native_prompts)).map(asJsonObject);
  if (prompts.length > 0 || result.phase_state === "awaiting_clarification") {
    const approval = asJsonObject(result.approval);
    const sessionId = asOptionalString(approval.session_id) || null;
    const resumableSessionId = sessionId && approval.session_resumable === true ? sessionId : null;
    const currentStage = asOptionalString(approval.current_stage) || null;
    const stageInputKeys = approvalStageInputKeys(approval, currentStage);
    const required = asStringArray(result.missing_payload);
    const writableRequired = required.length > 0 ? required : (resumableSessionId && prompts.length === 0 ? stageInputKeys : []);
    const writable = promptWritableInputPaths(prompts, writableRequired, workflow, resumableSessionId ? stageInputKeys : []);
    if (writable.error) return { kind: "blocked", reason: `Invalid clarification response target: ${writable.error}` };
    return {
      kind: "clarification",
      prompts,
      required,
      session_id: sessionId,
      current_stage: currentStage,
      approved_stages: asStringArray(approval.approved_stages),
      pending_stages: asStringArray(approval.pending_stages),
      resume: workflowContinuationCall(root, workflow, resumableSessionId ? {} : publicWorkflowInput(args), resumableSessionId),
      writable_paths: writable.paths,
    };
  }
  if (result.phase_state === "pending_provider") {
    return { kind: "provider_evidence", required: jsonValue(result.required_evidence) || null };
  }
  if (result.ok === false) {
    return { kind: "blocked", reason: asOptionalString(result.error || result.reason || result.stage) || "Cadre workflow failed" };
  }
  const approval = approvalDecision(root, workflow, result);
  if (approval) return approval;
  const completed = ["executed", "complete", "completed"].includes(String(result.phase_state || ""));
  return { kind: completed ? "complete" : "ready" };
}

function workflowDecision(root: string, workflow: string, result: JsonObject, args: RuntimeArgs): JsonObject {
  const decision = workflowDecisionBase(root, workflow, result, args);
  if (decision.reopen !== undefined || ["recovery_required", "cancelled", "complete"].includes(String(decision.kind || ""))) {
    return decision;
  }
  const reopen = approvalReopenOptions(root, workflow, asJsonObject(result.approval));
  return reopen.length > 0 ? { ...decision, reopen } : decision;
}

function requiredInputs(result: JsonObject, workflow: string, args: RuntimeArgs): string[] {
  return Array.from(new Set([
    ...asStringArray(result.missing_payload),
    ...(result.ok === false ? asStringArray(result.required_payload) : []),
    ...(result.required_provider_mcp ? ["providerEvidence"] : []),
    ...(workflow === "implement" ? implementationRequired(result, args) : []),
    ...(workflow === "debug" && args.execute !== true ? ["execute"] : []),
  ]));
}

function reviewFiles(value: unknown): JsonObject[] {
  const bundle = asJsonObject(value);
  return asJsonArray(bundle.files).slice(0, 30).map((entry) => {
    const file = asJsonObject(entry);
    return {
      path: jsonValue(file.path) || null,
      review_path: jsonValue(file.review_path) || null,
      target_path: jsonValue(file.target_path) || null,
      title: jsonValue(file.title) || null,
      kind: jsonValue(file.kind) || null,
    };
  });
}

function workflowArtifacts(result: JsonObject): JsonObject[] {
  const files = [
    ...asJsonArray(result.review_artifacts).map((entry) => boundedJsonObject(entry)),
    ...reviewFiles(result.review_bundle),
  ];
  for (const path of [...asStringArray(result.written), ...asStringArray(result.release_artifacts)]) {
    files.push({ path, kind: "changed" });
  }
  const seen = new Set<string>();
  return files.filter((file) => {
    const located = asOptionalString(file.path)
      || asOptionalString(file.review_path)
      || asOptionalString(file.target_path);
    const semantic = [file.kind, file.title, file.source].map((entry) => String(entry || "")).join(":");
    const key = located || (semantic === "::" ? JSON.stringify(file) || "{}" : semantic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

function resourceWithRoot(root: string, uri: string): string {
  const base = uri.split("?")[0] || uri;
  if (!uri.startsWith("cadre://") || ROOTLESS_RESOURCES.has(base) || /[?&]root=/.test(uri)) return uri;
  return `${uri}${uri.includes("?") ? "&" : "?"}root=${encodeURIComponent(root)}`;
}

function workflowResources(root: string, result: JsonObject): string[] {
  const candidates = [
    ...asStringArray(result.resource_uris),
    ...asStringArray(result.schema_resources),
    ...asStringArray(result.detail_resources),
  ];
  return Array.from(new Set(candidates.map((uri) => resourceWithRoot(root, uri)))).slice(0, 8);
}

function publicCall(value: unknown): WorkflowNextCall | null {
  const packet = asJsonObject(value);
  const tool = asOptionalString(packet.tool);
  if (!tool || !["cadre_workflow", "cadre_action", "cadre_read"].includes(tool)) return null;
  return { tool: tool as CadrePublicTool, arguments: asJsonObject(packet.arguments) };
}

function actionCall(root: string, action: string, input: JsonObject = {}, execute = false): WorkflowNextCall {
  return {
    tool: "cadre_action",
    arguments: { root, action, input, ...(execute ? { execute: true } : {}) },
  };
}

function nextCall(root: string, workflow: string, result: JsonObject, resources: string[], args: RuntimeArgs): WorkflowNextCall | null {
  const explicit = publicCall(result.next) || publicCall(result.next_intent);
  if (explicit) return explicit;
  if (workflow === "skill" && result.phase_state === "awaiting_formatting" && resources[0]) {
    return { tool: "cadre_read", arguments: { uri: resources[0] } };
  }
  const approval = asJsonObject(result.approval);
  if (approval.approval_recovery_required === true) return null;
  if (
    result.ok !== false
    && result.phase_state !== "pending_provider"
    && asStringArray(result.missing_payload).length === 0
    && args.execute !== true
    && approval.cancelled !== true
    && asStringArray(approval.pending_stages).length === 0
    && approval.approval_error == null
    && approval.session_id
  ) {
    return {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow,
        input: {},
        execute: true,
        approval: {
          session_id: approval.session_id as JsonValue,
          approved_stages: jsonValue(approval.approved_stages) || [],
          complete: true,
        },
      },
    };
  }
  if (
    workflow === "refresh"
    && result.ok !== false
    && args.execute !== true
    && approval.required === false
    && asStringArray(result.selected_levels).some((level) => level === "projections")
  ) {
    const input = approvalPayload(args, workflow);
    delete input.workflow;
    delete input.root;
    return {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow,
        input,
        execute: true,
      },
    };
  }
  if (result.phase_state === "pending_provider") {
    const providerActions = resources.find((uri) => uri.startsWith("cadre://provider-actions"));
    return providerActions ? { tool: "cadre_read", arguments: { uri: providerActions } } : null;
  }
  const snapshot = args.execute === true ? publicCall(result.snapshot_packet) : null;
  if (snapshot) return snapshot;
  const job = asJsonObject(result.job);
  if (job.id) return actionCall(root, "job.result", { jobId: String(job.id) });
  if (workflow === "implement") return implementationNext(root, result, args) as WorkflowNextCall | null;
  return null;
}

const WORKFLOW_ALIASES: Record<string, string> = {
  setup_assist: "setup",
  setup_scaffold: "setup",
  new_track: "newtrack",
  artifact_sync: "artifacts",
};

const COMMON_DATA_FIELDS = ["dry_run", "operation", "stage", "sync_pre", "sync_post", "control_commit"];
const WORKFLOW_DATA_FIELDS: Record<string, string[]> = {
  setup: ["topology", "provider", "sync_mode", "workspace_health", "workspace", "dependency_graph", "lsp", "lsp_setup", "integrations", "styleguide_ids", "project_skills", "scaffolded", "written", "skipped", "gitattributes", "ci_setup", "polyrepo_setup", "force"],
  newtrack: ["track_id", "track_context", "plan_assist", "generation_quality", "project_skills", "write", "regen", "restart"],
  implement: ["prepare_implementation", "phase_schedule", "integration_worktrees", "implementation_guard", "task", "project_skills"],
  status: ["status", "project_skills"],
  review: ["track_context", "review_assist", "gate", "provider", "required_provider_mcp", "required_evidence", "unsupported_reason", "project_skills"],
  validate: ["doctor", "team", "integrity", "collisions", "fleet", "branch_sets", "native_state", "project_skill_diagnostics", "projection_validation"],
  debug: ["dap_status", "dap_setup", "snapshot", "breakpoints", "configuration", "adapter", "output", "job"],
  archive: ["tracks", "archived", "regen"],
  handoff: ["track_id", "track_context", "handoff_path", "message", "event", "review_validation", "reused_review_files"],
  ship: ["track_id", "gate", "provider", "provider_actions", "git_actions", "git_results", "publication", "git_action_state", "provider_evidence_write", "continuation_token", "required_provider_mcp", "required_evidence", "unsupported_reason"],
  land: ["track_id", "topology", "preflight", "gate", "provider", "provider_actions", "git_actions", "git_results", "publication", "git_action_state", "provider_evidence_write", "continuation_token", "required_provider_mcp", "required_evidence", "unsupported_reason", "fleet"],
  release: ["release_version", "completed_tracks", "release_artifacts", "git_actions", "git_results", "bump", "setup_state", "review_validation", "reused_review_files"],
  revise: ["track_id", "track_context", "impact", "write", "regen", "review_validation", "reused_review_files"],
  refresh: ["scope", "selected_levels", "refresh_analysis", "doctor", "workspace", "dependency_graph", "lsp", "lsp_setup", "refreshed_documents", "patterns", "projection_repair", "review_validation", "reused_review_files"],
  artifacts: ["artifact_action", "artifact_scope", "artifacts", "written", "skipped", "mutation"],
  flag: ["track_id", "track_context", "proposed_status", "reason", "status_result", "metadata_patch", "event"],
  revert: ["track_id", "track_context", "affected_repos", "repo_error", "git_actions", "git_results", "metadata_patch", "projection_repair", "regen", "event"],
  formula: ["action", "id", "formula_id", "wisp_id", "path", "formula", "formulas", "count", "title", "variables", "recommended_phase", "dependencies", "spec", "plan", "wisp", "wisps", "step", "digest", "event", "existed", "pour_event", "pour_commit", "track_id"],
  skill: ["operation", "skill_id", "new_skill_id", "valid", "invalid", "manifest", "diagnostics", "projection_path", "references", "source_requests", "written", "removed"],
};

function workflowData(workflow: string, result: JsonObject): JsonObject {
  const canonical = WORKFLOW_ALIASES[workflow] || workflow;
  const selected = [...COMMON_DATA_FIELDS, ...(WORKFLOW_DATA_FIELDS[canonical] || ["track_id", "status", "reason", "scope", "project_skills"])];
  const data: JsonObject = {};
  for (const key of new Set(selected)) {
    const value = boundedJsonValue(result[key]);
    if (value !== undefined) data[key] = value;
  }
  return data;
}

export function workflowPacketV1(root: string, args: RuntimeArgs = {}): WorkflowPacketV1 {
  const raw = workflowPacket(root, args);
  return workflowPacketEnvelopeV1(root, args, raw);
}

export function workflowPacketEnvelopeV1(root: string, args: RuntimeArgs, value: CoreResult | unknown): WorkflowPacketV1 {
  const result = asJsonObject(value);
  const workflow = asOptionalString(result.workflow || args.workflow) || "status";
  const ok = result.ok !== false;
  const resources = workflowResources(root, result);
  const reason = asOptionalString(result.error || result.reason || result.stage);
  const rawErrors = asStringArray(result.errors);
  const errors = ok
    ? rawErrors
    : Array.from(new Set([reason || rawErrors[0] || "Cadre workflow failed", ...rawErrors]));
  const cancellationWarning = asOptionalString(asJsonObject(asJsonObject(result.approval).cancellation).warning);
  return {
    ok,
    workflow,
    phase: asOptionalString(result.phase_state) || (ok ? "ready" : "blocked"),
    decision: workflowDecision(root, workflow, result, args),
    required: requiredInputs(result, workflow, args),
    next: nextCall(root, workflow, result, resources, args),
    artifacts: workflowArtifacts(result),
    resources,
    data: workflowData(workflow, result),
    warnings: Array.from(new Set([...asStringArray(result.warnings), ...(cancellationWarning ? [cancellationWarning] : [])])),
    errors,
  };
}
