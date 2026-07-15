import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { asJsonObject, asOptionalString, errorMessage } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";
import { applySkillChanges, emptyManagedManifest, validateManagedManifest, type ManagedManifest, type SkillOperation } from "../../domain/project-skill-management";
import { PROJECT_SKILL_ID_PATTERN, PROJECT_SKILL_REFERENCE_EXTENSIONS } from "../../domain/project-skill-policy";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { atomicSkillMutation, normalizeReferenceContent } from "../../infrastructure/runtime/project-skill-mutations";
import { loadProjectSkill, projectSkillIds } from "../../infrastructure/runtime/project-skills-store";
import { readProjectSourceFile } from "../../infrastructure/runtime/project-source-files";
import { closeApprovalSessionFromArgs, readApprovalSession, recordApprovalCompletionFromArgs, unapprovedSkillTargetApproval } from "./approval-session-store";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult, ReviewFile } from "./contracts";
import { appendCadreEvent } from "./native-state";
import { renderProjectSkillProjection } from "./project-skill-projection";
import { applySkillApprovalPayload, approvedSkillExecutionFiles, collectSkillStage, skillFormattingDecision, skillReferencePlan } from "./skill-stage-lifecycle";
import { stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import type { ApprovalStage } from "./staged-approval-stages";

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

function sourcePause(root: string, skillId: string, requests: JsonObject[], approval: JsonObject): CoreResult {
  const resources: string[] = [];
  const errors: string[] = [];
  for (const request of requests) {
    const source = asOptionalString(request.source_path) || "";
    const lexicalRoot = path.resolve(root);
    const lexicalPath = path.resolve(lexicalRoot, source);
    const relative = path.relative(lexicalRoot, lexicalPath);
    const validated = readProjectSourceFile(root, source);
    if (!source || relative.startsWith("..") || path.isAbsolute(relative)) errors.push(`source_path must stay inside the project: ${source}`);
    else if (!PROJECT_SKILL_REFERENCE_EXTENSIONS.has(path.extname(source).toLowerCase())) errors.push(`source_path has an unsupported extension: ${source}`);
    else if (!validated.ok && validated.kind === "path") errors.push(`source_path must identify an existing, link-free project file: ${source}`);
    else if (!validated.ok) errors.push(`source_path must be a text file no larger than 128 KiB: ${source}`);
    else if (path.resolve(validated.canonicalRoot, "cadre", "skills", skillId, asOptionalString(request.target_path) || "") === validated.canonicalPath) errors.push(`source_path collides with its managed target: ${source}`);
    else resources.push(`cadre://project-skill-source?root=${encodeURIComponent(root)}&path=${encodeURIComponent(source)}`);
  }
  const decision = skillFormattingDecision(root, approval);
  return errors.length ? {
    ok: false,
    phase_state: "awaiting_clarification",
    approval,
    decision,
    errors,
    error: errors[0],
    missing_payload: ["formattedReferences"],
    source_requests: requests,
  } : {
    ok: true,
    phase_state: "awaiting_formatting",
    approval,
    decision,
    missing_payload: ["formattedReferences"],
    detail_resources: resources,
    source_requests: requests,
  };
}

function desiredFiles(
  root: string,
  sourceId: string,
  manifest: ManagedManifest,
  contents: Map<string, string>,
  baselineContents: Map<string, string | null> | null = null,
): { files: Map<string, string>; errors: string[] } {
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
      if (baselineContents?.has(relative)) content = baselineContents.get(relative) ?? undefined;
      else {
        const existing = path.join(root, "cadre", "skills", sourceId, relative);
        if (fs.existsSync(existing)) content = fs.readFileSync(existing, "utf8");
      }
      if (content === undefined) { errors.push(`reference content is required: ${id}`); continue; }
    }
    try { files.set(relative, normalizeReferenceContent(relative, content)); } catch (error) { errors.push(errorMessage(error)); }
  }
  return { files, errors };
}

function reviewFilesFor(sourceId: string, targetId: string | null, files: Map<string, string>, removedReferencePaths: string[]): ReviewFile[] {
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

function skillDirectoryFiles(root: string, skillId: string): string[] {
  const directory = path.join(root, "cadre", "skills", skillId);
  const visit = (current: string): string[] => {
    if (!fs.existsSync(current)) return [];
    return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const target = path.join(current, entry.name);
      return entry.isDirectory() ? visit(target) : [path.relative(root, target).split(path.sep).join("/")];
    });
  };
  return visit(directory).sort();
}

function skillDirectorySymlinks(root: string, skillId: string): string[] {
  const chain = [path.join(root, "cadre"), path.join(root, "cadre", "skills"), path.join(root, "cadre", "skills", skillId)];
  const linkedParent = chain.find((entry) => {
    try { return fs.lstatSync(entry).isSymbolicLink(); } catch { return false; }
  });
  if (linkedParent) return [path.relative(root, linkedParent).split(path.sep).join("/")];
  return skillDirectoryFiles(root, skillId).filter((file) => fs.lstatSync(path.join(root, file)).isSymbolicLink());
}

function removalReviewFiles(root: string, skillId: string): ReviewFile[] {
  const files = skillDirectoryFiles(root, skillId);
  const targets = files.length > 0 ? files : [`cadre/skills/${skillId}/.remove`];
  return targets.map((target) => ({
    path: target,
    title: `Remove ${target}`,
    kind: "text",
    source: "skill.remove",
    content: `Delete ${target}\n`,
    missing: true,
    documentId: "mutation",
    reviewRole: "human",
  }));
}

function approvalStages(operation: SkillOperation, referenceReviewPaths: string[]): ApprovalStage[] {
  if (operation === "rename" || operation === "remove") return [{
    id: "mutation",
    title: operation === "rename" ? "Rename Project Skill" : "Remove Project Skill",
    description: operation === "rename"
      ? "Complete source deletion and target skill contents as one atomic rename."
      : "Every managed file that will be removed as one atomic deletion.",
    documentIds: ["mutation"],
    fileMatches: ["*"],
    inputKeys: [],
  }];
  return [
    ...(["create", "update"].includes(operation) ? [{ id: "skill", title: "Project Skill", description: "Canonical skill manifest and generated SKILL.md.", documentIds: ["skill"], inputKeys: ["changes"] }] : []),
    ...(["create", "update"].includes(operation) && referenceReviewPaths.length ? [{ id: "references", title: "Skill References", description: "Reference files added, changed, moved, or removed.", documentIds: ["references"], inputKeys: ["formattedReferences", "formatted_references"] }] : []),
  ];
}

interface FileBaseline { existed: boolean; content: string | null }

function captureFileBaseline(file: string): FileBaseline {
  const existed = fs.existsSync(file);
  return { existed, content: existed ? fs.readFileSync(file, "utf8") : null };
}

function restoreFileBaseline(file: string, baseline: FileBaseline): void {
  if (!baseline.existed) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, baseline.content || "");
}

function destructiveSessionIntegrity(
  root: string,
  operation: SkillOperation,
  sourceId: string,
  targetId: string,
  args: RuntimeArgs,
): CoreResult {
  if (operation !== "rename" && operation !== "remove") return { ok: true, skipped: true };
  const expectedSourceHash = asOptionalString((args as JsonObject).source_snapshot);
  const actualSourceHash = hashDirectory(path.join(root, "cadre", "skills", sourceId));
  if (!expectedSourceHash || actualSourceHash !== expectedSourceHash) {
    return { ok: false, error: `Project skill source changed after ${operation} review began: ${sourceId}` };
  }
  if (operation !== "rename") return { ok: true, source_snapshot: actualSourceHash };
  const sessionId = asOptionalString(args.approvalSessionId || args.approval_session_id);
  const session = sessionId ? readApprovalSession(root, sessionId) : null;
  if (!session) return { ok: false, error: "Approved rename session was not found" };
  const prefix = `cadre/skills/${targetId}/`;
  const expected = session.snapshot_files
    .filter((file) => file.missing !== true && file.path.startsWith(prefix))
    .map((file) => file.path)
    .sort();
  const actual = skillDirectoryFiles(root, targetId);
  if (expected.length !== actual.length || expected.some((file, index) => file !== actual[index])) {
    return { ok: false, error: `Project skill rename destination changed after review: ${targetId}`, expected, actual };
  }
  return { ok: true, source_snapshot: actualSourceHash, target_files: actual };
}

export function workflowSkill(root: string, args: RuntimeArgs): CoreResult {
  const appliedApprovalPayload = applySkillApprovalPayload(root, args);
  args = appliedApprovalPayload.args;
  const operation = (asOptionalString(args.operation) || "list") as SkillOperation;
  const id = asOptionalString(args.skillId || args.skill_id || args.id)?.trim() || "";
  if (operation === "list") return catalog(root);
  if (operation === "show") return id ? show(root, id) : { ok: false, error: "skillId is required" };
  if (operation === "validate") return validateCatalog(root, id || null);
  if (!["create", "update", "rename", "remove"].includes(operation)) return { ok: false, error: `unknown skill operation: ${operation}` };
  if (!id || !PROJECT_SKILL_ID_PATTERN.test(id)) return { ok: false, error: `invalid skillId: ${id || "(missing)"}` };
  const continuingApproval = Boolean(args.approvalSessionId || args.approval_session_id);
  const newId = operation === "rename" ? asOptionalString(args.newSkillId || args.new_skill_id)?.trim() || "" : id;
  const targetId = operation === "rename" ? newId : id;
  if (operation === "rename" && !PROJECT_SKILL_ID_PATTERN.test(newId)) return { ok: false, error: `invalid or existing rename target: ${newId || "(missing)"}` };
  const symlinks = Array.from(new Set([id, targetId])).flatMap((skillId) => skillDirectorySymlinks(root, skillId));
  if (symlinks.length > 0) return { ok: false, operation, skill_id: id, phase_state: "blocked", error: `Project skill directories must not contain symbolic links: ${symlinks.join(", ")}`, errors: symlinks };
  const targetOwner = PROJECT_SKILL_ID_PATTERN.test(targetId) ? unapprovedSkillTargetApproval(root, targetId) : null;
  const previewOwner = targetOwner
    && asOptionalString(targetOwner.payload.operation) === operation
    && asOptionalString(targetOwner.payload.skillId || targetOwner.payload.skill_id || targetOwner.payload.id) === id
    ? targetOwner
    : null;
  const existing = readManifest(root, id);
  if (operation === "create" && fs.existsSync(path.join(root, "cadre", "skills", id)) && !continuingApproval && !previewOwner) return { ok: false, error: `skill already exists: ${id}` };
  if (operation !== "create" && !existing.manifest && !previewOwner?.sourceManifest && operation !== "remove") return { ok: false, error: existing.error || `skill not found: ${id}` };
  if (operation === "remove" && !fs.existsSync(path.join(root, "cadre", "skills", id))) return { ok: false, error: `skill not found: ${id}` };
  if (operation === "rename" && fs.existsSync(path.join(root, "cadre", "skills", newId)) && !continuingApproval && !previewOwner) return { ok: false, error: `invalid or existing rename target: ${newId || "(missing)"}` };
  const sessionSource = (args as JsonObject).source_manifest;
  const previewSource = previewOwner?.sourceManifest as unknown as ManagedManifest | null | undefined;
  const sourceManifest = sessionSource && typeof sessionSource === "object" && !Array.isArray(sessionSource)
    ? asJsonObject(sessionSource) as unknown as ManagedManifest
    : previewSource || existing.manifest;
  const base = operation === "create" ? emptyManagedManifest(id) : sourceManifest || emptyManagedManifest(id);
  const changed = applySkillChanges(base, args.changes);
  const manifest = changed.manifest;
  manifest.id = newId;
  const reviewedOperation = operation === "create" || operation === "update";
  const skillErrors = [...changed.errors, ...(operation === "remove" ? [] : validateManagedManifest(manifest, knownRepos(root)))];
  const baselinePrefix = `cadre/skills/${id}/`;
  const baselineContents = previewOwner && operation === "update"
    ? new Map(previewOwner.baselineFiles
      .filter((file) => file.path.startsWith(baselinePrefix))
      .map((file): [string, string | null] => [file.path.slice(baselinePrefix.length), file.existed ? file.content : null]))
    : null;
  const referencePlan = skillReferencePlan(sourceManifest, manifest, changed);
  const desired = operation === "remove" || reviewedOperation
    ? { files: new Map<string, string>(), errors: [] }
    : desiredFiles(root, id, manifest, changed.referenceContent, baselineContents);
  const destructiveErrors = reviewedOperation ? [] : [...skillErrors, ...desired.errors];
  if (!reviewedOperation && changed.sourceRequests.length > 0) destructiveErrors.push("Destructive skill changes require formatted inline reference content before review.");
  if (destructiveErrors.length) return { ok: false, operation, skill_id: id, phase_state: "blocked", error: destructiveErrors[0], errors: destructiveErrors };
  const existingReferences = (Array.isArray(sourceManifest?.references) ? sourceManifest!.references : []).map(asJsonObject);
  const existingReferencePaths = existingReferences.map((value) => asOptionalString(value.path)).filter((value): value is string => Boolean(value));
  const targetReferencePaths = manifest.references.map((value) => asOptionalString(asJsonObject(value).path)).filter((value): value is string => Boolean(value));
  const changedReferencePaths = reviewedOperation
    ? referencePlan.changedPaths
    : Array.from(new Set([...existingReferencePaths, ...targetReferencePaths])).filter(Boolean);
  const deletedReferencePaths = reviewedOperation
    ? referencePlan.deletedPaths
    : operation === "remove" ? changedReferencePaths : existingReferencePaths.filter((relative) => !targetReferencePaths.includes(relative));
  const stages = approvalStages(operation, changedReferencePaths);
  const collection = reviewedOperation
    ? collectSkillStage(root, args, id, newId, sourceManifest, changed, referencePlan, stages, skillErrors, baselineContents)
    : null;
  const desiredReviews = reviewedOperation ? [] : reviewFilesFor(id, operation === "remove" ? null : newId, desired.files, deletedReferencePaths);
  const reviews = collection?.files || (operation === "remove"
    ? removalReviewFiles(root, id)
    : operation === "rename"
      ? [...desiredReviews, ...removalReviewFiles(root, id)]
      : desiredReviews);
  const snapshot = asOptionalString((args as JsonObject).source_snapshot) || previewOwner?.sourceSnapshot || hashDirectory(path.join(root, "cadre", "skills", id));
  const rawSourceFiles = (args as JsonObject).source_files;
  const sourceFiles: string[] = Array.isArray(rawSourceFiles)
    ? rawSourceFiles.filter((file): file is string => typeof file === "string")
    : skillDirectoryFiles(root, id);
  const storedSourceHashes = asJsonObject((args as JsonObject).source_file_hashes);
  const sourceFileHashes = Object.keys(storedSourceHashes).length > 0 ? storedSourceHashes : Object.fromEntries(sourceFiles.map((file) => [
    file,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"),
  ]));
  const reviewArgs = {
    ...args,
    source_snapshot: snapshot,
    source_files: sourceFiles,
    source_file_hashes: sourceFileHashes,
    source_manifest: (sourceManifest || emptyManagedManifest(id)) as unknown as JsonObject,
  } as RuntimeArgs;
  if (collection?.errors.length && appliedApprovalPayload.acceptedFormattedAmendment) {
    delete (reviewArgs as JsonObject).formattedReferences;
    delete (reviewArgs as JsonObject).formatted_references;
    const declaredReferenceIds = new Set(manifest.references.map((reference) => asOptionalString(asJsonObject(reference).id)).filter(Boolean));
    const retainedFormatting = Object.fromEntries(Object.entries(appliedApprovalPayload.formattedReferences).filter(([referenceId]) => declaredReferenceIds.has(referenceId)));
    if (Object.keys(retainedFormatting).length > 0) {
      (reviewArgs as JsonObject).formattedReferences = retainedFormatting;
    }
  }
  const approval = stages.length > 0
    ? stagedApprovalState(root, "skill", reviewArgs, stages, reviews, { operation, skill_id: id, new_skill_id: newId, source_snapshot: snapshot, final_only_files: ["cadre/events.jsonl"] }, { allowEmptyActiveStage: reviewedOperation })
    : { required: false, valid_for_execute: true, current_stage: null, pending_stages: [] };
  const approvalError = stages.length > 0 ? stagedApprovalError(approval) : null;
  if (collection && !approvalError && collection.errors.length > 0) return {
    ok: false,
    operation,
    skill_id: id,
    new_skill_id: newId,
    dry_run: true,
    phase_state: "awaiting_clarification",
    stage: `${collection.activeKind || "skill"}_validation`,
    approval,
    review_bundle: asJsonObject(approval).current_review_bundle,
    errors: collection.errors,
    error: collection.errors[0],
  };
  if (collection && !approvalError && collection.sourceRequests.length > 0) {
    return { operation, skill_id: id, new_skill_id: newId, dry_run: true, ...sourcePause(root, id, collection.sourceRequests, asJsonObject(approval)) };
  }
  if (collection && !approvalError && collection.missingReferenceIds.length > 0) return {
    ok: false,
    operation,
    skill_id: id,
    new_skill_id: newId,
    dry_run: true,
    phase_state: "awaiting_clarification",
    stage: "reference_evidence",
    approval,
    missing_payload: ["formattedReferences"],
    missing_reference_ids: collection.missingReferenceIds,
    error: `Reference content is required for: ${collection.missingReferenceIds.join(", ")}`,
  };
  if (args.execute !== true || (stages.length > 0 && !stagedApprovalReady(approval))) {
    const blockedExecution = args.execute === true && stages.length > 0 && !stagedApprovalReady(approval);
    return {
      ok: !approvalError && !blockedExecution,
      operation,
      skill_id: id,
      new_skill_id: newId,
      dry_run: true,
      phase_state: stages.length > 0 ? "awaiting_staged_approval" : "ready",
      approval,
      review_bundle: asJsonObject(approval).current_review_bundle,
      mutation_plan: stages.length === 0 ? { operation, source: id, target: operation === "remove" ? null : newId } : null,
      ...(approvalError || blockedExecution ? { error: approvalError || "Staged approval is required before changing project skill files" } : {}),
    };
  }
  const reviewValidation = stages.length > 0 ? validateApprovedTargetReviewFiles(root, reviewArgs) : { ok: true, skipped: true };
  if (reviewValidation.ok === false) return { ok: false, operation, skill_id: id, phase_state: "awaiting_staged_approval", stage: "staged_review_drift", approval, review_validation: reviewValidation, error: asOptionalString(reviewValidation.error) || "Approved review files changed" };
  const approvedExecution = reviewedOperation ? approvedSkillExecutionFiles(root, reviewArgs, id, newId) : null;
  if (approvedExecution?.error) return { ok: false, operation, skill_id: id, phase_state: "awaiting_staged_approval", stage: "approval_session_integrity", approval, review_validation: reviewValidation, error: approvedExecution.error };
  const destructiveIntegrity = destructiveSessionIntegrity(root, operation, id, newId, reviewArgs);
  if (destructiveIntegrity.ok === false) return { ok: false, operation, skill_id: id, phase_state: "awaiting_staged_approval", stage: "staged_review_drift", approval, review_validation: reviewValidation, destructive_integrity: destructiveIntegrity, error: asOptionalString(destructiveIntegrity.error) || "Approved skill directory membership changed" };
  const traceBefore = beginTrace(root);
  let recoverMutation: (() => void) | null = null;
  try {
    const eventsPath = path.join(root, "cadre", "events.jsonl");
    const eventsBaseline = captureFileBaseline(eventsPath);
    const mutation = atomicSkillMutation(root, id, operation === "remove" ? null : newId, approvedExecution?.files || desired.files);
    let mutationSettled = false;
    const rollback = () => {
      if (mutationSettled) return;
      mutation.rollback();
      restoreFileBaseline(eventsPath, eventsBaseline);
      mutation.finish();
      mutationSettled = true;
      recoverMutation = null;
    };
    recoverMutation = rollback;
    if (operation !== "remove") {
      const final = loadProjectSkill(root, newId, knownRepos(root));
      if (!final.ok) { rollback(); return { ok: false, phase_state: "recovery_required", stage: "final_validation", errors: final.errors }; }
    }
    const approvalSessionId = asOptionalString(asJsonObject(approval).session_id);
    const approvedSession = approvalSessionId ? readApprovalSession(root, approvalSessionId) : null;
    const written = Array.from(new Set([
      ...mutation.written,
      ...(approvedSession?.snapshot_files || []).filter((file) => file.missing !== true).map((file) => file.path),
    ])).sort();
    const removed = Array.from(new Set([
      ...mutation.removed,
      ...(approvedSession?.snapshot_files || []).filter((file) => file.missing === true).map((file) => file.path),
    ])).sort();
    const eventKind = `project_skill_${operation === "create" ? "created" : operation === "update" ? "updated" : operation === "rename" ? "renamed" : "removed"}`;
    const event = appendCadreEvent(root, { kind: eventKind, workflow: "skill", skill_id: id, new_skill_id: operation === "rename" ? newId : null, approval_session_id: approvalSessionId || null });
    const approvalAudit = stages.length > 0 ? recordApprovalCompletionFromArgs(root, reviewArgs) : null;
    const files = [...written, ...removed, "cadre/events.jsonl"];
    const controlCommit = commitTrace(root, args, { kind: "control", workflow: "skill", action: operation, type: operation === "remove" ? "chore" : "feat", scope: "skill", subject: `${operation} project skill ${operation === "rename" ? `${id} as ${newId}` : id}`, before: traceBefore, files, forceEnabled: true, allowDirty: stages.length > 0, note: { event_id: asOptionalString(asJsonObject(event.event).id), skill_id: id, new_skill_id: operation === "rename" ? newId : null } });
    if (controlCommit.ok === false) {
      rollback();
      return { ok: false, operation, skill_id: id, phase_state: "recovery_required", stage: "commit", rolled_back: true, written: [], removed: [], event, control_commit: controlCommit };
    }
    mutation.finish();
    mutationSettled = true;
    recoverMutation = null;
    const approvalSessionClose = stages.length > 0 ? closeApprovalSessionFromArgs(root, reviewArgs) : null;
    return { ok: true, operation, skill_id: id, new_skill_id: operation === "rename" ? newId : null, phase_state: "executed", dry_run: false, written, removed, event, control_commit: controlCommit, approval, approval_audit: approvalAudit, approval_session_close: approvalSessionClose, review_validation: reviewValidation };
  } catch (error) {
    const recoveryErrors: string[] = [];
    try { recoverMutation?.(); } catch (recoveryError) { recoveryErrors.push(errorMessage(recoveryError)); }
    return {
      ok: false,
      operation,
      skill_id: id,
      phase_state: "recovery_required",
      stage: "filesystem",
      error: [errorMessage(error), ...recoveryErrors].join("; "),
      rolled_back: recoveryErrors.length === 0,
    };
  }
}
