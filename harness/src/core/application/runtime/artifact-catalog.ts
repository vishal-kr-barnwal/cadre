import fs from "node:fs";
import path from "node:path";
import { asOptionalString } from "../../../guards";
import type { JsonObject, RuntimeArgs } from "../../../types";

import { fileExists } from "../../infrastructure/runtime/json-store";
import type { ArtifactDefinition } from "./contracts";
import { projectionDefinition } from "./projection-registry";
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
  const planTaskSchema = objectSchema(["task_index", "task_key", "title", "files", "depends_on"], {
    task_index: { type: "integer" },
    task_key: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked", "skipped"] },
    files: { type: "array", items: { type: "string" } },
    depends_on: { type: "array", items: { type: "string" } },
    repo: { type: ["string", "null"] },
    annotations: { type: "object" },
    commit_shas: { type: "array", items: { type: "string" } },
    repo_shas: { type: "object" },
  });
  const planPhaseSchema = objectSchema(["phase_index", "title", "tasks"], {
    phase_index: { type: "integer" },
    title: { type: "string" },
    execution_mode: { type: "string", enum: ["sequential", "parallel"] },
    depends_on: { type: "array", items: { type: "string" } },
    annotations: { type: "object" },
    tasks: { type: "array", minItems: 1, items: planTaskSchema },
  });
  const specExample: JsonObject = {
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: "example-track",
    title: "Spec: example-track",
    description: "Describe the goal and intended outcome in concrete project terms.",
    functional_requirements: [{ heading: "User-visible behavior", body: "State the behavior this track must deliver." }],
    non_functional_requirements: [],
    acceptance_criteria: [{ heading: "Verified outcome", body: "State how completion will be verified." }],
    out_of_scope: [{ heading: "Excluded work", body: "State what this track must not change." }],
  };
  const planExample: JsonObject = {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: "example-track",
    title: "Plan: example-track",
    phases: [
      {
        phase_index: 1,
        title: "Phase 1: Implement",
        execution_mode: "sequential",
        depends_on: [],
        tasks: [
          {
            task_index: 1,
            task_key: "phase1_task1",
            title: "Implement the scoped change",
            status: "pending",
            files: [],
            depends_on: [],
            commit_shas: [],
            repo_shas: {},
          },
        ],
      },
    ],
  };
  const schemas: Record<string, JsonObject> = {
    spec: objectSchema(["schema", "track_id", "title", "description", "functional_requirements", "acceptance_criteria", "out_of_scope"], {
      version: { type: "integer" },
      schema: { const: "cadre.spec.v1" },
      kind: { const: "spec" },
      track_id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      functional_requirements: { type: "array", items: specListItemSchema },
      non_functional_requirements: { type: "array", items: specListItemSchema },
      acceptance_criteria: { type: "array", items: specListItemSchema },
      out_of_scope: { type: "array", items: specListItemSchema },
    }),
    plan: objectSchema(["schema", "track_id", "phases"], {
      version: { type: "integer" },
      schema: { const: "cadre.plan.v1" },
      track_id: { type: "string" },
      title: { type: "string" },
      phases: { type: "array", minItems: 1, items: planPhaseSchema },
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
      release_notes_markdown: { type: "string" },
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
  const schemaIds: Record<string, string> = {
    spec: "cadre.spec.v1",
    plan: "cadre.plan.v1",
    styleguide: "cadre.styleguide.v1",
  };
  const examples: Record<string, JsonObject> = {
    spec: specExample,
    plan: planExample,
  };
  const notes: Record<string, string[]> = {
    spec: [
      "Use canonical snake_case fields; aliases such as functionalRequirements and acceptanceCriteria are rejected by newtrack.",
      "Newtrack requires meaningful goal, outcome, acceptance criteria, and scope before it creates review artifacts.",
    ],
    plan: [
      "Do not send top-level plan.tasks for newtrack; put task objects under plan.phases[].tasks.",
      "Each phase must have a title and at least one task object with a title.",
    ],
  };
  return {
    ok: true,
    artifact: id,
    schema_id: schemaIds[id] || null,
    schema: schemas[id]
      || (["review-evidence", "review_evidence", "provider-evidence", "provider_evidence"].includes(id) ? schemas.evidence : undefined)
      || (["completion-journal", "completion_journal"].includes(id) ? schemas.journal : undefined)
      || schemas.project_doc,
    example: examples[id],
    guidance: notes[id] || [],
    dialect: "https://json-schema.org/draft/2020-12/schema",
  };
}

export function artifactDefinitions(root: string, args: RuntimeArgs = {}): ArtifactDefinition[] {
  const defs: ArtifactDefinition[] = [
    projectionDefinition("product", "product"),
    projectionDefinition("product-guidelines", "product-guidelines"),
    projectionDefinition("workflow", "workflow"),
    projectionDefinition("patterns", "patterns"),
    { id: "tracks-index", title: "Track index", canonical: "cadre/tracks.json", schema: TRACKS_INDEX_SCHEMA, scope: "project", sourceFormat: "json", projectionFormat: "none" },
    projectionDefinition("tech-stack", "tech-stack"),
    { id: "config", title: "Cadre config", canonical: "cadre/config.json", schema: "cadre.config.v1", scope: "project", sourceFormat: "json", projectionFormat: "none" },
    { id: "setup-state", title: "Setup state", canonical: "cadre/setup_state.json", schema: "cadre.setup_state.v1", scope: "project", sourceFormat: "json", projectionFormat: "none" },
  ];
  if (fileExists(path.join(root, "cadre", "repos.json")) || fileExists(path.join(root, "cadre", "repos.md"))) {
    defs.push(projectionDefinition("repository-topology", "repos"));
  }
  if (fileExists(path.join(root, "cadre", "lsp.json"))) {
    defs.push({ id: "lsp-config", title: "LSP config", canonical: "cadre/lsp.json", schema: "cadre.lsp.v1", scope: "project", sourceFormat: "json", projectionFormat: "none" });
  }
  const styleJsonDir = path.join(root, "cadre", "styleguides");
  const styleIds = new Set<string>();
  for (const file of safeReadDir(styleJsonDir)) {
    if (file.endsWith(".json") && file !== "index.json") styleIds.add(path.basename(file, ".json"));
  }
  for (const file of safeReadDir(styleJsonDir)) {
    if (file.endsWith(".md") && file !== "README.md") styleIds.add(path.basename(file, ".md"));
  }
  if (styleIds.size > 0 || fileExists(path.join(styleJsonDir, "index.json")) || fileExists(path.join(styleJsonDir, "README.md"))) {
    defs.push(projectionDefinition("styleguide-catalog", "styleguides-index"));
  }
  for (const id of Array.from(styleIds).sort()) {
    defs.push(projectionDefinition("styleguide", `styleguide:${id}`, { id }, `Style guide: ${id}`));
  }
  const skillsDir = path.join(root, "cadre", "skills");
  for (const id of safeReadDir(skillsDir)) {
    const skillPath = path.join(skillsDir, id, "skill.json");
    if (!fileExists(skillPath)) continue;
    defs.push(projectionDefinition("project-skill", `skill:${id}`, { id }, `Project skill: ${id}`));
  }
  for (const track of listTracks(root)) {
    defs.push(
      { id: `track:${track.track_id}:metadata`, title: `Metadata: ${track.track_id}`, canonical: path.relative(root, track.metadata_path), schema: "cadre.metadata.v1", scope: "track", sourceFormat: "json", projectionFormat: "none" },
      projectionDefinition("track-specification", `track:${track.track_id}:spec`, { trackId: track.track_id }, `Spec: ${track.track_id}`),
      projectionDefinition("track-plan", `track:${track.track_id}:plan`, { trackId: track.track_id }, `Plan: ${track.track_id}`),
      projectionDefinition("track-learnings", `track:${track.track_id}:learnings`, { trackId: track.track_id }, `Learnings: ${track.track_id}`),
      projectionDefinition("track-handoff", `track:${track.track_id}:handoff`, { trackId: track.track_id }, `Handoff: ${track.track_id}`)
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
    defs.push(projectionDefinition("release", `release:${version}`, { version }, `Release - ${version}`));
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
        projectionDefinition("track-specification", `archive:${trackId}:spec`, { trackId, archived: true }, `Archived spec: ${trackId}`),
        projectionDefinition("track-plan", `archive:${trackId}:plan`, { trackId, archived: true }, `Archived plan: ${trackId}`),
        projectionDefinition("track-learnings", `archive:${trackId}:learnings`, { trackId, archived: true }, `Archived learnings: ${trackId}`),
        projectionDefinition("track-handoff", `archive:${trackId}:handoff`, { trackId, archived: true }, `Archived handoff: ${trackId}`)
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
  if (scope === "skills" || scope === "skill") return def.scope === "skill";
  if (scope === "release") return def.scope === "release";
  if (scope === "spec") return def.id.endsWith(":spec");
  if (scope === "plan") return def.id.endsWith(":plan");
  if (scope.startsWith("track:")) return def.id.startsWith(`${scope}:`) || def.id === "tracks-index";
  return def.id === scope || def.scope === scope;
}
