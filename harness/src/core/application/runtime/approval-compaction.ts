import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";

function compactCurrentDocument(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  const document = asJsonObject(value);
  const files = Array.isArray(document.files) ? document.files.map(asJsonObject) : [];
  const human = files.find((file) => file.review_role === "human") || {};
  const canonical = files.find((file) => file.review_role === "canonical") || {};
  return {
    id: asOptionalString(document.id) || null,
    canonical_path: asOptionalString(canonical.canonical_path || human.canonical_path) || null,
    projection_path: asOptionalString(human.projection_path || human.path) || null,
    snapshot_hashes: Object.fromEntries(files.flatMap((file) => {
      const filePath = asOptionalString(file.path);
      const hash = asOptionalString(file.sha256);
      return filePath && hash ? [[filePath, hash]] : [];
    })),
  };
}

export function compactApproval(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const approval = asJsonObject(value);
  const stages = Array.isArray(approval.stages) ? approval.stages.map(asJsonObject) : [];
  const bundle = asJsonObject(approval.current_review_bundle);
  const bundleFiles = Array.isArray(bundle.files) ? bundle.files : [];
  return {
    kind: asOptionalString(approval.kind) || "cadre.staged_approval.v1",
    required: approval.required !== false,
    ...(approval.cancelled === true ? { cancelled: true } : {}),
    session_id: asOptionalString(approval.session_id) || null,
    session_resumable: approval.session_resumable === true,
    explicit_user_approval_required: approval.explicit_user_approval_required === true,
    manual_approval_required: approval.manual_approval_required === true,
    manual_approval_prompt: asOptionalString(approval.manual_approval_prompt) || null,
    approval_complete: approval.approval_complete === true,
    valid_for_execute: approval.valid_for_execute === true,
    ...(asOptionalString(approval.approval_error) ? { approval_error: asOptionalString(approval.approval_error) } : {}),
    current_stage: asOptionalString(approval.current_stage) || null,
    current_stage_hash: asOptionalString(approval.current_stage_hash) || null,
    current_stage_revision: typeof approval.current_stage_revision === "number"
      ? approval.current_stage_revision
      : null,
    approved_stages: asStringArray(approval.approved_stages),
    pending_stages: asStringArray(approval.pending_stages),
    intent_to_add_paths: asStringArray(approval.intent_to_add_paths),
    approved_review_paths: asStringArray(approval.approved_review_paths),
    final_only_files: asStringArray(approval.final_only_files),
    current_document: compactCurrentDocument(approval.current_document),
    stages: stages.map((stage) => ({
      id: asOptionalString(stage.id) || null,
      input_keys: asStringArray(stage.input_keys),
      hash: asOptionalString(stage.hash) || null,
      revision: typeof stage.revision === "number" ? stage.revision : 0,
    })),
    current_review_bundle_path: asOptionalString(bundle.manifest_path) || null,
    current_review_bundle_file_count: bundleFiles.length,
    next_actions: Array.isArray(approval.next_actions) ? approval.next_actions.slice(0, 1) : [],
  };
}
