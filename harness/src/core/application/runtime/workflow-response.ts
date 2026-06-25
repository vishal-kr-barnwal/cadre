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

import { CoreResult } from "./contracts";
import { utcNow } from "../../infrastructure/runtime/json-store";
import { normalizePlanManualVerification } from "./plan-docs";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { syncControlPlane } from "./review-records";
import { normalizedSpecFromRaw } from "./spec-docs";
import { asArray } from "./status";
import { gitIdentity } from "../../infrastructure/runtime/system";
import { packagedTemplateJson, packagedTemplatePath, packagedTemplatePaths, packagedTemplateSource, packagedTemplateText } from "./packaged-assets";
import { compactWorkflowResponse } from "./response-compaction";

export function workflowResponseMode(args: RuntimeArgs = {}): "compact" | "detail" {
  const raw = asOptionalString(args.responseMode || args.response_mode
    || (args.detail === true ? "detail" : null)
    || (args.compact === true ? "compact" : null))?.trim().toLowerCase();
  if (raw && ["detail", "detailed", "full", "verbose"].includes(raw)) return "detail";
  return "compact";
}

export function workflowSummary(root: string, workflow: string, args: RuntimeArgs = {}): CoreResult {
  const identity = gitIdentity(root);
  return {
    root,
    workflow,
    packet_only: true,
    execute: args.execute === true,
    phase_state: args.execute === true ? "executed" : "dry_run",
    response_mode: workflowResponseMode(args),
    detail_available: true,
    identity,
    generated_at: utcNow(),
  };
}

export function resultOk(value: CoreResult | null | undefined): boolean {
  return !value || value.ok !== false;
}

export function withSharedControlPlaneSync(root: string, args: RuntimeArgs = {}, operation: string, fn: () => CoreResult): CoreResult {
  const topology = loadTopology(root);
  if (args.execute !== true || topology.config.sync_mode !== "shared" || (args as UnknownRecord).skipSync === true) {
    return fn();
  }
  const syncPre = syncControlPlane(root, { mode: "pre" });
  if (syncPre.ok === false) {
    return {
      ok: false,
      phase_state: "blocked",
      stage: "sync_pre",
      operation,
      sync_pre: syncPre,
    };
  }
  const result = fn();
  if (result.ok === false) {
    return {
      ...result,
      sync_pre: syncPre,
      sync_post: null,
    };
  }
  const syncPost = syncControlPlane(root, { mode: "post" });
  return {
    ...result,
    ok: resultOk(result) && syncPost.ok !== false,
    phase_state: syncPost.ok === false ? "recovery_required" : result.phase_state,
    sync_pre: syncPre,
    sync_post: syncPost,
  };
}

export function compactObject(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const limit = depth === 0 ? 80 : 25;
    return value.slice(0, limit).map((item) => compactObject(item, depth + 1));
  }
  const source = asJsonObject(value);
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key === "content" && typeof entry === "string" && entry.length > 800) {
      out[key] = `${entry.slice(0, 800)}\n...[truncated; request responseMode:\"detail\" for full content]`;
      continue;
    }
    if (key === "plan" && isRecord(entry)) {
      const plan = asJsonObject(entry);
      out[key] = {
        ok: plan.ok,
        phases: Array.isArray(plan.phases) ? plan.phases.length : 0,
        tasks: Array.isArray(plan.tasks) ? plan.tasks.length : 0,
        warnings: Array.isArray(plan.warnings) ? plan.warnings.length : 0,
        errors: Array.isArray(plan.errors) ? plan.errors.length : 0,
      };
      continue;
    }
    if (["stdout", "stderr"].includes(key) && typeof entry === "string" && entry.length > 1200) {
      out[`${key}_tail`] = entry.slice(-1200);
      out[`${key}_truncated`] = true;
      continue;
    }
    if (["repo_diffs", "repo_todos", "commands", "results"].includes(key) && Array.isArray(entry)) {
      out[key] = entry.slice(0, 20).map((item) => compactObject(item, depth + 1)) as JsonObject[];
      out[`${key}_count`] = entry.length;
      out[`${key}_truncated`] = entry.length > 20;
      continue;
    }
    out[key] = depth > 5 ? "[depth-limit]" : compactObject(entry, depth + 1) as JsonObject | string | number | boolean | null | JsonObject[];
  }
  return out;
}

export function workflowResourceUris(root: string, workflow: string, result: CoreResult): string[] {
  const encodedRoot = encodeURIComponent(root);
  const trackId = asOptionalString(result.track_id)
    || asOptionalString(asJsonObject(result.track || {}).track_id)
    || asOptionalString(asJsonObject(asJsonObject(result.track_context).track).track_id);
  const uris = [
    `cadre://workspace-health?root=${encodedRoot}`,
    `cadre://mcp-readiness?root=${encodedRoot}`,
    `cadre://team-board?root=${encodedRoot}`,
    `cadre://quality-gate?root=${encodedRoot}${trackId ? `&trackId=${encodeURIComponent(trackId)}` : ""}`,
  ];
  if (trackId) {
    uris.push(`cadre://track-context?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
    uris.push(`cadre://parallel-state?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
  }
  if (workflow === "ship" && trackId) uris.push(`cadre://ship-plan?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
  if (workflow === "land" && trackId) uris.push(`cadre://land-plan?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
  if (workflow === "release") uris.push(`cadre://release-plan?root=${encodedRoot}`);
  if (workflow === "artifacts" || workflow === "artifact_sync") {
    const scope = asOptionalString(result.scope || result.artifact_scope) || "all";
    uris.push(`cadre://artifact-catalog?root=${encodedRoot}`);
    uris.push(`cadre://artifact-sync-plan?root=${encodedRoot}&scope=${encodeURIComponent(scope)}`);
    if (scope.startsWith("track:")) {
      const scopedTrackId = scope.slice("track:".length);
      uris.push(`cadre://track-spec?root=${encodedRoot}&trackId=${encodeURIComponent(scopedTrackId)}`);
      uris.push(`cadre://track-plan?root=${encodedRoot}&trackId=${encodeURIComponent(scopedTrackId)}`);
    }
  }
  return Array.from(new Set(uris));
}

export function shapeWorkflowResponse(root: string, workflow: string, args: RuntimeArgs, result: CoreResult): CoreResult {
  const mode = workflowResponseMode(args);
  const enriched = {
    ...result,
    response_mode: mode,
    detail_available: true,
    resource_uris: workflowResourceUris(root, workflow, result),
  };
  if (mode === "detail") return enriched;
  const workflowSpecific = compactWorkflowResponse(workflow, enriched);
  if (workflowSpecific) return workflowSpecific;
  return compactObject(enriched) as CoreResult;
}

export function templatePath(relativePath: string): string | null {
  return packagedTemplatePath(relativePath);
}

export function templateText(relativePath: string, fallback: string): string {
  return packagedTemplateText(relativePath) ?? fallback;
}

export function templateSourceLabel(relativePath: string): string | null {
  return packagedTemplateSource(relativePath);
}

export function templateRelativePaths(prefix = ""): string[] {
  return packagedTemplatePaths(prefix);
}

export function packetText(value: unknown, fallback: string): string {
  const text = asOptionalString(value);
  return (text && text.trim() ? text : fallback).replace(/\n*$/, "\n");
}

export const MARKDOWN_PAYLOAD_FIELDS = [
  "productText",
  "productGuidelinesText",
  "product_guidelines_text",
  "workflowText",
  "specText",
  "planText",
  "planPath",
];

export function markdownPayloadError(args: RuntimeArgs = {}): CoreResult | null {
  const raw = args as UnknownRecord;
  const provided = MARKDOWN_PAYLOAD_FIELDS.filter((field) => raw[field] !== undefined);
  if (provided.length === 0) return null;
  return {
    ok: false,
    error: `Markdown payload fields are not supported: ${provided.join(", ")}. Use structured JSON fields instead.`,
    unsupported_fields: provided,
    expected_fields: ["product", "productGuidelines", "workflowPolicy", "spec", "plan"],
  };
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

function stringList(value: unknown): string[] {
  return asStringArray(value).filter((item) => item.trim().length > 0);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asOptionalString(value);
    if (text) return text;
  }
  return null;
}

function appendLines(lines: string[], heading: string, values: string[]): void {
  if (values.length === 0) return;
  if (lines.length > 0) lines.push("");
  lines.push(`${heading}:`, bulletList(values));
}

function productSectionBody(heading: string, provided: JsonObject, fallback: string): string {
  const lines: string[] = [];
  const name = firstString(provided.name, provided.productName, provided.product_name, provided.title);
  const summary = firstString(provided.summary, provided.description, provided.notes);
  switch (heading.toLowerCase()) {
    case "product summary":
      if (name) lines.push(`- What the product is: ${name}`);
      if (summary) lines.push(`- Primary value proposition: ${summary}`);
      appendLines(lines, "Primary users", stringList(provided.users));
      break;
    case "users and personas":
      appendLines(lines, "Primary users", stringList(provided.users));
      break;
    case "core workflows":
      appendLines(lines, "Product goals", stringList(provided.goals));
      appendLines(lines, "Primary workflows", stringList(provided.workflows || provided.coreWorkflows || provided.core_workflows));
      break;
    case "product invariants":
      appendLines(lines, "Product invariants", stringList(provided.invariants || provided.productInvariants || provided.product_invariants));
      appendLines(lines, "Non-goals", stringList(provided.nonGoals || provided.non_goals));
      break;
    case "architecture boundaries":
      appendLines(lines, "Architecture boundaries", stringList(provided.boundaries || provided.architectureBoundaries || provided.architecture_boundaries));
      break;
    case "data and integrations":
      appendLines(lines, "Data stores", stringList(provided.dataStores || provided.data_stores || provided.datastores));
      appendLines(lines, "Integrations", stringList(provided.integrations));
      break;
    case "quality and release expectations":
      appendLines(lines, "Quality expectations", stringList(provided.qualityBar || provided.quality_bar || provided.qualityExpectations || provided.quality_expectations));
      break;
    case "open questions":
      appendLines(lines, "Open questions", stringList(provided.openQuestions || provided.open_questions));
      break;
    default:
      break;
  }
  return lines.length > 0 ? lines.join("\n") : fallback;
}

function productGuidelinesSectionBody(heading: string, provided: JsonObject, fallback: string): string {
  const lines: string[] = [];
  switch (heading.toLowerCase()) {
    case "product principles":
      appendLines(lines, "Principles", stringList(provided.principles));
      break;
    case "user promises":
      appendLines(lines, "User promises", stringList(provided.userPromises || provided.user_promises || provided.promises));
      break;
    case "trust and safety boundaries":
      appendLines(lines, "Trust and safety boundaries", stringList(provided.trustAndSafety || provided.trust_and_safety || provided.safety || provided.boundaries));
      break;
    case "domain and workflow rules":
      appendLines(lines, "Domain and workflow rules", stringList(provided.rules || provided.domainRules || provided.domain_rules || provided.workflowRules || provided.workflow_rules));
      break;
    case "data ownership":
      appendLines(lines, "Data ownership", stringList(provided.dataOwnership || provided.data_ownership));
      break;
    case "non-goals":
      appendLines(lines, "Non-goals", stringList(provided.nonGoals || provided.non_goals));
      break;
    case "decision rules":
      appendLines(lines, "Decision rules", stringList(provided.decisionRules || provided.decision_rules));
      break;
    case "review checklist":
      appendLines(lines, "Quality bar", stringList(provided.qualityBar || provided.quality_bar || provided.reviewChecklist || provided.review_checklist));
      break;
    default:
      break;
  }
  return lines.length > 0 ? lines.join("\n") : fallback;
}

function workflowSectionBody(heading: string, provided: JsonObject, fallback: string): string {
  const lines: string[] = [];
  const preferredTestCommand = firstString(provided.preferredTestCommand, provided.preferred_test_command, provided.testCommand, provided.test_command);
  const reviewGate = firstString(provided.reviewGate, provided.review_gate);
  const providerMode = firstString(provided.providerMode, provided.provider_mode);
  switch (heading.toLowerCase()) {
    case "quality gates":
      if (reviewGate) lines.push(`- Review gate: ${reviewGate}`);
      if (preferredTestCommand) lines.push(`- Preferred test command: \`${preferredTestCommand}\``);
      break;
    case "development commands":
      if (preferredTestCommand) lines.push(`- Preferred test command: \`${preferredTestCommand}\``);
      appendLines(lines, "Additional commands", stringList(provided.commands || provided.developmentCommands || provided.development_commands));
      break;
    case "guiding principles":
      appendLines(lines, "Project workflow principles", stringList(provided.principles));
      if (providerMode) lines.push(`- Provider mode: ${providerMode}`);
      break;
    default:
      break;
  }
  return lines.length > 0 ? lines.join("\n") : fallback;
}

function hydrateTemplateSections(kind: string, templateSections: JsonObject[], provided: JsonObject): JsonObject[] {
  if (Object.keys(provided).length === 0) return templateSections;
  return templateSections.map((section) => {
    const heading = asOptionalString(section.heading) || "";
    const fallback = asOptionalString(section.body) || "";
    const body = kind === "product"
      ? productSectionBody(heading, provided, fallback)
      : kind === "product_guidelines"
        ? productGuidelinesSectionBody(heading, provided, fallback)
        : kind === "workflow"
          ? workflowSectionBody(heading, provided, fallback)
          : fallback;
    return { ...section, body };
  });
}

export function normalizeProjectDoc(kind: string, raw: unknown, templateFile: string, fallbackTitle: string, notesHeading: string): JsonObject {
  const template = templateJson(templateFile, {
    version: 1,
    schema: `cadre.${kind}.v1`,
    kind,
    title: fallbackTitle,
    summary: "",
    sections: [],
  });
  const provided = isRecord(raw) ? asJsonObject(raw) : {};
  const templateSections = asArray(template.sections).map(asJsonObject);
  const providedSections = asArray(provided.sections).map(asJsonObject);
  const providedSummary = asOptionalString(provided.summary || provided.description || provided.notes);
  const sections = providedSections.length > 0
    ? providedSections
    : [
        ...hydrateTemplateSections(kind, templateSections, provided),
        ...(providedSummary && isRecord(raw) ? [{ heading: notesHeading, body: providedSummary }] : []),
      ];
  return {
    ...template,
    ...provided,
    version: 1,
    schema: `cadre.${kind}.v1`,
    kind,
    title: asOptionalString(provided.title || provided.name || provided.productName || provided.product_name) || asOptionalString(template.title) || fallbackTitle,
    summary: asOptionalString(provided.summary || provided.description) || asOptionalString(template.summary) || "",
    sections,
    updated_at: utcNow(),
  };
}

export function normalizeSpecJson(trackId: string, raw: unknown): JsonObject {
  const spec = normalizedSpecFromRaw({
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: trackId,
    title: `Spec: ${trackId}`,
    ...asJsonObject(raw),
  });
  return {
    ...spec,
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: trackId,
    updated_at: utcNow(),
  };
}

export function normalizePlanJson(trackId: string, raw: unknown, specJson?: JsonObject | null): JsonObject {
  const plan = {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: trackId,
    title: `Plan: ${trackId}`,
    ...asJsonObject(raw),
  };
  return normalizePlanManualVerification({ ...plan, track_id: trackId }, specJson);
}

export function templateJson(relativePath: string, fallback: JsonObject): JsonObject {
  return packagedTemplateJson(relativePath) || fallback;
}

export function templateManifest(): JsonObject {
  return templateJson("manifest.json", { templates: [] });
}
