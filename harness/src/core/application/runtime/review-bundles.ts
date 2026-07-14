import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { fileExists, readJson, safeName, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { normalizeClaimPath } from "./collision";
import type { CoreResult, ReviewFile } from "./contracts";
import { reviewOutputMode, targetReviewBundle } from "./review-output";
import type { ApprovalStageRecord } from "./approval-session-model";
import { asArray } from "./status";
import { humanReviewConfirmed, requestedStyleGuideIds, styleGuideIdsForTechStack, techStackForPacket } from "./tech-stack";
import { findTrack } from "./track-context";
import { parsePlanFile } from "./track-schedule";
import { templateJson } from "./workflow-response";

export function reviewStats(text: string): JsonObject {
  const normalized = text.replace(/\n*$/, "\n");
  return {
    bytes: Buffer.byteLength(normalized, "utf8"),
    lines: normalized.split("\n").length - 1,
    sha256: crypto.createHash("sha256").update(normalized).digest("hex"),
  };
}

export function textReviewFile(relativePath: string, title: string, source: string, text: string): ReviewFile {
  return {
    path: relativePath,
    title,
    kind: "markdown",
    source,
    content: text.replace(/\n*$/, "\n"),
  };
}

export function plainReviewFile(relativePath: string, title: string, source: string, text: string): ReviewFile {
  return {
    path: relativePath,
    title,
    kind: "text",
    source,
    content: text.replace(/\n*$/, "\n"),
  };
}

export function jsonReviewFile(relativePath: string, title: string, source: string, value: JsonObject | null): ReviewFile {
  const text = value ? `${JSON.stringify(value, null, 2)}\n` : "";
  return {
    path: relativePath,
    title,
    kind: "json",
    source,
    missing: value == null,
    content: text,
  };
}

export function documentReviewPair(
  documentId: string,
  canonical: ReviewFile,
  projection: ReviewFile,
  approvalGroup?: string,
  reviewRole: "human" | "generated" = "human"
): ReviewFile[] {
  const pair = {
    documentId,
    canonicalPath: canonical.path,
    projectionPath: projection.path,
    ...(approvalGroup ? { approvalGroup } : {}),
  };
  return [
    { ...canonical, ...pair, reviewRole: reviewRole === "human" ? "canonical" as const : "generated" as const },
    { ...projection, ...pair, reviewRole },
  ];
}

export function setupLspWriteRequested(args: RuntimeArgs = {}): boolean {
  const rawArgs = args as UnknownRecord;
  return rawArgs.lsp === true
    || args.setupLsp === true
    || args.setup_lsp === true
    || args.writeLsp === true
    || args.write_lsp === true;
}

export function setupLspWriteDisabled(args: RuntimeArgs = {}): boolean {
  const rawArgs = args as UnknownRecord;
  return rawArgs.lsp === false
    || args.setupLsp === false
    || args.setup_lsp === false
    || args.writeLsp === false
    || args.write_lsp === false;
}

export function setupShouldWriteLsp(args: RuntimeArgs, lspRecommendations: CoreResult): boolean {
  if (setupLspWriteRequested(args)) return true;
  if (setupLspWriteDisabled(args)) return false;
  const rawArgs = args as UnknownRecord;
  const hasPreviewSelection = Object.prototype.hasOwnProperty.call(rawArgs, "setupPreviewLspAdded")
    || Object.prototype.hasOwnProperty.call(rawArgs, "setup_preview_lsp_added");
  if (hasPreviewSelection) {
    return asStringArray(rawArgs.setupPreviewLspAdded || rawArgs.setup_preview_lsp_added).length > 0;
  }
  return Array.isArray(lspRecommendations.recommended) && lspRecommendations.recommended.length > 0;
}

export function reviewArtifactsFromFiles(reviewFiles: ReviewFile[]): JsonObject[] {
  return reviewFiles.map((file) => ({
      path: file.path,
      title: file.title,
      kind: file.kind,
      source: file.source,
      document_id: file.documentId || null,
      review_role: file.reviewRole || null,
      canonical_path: file.canonicalPath || null,
      projection_path: file.projectionPath || null,
      approval_group: file.approvalGroup || null,
      missing: file.missing === true,
      ...reviewStats(file.content),
    }));
}

export function workflowReviewBundle(
  root: string,
  workflow: string,
  args: RuntimeArgs,
  reviewFiles: ReviewFile[],
  manifestExtras: JsonObject = {},
  previousStage: ApprovalStageRecord | null = null,
): JsonObject | null {
  const rawArgs = args as UnknownRecord;
  if (reviewFiles.length === 0) return null;
  if (
    (args.execute === true && (humanReviewConfirmed(args) || rawArgs.approvalComplete === true || rawArgs.approval_complete === true))
    || rawArgs.reviewBundle === false
    || rawArgs.reviewFiles === false
  ) return null;
  if (reviewOutputMode(args) === "target") return targetReviewBundle(root, workflow, args, reviewFiles, manifestExtras, previousStage);
  const explicitDir = asOptionalString(rawArgs.reviewBundleDir || rawArgs.review_bundle_dir || rawArgs.reviewDir || rawArgs.review_dir);
  const rootHash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 12);
  const defaultDirectory = path.join(os.tmpdir(), `cadre-${safeName(workflow)}-review-${safeName(path.basename(root))}-${rootHash}`);
  let directory = explicitDir ? path.resolve(root, explicitDir) : defaultDirectory;
  const resolvedRoot = path.resolve(root);
  const resolvedCadre = path.join(resolvedRoot, "cadre");
  const relativeToCadre = path.relative(resolvedCadre, directory);
  const insideCadre = relativeToCadre === "" || (!relativeToCadre.startsWith("..") && !path.isAbsolute(relativeToCadre));
  const unsafeExplicitDir = Boolean(explicitDir) && (directory === resolvedRoot || insideCadre);
  const warnings = unsafeExplicitDir
    ? [`Ignored unsafe reviewBundleDir ${explicitDir}; using a temp review bundle outside the project control plane.`]
    : [];
  if (unsafeExplicitDir) directory = defaultDirectory;
  if (!explicitDir || unsafeExplicitDir) fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  const files: JsonObject[] = reviewFiles.map((file) => {
    const reviewPath = path.join(directory, file.path);
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    fs.writeFileSync(reviewPath, file.content);
    return {
      path: file.path,
      review_path: reviewPath,
      title: file.title,
      kind: file.kind,
      source: file.source,
      missing: file.missing === true,
      ...reviewStats(file.content),
    };
  });
  const manifestPath = path.join(directory, "manifest.json");
  const manifest: JsonObject = {
    version: 1,
    kind: `cadre_${safeName(workflow)}_review`,
    mode: "bundle",
    workflow,
    root,
    generated_at: utcNow(),
    content_in_response: false,
    mutates_worktree: false,
    warnings,
    files,
    ...manifestExtras,
  };
  writeJson(manifestPath, manifest);
  return {
    mode: "bundle",
    directory,
    manifest_path: manifestPath,
    content_in_response: false,
    mutates_worktree: false,
    warnings,
    files,
  };
}

export function setupLspReviewArtifacts(args: RuntimeArgs = {}, writeRequested = setupLspWriteRequested(args)): JsonObject[] {
  if (writeRequested) {
    return [
      {
        path: "cadre/lsp.json",
        title: "LSP configuration",
        kind: "json",
        source: "lsp_setup",
        write_requested: true,
      },
    ];
  }
  return [];
}

export function humanReviewState(workflow: string, args: RuntimeArgs, artifacts: JsonObject[], reviewBundle: JsonObject | null = null): JsonObject {
  return {
    required: true,
    confirmed: humanReviewConfirmed(args),
    workflow,
    confirm_argument: "approvalComplete",
    explicit_approval_required: true,
    approval_instruction: `Review the ${workflow} bundle, then ask the user for explicit approval before calling the mutating packet with approvalComplete:true.`,
    not_approval: [
      "native prompt answers",
      "numbered option selections",
      "intent clarification answers",
      "review bundle generation",
    ],
    artifacts,
    review_bundle: reviewBundle,
  };
}

export function packetReviewArtifact(title: string, source: string, fields: JsonObject = {}): JsonObject {
  return {
      title,
      kind: "packet",
      source,
      content_in_response: false,
      ...fields,
  };
}

export function trackLearningsText(trackId: string): string {
  const seed = templateJson("learnings_seed.json", {
    text: "# Track Learnings: {{track_id}}\n\nPatterns, gotchas, and context discovered during implementation.\n",
  });
  return (asOptionalString(seed.text) || "# Track Learnings: {{track_id}}\n\n")
    .replace(/\{\{track_id\}\}/g, trackId)
    .replace(/\n*$/, "\n");
}

export function installedStyleGuideIds(root: string): string[] {
  const dir = path.join(root, "cadre", "styleguides");
  if (!fileExists(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json") && file !== "index.json")
      .map((file) => path.basename(file, ".json"))
      .sort();
  } catch {
    return [];
  }
}

export function styleGuideIdsForFiles(files: string[]): string[] {
  const ids = new Set<string>();
  for (const rawFile of files) {
    const file = normalizeClaimPath(rawFile);
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();
    if ([".ts", ".tsx"].includes(ext)) ids.add("typescript");
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) ids.add("javascript");
    if ([".html", ".css", ".scss", ".sass", ".less", ".vue", ".svelte"].includes(ext)) ids.add("html-css");
    if (ext === ".py") ids.add("python");
    if (ext === ".go") ids.add("go");
    if (ext === ".rs") ids.add("rust");
    if ([".kt", ".kts"].includes(ext)) ids.add("kotlin");
    if (ext === ".swift") ids.add("swift");
    if (ext === ".dart") ids.add("dart");
    if (base === "androidmanifest.xml" || file.includes("/android/")) ids.add("android");
    if (file.includes("compose")) ids.add("compose-multiplatform");
    if (file.includes("swiftui")) ids.add("swiftui");
    if (ext === ".dart" && (file.startsWith("lib/") || file.includes("/flutter/"))) ids.add("flutter");
  }
  return Array.from(ids).sort();
}

export function implementationStyleGuides(root: string, trackId: string | null | undefined, args: RuntimeArgs = {}): CoreResult {
  const installed = installedStyleGuideIds(root);
  if (installed.length === 0) {
    return {
      ok: true,
      available: false,
      source: "cadre/styleguides",
      installed: [],
      selected: [],
      guides: [],
      warning: "No installed Cadre code style guides found",
    };
  }
  const installedSet = new Set(installed);
  const track = findTrack(root, trackId);
  const plan = track ? parsePlanFile(track.plan_path) : { tasks: [] };
  const taskFiles = asArray(plan.tasks)
    .flatMap((task) => asStringArray(asJsonObject(task).files))
    .map(normalizeClaimPath)
    .filter(Boolean);
  const taskFileIds = styleGuideIdsForFiles(taskFiles).filter((id) => installedSet.has(id));
  const techStack = techStackForPacket(root, args);
  if (!techStack) {
    return {
      ok: false,
      available: false,
      source: "cadre/tech-stack.json",
      installed,
      selected: [],
      guides: [],
      error: "Missing structured tech stack: cadre/tech-stack.json",
    };
  }
  const techStackIds = styleGuideIdsForTechStack(techStack).filter((id) => installedSet.has(id));
  const requested = requestedStyleGuideIds((args as UnknownRecord).styleGuideIds);
  const missing = requested.filter((id) => !installedSet.has(id));
  const selected = Array.from(new Set([
    ...(installedSet.has("general") ? ["general"] : []),
    ...techStackIds,
    ...requested.filter((id) => installedSet.has(id)),
  ])).sort();
  const maxChars = Math.max(1000, Math.min(Number(args.styleGuideMaxChars || 6000), 20000));
  const guides = selected.map((id) => {
    const file = path.join(root, "cadre", "styleguides", `${id}.json`);
    const guide = readJson<JsonObject | null>(file, null) || {};
    const text = JSON.stringify(guide, null, 2);
    return {
      id,
      path: path.relative(root, file),
      guide,
      content: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      bytes: Buffer.byteLength(text, "utf8"),
      reasons: [
        id === "general" ? "general" : null,
        techStackIds.includes(id) ? "tech_stack" : null,
        requested.includes(id) ? "explicit" : null,
      ].filter(Boolean),
    };
  });
  return {
    ok: missing.length === 0,
    available: true,
    source: "cadre/styleguides",
    tech_stack_source: "cadre/tech-stack.json",
    installed,
    selected,
    tech_stack_ids: techStackIds,
    task_file_ids: taskFileIds,
    task_files: taskFiles,
    missing,
    max_chars_per_guide: maxChars,
    guides,
  };
}
