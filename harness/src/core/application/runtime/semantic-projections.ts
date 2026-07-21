import { asJsonObject, asOptionalString } from "../../../guards";
import type { JsonObject, JsonValue } from "../../../types";

import { appendCanonicalJsonReference, normalizedText } from "./markdown-docs";

interface ProjectionField {
  label: string;
  keys: readonly string[];
}

interface ProjectionSection {
  title: string;
  ids: readonly string[];
  fields: readonly ProjectionField[];
}

const DOCUMENT_METADATA_FIELDS: readonly ProjectionField[] = [
  { label: "Version", keys: ["version"] },
  { label: "Schema", keys: ["schema"] },
  { label: "Kind", keys: ["kind"] },
  { label: "Updated At", keys: ["updated_at"] },
];

const TECH_STACK_SECTIONS: readonly ProjectionSection[] = [
  {
    title: "Languages and Frameworks",
    ids: [],
    fields: [
      { label: "Languages", keys: ["languages", "language"] },
      { label: "Frameworks", keys: ["frameworks", "framework"] },
      { label: "Libraries", keys: ["libraries"] },
    ],
  },
  {
    title: "Runtimes and Platforms",
    ids: [],
    fields: [
      { label: "Runtimes", keys: ["runtimes", "runtime"] },
      { label: "Platforms", keys: ["platforms", "platform"] },
    ],
  },
  {
    title: "Package and Build Tooling",
    ids: [],
    fields: [
      { label: "Package Managers", keys: ["packageManagers", "package_managers"] },
      { label: "Build", keys: ["build"] },
      { label: "Build Command", keys: ["buildCommand", "build_command"] },
    ],
  },
  {
    title: "Testing and Development Commands",
    ids: [],
    fields: [
      { label: "Testing", keys: ["testing", "test"] },
      { label: "Test Command", keys: ["testCommand", "test_command"] },
      { label: "Format Command", keys: ["formatCommand", "format_command"] },
      { label: "Commands", keys: ["commands"] },
    ],
  },
  {
    title: "Data and Services",
    ids: [],
    fields: [
      { label: "Data Stores", keys: ["datastores", "dataStores", "data_stores"] },
      { label: "Database", keys: ["database", "databases"] },
      { label: "Services", keys: ["services"] },
      { label: "Integrations", keys: ["integrations"] },
    ],
  },
  {
    title: "Dependencies and Style Guidance",
    ids: [],
    fields: [
      { label: "Dependencies", keys: ["dependencies"] },
      { label: "Key Dependencies", keys: ["keyDependencies", "key_dependencies"] },
      { label: "Style Guides", keys: ["styleGuideIds", "style_guides", "codeStyleGuides", "code_style_guides"] },
    ],
  },
  {
    title: "Notes",
    ids: [],
    fields: [{ label: "Notes", keys: ["notes"] }],
  },
];

const WORKFLOW_SECTIONS: readonly ProjectionSection[] = [
  {
    title: "Guiding Principles",
    ids: ["guiding_principles"],
    fields: [
      { label: "Principles", keys: ["principles"] },
      { label: "Provider Mode", keys: ["providerMode", "provider_mode"] },
    ],
  },
  {
    title: "Task Lifecycle",
    ids: ["task_lifecycle"],
    fields: [
      { label: "Task Lifecycle", keys: ["taskLifecycle", "task_lifecycle"] },
      { label: "Complete Task Policy", keys: ["completeTaskPolicy", "complete_task_policy"] },
    ],
  },
  {
    title: "Commit Discipline",
    ids: ["commit_discipline"],
    fields: [
      { label: "Commit Policy", keys: ["commitPolicy", "commit_policy"] },
      { label: "Branch Policy", keys: ["branchPolicy", "branch_policy"] },
    ],
  },
  {
    title: "Repository Topology",
    ids: ["polyrepo_notes", "repository_topology"],
    fields: [
      { label: "Topology", keys: ["topology"] },
      { label: "Repositories", keys: ["repos"] },
      { label: "Repository Commands", keys: ["repoCommands", "repo_commands"] },
    ],
  },
  {
    title: "Quality Gates",
    ids: ["quality_gates"],
    fields: [
      { label: "Preferred Test Command", keys: ["preferredTestCommand", "preferred_test_command"] },
      { label: "Test Command", keys: ["testCommand", "test_command"] },
      { label: "Coverage Command", keys: ["coverageCommand", "coverage_command"] },
      { label: "Review Gate", keys: ["reviewGate", "review_gate"] },
      { label: "Review Focus", keys: ["reviewFocus", "review_focus"] },
      { label: "Quality Bar", keys: ["qualityBar", "quality_bar"] },
    ],
  },
  {
    title: "Phase Completion",
    ids: ["phase_completion"],
    fields: [
      { label: "Phase Completion", keys: ["phaseCompletion", "phase_completion"] },
      { label: "Manual Verification", keys: ["manualVerification", "manual_verification"] },
      { label: "Coverage Policy", keys: ["coveragePolicy", "coverage_policy"] },
    ],
  },
  {
    title: "Development Commands",
    ids: ["development_commands"],
    fields: [
      { label: "Format Command", keys: ["formatCommand", "format_command"] },
      { label: "Build Command", keys: ["buildCommand", "build_command"] },
      { label: "Commands", keys: ["commands", "developmentCommands", "development_commands"] },
    ],
  },
];

function own(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
}

function normalizedId(value: unknown): string {
  return (asOptionalString(value) || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\b(Api|Ci|Id|Ids|Json|Lsp|Mcp|Url)\b/g, (word) => word.toUpperCase());
}

function scalarText(value: JsonValue): string | null {
  if (value === null) return "_Not specified._";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value.trim() : "_Empty._";
}

function appendValue(lines: string[], value: JsonValue, indent = 0): void {
  const prefix = " ".repeat(indent);
  const scalar = scalarText(value);
  if (scalar !== null) {
    lines.push(...scalar.split(/\r?\n/).map((line) => `${prefix}${line}`));
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix}_None configured._`);
      return;
    }
    for (const entry of value) {
      const entryScalar = scalarText(entry);
      if (entryScalar !== null && !entryScalar.includes("\n")) lines.push(`${prefix}- ${entryScalar}`);
      else {
        lines.push(`${prefix}-`);
        appendValue(lines, entry, indent + 2);
      }
    }
    return;
  }
  const entries = Object.entries(asJsonObject(value))
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    lines.push(`${prefix}_None configured._`);
    return;
  }
  for (const [key, entry] of entries) {
    const entryScalar = scalarText(entry as JsonValue);
    if (entryScalar !== null && !entryScalar.includes("\n")) lines.push(`${prefix}- **${humanize(key)}:** ${entryScalar}`);
    else {
      lines.push(`${prefix}- **${humanize(key)}:**`);
      appendValue(lines, entry as JsonValue, indent + 2);
    }
  }
}

function fieldLines(value: JsonObject, fields: readonly ProjectionField[], consumed: Set<string>): string[] {
  const lines: string[] = [];
  for (const field of fields) {
    const groups = new Map<string, { keys: string[]; value: JsonValue }>();
    for (const key of field.keys) {
      if (!own(value, key)) continue;
      consumed.add(key);
      const entry = value[key] as JsonValue;
      const fingerprint = JSON.stringify(entry);
      const group = groups.get(fingerprint);
      if (group) group.keys.push(key);
      else groups.set(fingerprint, { keys: [key], value: entry });
    }
    for (const group of groups.values()) {
      const suffix = groups.size > 1 ? ` (${group.keys.join(" / ")})` : "";
      lines.push(`### ${field.label}${suffix}`, "");
      appendValue(lines, group.value);
      lines.push("");
    }
  }
  return lines;
}

function appendSectionContent(lines: string[], section: JsonObject): void {
  const renderedBodyKeys = new Set<string>();
  const renderedBodies = new Set<string>();
  for (const key of ["body", "content", "text"]) {
    const entry = section[key];
    if (typeof entry !== "string" || entry.trim().length === 0) continue;
    renderedBodyKeys.add(key);
    if (renderedBodies.has(entry)) continue;
    renderedBodies.add(entry);
    lines.push(entry.trim(), "");
  }
  const additional = Object.keys(section)
    .filter((key) => !renderedBodyKeys.has(key) && section[key] !== undefined)
    .sort();
  if (additional.length === 0) return;
  lines.push("### Section Details", "");
  for (const key of additional) {
    lines.push(`#### ${humanize(key)}`, "");
    appendValue(lines, section[key] as JsonValue);
    lines.push("");
  }
}

function appendAdditionalDetails(lines: string[], value: JsonObject, consumed: Set<string>): void {
  const additional = Object.keys(value)
    .filter((key) => !consumed.has(key) && value[key] !== undefined)
    .sort();
  if (additional.length === 0) return;
  lines.push("## Additional Details", "");
  for (const key of additional) {
    lines.push(`### ${humanize(key)}`, "");
    appendValue(lines, value[key] as JsonValue);
    lines.push("");
  }
}

function renderStructuredDocument(
  value: JsonObject,
  fallbackTitle: string,
  sections: readonly ProjectionSection[],
  canonicalSource?: string,
  includePersistedSections = false,
): string {
  const declaredTitle = asOptionalString(value.title);
  const title = declaredTitle?.trim() || fallbackTitle;
  const lines: string[] = [`# ${title}`, ""];
  const summary = asOptionalString(value.summary);
  const consumed = new Set<string>();
  if (declaredTitle?.trim()) consumed.add("title");
  if (summary?.trim()) {
    consumed.add("summary");
    lines.push(summary.trim(), "");
  }
  const metadata = fieldLines(value, DOCUMENT_METADATA_FIELDS, consumed);
  if (metadata.length > 0) lines.push("## Document Metadata", "", ...metadata);
  const persisted = Array.isArray(value.sections) ? value.sections.map(asJsonObject) : [];
  if (includePersistedSections && Array.isArray(value.sections)) consumed.add("sections");
  const renderedSections = new Set<number>();
  for (const spec of sections) {
    const ids = new Set([normalizedId(spec.title), ...spec.ids.map(normalizedId)]);
    const matches = includePersistedSections
      ? persisted.map((section, index) => ({ section, index })).filter(({ section }) => ids.has(normalizedId(section.id || section.heading)))
      : [];
    const structured = fieldLines(value, spec.fields, consumed);
    if (matches.length === 0 && structured.length === 0) continue;
    lines.push(`## ${spec.title}`, "");
    for (const match of matches) {
      renderedSections.add(match.index);
      appendSectionContent(lines, match.section);
    }
    lines.push(...structured);
  }
  if (includePersistedSections) {
    persisted.forEach((section, index) => {
      if (renderedSections.has(index)) return;
      lines.push(`## ${asOptionalString(section.heading) || asOptionalString(section.id) || `Section ${index + 1}`}`, "");
      appendSectionContent(lines, section);
    });
  }
  appendAdditionalDetails(lines, value, consumed);
  appendCanonicalJsonReference(lines, canonicalSource);
  return normalizedText(lines.join("\n"));
}

export function renderTechStackMarkdown(value: JsonObject, canonicalSource = "cadre/tech-stack.json"): string {
  return renderStructuredDocument(value, "Tech Stack", TECH_STACK_SECTIONS, canonicalSource, true);
}

export function renderWorkflowMarkdown(value: JsonObject, fallbackTitle = "Project Workflow", canonicalSource = "cadre/workflow.json"): string {
  return renderStructuredDocument(value, fallbackTitle, WORKFLOW_SECTIONS, canonicalSource, true);
}

export function renderSemanticProjection(
  schema: string,
  value: JsonObject,
  fallbackTitle: string,
  canonicalSource?: string,
): string | null {
  if (schema === "cadre.tech_stack.v1") return renderTechStackMarkdown(value, canonicalSource);
  if (schema === "cadre.workflow.v1") return renderWorkflowMarkdown(value, fallbackTitle, canonicalSource);
  return null;
}
