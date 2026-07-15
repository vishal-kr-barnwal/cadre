import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";
import type { ManagedManifest } from "../../domain/project-skill-management";
import { normalizeReferenceContent, type ProjectSkillFileContent } from "../../infrastructure/runtime/project-skill-mutations";
import { approvalStageCursor, scopedApprovalReviewFiles, type ApprovalStageCursor } from "./approval-stage-cursor";
import { applyApprovalSessionPayload } from "./approval-request";
import { stageRecord } from "./approval-session-model";
import { readApprovalSession } from "./approval-session-store";
import type { ReviewFile } from "./contracts";
import { renderProjectSkillProjection } from "./project-skill-projection";
import type { ApprovalStage } from "./staged-approval-stages";
import { inputObjectMemberPointer } from "./workflow-continuations";

export interface SkillReferencePlan {
  changedPaths: string[];
  deletedPaths: string[];
}

export interface SkillStageCollection {
  cursor: ApprovalStageCursor;
  activeKind: "skill" | "references" | null;
  files: ReviewFile[];
  sourceRequests: JsonObject[];
  missingReferenceIds: string[];
  errors: string[];
}

export interface AppliedSkillApprovalPayload {
  args: RuntimeArgs;
  acceptedFormattedAmendment: boolean;
  formattedReferences: JsonObject;
}

interface SkillChangeCollection {
  manifest: ManagedManifest;
  referenceContent: Map<string, string>;
  removedReferences: Set<string>;
  sourceRequests: JsonObject[];
}

function referenceRecords(manifest: ManagedManifest | null | undefined): JsonObject[] {
  return (Array.isArray(manifest?.references) ? manifest.references : []).map(asJsonObject);
}

function referenceById(manifest: ManagedManifest | null | undefined): Map<string, JsonObject> {
  return new Map(referenceRecords(manifest).flatMap((reference) => {
    const id = asOptionalString(reference.id);
    return id ? [[id, reference] as const] : [];
  }));
}

function referencePath(reference: JsonObject | undefined): string | null {
  return asOptionalString(reference?.path) || null;
}

export function skillReferencePlan(
  sourceManifest: ManagedManifest | null | undefined,
  targetManifest: ManagedManifest,
  changes: Pick<SkillChangeCollection, "referenceContent" | "removedReferences" | "sourceRequests">,
): SkillReferencePlan {
  const existing = referenceById(sourceManifest);
  const target = referenceById(targetManifest);
  const sourceRequestIds = changes.sourceRequests.map((request) => asOptionalString(request.id)).filter((id): id is string => Boolean(id));
  const ids = new Set([
    ...changes.referenceContent.keys(),
    ...changes.removedReferences,
    ...sourceRequestIds,
    ...Array.from(target.keys()).filter((id) => referencePath(existing.get(id)) !== referencePath(target.get(id))),
  ]);
  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (const id of ids) {
    const previousPath = referencePath(existing.get(id));
    const nextPath = referencePath(target.get(id));
    if (previousPath && previousPath !== nextPath) deleted.add(previousPath);
    if (nextPath && (
      !previousPath
      || previousPath !== nextPath
      || changes.referenceContent.has(id)
      || sourceRequestIds.includes(id)
    )) changed.add(nextPath);
  }
  for (const removedId of changes.removedReferences) {
    const previousPath = referencePath(existing.get(removedId));
    if (previousPath) deleted.add(previousPath);
  }
  return {
    changedPaths: Array.from(new Set([...changed, ...deleted])).sort(),
    deletedPaths: Array.from(deleted).sort(),
  };
}

function skillReviewFiles(targetId: string, manifest: ManagedManifest): ReviewFile[] {
  const canonical = `cadre/skills/${targetId}/skill.json`;
  const projection = `cadre/skills/${targetId}/SKILL.md`;
  return [
    {
      path: canonical,
      title: "skill.json",
      kind: "json",
      source: "skill.desired_state",
      content: `${JSON.stringify(manifest, null, 2)}\n`,
      documentId: "skill",
      reviewRole: "canonical",
      canonicalPath: canonical,
      projectionPath: projection,
    },
    {
      path: projection,
      title: "SKILL.md",
      kind: "markdown",
      source: "skill.desired_state",
      content: renderProjectSkillProjection(manifest),
      documentId: "skill",
      reviewRole: "human",
      canonicalPath: canonical,
      projectionPath: projection,
    },
  ];
}

function frozenManifest(cursor: ApprovalStageCursor, targetId: string, fallback: ManagedManifest): ManagedManifest | null {
  const canonical = `cadre/skills/${targetId}/skill.json`;
  const snapshot = cursor.session ? stageRecord(cursor.session, "skill")?.snapshot_files.find((file) => file.path === canonical) : null;
  if (!snapshot) return fallback;
  try { return asJsonObject(JSON.parse(snapshot.content)) as ManagedManifest; } catch { return null; }
}

function formattedReferenceContent(args: RuntimeArgs): { content: Map<string, string>; errors: string[] } {
  const rawArgs = args as JsonObject;
  const raw = asJsonObject(rawArgs.formattedReferences || rawArgs.formatted_references);
  const content = new Map<string, string>();
  const errors: string[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "string") content.set(id, value);
    else errors.push(`formatted reference content must be text: ${id}`);
  }
  return { content, errors };
}

function formattingMap(value: unknown): JsonObject {
  return { ...asJsonObject(value) };
}

export function applySkillApprovalPayload(root: string, args: RuntimeArgs): AppliedSkillApprovalPayload {
  const raw = args as JsonObject;
  const sessionId = asOptionalString(raw.approvalSessionId || raw.approval_session_id);
  const session = sessionId ? readApprovalSession(root, sessionId) : null;
  const activeStage = session?.stage_order?.find((stageId) => !session.approved_stages.includes(stageId)) || null;
  const hasAmendment = raw.formattedReferences !== undefined || raw.formatted_references !== undefined;
  const prior = {
    ...formattingMap(session?.payload.formatted_references),
    ...formattingMap(session?.payload.formattedReferences),
  };
  const amendment = {
    ...formattingMap(raw.formatted_references),
    ...formattingMap(raw.formattedReferences),
  };
  const normalized = { ...applyApprovalSessionPayload(root, args, "skill") } as JsonObject;
  delete normalized.formattedReferences;
  delete normalized.formatted_references;
  if (session && activeStage === "references" && (hasAmendment || Object.keys(prior).length > 0)) {
    normalized.formattedReferences = hasAmendment ? { ...prior, ...amendment } : prior;
  }
  else if (session && hasAmendment) normalized.formattedReferences = amendment;
  else if (session && Object.keys(prior).length > 0) normalized.formattedReferences = prior;
  return {
    args: normalized as RuntimeArgs,
    acceptedFormattedAmendment: Boolean(session && activeStage === "references" && hasAmendment),
    formattedReferences: formattingMap(normalized.formattedReferences),
  };
}

function existingReferenceContent(
  root: string,
  sourceId: string,
  targetPath: string,
  referenceId: string,
  sourceManifest: ManagedManifest | null | undefined,
  baselineContents: Map<string, string | null> | null,
): string | undefined {
  const previousPath = referencePath(referenceById(sourceManifest).get(referenceId));
  for (const relative of Array.from(new Set([targetPath, previousPath].filter((value): value is string => Boolean(value))))) {
    if (baselineContents?.has(relative)) {
      const baseline = baselineContents.get(relative);
      if (baseline !== null && baseline !== undefined) return baseline;
    }
    const file = path.join(root, "cadre", "skills", sourceId, relative);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  return undefined;
}

function referenceReviewFiles(
  root: string,
  sourceId: string,
  targetId: string,
  sourceManifest: ManagedManifest | null | undefined,
  manifest: ManagedManifest,
  plan: SkillReferencePlan,
  referenceContent: Map<string, string>,
  baselineContents: Map<string, string | null> | null,
): { files: ReviewFile[]; missing: string[]; errors: string[] } {
  const targetByPath = new Map(referenceRecords(manifest).flatMap((reference) => {
    const relative = referencePath(reference);
    return relative ? [[relative, reference] as const] : [];
  }));
  const files: ReviewFile[] = [];
  const missing: string[] = [];
  const errors: string[] = [];
  for (const relative of plan.changedPaths) {
    const targetReference = targetByPath.get(relative);
    const target = `cadre/skills/${targetId}/${relative}`;
    if (!targetReference) {
      files.push({
        path: `cadre/skills/${sourceId}/${relative}`,
        title: `Remove reference ${relative}`,
        kind: "text",
        source: "skill.reference.remove",
        content: `Delete cadre/skills/${sourceId}/${relative}\n`,
        missing: true,
        documentId: "references",
        reviewRole: "human",
        projectionPath: `cadre/skills/${sourceId}/${relative}`,
        approvalGroup: "references",
      });
      continue;
    }
    const id = asOptionalString(targetReference.id) || relative;
    const rawContent = referenceContent.get(id)
      ?? existingReferenceContent(root, sourceId, relative, id, sourceManifest, baselineContents);
    if (rawContent === undefined) { missing.push(id); continue; }
    try {
      const content = normalizeReferenceContent(relative, rawContent);
      files.push({
        path: target,
        title: relative,
        kind: relative.endsWith(".json") ? "json" : relative.endsWith(".md") ? "markdown" : "text",
        source: "skill.reference",
        content,
        documentId: "references",
        reviewRole: "human",
        projectionPath: target,
        approvalGroup: "references",
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { files, missing: Array.from(new Set(missing)), errors };
}

export function collectSkillStage(
  root: string,
  args: RuntimeArgs,
  sourceId: string,
  targetId: string,
  sourceManifest: ManagedManifest | null | undefined,
  changes: SkillChangeCollection,
  plan: SkillReferencePlan,
  stages: ApprovalStage[],
  skillErrors: string[],
  baselineContents: Map<string, string | null> | null,
): SkillStageCollection {
  const cursor = approvalStageCursor(root, args, "skill", stages);
  const activeKind = cursor.activeStage?.id === "skill" ? "skill" : cursor.activeStage?.id === "references" ? "references" : null;
  const formatted = activeKind === "references"
    ? formattedReferenceContent(args)
    : { content: new Map<string, string>(), errors: [] };
  const combinedContent = new Map([...changes.referenceContent, ...formatted.content]);
  const sourceRequests = activeKind === "references"
    ? changes.sourceRequests.filter((request) => !combinedContent.has(asOptionalString(request.id) || ""))
    : [];
  let currentFiles: ReviewFile[] = [];
  let missingReferenceIds: string[] = [];
  const knownReferenceIds = new Set(referenceById(changes.manifest).keys());
  const errors = [
    ...formatted.errors,
    ...Array.from(formatted.content.keys()).filter((id) => !knownReferenceIds.has(id)).map((id) => `formatted reference id is not declared: ${id}`),
  ];
  if (activeKind === "skill" && skillErrors.length === 0) currentFiles = skillReviewFiles(targetId, changes.manifest);
  if (activeKind === "references" && sourceRequests.length === 0) {
    const manifest = frozenManifest(cursor, targetId, changes.manifest);
    if (!manifest) errors.push("Approved project skill manifest snapshot cannot be read");
    else {
      const references = referenceReviewFiles(root, sourceId, targetId, sourceManifest, manifest, plan, combinedContent, baselineContents);
      currentFiles = references.files;
      missingReferenceIds = references.missing;
      errors.push(...references.errors);
    }
  }
  if (activeKind === "references" && (errors.length > 0 || missingReferenceIds.length > 0)) currentFiles = [];
  return {
    cursor,
    activeKind,
    files: scopedApprovalReviewFiles(cursor, currentFiles),
    sourceRequests,
    missingReferenceIds,
    errors: [...skillErrors, ...errors],
  };
}

export function approvedSkillExecutionFiles(
  root: string,
  args: RuntimeArgs,
  sourceId: string,
  targetId: string,
): { files: Map<string, ProjectSkillFileContent>; manifest: ManagedManifest | null; error?: string } {
  const sessionId = asOptionalString(args.approvalSessionId || args.approval_session_id);
  const session = sessionId ? readApprovalSession(root, sessionId) : null;
  if (!session) return { files: new Map(), manifest: null, error: "Approved skill session was not found" };
  const prefix = `cadre/skills/${targetId}/`;
  const snapshots = new Map(session.snapshot_files
    .filter((file) => file.missing !== true && file.path.startsWith(prefix))
    .map((file) => [file.path.slice(prefix.length), file.content]));
  const manifestContent = snapshots.get("skill.json");
  let manifest: ManagedManifest | null = null;
  try { if (manifestContent) manifest = asJsonObject(JSON.parse(manifestContent)) as ManagedManifest; } catch { /* reported below */ }
  if (!manifest) return { files: new Map(), manifest: null, error: "Approved skill manifest snapshot cannot be read" };
  const sourcePrefix = `cadre/skills/${sourceId}/`;
  const initialFiles = asStringArray(session.payload.source_files).filter((file) => file.startsWith(sourcePrefix));
  const initialHashes = asJsonObject(session.payload.source_file_hashes);
  const actualFiles = (() => {
    const directory = path.join(root, "cadre", "skills", sourceId);
    const visit = (current: string): string[] => {
      if (!fs.existsSync(current)) return [];
      return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(current, entry.name);
        return entry.isDirectory() ? visit(target) : [path.relative(root, target).split(path.sep).join("/")];
      });
    };
    return visit(directory).sort();
  })();
  const expectedCurrent = Array.from(new Set([
    ...initialFiles,
    ...session.snapshot_files.filter((file) => file.missing !== true && file.path.startsWith(prefix)).map((file) => file.path),
  ])).sort();
  if (expectedCurrent.length !== actualFiles.length || expectedCurrent.some((file, index) => file !== actualFiles[index])) {
    return { files: new Map(), manifest, error: "Project skill directory membership changed after review began" };
  }
  const reviewedSourcePaths = new Set(session.snapshot_files
    .filter((file) => file.path.startsWith(sourcePrefix))
    .map((file) => file.path));
  for (const file of initialFiles.filter((candidate) => !reviewedSourcePaths.has(candidate))) {
    const expectedHash = asOptionalString(initialHashes[file]);
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
    if (!expectedHash || actualHash !== expectedHash) {
      return { files: new Map(), manifest, error: `Project skill file changed outside its approved stage: ${file}` };
    }
  }
  const expected = ["skill.json", "SKILL.md", ...referenceRecords(manifest).map((reference) => referencePath(reference)).filter((value): value is string => Boolean(value))];
  const files = new Map<string, ProjectSkillFileContent>();
  const removed = new Set(session.snapshot_files.filter((file) => file.missing === true && file.path.startsWith(sourcePrefix)).map((file) => file.path));
  for (const file of initialFiles) {
    if (removed.has(file)) continue;
    const relative = file.slice(sourcePrefix.length);
    if (expected.includes(relative)) continue;
    const existing = path.join(root, file);
    if (fs.existsSync(existing)) files.set(relative, fs.readFileSync(existing));
  }
  for (const relative of expected) {
    const frozen = snapshots.get(relative);
    if (frozen !== undefined) { files.set(relative, frozen); continue; }
    const existing = path.join(root, "cadre", "skills", sourceId, relative);
    if (!fs.existsSync(existing)) return { files: new Map(), manifest, error: `Approved skill execution is missing ${relative}` };
    files.set(relative, fs.readFileSync(existing));
  }
  return { files, manifest };
}

export function skillFormattingDecision(root: string, approval: JsonObject, missingReferenceIds: string[] = []): JsonObject {
  const sessionId = asOptionalString(approval.session_id) || null;
  const referencePaths = Array.from(new Set(missingReferenceIds)).flatMap((id) => {
    const pointer = inputObjectMemberPointer("formattedReferences", id);
    return pointer ? [pointer] : [];
  });
  return {
    kind: "format_reference",
    required: ["formattedReferences"],
    session_id: sessionId,
    current_stage: asOptionalString(approval.current_stage) || null,
    approved_stages: approval.approved_stages || [],
    pending_stages: approval.pending_stages || [],
    resume: sessionId ? {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "skill",
        input: { formattedReferences: {} },
        execute: false,
        approval: { session_id: sessionId },
      },
    } : null,
    writable_paths: referencePaths.length > 0 ? referencePaths : ["/arguments/input/formattedReferences"],
  };
}
