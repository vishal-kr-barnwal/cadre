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

import { ArtifactDefinition } from "./contracts";
import { fileExists } from "../../infrastructure/runtime/json-store";
import { trackHandoffJsonPath, trackLearningsJsonlPath, trackPlanJsonPath, trackSpecJsonPath } from "./plan-docs";
import { TRACKS_INDEX_SCHEMA } from "./status";
import { listTracks } from "./track-schedule";

export function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

export function artifactSchema(artifact: unknown): JsonObject {
  const id = String(artifact || "catalog").toLowerCase();
  const objectSchema = (required: string[], properties: JsonObject): JsonObject => ({
    type: "object",
    required,
    additionalProperties: true,
    properties,
  });
  const specListItemSchema = objectSchema(["heading"], {
    heading: { type: "string" },
    body: { type: "string" },
  });
  const schemas: Record<string, JsonObject> = {
    spec: objectSchema(["track_id", "title"], {
      track_id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      functional_requirements: { type: "array", items: specListItemSchema },
      non_functional_requirements: { type: "array", items: specListItemSchema },
      acceptance_criteria: { type: "array", items: specListItemSchema },
      out_of_scope: { type: "array", items: specListItemSchema },
    }),
    plan: objectSchema(["track_id", "phases"], {
      track_id: { type: "string" },
      phases: { type: "array" },
      tasks: { type: "array" },
      execution_mode: { type: "string" },
      dependencies: { type: "array" },
      files: { type: "array" },
      repo: { type: "string" },
      status: { type: "string" },
      commit_shas: { type: "array", items: { type: "string" } },
      test_expectations: { type: "array" },
      completion_evidence: { type: "object" },
    }),
    styleguide: objectSchema(["id", "title", "rules"], {
      id: { type: "string" },
      title: { type: "string" },
      languages: { type: "array", items: { type: "string" } },
      frameworks: { type: "array", items: { type: "string" } },
      file_patterns: { type: "array", items: { type: "string" } },
      applies_to: { type: "array", items: { type: "string" } },
      rules: { type: "array" },
      examples: { type: "array" },
      anti_examples: { type: "array" },
      severity: { type: "string" },
      source: { type: "string" },
      version: { type: "number" },
    }),
    metadata: objectSchema(["track_id"], {
      track_id: { type: "string" },
      status: { type: "string" },
      owner: { type: "string" },
      reviewer: { type: "string" },
      review: { type: "object" },
      worktree_path: { type: "string" },
    }),
    release: objectSchema(["version", "completed_tracks"], {
      version: { type: "string" },
      generated_at: { type: "string" },
      completed_tracks: { type: "array" },
      notes: { type: "array" },
    }),
    journal: objectSchema(["track_id", "events"], {
      track_id: { type: "string" },
      events: { type: "array" },
      event: { type: "string" },
      recorded_at: { type: "string" },
    }),
    evidence: objectSchema(["entries"], {
      entries: { type: "array" },
      provider: { type: "string" },
      findings: { type: "array" },
      blocking_count: { type: "number" },
      recorded_at: { type: "string" },
    }),
    project_doc: objectSchema(["title", "sections"], {
      title: { type: "string" },
      summary: { type: "string" },
      sections: { type: "array" },
    }),
    artifact_sync_result: objectSchema(["ok", "dry_run", "artifacts"], {
      ok: { type: "boolean" },
      dry_run: { type: "boolean" },
      artifacts: { type: "array" },
      review_bundle: { type: "object" },
      written: { type: "array", items: { type: "string" } },
      skipped: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
      errors: { type: "array", items: { type: "string" } },
    }),
  };
  return {
    ok: true,
    artifact: id,
    schema: schemas[id]
      || (["review-evidence", "review_evidence", "provider-evidence", "provider_evidence"].includes(id) ? schemas.evidence : undefined)
      || (["completion-journal", "completion_journal"].includes(id) ? schemas.journal : undefined)
      || schemas.project_doc,
    dialect: "https://json-schema.org/draft/2020-12/schema",
  };
}

export function artifactDefinitions(root: string, args: RuntimeArgs = {}): ArtifactDefinition[] {
  const defs: ArtifactDefinition[] = [
    { id: "product", title: "Product context", canonical: "cadre/product.json", projection: "cadre/product.md", schema: "cadre.product.v1", scope: "project", sourceFormat: "json", projectionFormat: "markdown" },
    { id: "product-guidelines", title: "Product guidelines", canonical: "cadre/product_guidelines.json", projection: "cadre/product_guidelines.md", schema: "cadre.product_guidelines.v1", scope: "project", sourceFormat: "json", projectionFormat: "markdown" },
    { id: "workflow", title: "Workflow policy", canonical: "cadre/workflow.json", projection: "cadre/workflow.md", schema: "cadre.workflow.v1", scope: "project", sourceFormat: "json", projectionFormat: "markdown" },
    { id: "patterns", title: "Project patterns", canonical: "cadre/patterns.jsonl", projection: "cadre/patterns.md", schema: "cadre.patterns.v1", scope: "project", sourceFormat: "jsonl", projectionFormat: "markdown" },
    { id: "tracks-index", title: "Track index", canonical: "cadre/tracks.json", schema: TRACKS_INDEX_SCHEMA, scope: "project", sourceFormat: "json", projectionFormat: "none" },
    { id: "tech-stack", title: "Tech stack", canonical: "cadre/tech-stack.json", schema: "cadre.tech_stack.v1", scope: "project", sourceFormat: "json", projectionFormat: "none" },
    { id: "config", title: "Cadre config", canonical: "cadre/config.json", schema: "cadre.config.v1", scope: "project", sourceFormat: "json", projectionFormat: "none" },
    { id: "setup-state", title: "Setup state", canonical: "cadre/setup_state.json", schema: "cadre.setup_state.v1", scope: "project", sourceFormat: "json", projectionFormat: "none" },
  ];
  if (fileExists(path.join(root, "cadre", "repos.json")) || fileExists(path.join(root, "cadre", "repos.md"))) {
    defs.push({ id: "repos", title: "Repository topology", canonical: "cadre/repos.json", projection: "cadre/repos.md", schema: "cadre.repos.v1", scope: "project", sourceFormat: "json", projectionFormat: "markdown" });
  }
  if (fileExists(path.join(root, "cadre", "lsp.json"))) {
    defs.push({ id: "lsp-config", title: "LSP config", canonical: "cadre/lsp.json", schema: "cadre.lsp.v1", scope: "project", sourceFormat: "json", projectionFormat: "none" });
  }
  const styleJsonDir = path.join(root, "cadre", "styleguides");
  const styleMdDir = path.join(root, "cadre", "code_styleguides");
  const styleIds = new Set<string>();
  for (const file of safeReadDir(styleJsonDir)) {
    if (file.endsWith(".json") && file !== "index.json") styleIds.add(path.basename(file, ".json"));
  }
  for (const file of safeReadDir(styleMdDir)) {
    if (file.endsWith(".md") && file !== "README.md") styleIds.add(path.basename(file, ".md"));
  }
  if (styleIds.size > 0) {
    defs.push({ id: "styleguides-index", title: "Style guide catalog", canonical: "cadre/styleguides/index.json", projection: "cadre/code_styleguides/README.md", schema: "cadre.styleguide_index.v1", scope: "styleguide", sourceFormat: "json", projectionFormat: "markdown" });
  }
  for (const id of Array.from(styleIds).sort()) {
    defs.push({ id: `styleguide:${id}`, title: `Style guide: ${id}`, canonical: `cadre/styleguides/${id}.json`, projection: `cadre/code_styleguides/${id}.md`, schema: "cadre.styleguide.v1", scope: "styleguide", sourceFormat: "json", projectionFormat: "markdown" });
  }
  for (const track of listTracks(root)) {
    defs.push(
      { id: `track:${track.track_id}:metadata`, title: `Metadata: ${track.track_id}`, canonical: path.relative(root, track.metadata_path), schema: "cadre.metadata.v1", scope: "track", sourceFormat: "json", projectionFormat: "none" },
      { id: `track:${track.track_id}:spec`, title: `Spec: ${track.track_id}`, canonical: path.relative(root, trackSpecJsonPath(track)), projection: path.relative(root, track.spec_path), schema: "cadre.spec.v1", scope: "track", sourceFormat: "json", projectionFormat: "markdown" },
      { id: `track:${track.track_id}:plan`, title: `Plan: ${track.track_id}`, canonical: path.relative(root, trackPlanJsonPath(track)), projection: path.relative(root, track.plan_path), schema: "cadre.plan.v1", scope: "track", sourceFormat: "json", projectionFormat: "markdown" },
      { id: `track:${track.track_id}:learnings`, title: `Learnings: ${track.track_id}`, canonical: path.relative(root, trackLearningsJsonlPath(track)), projection: path.relative(root, track.learnings_path || path.join(track.dir, "learnings.md")), schema: "cadre.learnings.v1", scope: "track", sourceFormat: "jsonl", projectionFormat: "markdown" },
      { id: `track:${track.track_id}:handoff`, title: `Handoff: ${track.track_id}`, canonical: path.relative(root, trackHandoffJsonPath(track)), projection: path.relative(root, path.join(track.dir, "HANDOFF.md")), schema: "cadre.handoff.v1", scope: "track", sourceFormat: "json", projectionFormat: "markdown" }
    );
    const reviewEvidenceJsonl = path.join(track.dir, "review-evidence.jsonl");
    const reviewEvidenceJson = path.join(track.dir, "review-evidence.json");
    const completionJournal = path.join(track.dir, "completion_journal.jsonl");
    const parallelState = path.join(track.dir, "parallel_state.json");
    const implementState = path.join(track.dir, "implement_state.json");
    if (fileExists(reviewEvidenceJsonl)) {
      defs.push({ id: `track:${track.track_id}:review-evidence`, title: `Review evidence: ${track.track_id}`, canonical: path.relative(root, reviewEvidenceJsonl), schema: "cadre.review_evidence.v1", scope: "track", sourceFormat: "jsonl", projectionFormat: "none" });
    }
    if (fileExists(reviewEvidenceJson)) {
      defs.push({ id: `track:${track.track_id}:review-evidence-summary`, title: `Review evidence summary: ${track.track_id}`, canonical: path.relative(root, reviewEvidenceJson), schema: "cadre.review_evidence_summary.v1", scope: "track", sourceFormat: "json", projectionFormat: "none" });
    }
    if (fileExists(completionJournal)) {
      defs.push({ id: `track:${track.track_id}:completion-journal`, title: `Completion journal: ${track.track_id}`, canonical: path.relative(root, completionJournal), schema: "cadre.completion_journal.v1", scope: "track", sourceFormat: "jsonl", projectionFormat: "none" });
    }
    if (fileExists(parallelState)) {
      defs.push({ id: `track:${track.track_id}:parallel-state`, title: `Parallel state: ${track.track_id}`, canonical: path.relative(root, parallelState), schema: "cadre.parallel_state.v1", scope: "track", sourceFormat: "json", projectionFormat: "none" });
    }
    if (fileExists(implementState)) {
      defs.push({ id: `track:${track.track_id}:implement-state`, title: `Implementation state: ${track.track_id}`, canonical: path.relative(root, implementState), schema: "cadre.implement_state.v1", scope: "track", sourceFormat: "json", projectionFormat: "none" });
    }
  }
  const releasesDir = path.join(root, "cadre", "releases");
  for (const file of safeReadDir(releasesDir)) {
    if (!file.endsWith(".json")) continue;
    const version = path.basename(file, ".json");
    defs.push({ id: `release:${version}`, title: `Release - ${version}`, canonical: `cadre/releases/${file}`, projection: `cadre/releases/${version}.md`, schema: "cadre.release.v1", scope: "release", sourceFormat: "json", projectionFormat: "markdown" });
  }
  const jobsDir = path.join(root, "cadre", "jobs");
  for (const file of safeReadDir(jobsDir)) {
    if (!file.endsWith(".json")) continue;
    const jobId = path.basename(file, ".json");
    defs.push({ id: `job:${jobId}`, title: `Job ${jobId}`, canonical: `cadre/jobs/${file}`, schema: "cadre.job.v1", scope: "external", sourceFormat: "json", projectionFormat: "none" });
  }
  if (args.includeArchive === true || args.include_archive === true) {
    const archiveDir = path.join(root, "cadre", "archive");
    for (const trackId of safeReadDir(archiveDir)) {
      const dir = path.join(archiveDir, trackId);
      if (!fileExists(path.join(dir, "metadata.json"))) continue;
      defs.push(
        { id: `archive:${trackId}:spec`, title: `Archived spec: ${trackId}`, canonical: `cadre/archive/${trackId}/spec.json`, projection: `cadre/archive/${trackId}/spec.md`, schema: "cadre.spec.v1", scope: "track", sourceFormat: "json", projectionFormat: "markdown" },
        { id: `archive:${trackId}:plan`, title: `Archived plan: ${trackId}`, canonical: `cadre/archive/${trackId}/plan.json`, projection: `cadre/archive/${trackId}/plan.md`, schema: "cadre.plan.v1", scope: "track", sourceFormat: "json", projectionFormat: "markdown" }
      );
    }
  }
  return defs;
}

export function artifactMatches(def: ArtifactDefinition, args: RuntimeArgs = {}): boolean {
  const artifact = asOptionalString(args.artifact || args.id);
  if (artifact && def.id !== artifact && !def.id.endsWith(`:${artifact}`)) return false;
  const scope = asOptionalString(args.scope || args.view || "all") || "all";
  if (scope === "all") return true;
  if (scope === "project") return def.scope === "project";
  if (scope === "tracks") return def.scope === "track" || def.id === "tracks-index";
  if (scope === "styleguides" || scope === "styleguide") return def.scope === "styleguide";
  if (scope === "release") return def.scope === "release";
  if (scope === "spec") return def.id.endsWith(":spec");
  if (scope === "plan") return def.id.endsWith(":plan");
  if (scope.startsWith("track:")) return def.id.startsWith(`${scope}:`) || def.id === "tracks-index";
  return def.id === scope || def.scope === scope;
}
