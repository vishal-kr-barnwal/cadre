import type { JsonObject, JsonValue, RuntimeArgs } from "../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../guards";
import type { RuntimeEnvelope } from "../domain/protocol-types";

const FORBIDDEN_BODY_KEYS = new Set(["content", "instructions", "stdout", "stderr", "notes", "diff", "plan"]);

function bounded(value: unknown, depth = 0): JsonValue {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string") return value.length > 600 ? `${value.slice(0, 600)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);
  if (depth >= 4) return "[resource-required]";
  if (Array.isArray(value)) return value.slice(0, 12).map((entry) => bounded(entry, depth + 1));
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(asJsonObject(value))) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      output[`${key}_available`] = entry != null;
      continue;
    }
      output[key] = bounded(entry, depth + 1);
  }
  return output;
}

function approvalDecision(result: JsonObject): JsonObject | null {
  const approval = asJsonObject(result.approval);
  const currentStage = asOptionalString(approval.current_stage);
  if (!currentStage) {
    const human = asJsonObject(result.human_review);
    if (human.required === true && human.confirmed !== true) {
      return { kind: "approval", stage: "human_review", session_id: null, prompt: human.approval_instruction || "Review the proposed change and ask for explicit user approval." };
    }
    return null;
  }
  return {
    kind: "approval",
    stage: currentStage || asOptionalString(result.stage) || "human_review",
    title: asOptionalString(approval.current_stage_title) || null,
    session_id: asOptionalString(approval.session_id) || null,
    approved_stages: asStringArray(approval.approved_stages),
    pending_stages: asStringArray(approval.pending_stages),
    prompt: asOptionalString(approval.manual_approval_prompt) || "Review the current stage and ask for explicit user approval.",
  };
}

function decision(result: JsonObject): JsonObject {
  const skills = asJsonObject(result.project_skills);
  if (skills.decision) return asJsonObject(skills.decision);
  const prompts = Array.isArray(result.intent_prompts) ? result.intent_prompts : Array.isArray(result.native_prompts) ? result.native_prompts : [];
  if (prompts.length > 0) return { kind: "clarification", prompts: bounded(prompts) };
  const approval = approvalDecision(result);
  if (approval) return approval;
  if (result.phase_state === "pending_provider") return { kind: "provider_evidence", required: result.required_evidence || null };
  if (result.ok === false) return { kind: "blocked", reason: result.error || result.stage || "Cadre workflow failed" };
  return { kind: result.execute === true && result.dry_run !== true ? "complete" : "ready" };
}

function required(result: JsonObject): string[] {
  return Array.from(new Set([
    ...asStringArray(result.missing_payload),
    ...(result.ok === false ? asStringArray(result.required_payload) : []),
    ...(result.required_provider_mcp ? [String(result.required_provider_mcp)] : []),
  ]));
}

function reviewFiles(value: unknown): JsonObject[] {
  const bundle = asJsonObject(value);
  return (Array.isArray(bundle.files) ? bundle.files : []).slice(0, 30).map((entry) => {
    const file = asJsonObject(entry);
    return {
      path: file.path || null,
      review_path: file.review_path || null,
      target_path: file.target_path || null,
      kind: file.kind || null,
    };
  });
}

function artifacts(result: JsonObject): JsonObject[] {
  const files = reviewFiles(result.review_bundle);
  for (const path of [...asStringArray(result.written), ...asStringArray(result.release_artifacts)]) files.push({ path, kind: "changed" });
  return files;
}

function relevantResources(workflow: string, result: JsonObject): string[] {
  const candidates = [
    ...asStringArray(result.schema_resources),
    ...asStringArray(result.detail_resources),
    ...asStringArray(result.resource_uris),
  ];
  const keep: Record<string, string[]> = {
    setup: ["template-inventory", "workspace-diagnostics", "dependency-graph"],
    newtrack: ["artifact-schema"],
    implement: ["track-context", "parallel-state", "project-skill"],
    review: ["quality-gate", "review-evidence"],
    ship: ["provider-actions", "quality-gate"],
    land: ["provider-actions", "quality-gate"],
    release: ["release-plan"],
    artifacts: ["artifact-"],
  };
  const needles = keep[workflow] || [];
  return Array.from(new Set(candidates.filter((uri) => needles.some((needle) => uri.includes(needle))))).slice(0, 6);
}

function nextCall(root: string, workflow: string, result: JsonObject, resources: string[]): JsonObject | null {
  if (result.phase_state === "pending_provider" && resources[0]) return { tool: "cadre_read", arguments: { uri: resources[0] } };
  const snapshot = asJsonObject(result.snapshot_packet);
  if (snapshot.tool) {
    const argumentsObject = asJsonObject(snapshot.arguments);
    return { tool: "cadre_action", arguments: { root, action: "intel.dap_snapshot", input: argumentsObject.input || argumentsObject } };
  }
  const job = asJsonObject(result.job);
  if (job.id) return { tool: "cadre_action", arguments: { root, action: "job.result", input: { jobId: job.id } } };
  if (workflow === "implement") {
    const prep = asJsonObject(result.prepare_implementation);
    const trackId = asOptionalString(prep.selected_track);
    const phase = Number(prep.next_phase_index || 0);
    const task = Number(prep.next_task_index || 0);
    if (trackId && phase > 0 && task > 0) return { tool: "cadre_action", arguments: { root, action: "task.complete", input: { trackId, phaseIndex: phase, taskIndex: task } } };
  }
  return null;
}

function workflowData(workflow: string, result: JsonObject): JsonObject {
  const fields: Record<string, string[]> = {
    setup: ["topology", "provider", "sync_mode", "workspace_health", "styleguide_ids", "project_skills", "scaffolded"],
    newtrack: ["track_id", "plan_assist", "project_skills"],
    implement: ["prepare_implementation", "phase_schedule", "project_skills"],
    debug: ["dap_status", "dap_setup"],
    status: ["status", "project_skills"],
    review: ["track_context", "review_assist", "gate", "provider", "project_skills"],
    validate: ["doctor", "team", "integrity", "collisions", "fleet", "project_skill_diagnostics"],
    ship: ["track_id", "gate", "provider", "provider_actions", "git_actions"],
    land: ["track_id", "gate", "provider", "provider_actions", "git_actions"],
  };
  const selected = fields[workflow] || ["track_id", "status", "reason", "scope", "project_skills"];
  return Object.fromEntries(selected.filter((key) => result[key] !== undefined).map((key) => [key, bounded(result[key])]));
}

export function workflowEnvelope(root: string, args: RuntimeArgs, value: unknown): RuntimeEnvelope {
  const result = asJsonObject(value);
  const workflow = asOptionalString(result.workflow || args.workflow) || "status";
  const ok = result.ok !== false;
  const resources = relevantResources(workflow, result);
  const reason = asOptionalString(result.error || result.reason || result.stage);
  return {
    ok,
    workflow,
    phase: asOptionalString(result.phase_state) || (ok ? "ready" : "blocked"),
    decision: decision(result),
    required: required(result),
    next: nextCall(root, workflow, result, resources),
    artifacts: artifacts(result),
    resources,
    data: workflowData(workflow, result),
    warnings: asStringArray(result.warnings),
    errors: ok ? [] : [reason || "Cadre workflow failed"],
  };
}
