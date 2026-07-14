import fs from "node:fs";
import path from "node:path";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString } from "../../../guards";

import { artifactDefinitions, artifactMatches, artifactSchema } from "./artifact-catalog";
import { ArtifactDefinition, ArtifactRenderResult, CoreResult, ReviewFile } from "./contracts";
import { fileExists, readJson, utcNow } from "../../infrastructure/runtime/json-store";
import { appendCanonicalJsonReference, hasGeneratedMarker, normalizedText, renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import { renderPlanMarkdown } from "./plan-docs";
import { renderSpecMarkdown, renderStyleGuideMarkdown } from "./spec-docs";
import { asArray } from "./status";
import { beginTrace, commitTrace } from "./commit-trace";
import { markdownPayloadError } from "./workflow-response";
import { renderProjectSkillProjection } from "./project-skill-projection";
import type { ManagedManifest } from "../../domain/project-skill-management";
import { writeArtifactFilesAtomic } from "./artifact-pairs";

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
  let canonicalContent = "";
  let body = "";
  let missingCanonical = false;
  if (def.sourceFormat === "markdown") {
    if (!fileExists(canonicalPath)) missingCanonical = true;
    else body = canonicalContent = fs.readFileSync(canonicalPath, "utf8");
  } else if (def.sourceFormat === "jsonl") {
    if (!fileExists(canonicalPath)) {
      missingCanonical = true;
    } else {
      canonicalContent = fs.readFileSync(canonicalPath, "utf8");
      body = renderJsonlMarkdown(def.title, readJsonl(canonicalPath));
    }
  } else if (fileExists(canonicalPath)) {
    canonicalContent = fs.readFileSync(canonicalPath, "utf8");
    raw = readJson<JsonObject | null>(canonicalPath, null);
    if (!raw) return { ok: false, artifact_id: def.id, canonical_path: def.canonical, projection_path: def.projection, error: "Invalid canonical JSON" };
    if (def.schema === "cadre.plan.v1") body = renderPlanMarkdown(raw, def.canonical);
    else if (def.schema === "cadre.spec.v1") body = renderSpecMarkdown(raw, def.canonical);
    else if (def.schema === "cadre.styleguide.v1") body = renderStyleGuideMarkdown(raw);
    else if (def.schema === "cadre.styleguide_index.v1") body = renderJsonCodeblock(def.title, raw);
    else if (def.schema === "cadre.release.v1") body = releaseMarkdownFromMetadata(raw);
    else if (def.schema === "cadre.project-skill.v1") body = renderProjectSkillProjection(raw as unknown as ManagedManifest);
    else if (["cadre.product.v1", "cadre.product_guidelines.v1", "cadre.workflow.v1", "cadre.handoff.v1"].includes(def.schema)) body = renderMarkdownDoc(raw, def.title, def.canonical);
    else body = renderJsonCodeblock(def.title, raw);
  } else {
    missingCanonical = true;
  }
  if (!body) return { ok: false, artifact_id: def.id, canonical_path: def.canonical, projection_path: def.projection, missing_canonical: missingCanonical };
  const content = def.sourceFormat === "markdown" || hasGeneratedMarker(body)
    ? body
    : withGeneratedMarker(def.canonical, def.schema, body, {
      canonicalContent,
      ...(def.projection ? { projection: def.projection } : {}),
    });
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
  const approved = asOptionalString(metadata.release_notes_markdown);
  if (approved) return normalizedText(approved);
  const version = asOptionalString(metadata.version) || "release";
  const parts = [`# Release - ${version}`, "", `Generated: ${asOptionalString(metadata.generated_at) || utcNow()}`, "", "## Completed Tracks", ""];
  for (const rawTrack of asArray(metadata.completed_tracks)) {
    const track = asJsonObject(rawTrack);
    parts.push(`- ${asOptionalString(track.track_id) || "track"}: ${asOptionalString(track.name || track.status) || ""}`.trim());
  }
  parts.push("");
  appendCanonicalJsonReference(parts);
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
    const canonicalOk = def.sourceFormat === "jsonl"
      ? readJsonl(file).length >= 0
      : def.sourceFormat === "markdown"
        ? fs.readFileSync(file, "utf8").trim().length > 0
        : Boolean(readJson<JsonObject | null>(file, null));
    if (!canonicalOk || !def.projection) return { artifact_id: def.id, ok: canonicalOk, canonical_path: def.canonical };
    const rendered = renderArtifact(root, def, args);
    const projectionFile = path.join(root, def.projection);
    const projectionExists = fileExists(projectionFile);
    const existing = projectionExists ? fs.readFileSync(projectionFile, "utf8") : "";
    const generated = projectionExists && hasGeneratedMarker(existing);
    const drifted = rendered.ok === true && rendered.changed === true;
    return {
      artifact_id: def.id,
      ok: rendered.ok === true && projectionExists && generated && !drifted,
      canonical_path: def.canonical,
      projection_path: def.projection,
      projection_missing: !projectionExists,
      projection_generated: generated,
      projection_drift: drifted,
      ...(projectionExists && !generated ? { error: "Projection is user-owned or missing its Cadre generated marker" } : {}),
    };
  });
  const legacyStyleguides = fileExists(path.join(root, "cadre", "code_styleguides"));
  if (legacyStyleguides) {
    results.push({
      artifact_id: "legacy-styleguide-projections",
      ok: false,
      canonical_path: "cadre/styleguides",
      error: "Deprecated cadre/code_styleguides exists; projections now belong beside canonical JSON in cadre/styleguides",
    });
  }
  return {
    ok: results.every((result) => result.ok !== false),
    root,
    results,
    legacy_styleguide_path: legacyStyleguides ? "cadre/code_styleguides" : null,
  };
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
  if ((args as UnknownRecord).importLegacy !== undefined || (args as UnknownRecord).import_legacy !== undefined) {
    return {
      ok: false,
      error: "Legacy Markdown import is not supported. Create canonical JSON/JSONL artifacts and rerun artifact sync.",
      unsupported_fields: ["importLegacy", "import_legacy"].filter((field) => (args as UnknownRecord)[field] !== undefined),
    };
  }
  const defs = artifactDefinitions(root, args).filter((def) => artifactMatches(def, args));
  const artifacts: JsonObject[] = [];
  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const pendingWrites: Array<{ path: string; content: string }> = [];
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
      else if (rendered.ok === false && def.projection) errors.push(`${def.id}: ${asOptionalString(rendered.error) || "projection render failed"}`);
      continue;
    }
    const projectionFile = path.join(root, def.projection);
    const existing = fileExists(projectionFile) ? fs.readFileSync(projectionFile, "utf8") : "";
    if (existing && !hasGeneratedMarker(existing)) {
      skipped.push(def.projection);
      errors.push(`Refusing to overwrite user-owned projection ${def.projection}`);
      continue;
    }
    if (rendered.changed === true) pendingWrites.push({ path: def.projection, content: rendered.content });
    else skipped.push(def.projection);
  }
  if (fileExists(path.join(root, "cadre", "code_styleguides"))) {
    warnings.push("Deprecated styleguide projection directory exists: cadre/code_styleguides. Regenerate into cadre/styleguides and remove the legacy directory manually.");
  }
  const traceBefore = execute ? beginTrace(root) : null;
  let mutation: CoreResult | null = null;
  if (execute && errors.length === 0 && pendingWrites.length > 0) {
    mutation = writeArtifactFilesAtomic(root, pendingWrites);
    if (mutation.ok === false) errors.push(asOptionalString(mutation.error) || "Projection write failed");
    else written.push(...pendingWrites.map((file) => file.path));
  }
  const controlCommit = execute
    ? commitTrace(root, args, {
      kind: "control",
      workflow: "artifacts",
      subject: "sync projections",
      before: traceBefore,
      files: written,
      allowDirty: true,
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
    approval: { required: false },
    written,
    skipped,
    mutation,
    control_commit: controlCommit,
    warnings,
    errors,
    ...(errors.length ? { error: errors[0] } : {}),
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
