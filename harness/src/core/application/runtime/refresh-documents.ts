import path from "node:path";
import { asJsonArray, asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { fileExists, readJson, utcNow } from "../../infrastructure/runtime/json-store";
import { readJsonl, renderJsonCodeblock, renderJsonlMarkdown } from "./artifact-actions";
import { readApprovalSession, unapprovedTargetBaselineContent } from "./approval-session-store";
import type { ReviewFile } from "./contracts";
import type { RefreshLevel } from "./refresh-analysis";
import { withGeneratedMarker, renderMarkdownDoc } from "./markdown-docs";
import { renderSemanticProjection, renderTechStackMarkdown } from "./semantic-projections";
import { documentReviewPair, jsonReviewFile, plainReviewFile, textReviewFile } from "./review-bundles";
import { styleGuideReviewFiles } from "./setup-review-files";
import { asArray } from "./status";
import { availableStyleGuideIds, requestedStyleGuideIds, setupStyleGuides } from "./tech-stack";
import { templateJson } from "./workflow-response";

interface ProjectDocumentSpec {
  level: RefreshLevel;
  documentId: string;
  kind: string;
  canonical: string;
  projection: string;
  title: string;
  schema: string;
  source: string;
}

export interface RefreshDocumentsResult {
  files: ReviewFile[];
  documentIds: string[];
  paths: string[];
}

const PROJECT_DOCUMENTS: ProjectDocumentSpec[] = [
  {
    level: "product",
    documentId: "product",
    kind: "product",
    canonical: "cadre/product.json",
    projection: "cadre/product.md",
    title: "Product Context",
    schema: "cadre.product.v1",
    source: "proposedContext.product",
  },
  {
    level: "product-guidelines",
    documentId: "product_guidelines",
    kind: "product_guidelines",
    canonical: "cadre/product_guidelines.json",
    projection: "cadre/product_guidelines.md",
    title: "Product Guidelines",
    schema: "cadre.product_guidelines.v1",
    source: "proposedContext.productGuidelines",
  },
  {
    level: "workflow",
    documentId: "workflow",
    kind: "workflow",
    canonical: "cadre/workflow.json",
    projection: "cadre/workflow.md",
    title: "Project Workflow",
    schema: "cadre.workflow.v1",
    source: "proposedContext.workflowPolicy",
  },
];

function rawArgs(args: RuntimeArgs): UnknownRecord {
  return args as UnknownRecord;
}

function proposedContext(args: RuntimeArgs): JsonObject {
  const raw = rawArgs(args);
  return asJsonObject(raw.proposedContext || raw.proposed_context);
}

export function refreshCandidate(args: RuntimeArgs, level: RefreshLevel): unknown {
  const raw = rawArgs(args);
  const proposed = proposedContext(args);
  switch (level) {
    case "product":
      return raw.product ?? proposed.product;
    case "product-guidelines":
      return raw.productGuidelines ?? raw.product_guidelines ?? proposed.productGuidelines ?? proposed.product_guidelines;
    case "tech-stack":
      return raw.techStack ?? raw.tech_stack ?? proposed.techStack ?? proposed.tech_stack;
    case "style-guides":
      return raw.styleGuideIds ?? raw.style_guide_ids ?? proposed.styleGuideIds ?? proposed.style_guide_ids;
    case "workflow":
      return raw.workflowPolicy ?? raw.workflow_policy ?? proposed.workflowPolicy ?? proposed.workflow_policy ?? proposed.workflow;
    case "patterns":
      return raw.patterns === true ? proposed.patterns : raw.patterns ?? proposed.patterns;
    case "repository-topology":
      return raw.repositoryTopology ?? raw.repository_topology ?? (isRecord(raw.repos) ? raw.repos : undefined)
        ?? proposed.repositoryTopology ?? proposed.repository_topology ?? proposed.repos;
    default:
      return undefined;
  }
}

function meaningfulText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized.length < 4) return false;
  if (["todo", "tbd", "unknown", "placeholder", "fill me", "n a"].includes(normalized)) return false;
  return !/^(?:replace|placeholder|example)(?:\s|$)/.test(normalized);
}

function meaningfulValue(value: unknown): boolean {
  if (meaningfulText(value)) return true;
  if (Array.isArray(value)) return value.some(meaningfulValue);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) =>
    !["version", "schema", "kind", "updated_at", "refreshed_at", "id"].includes(key) && meaningfulValue(entry)
  );
}

function projectDocumentEvidence(value: unknown, templateFile: string): boolean {
  if (!isRecord(value)) return false;
  const candidate = asJsonObject(value);
  const template = templateJson(templateFile, {});
  const directEvidence = Object.entries(candidate).some(([key, entry]) => {
    if (["version", "schema", "kind", "updated_at", "title", "name", "sections"].includes(key)) return false;
    return JSON.stringify(entry) !== JSON.stringify(template[key]) && meaningfulValue(entry);
  });
  if (directEvidence) return true;
  const templateSections = new Map(asArray(template.sections).map(asJsonObject).map((section) => [sectionKey(section), section]));
  return asArray(candidate.sections).map(asJsonObject).some((section) => {
    const text = section.body || section.text || section.summary || section.description;
    return meaningfulValue(text) && !matchesTemplateSection(section, templateSections.get(sectionKey(section)));
  });
}

function patternsEvidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.some(meaningfulValue);
  if (!isRecord(value)) return false;
  const candidate = asJsonObject(value);
  if (Array.isArray(candidate.entries)) return candidate.entries.length > 0 && candidate.entries.some(meaningfulValue);
  const text = asOptionalString(candidate.text || candidate.body || candidate.summary);
  if (!text) return false;
  const evidence = text
    .replace(/^#+\s+.*$/gm, "")
    .replace(/Last refreshed:\s*.*$/gim, "")
    .replace(/^\s*[-*]\s*$/gm, "")
    .trim();
  return meaningfulText(evidence);
}

function topologyEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const candidate = asJsonObject(value);
  const mode = asOptionalString(candidate.mode)?.trim().toLowerCase();
  if (mode === "monorepo") return true;
  const repos = Array.isArray(candidate.repos) ? candidate.repos.map(asJsonObject) : [];
  const completeRepo = repos.some((repo) =>
    meaningfulText(repo.name) && meaningfulText(repo.submodule_path || repo.path || repo.url)
  );
  if (mode === "polyrepo") return meaningfulText(candidate.default_repo) && completeRepo;
  return meaningfulText(candidate.default_repo) && completeRepo;
}

export function refreshCandidateHasEvidence(args: RuntimeArgs, level: RefreshLevel): boolean {
  const candidate = refreshCandidate(args, level);
  if (level === "product") return projectDocumentEvidence(candidate, "product.json");
  if (level === "product-guidelines") return projectDocumentEvidence(candidate, "product_guidelines.json");
  if (level === "workflow") return projectDocumentEvidence(candidate, "workflow.json");
  if (level === "patterns") return patternsEvidence(candidate);
  if (level === "repository-topology") return topologyEvidence(candidate);
  if (level === "tech-stack") return isRecord(candidate) && meaningfulValue(candidate);
  return true;
}

export function missingRefreshEvidence(args: RuntimeArgs, levels: RefreshLevel[]): string[] {
  const expected: Partial<Record<RefreshLevel, string>> = {
    product: "proposedContext.product",
    "product-guidelines": "proposedContext.productGuidelines",
    "tech-stack": "proposedContext.techStack",
    workflow: "proposedContext.workflowPolicy",
    patterns: "proposedContext.patterns",
    "repository-topology": "proposedContext.repos",
  };
  return levels
    .filter((level) => expected[level] && !refreshCandidateHasEvidence(args, level))
    .map((level) => expected[level]!);
}

function sectionKey(value: JsonObject): string {
  return asOptionalString(value.id) || asOptionalString(value.heading)?.toLowerCase() || "";
}

function currentJsonl(root: string, relativePath: string): JsonObject[] {
  const baseline = unapprovedTargetBaselineContent(root, relativePath);
  if (baseline === undefined) return readJsonl(path.join(root, relativePath));
  if (baseline === null) return [];
  return baseline.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      return isRecord(parsed) ? [asJsonObject(parsed)] : [];
    } catch {
      return [];
    }
  });
}

function currentJson(root: string, relativePath: string): JsonObject {
  const baseline = unapprovedTargetBaselineContent(root, relativePath);
  if (baseline === undefined) return readJson<JsonObject>(path.join(root, relativePath), {});
  if (baseline === null) return {};
  try {
    return asJsonObject(JSON.parse(baseline));
  } catch {
    return {};
  }
}

function matchesTemplateSection(current: JsonObject | undefined, template: JsonObject | undefined): boolean {
  if (!current || !template) return false;
  const keys = new Set([...Object.keys(current), ...Object.keys(template)]);
  keys.delete("updated_at");
  return Array.from(keys).every((key) => JSON.stringify(current[key]) === JSON.stringify(template[key]));
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function withoutUpdatedAt(value: JsonObject): JsonObject {
  const normalized = { ...value };
  delete normalized.updated_at;
  return normalized;
}

function stableReviewUpdatedAt(root: string, args: RuntimeArgs, relativePath: string, candidate: JsonObject): string {
  const raw = rawArgs(args);
  const sessionId = asOptionalString(raw.approvalSessionId || raw.approval_session_id);
  const session = sessionId ? readApprovalSession(root, sessionId) : null;
  const snapshot = session?.snapshot_files.find((file) => file.path === relativePath);
  if (snapshot?.content) {
    try {
      const parsed: unknown = JSON.parse(snapshot.content);
      const previous = asJsonObject(parsed);
      const updatedAt = asOptionalString(previous.updated_at);
      if (updatedAt && stableJson(withoutUpdatedAt(previous)) === stableJson(withoutUpdatedAt(candidate))) return updatedAt;
    } catch {
      // A malformed prior preview is replaced by the current canonical renderer.
    }
  }
  return utcNow();
}

function normalizedRefreshProjectDocument(spec: ProjectDocumentSpec, rawValue: unknown, updatedAt: string): JsonObject {
  const raw = asJsonObject(rawValue);
  return {
    ...raw,
    version: 1,
    schema: spec.schema,
    kind: spec.kind,
    title: asOptionalString(raw.title || raw.name || raw.productName || raw.product_name) || spec.title,
    summary: asOptionalString(raw.summary || raw.description) || "",
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    updated_at: updatedAt,
  };
}

function projectDocumentFiles(root: string, args: RuntimeArgs, spec: ProjectDocumentSpec, rawValue: unknown): ReviewFile[] {
  const unstamped = normalizedRefreshProjectDocument(spec, rawValue, "");
  const canonical = { ...unstamped, updated_at: stableReviewUpdatedAt(root, args, spec.canonical, unstamped) };
  const canonicalContent = `${JSON.stringify(canonical, null, 2)}\n`;
  const projection = withGeneratedMarker(
    spec.canonical,
    spec.schema,
    renderSemanticProjection(spec.schema, canonical, spec.title, spec.canonical)
      || renderMarkdownDoc(canonical, spec.title, spec.canonical),
    { canonicalContent, projection: spec.projection }
  );
  return documentReviewPair(
    spec.documentId,
    jsonReviewFile(spec.canonical, `${spec.title} canonical`, spec.source, canonical),
    textReviewFile(spec.projection, spec.title, spec.canonical, projection)
  );
}

function techStackFiles(root: string, args: RuntimeArgs, rawValue: unknown): ReviewFile[] {
  const canonicalPath = "cadre/tech-stack.json";
  const projectionPath = "cadre/tech-stack.md";
  const unstamped: JsonObject = {
    ...asJsonObject(rawValue),
    version: 1,
    schema: "cadre.tech_stack.v1",
  };
  delete unstamped.updated_at;
  const candidate = { ...unstamped, updated_at: stableReviewUpdatedAt(root, args, canonicalPath, unstamped) };
  const canonicalContent = `${JSON.stringify(candidate, null, 2)}\n`;
  const projection = withGeneratedMarker(
    canonicalPath,
    "cadre.tech_stack.v1",
    renderTechStackMarkdown(candidate, canonicalPath),
    { canonicalContent, projection: projectionPath }
  );
  return documentReviewPair(
    "tech_stack",
    jsonReviewFile(canonicalPath, "Tech stack canonical", "proposedContext.techStack", candidate),
    textReviewFile(projectionPath, "Tech stack", canonicalPath, projection)
  );
}

function repositoryTopologyFiles(root: string, args: RuntimeArgs, rawValue: unknown): ReviewFile[] {
  const canonicalPath = "cadre/repos.json";
  const projectionPath = "cadre/repos.md";
  const raw = asJsonObject(rawValue);
  const unstamped: JsonObject = {
    ...raw,
    version: 1,
    schema: "cadre.repos.v1",
  };
  delete unstamped.updated_at;
  const candidate = { ...unstamped, updated_at: stableReviewUpdatedAt(root, args, canonicalPath, unstamped) };
  const canonicalContent = `${JSON.stringify(candidate, null, 2)}\n`;
  const projection = withGeneratedMarker(
    canonicalPath,
    "cadre.repos.v1",
    renderJsonCodeblock("Repository topology", candidate),
    { canonicalContent, projection: projectionPath }
  );
  return documentReviewPair(
    "repos",
    jsonReviewFile(canonicalPath, "Repository topology canonical", "proposedContext.repos", candidate),
    textReviewFile(projectionPath, "Repository topology", canonicalPath, projection)
  );
}

function styleGuideFiles(root: string, args: RuntimeArgs, refreshesTechStack: boolean): ReviewFile[] {
  const rawIds = refreshCandidate(args, "style-guides");
  const currentIds = asStringArray(currentJson(root, "cadre/styleguides/index.json").selected);
  const techStack = refreshesTechStack
    ? refreshCandidate(args, "tech-stack")
    : currentJson(root, "cadre/tech-stack.json");
  const available = new Set(availableStyleGuideIds());
  const requestedIds = rawIds === undefined ? currentIds : requestedStyleGuideIds(rawIds);
  const customIds = requestedIds.filter((id) => (
    !available.has(id) && fileExists(path.join(root, "cadre", "styleguides", `${id}.json`))
  ));
  const styleGuides = setupStyleGuides(root, {
    ...args,
    ...(isRecord(techStack) ? { techStack: asJsonObject(techStack) } : {}),
    ...(rawIds === undefined ? {} : { styleGuideIds: requestedIds }),
  });
  const selected = Array.from(new Set([
    ...asStringArray(styleGuides.selected),
    ...(rawIds === undefined ? currentIds : []),
    ...customIds,
  ])).sort();
  const missing = asStringArray(styleGuides.missing).filter((id) => !customIds.includes(id));
  return styleGuideReviewFiles({
    ...styleGuides,
    selected,
    missing,
    valid: missing.length === 0,
    warnings: missing.length > 0 ? [`Unknown refresh style guide id(s) ignored: ${missing.join(", ")}`] : [],
  }, selected.filter((id) => available.has(id)));
}

function stampedPatternEntries(entries: JsonObject[]): JsonObject[] {
  if (entries.length === 0) return [];
  const now = utcNow();
  const first = { ...entries[0] };
  const field = asOptionalString(first.text) ? "text" : asOptionalString(first.body) ? "body" : asOptionalString(first.summary) ? "summary" : "text";
  const current = asOptionalString(first[field]) || "# Codebase Patterns\n";
  first[field] = refreshedPatternsText(current, now).text;
  first.refreshed_at = now;
  return [first, ...entries.slice(1)];
}

function patternEntries(root: string, rawValue: unknown): JsonObject[] {
  const current = currentJsonl(root, "cadre/patterns.jsonl");
  if (Array.isArray(rawValue)) return stampedPatternEntries(asJsonArray(rawValue).map(asJsonObject));
  const raw = asJsonObject(rawValue);
  if (Array.isArray(raw.entries)) return stampedPatternEntries(asJsonArray(raw.entries).map(asJsonObject));
  const text = asOptionalString(raw.text || raw.body || raw.summary) || "";
  const first = current[0] || { id: "initial", kind: "patterns_seed" };
  return stampedPatternEntries([{ ...first, ...raw, id: raw.id || first.id || "initial", kind: raw.kind || "patterns_refresh", text }, ...current.slice(1)]);
}

export function refreshedPatternsText(text: string, now = utcNow()): { text: string; stamp: string } {
  const stamp = `Last refreshed: ${now.slice(0, 10)}`;
  const next = /Last refreshed:\s*.*/.test(text)
    ? text.replace(/Last refreshed:\s*.*/, stamp)
    : `${text.replace(/\n*$/, "\n\n")}${stamp}\n`;
  return { text: next, stamp };
}

export function refreshedPatternsArtifacts(root: string, args: RuntimeArgs): { files: ReviewFile[]; jsonl: string; projection: string; stamp: string } | null {
  const raw = refreshCandidate(args, "patterns");
  if (!patternsEvidence(raw)) return null;
  const entries = patternEntries(root, raw);
  const jsonl = entries.map((entry) => JSON.stringify(entry)).join("\n").replace(/\n*$/, "\n");
  const projectionPath = "cadre/patterns.md";
  const projection = withGeneratedMarker(
    "cadre/patterns.jsonl",
    "cadre.patterns.v1",
    renderJsonlMarkdown("Project patterns", entries),
    { canonicalContent: jsonl, projection: projectionPath }
  );
  const stamp = asOptionalString(entries[0]?.refreshed_at)?.slice(0, 10) || utcNow().slice(0, 10);
  return {
    files: documentReviewPair(
      "patterns",
      plainReviewFile("cadre/patterns.jsonl", "Project patterns canonical", "proposedContext.patterns", jsonl),
      textReviewFile(projectionPath, "Project patterns", "cadre/patterns.jsonl", projection)
    ),
    jsonl,
    projection,
    stamp: `Last refreshed: ${stamp}`,
  };
}

export function refreshReviewFiles(root: string, args: RuntimeArgs, levels: RefreshLevel[]): RefreshDocumentsResult {
  const files: ReviewFile[] = [];
  for (const spec of PROJECT_DOCUMENTS) {
    if (levels.includes(spec.level)) files.push(...projectDocumentFiles(root, args, spec, refreshCandidate(args, spec.level)));
  }
  if (levels.includes("tech-stack")) files.push(...techStackFiles(root, args, refreshCandidate(args, "tech-stack")));
  if (levels.includes("style-guides")) files.push(...styleGuideFiles(root, args, levels.includes("tech-stack")));
  if (levels.includes("patterns")) files.push(...(refreshedPatternsArtifacts(root, args)?.files || []));
  if (levels.includes("repository-topology")) files.push(...repositoryTopologyFiles(root, args, refreshCandidate(args, "repository-topology")));
  return {
    files,
    documentIds: Array.from(new Set(files.map((file) => file.documentId).filter((value): value is string => Boolean(value)))),
    paths: files.map((file) => file.path),
  };
}
