import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray, errorMessage } from "../../../guards";
import { applySkillChanges, emptyManagedManifest, validateManagedManifest, type ManagedManifest, type SkillOperation } from "../../domain/project-skill-management";
import { PROJECT_SKILL_ID_PATTERN } from "../../domain/project-skill-policy";
import { atomicSkillMutation, normalizeReferenceContent } from "../../infrastructure/runtime/project-skill-mutations";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { loadProjectSkill, projectSkillIds } from "../../infrastructure/runtime/project-skills-store";
import type { CoreResult, ReviewFile } from "./contracts";
import { beginTrace, commitTrace } from "./commit-trace";
import { appendCadreEvent } from "./native-state";
import { renderProjectSkillProjection } from "./project-skill-projection";
import { applyStagedApprovalSessionPayload, stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import type { ApprovalStage } from "./staged-approval-stages";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";

function knownRepos(root: string): Set<string> {
  const known = new Set([".", "root"]);
  for (const value of Array.isArray(loadTopology(root).repos.repos) ? loadTopology(root).repos.repos! : []) {
    const name = asOptionalString(asJsonObject(value).name);
    if (name) known.add(name);
  }
  return known;
}

function readManifest(root: string, id: string): { manifest?: ManagedManifest; error?: string } {
  const file = path.join(root, "cadre", "skills", id, "skill.json");
  try {
    const raw = asJsonObject(JSON.parse(fs.readFileSync(file, "utf8")));
    return { manifest: raw as ManagedManifest };
  } catch (error) { return { error: `skill manifest cannot be read: ${errorMessage(error)}` }; }
}

function hashDirectory(directory: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string) => {
    if (!fs.existsSync(current)) { hash.update("missing"); return; }
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      hash.update(path.relative(directory, file));
      if (entry.isDirectory()) visit(file); else hash.update(fs.readFileSync(file));
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function catalog(root: string): CoreResult {
  const repos = knownRepos(root);
  const loaded = projectSkillIds(root).map((id) => loadProjectSkill(root, id, repos));
  return {
    ok: true,
    operation: "list",
    valid: loaded.filter((entry) => entry.ok && entry.skill).map((entry) => ({ id: entry.id, name: entry.skill!.name, description: entry.skill!.description, workflows: entry.skill!.workflows })),
    invalid: loaded.filter((entry) => !entry.ok).map((entry) => ({ id: entry.id, diagnostics: entry.errors })),
  };
}

function show(root: string, id: string): CoreResult {
  const loaded = loadProjectSkill(root, id, knownRepos(root));
  const raw = readManifest(root, id);
  if (!raw.manifest) return { ok: false, operation: "show", skill_id: id, diagnostics: [raw.error], projection_path: `cadre/skills/${id}/SKILL.md`, references: [] };
  return {
    ok: loaded.ok,
    operation: "show",
    skill_id: id,
    manifest: raw.manifest,
    diagnostics: loaded.errors,
    projection_path: `cadre/skills/${id}/SKILL.md`,
    references: (Array.isArray(raw.manifest.references) ? raw.manifest.references : []).map((value) => {
      const reference = asJsonObject(value);
      const relative = asOptionalString(reference.path) || "";
      const file = path.join(root, "cadre", "skills", id, relative);
      return { id: reference.id, path: relative, bytes: fs.existsSync(file) ? fs.statSync(file).size : null, resource_uri: `cadre://project-skill?root=${encodeURIComponent(root)}&id=${encodeURIComponent(id)}&reference=${encodeURIComponent(String(reference.id || ""))}` };
    }),
  };
}

function validateCatalog(root: string, id: string | null): CoreResult {
  if (id) {
    const loaded = loadProjectSkill(root, id, knownRepos(root));
    return { ok: loaded.ok, operation: "validate", skill_id: id, diagnostics: loaded.errors };
  }
  const result = catalog(root);
  const invalid = Array.isArray(result.invalid) ? result.invalid : [];
  return { ...result, operation: "validate", ok: invalid.length === 0 };
}

function inside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourcePause(root: string, skillId: string, requests: JsonObject[]): CoreResult {
  const resources: string[] = [];
  const errors: string[] = [];
  for (const request of requests) {
    const source = asOptionalString(request.source_path) || "";
    const absolute = path.resolve(root, source);
    const relative = path.relative(root, absolute);
    if (!source || relative.startsWith("..") || path.isAbsolute(relative)) errors.push(`source_path must stay inside the project: ${source}`);
    else if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) errors.push(`source_path is not a file: ${source}`);
    else if (!inside(fs.realpathSync(root), fs.realpathSync(absolute))) errors.push(`source_path escapes the project through a link: ${source}`);
    else if (path.resolve(root, "cadre", "skills", skillId, asOptionalString(request.target_path) || "") === absolute) errors.push(`source_path collides with its managed target: ${source}`);
    else resources.push(`cadre://project-skill-source?root=${encodeURIComponent(root)}&path=${encodeURIComponent(source)}`);
  }
  return errors.length ? { ok: false, phase_state: "blocked", errors, error: errors[0] } : {
    ok: true, phase_state: "awaiting_formatting", decision: { kind: "format_reference", required: ["formatted inline content"] },
    detail_resources: resources, source_requests: requests,
  };
}

function desiredFiles(root: string, sourceId: string, manifest: ManagedManifest, contents: Map<string, string>): { files: Map<string, string>; errors: string[] } {
  const files = new Map<string, string>();
  const errors: string[] = [];
  files.set("skill.json", `${JSON.stringify(manifest, null, 2)}\n`);
  files.set("SKILL.md", renderProjectSkillProjection(manifest));
  for (const value of manifest.references) {
    const reference = asJsonObject(value);
    const id = asOptionalString(reference.id) || "";
    const relative = asOptionalString(reference.path) || "";
    let content = contents.get(id);
    if (content === undefined) {
      const existing = path.join(root, "cadre", "skills", sourceId, relative);
      if (fs.existsSync(existing)) content = fs.readFileSync(existing, "utf8");
      else { errors.push(`reference content is required: ${id}`); continue; }
    }
    try { files.set(relative, normalizeReferenceContent(relative, content)); } catch (error) { errors.push(errorMessage(error)); }
  }
  return { files, errors };
}

function reviewFilesFor(operation: SkillOperation, sourceId: string, targetId: string | null, files: Map<string, string>, removedReferencePaths: string[]): ReviewFile[] {
  if (!targetId) return [
    { path: `cadre/skills/${sourceId}/.delete`, title: `Remove project skill ${sourceId}`, kind: "text", source: "skill.remove", content: `Delete cadre/skills/${sourceId}/\n`, missing: true },
    ...removedReferencePaths.map((relative): ReviewFile => ({ path: `cadre/skills/${sourceId}/${relative}.delete`, title: `Remove reference ${relative}`, kind: "text", source: "skill.reference.remove", content: `Delete cadre/skills/${sourceId}/${relative}\n`, missing: true })),
  ];
  const output: ReviewFile[] = [];
  for (const [relative, content] of files) {
    const mainDocument = relative === "skill.json" || relative === "SKILL.md";
    output.push({
      path: `cadre/skills/${targetId}/${relative}`,
      title: relative,
      kind: relative.endsWith(".json") ? "json" : relative.endsWith(".md") ? "markdown" : "text",
      source: "skill.desired_state",
      content,
      documentId: mainDocument ? "skill" : "references",
      reviewRole: relative === "skill.json" ? "canonical" : "human",
      ...(mainDocument ? { canonicalPath: `cadre/skills/${targetId}/skill.json` } : {}),
      projectionPath: mainDocument ? `cadre/skills/${targetId}/SKILL.md` : `cadre/skills/${targetId}/${relative}`,
      ...(!mainDocument ? { approvalGroup: "references" } : {}),
    });
  }
  for (const relative of removedReferencePaths) output.push({
    path: `cadre/skills/${targetId}/${relative}.delete`,
    title: `Remove reference ${relative}`,
    kind: "text",
    source: "skill.reference.remove",
    content: `Delete cadre/skills/${targetId}/${relative}\n`,
    missing: true,
    documentId: "references",
    reviewRole: "human",
    projectionPath: `cadre/skills/${targetId}/${relative}`,
    approvalGroup: "references",
  });
  return output;
}

function approvalStages(operation: SkillOperation, referenceReviewPaths: string[]): ApprovalStage[] {
  return [
    ...(["create", "update"].includes(operation) ? [{ id: "skill", title: "Project Skill", description: "Canonical skill manifest and generated SKILL.md.", documentIds: ["skill"] }] : []),
    ...(["create", "update"].includes(operation) && referenceReviewPaths.length ? [{ id: "references", title: "Skill References", description: "Reference files added, changed, moved, or removed.", documentIds: ["references"] }] : []),
  ];
}

export function workflowSkill(root: string, args: RuntimeArgs): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "skill");
  const operation = (asOptionalString(args.operation) || "list") as SkillOperation;
  const id = asOptionalString(args.skillId || args.skill_id || args.id)?.trim() || "";
  if (operation === "list") return catalog(root);
  if (operation === "show") return id ? show(root, id) : { ok: false, error: "skillId is required" };
  if (operation === "validate") return validateCatalog(root, id || null);
  if (!["create", "update", "rename", "remove"].includes(operation)) return { ok: false, error: `unknown skill operation: ${operation}` };
  if (!id || !PROJECT_SKILL_ID_PATTERN.test(id)) return { ok: false, error: `invalid skillId: ${id || "(missing)"}` };
  const existing = readManifest(root, id);
  const continuingApproval = Boolean(args.approvalSessionId || args.approval_session_id);
  if (operation === "create" && fs.existsSync(path.join(root, "cadre", "skills", id)) && !continuingApproval) return { ok: false, error: `skill already exists: ${id}` };
  if (operation !== "create" && !existing.manifest && operation !== "remove") return { ok: false, error: existing.error || `skill not found: ${id}` };
  if (operation === "remove" && !fs.existsSync(path.join(root, "cadre", "skills", id))) return { ok: false, error: `skill not found: ${id}` };
  const newId = operation === "rename" ? asOptionalString(args.newSkillId || args.new_skill_id)?.trim() || "" : id;
  if (operation === "rename" && (!PROJECT_SKILL_ID_PATTERN.test(newId) || fs.existsSync(path.join(root, "cadre", "skills", newId)))) return { ok: false, error: `invalid or existing rename target: ${newId || "(missing)"}` };
  const sessionSource = (args as JsonObject).source_manifest;
  const sourceManifest = sessionSource && typeof sessionSource === "object" && !Array.isArray(sessionSource)
    ? asJsonObject(sessionSource) as unknown as ManagedManifest
    : existing.manifest;
  const base = operation === "create" ? emptyManagedManifest(id) : sourceManifest || emptyManagedManifest(id);
  const changed = applySkillChanges(base, args.changes);
  if (changed.sourceRequests.length) return { operation, skill_id: id, ...sourcePause(root, id, changed.sourceRequests) };
  const manifest = changed.manifest;
  manifest.id = newId;
  const errors = [...changed.errors, ...(operation === "remove" ? [] : validateManagedManifest(manifest, knownRepos(root)))];
  const desired = operation === "remove" ? { files: new Map<string, string>(), errors: [] } : desiredFiles(root, id, manifest, changed.referenceContent);
  errors.push(...desired.errors);
  if (errors.length) return { ok: false, operation, skill_id: id, phase_state: "blocked", error: errors[0], errors };
  const existingReferences = (Array.isArray(sourceManifest?.references) ? sourceManifest!.references : []).map(asJsonObject);
  const existingReferencePaths = existingReferences.map((value) => asOptionalString(value.path)).filter((value): value is string => Boolean(value));
  const targetReferencePaths = manifest.references.map((value) => asOptionalString(asJsonObject(value).path)).filter((value): value is string => Boolean(value));
  const upsertedPaths = Array.from(changed.referenceContent.keys()).flatMap((referenceId) => manifest.references
    .filter((value) => asOptionalString(asJsonObject(value).id) === referenceId)
    .map((value) => asOptionalString(asJsonObject(value).path) || ""));
  const replacedPaths = existingReferences
    .filter((reference) => changed.referenceContent.has(asOptionalString(reference.id) || ""))
    .map((reference) => asOptionalString(reference.path) || "");
  const removedPaths = existingReferences
    .filter((reference) => changed.removedReferences.has(asOptionalString(reference.id) || ""))
    .map((reference) => asOptionalString(reference.path) || "");
  const changedReferencePaths = Array.from(new Set(operation === "rename" || operation === "remove"
    ? [...existingReferencePaths, ...targetReferencePaths]
    : [...upsertedPaths, ...replacedPaths, ...removedPaths])).filter(Boolean);
  const deletedReferencePaths = operation === "remove" ? changedReferencePaths : existingReferencePaths.filter((relative) => !targetReferencePaths.includes(relative));
  const reviews = reviewFilesFor(operation, id, operation === "remove" ? null : newId, desired.files, deletedReferencePaths);
  const referenceReviewPaths = changedReferencePaths.flatMap((relative) => {
    const base = `cadre/skills/${operation === "remove" ? id : newId}/${relative}`;
    return deletedReferencePaths.includes(relative) ? [`${base}.delete`] : [base];
  });
  const stages = approvalStages(operation, referenceReviewPaths);
  const snapshot = asOptionalString((args as JsonObject).source_snapshot) || hashDirectory(path.join(root, "cadre", "skills", id));
  const reviewArgs = {
    ...args,
    source_snapshot: snapshot,
    source_manifest: (sourceManifest || emptyManagedManifest(id)) as unknown as JsonObject,
  } as RuntimeArgs;
  const approval = stages.length > 0
    ? stagedApprovalState(root, "skill", reviewArgs, stages, reviews, { operation, skill_id: id, new_skill_id: newId, source_snapshot: snapshot, final_only_files: ["cadre/events.jsonl"] })
    : { required: false, valid_for_execute: true, current_stage: null, pending_stages: [] };
  const approvalError = stages.length > 0 ? stagedApprovalError(approval) : null;
  if (args.execute !== true || (stages.length > 0 && !stagedApprovalReady(approval))) return {
    ok: !approvalError,
    operation,
    skill_id: id,
    new_skill_id: newId,
    dry_run: true,
    phase_state: stages.length > 0 ? "awaiting_staged_approval" : "ready",
    approval,
    review_bundle: asJsonObject(approval).current_review_bundle,
    mutation_plan: stages.length === 0 ? { operation, source: id, target: operation === "remove" ? null : newId } : null,
    ...(approvalError ? { error: approvalError } : {}),
  };
  const reviewValidation = stages.length > 0 ? validateApprovedTargetReviewFiles(root, reviewArgs) : { ok: true, skipped: true };
  if (reviewValidation.ok === false) return { ok: false, operation, skill_id: id, phase_state: "awaiting_staged_approval", stage: "staged_review_drift", approval, review_validation: reviewValidation, error: asOptionalString(reviewValidation.error) || "Approved review files changed" };
  const traceBefore = beginTrace(root);
  try {
    const mutation = atomicSkillMutation(root, id, operation === "remove" ? null : newId, desired.files);
    if (operation !== "remove") {
      const final = loadProjectSkill(root, newId, knownRepos(root));
      if (!final.ok) { mutation.rollback(); mutation.finish(); return { ok: false, phase_state: "recovery_required", stage: "final_validation", errors: final.errors }; }
    }
    mutation.finish();
    const eventKind = `project_skill_${operation === "create" ? "created" : operation === "update" ? "updated" : operation === "rename" ? "renamed" : "removed"}`;
    const event = appendCadreEvent(root, { kind: eventKind, workflow: "skill", skill_id: id, new_skill_id: operation === "rename" ? newId : null });
    const approvalAudit = stages.length > 0 ? recordApprovalCompletionFromArgs(root, reviewArgs) : null;
    const files = [...mutation.written, ...mutation.removed, "cadre/events.jsonl"];
    const controlCommit = commitTrace(root, args, { kind: "control", workflow: "skill", action: operation, type: operation === "remove" ? "chore" : "feat", scope: "skill", subject: `${operation} project skill ${operation === "rename" ? `${id} as ${newId}` : id}`, before: traceBefore, files, forceEnabled: true, allowDirty: stages.length > 0, note: { event_id: asOptionalString(asJsonObject(event.event).id), skill_id: id, new_skill_id: operation === "rename" ? newId : null } });
    if (controlCommit.ok === false) return { ok: false, operation, skill_id: id, phase_state: "recovery_required", stage: "commit", written: mutation.written, removed: mutation.removed, event, control_commit: controlCommit };
    const approvalSessionClose = stages.length > 0 ? closeApprovalSessionFromArgs(root, reviewArgs) : null;
    return { ok: true, operation, skill_id: id, new_skill_id: operation === "rename" ? newId : null, phase_state: "executed", dry_run: false, written: mutation.written, removed: mutation.removed, event, control_commit: controlCommit, approval, approval_audit: approvalAudit, approval_session_close: approvalSessionClose, review_validation: reviewValidation };
  } catch (error) { return { ok: false, operation, skill_id: id, phase_state: "recovery_required", stage: "filesystem", error: errorMessage(error) }; }
}
