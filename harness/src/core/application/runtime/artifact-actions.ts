import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { artifactDefinitions, artifactMatches, artifactSchema } from "./artifact-catalog";
import { ArtifactDefinition, ArtifactRenderResult, CoreResult, ReviewFile } from "./contracts";
import { ensureParent, fileExists, readJson, utcNow } from "../../infrastructure/runtime/json-store";
import { hasGeneratedMarker, normalizedText, renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import { renderPlanMarkdown } from "./plan-docs";
import { humanReviewState, reviewArtifactsFromFiles, textReviewFile, workflowReviewBundle } from "./review-bundles";
import { renderSpecMarkdown, renderStyleGuideMarkdown } from "./spec-docs";
import { asArray } from "./status";
import { humanReviewConfirmed } from "./tech-stack";
import { beginTrace, commitTrace } from "./commit-trace";
import { markdownPayloadError } from "./workflow-response";

export function artifactCatalog(root: string, args: RuntimeArgs = {}): CoreResult {
  const artifacts = artifactDefinitions(root, args)
    .filter((def) => artifactMatches(def, args))
    .map((def) => ({
      ...def,
      canonical_exists: def.canonical === "cadre/tracks" ? fileExists(path.join(root, "cadre", "tracks")) : fileExists(path.join(root, def.canonical)),
      projection_exists: def.projection ? fileExists(path.join(root, def.projection)) : false,
    }));
  return { ok: true, root, artifacts };
}

export function renderJsonCodeblock(title: string, value: JsonObject): string {
  return normalizedText(`# ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`);
}

export function readJsonl(file: string): JsonObject[] {
  if (!fileExists(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return asJsonObject(JSON.parse(line));
      } catch {
        return { text: line };
      }
    });
}

export function renderJsonlMarkdown(title: string, entries: JsonObject[]): string {
  if (entries.length === 1) {
    const text = asOptionalString(entries[0]?.text || entries[0]?.summary || entries[0]?.body);
    if (text && /^#\s+/m.test(text.trimStart())) return normalizedText(text);
  }
  const parts = [`# ${title}`, ""];
  for (const entry of entries) {
    const heading = asOptionalString(entry.title || entry.kind || entry.id);
    if (heading) parts.push(`## ${heading}`, "");
    const text = asOptionalString(entry.text || entry.summary || entry.body);
    if (text) parts.push(text, "");
  }
  return normalizedText(parts.join("\n"));
}

export function renderArtifact(root: string, def: ArtifactDefinition, args: RuntimeArgs = {}): ArtifactRenderResult {
  const canonicalPath = path.join(root, def.canonical);
  const projectionPath = def.projection ? path.join(root, def.projection) : undefined;
  let raw: JsonObject | null = null;
  let body = "";
  let missingCanonical = false;
  if (def.sourceFormat === "jsonl") {
    const entries = readJsonl(canonicalPath);
    if (entries.length === 0) missingCanonical = true;
    const title = def.title;
    body = renderJsonlMarkdown(title, entries);
  } else if (fileExists(canonicalPath)) {
    raw = readJson<JsonObject | null>(canonicalPath, null);
    if (!raw) return { ok: false, artifact_id: def.id, canonical_path: def.canonical, projection_path: def.projection, error: "Invalid canonical JSON" };
    if (def.schema === "cadre.plan.v1") body = renderPlanMarkdown(raw);
    else if (def.schema === "cadre.spec.v1") body = renderSpecMarkdown(raw);
    else if (def.schema === "cadre.styleguide.v1") body = renderStyleGuideMarkdown(raw);
    else if (def.schema === "cadre.styleguide_index.v1") body = renderJsonCodeblock(def.title, raw);
    else if (def.schema === "cadre.release.v1") body = releaseMarkdownFromMetadata(raw);
    else if (["cadre.product.v1", "cadre.product_guidelines.v1", "cadre.workflow.v1", "cadre.handoff.v1"].includes(def.schema)) body = renderMarkdownDoc(raw, def.title);
    else body = renderJsonCodeblock(def.title, raw);
  } else {
    missingCanonical = true;
  }
  if (!body) return { ok: false, artifact_id: def.id, canonical_path: def.canonical, projection_path: def.projection, missing_canonical: missingCanonical };
  const content = withGeneratedMarker(def.canonical, def.schema, body);
  const existing = projectionPath && fileExists(projectionPath) ? fs.readFileSync(projectionPath, "utf8") : "";
  return {
    ok: true,
    artifact_id: def.id,
    canonical_path: def.canonical,
    projection_path: def.projection,
    content,
    changed: projectionPath ? normalizedText(existing) !== normalizedText(content) : false,
    missing_canonical: missingCanonical,
    legacy_import_available: false,
  };
}

export function releaseMarkdownFromMetadata(metadata: JsonObject): string {
  const version = asOptionalString(metadata.version) || "release";
  const parts = [`# Release - ${version}`, "", `Generated: ${asOptionalString(metadata.generated_at) || utcNow()}`, "", "## Completed Tracks", ""];
  for (const rawTrack of asArray(metadata.completed_tracks)) {
    const track = asJsonObject(rawTrack);
    parts.push(`- ${asOptionalString(track.track_id) || "track"}: ${asOptionalString(track.name || track.status) || ""}`.trim());
  }
  parts.push("");
  return normalizedText(parts.join("\n"));
}

export function artifactRender(root: string, args: RuntimeArgs = {}): CoreResult {
  const artifact = asOptionalString(args.artifact || args.id);
  if (!artifact) return { ok: false, error: "artifact is required" };
  const def = artifactDefinitions(root, args).find((item) => item.id === artifact || item.id.endsWith(`:${artifact}`));
  if (!def) return { ok: false, error: `Unknown artifact: ${artifact}` };
  return renderArtifact(root, def, args);
}

export function artifactValidate(root: string, args: RuntimeArgs = {}): CoreResult {
  const artifacts = artifactDefinitions(root, args).filter((def) => artifactMatches(def, args));
  const results = artifacts.map((def) => {
    const file = path.join(root, def.canonical);
    if (!fileExists(file)) return { artifact_id: def.id, ok: false, missing: true, canonical_path: def.canonical };
    if (def.sourceFormat === "jsonl") return { artifact_id: def.id, ok: readJsonl(file).length >= 0, canonical_path: def.canonical };
    const value = readJson<JsonObject | null>(file, null);
    return { artifact_id: def.id, ok: Boolean(value), canonical_path: def.canonical };
  });
  return { ok: results.every((result) => result.ok !== false), root, results };
}

export function artifactDiff(root: string, args: RuntimeArgs = {}): CoreResult {
  const artifacts = artifactDefinitions(root, args).filter((def) => artifactMatches(def, args));
  const diffs = artifacts.map((def) => {
    const rendered = renderArtifact(root, def, args);
    return {
      artifact_id: def.id,
      projection_path: def.projection,
      changed: rendered.changed === true,
      missing_canonical: rendered.missing_canonical === true,
      legacy_import_available: rendered.legacy_import_available === true,
    };
  });
  return { ok: true, root, diffs, changed: diffs.filter((diff) => diff.changed).length };
}

export function artifactSync(root: string, args: RuntimeArgs = {}): CoreResult {
  const execute = args.execute === true;
  const force = args.force === true;
  if ((args as UnknownRecord).importLegacy !== undefined || (args as UnknownRecord).import_legacy !== undefined) {
    return {
      ok: false,
      error: "Legacy Markdown import is not supported. Create canonical JSON/JSONL artifacts and rerun artifact sync.",
      unsupported_fields: ["importLegacy", "import_legacy"].filter((field) => (args as UnknownRecord)[field] !== undefined),
    };
  }
  const defs = artifactDefinitions(root, args).filter((def) => artifactMatches(def, args));
  const reviewFiles: ReviewFile[] = [];
  const artifacts: JsonObject[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const traceBefore = execute && humanReviewConfirmed(args) ? beginTrace(root) : null;
  for (const def of defs) {
    const rendered = renderArtifact(root, def, args);
    artifacts.push({
      artifact_id: def.id,
      canonical_path: def.canonical,
      projection_path: def.projection || null,
      changed: rendered.changed === true,
      missing_canonical: rendered.missing_canonical === true,
      legacy_import_available: rendered.legacy_import_available === true,
    });
    if (rendered.ok === false || !rendered.content || !def.projection) {
      if (rendered.missing_canonical) warnings.push(`Missing canonical for ${def.id}`);
      continue;
    }
    reviewFiles.push(textReviewFile(def.projection, def.title, def.canonical, rendered.content));
    if (!execute) continue;
    if (!humanReviewConfirmed(args)) continue;
    const projectionFile = path.join(root, def.projection);
    const existing = fileExists(projectionFile) ? fs.readFileSync(projectionFile, "utf8") : "";
    if (existing && !hasGeneratedMarker(existing) && !force) {
      skipped.push(def.projection);
      warnings.push(`Skipped unmarked projection ${def.projection}; pass force:true or import first.`);
      continue;
    }
    ensureParent(projectionFile);
    fs.writeFileSync(projectionFile, rendered.content);
    written.push(def.projection);
  }
  const reviewBundle = workflowReviewBundle(root, "artifacts", args, reviewFiles, {
    scope: args.scope || "all",
    artifact: args.artifact || null,
  });
  const humanReview = humanReviewState("artifacts", args, reviewArtifactsFromFiles(reviewFiles), reviewBundle);
  if (execute && !humanReviewConfirmed(args)) {
    return {
      ok: false,
      dry_run: true,
      phase_state: "awaiting_human_review",
      stage: "human_review",
      artifacts,
      human_review: humanReview,
      review_bundle: reviewBundle,
      warnings,
      errors: ["Human confirmation is required before syncing artifacts"],
      error: "Human confirmation is required before syncing artifacts",
    };
  }
  const controlCommit = execute
    ? commitTrace(root, args, {
      kind: "control",
      workflow: "artifacts",
      subject: "sync projections",
      before: traceBefore,
      files: written,
      note: {
        scope: args.scope || "all",
        artifact: args.artifact || null,
        written,
        skipped,
      },
    })
    : null;
  return {
    ok: errors.length === 0 && (!controlCommit || controlCommit.ok !== false),
    dry_run: !execute,
    phase_state: execute ? (controlCommit && controlCommit.ok === false ? "recovery_required" : "executed") : "dry_run",
    artifacts,
    review_bundle: reviewBundle,
    human_review: humanReview,
    written,
    skipped,
    control_commit: controlCommit,
    warnings,
    errors,
  };
}

export function artifactImport(root: string, args: RuntimeArgs = {}): CoreResult {
  return {
    ok: false,
    error: "Legacy Markdown import is not supported. Create canonical JSON/JSONL artifacts and rerun artifact sync.",
    action: asOptionalString(args.action) || "import",
  };
}

export function artifactPacket(root: string, args: RuntimeArgs = {}): CoreResult {
  const markdownError = markdownPayloadError(args);
  if (markdownError) return markdownError;
  const action = asOptionalString(args.action) || "catalog";
  if (action === "catalog") return artifactCatalog(root, args);
  if (action === "schema") return artifactSchema(args.artifact || args.id || args.scope);
  if (action === "validate") return artifactValidate(root, args);
  if (action === "render") return artifactRender(root, args);
  if (action === "diff") return artifactDiff(root, args);
  if (action === "sync") return artifactSync(root, args);
  if (action === "import") return artifactImport(root, args);
  return { ok: false, error: `Unknown artifact action: ${action}` };
}
