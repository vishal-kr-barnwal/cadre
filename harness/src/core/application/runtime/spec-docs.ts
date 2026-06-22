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

import { compactLines } from "./text-utils";
import { utcNow } from "../../infrastructure/runtime/json-store";
import { normalizedText, splitMarkdownSections } from "./markdown-docs";
import { asArray } from "./status";

export function normalizedSpecHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function specSectionKind(heading: string): "description" | "functional_requirements" | "non_functional_requirements" | "acceptance_criteria" | "out_of_scope" | null {
  const normalized = normalizedSpecHeading(heading);
  if (["description", "summary", "overview", "goal", "goals", "objective", "objectives", "context", "problem"].includes(normalized)) {
    return "description";
  }
  if ([
    "functional requirements",
    "functional requirement",
    "fr",
    "requirements",
    "requirement",
    "user facing behavior",
    "user facing behaviours",
    "user behavior",
    "user behaviour",
    "behavior",
    "behaviour",
  ].includes(normalized)) {
    return "functional_requirements";
  }
  if ([
    "non functional requirements",
    "non functional requirement",
    "nonfunctional requirements",
    "nonfunctional requirement",
    "nfr",
    "constraints",
    "constraint",
    "quality attributes",
    "quality attribute",
    "performance requirements",
    "security requirements",
  ].includes(normalized)) {
    return "non_functional_requirements";
  }
  if (["acceptance criteria", "acceptance criterion", "acceptance", "success criteria", "definition of done", "done"].includes(normalized)) {
    return "acceptance_criteria";
  }
  if (["out of scope", "out scope", "out of scopes", "non goals", "non goal", "nongoals", "exclusions", "exclusion"].includes(normalized)) {
    return "out_of_scope";
  }
  return null;
}

export function cleanSpecItem(value: JsonObject): JsonObject | null {
  const heading = compactLines(asOptionalString(value.heading || value.title || value.name) || "", 240);
  const body = normalizedText(asOptionalString(value.body || value.description || value.text) || "").trim();
  if (!heading && !body) return null;
  return { heading: heading || "Item", body };
}

export function parseSpecListItem(line: string): JsonObject {
  const text = line.trim();
  const bold = text.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
  const keyed = !bold ? text.match(/^(.+?)\s*(?::|\s+-\s+|\s+--\s+|\s+—\s+)\s*(.+)$/) : null;
  if (bold?.[1]) return { heading: bold[1].trim(), body: (bold[2] || "").trim() };
  if (keyed?.[1]) return { heading: keyed[1].trim(), body: (keyed[2] || "").trim() };
  return { heading: text, body: "" };
}

export function parseSpecListItems(body: string, fallbackHeading: string): JsonObject[] {
  const lines = normalizedText(body).split("\n");
  const items: JsonObject[] = [];
  let current: JsonObject | null = null;
  const pushCurrent = (): void => {
    if (!current) return;
    const cleaned = cleanSpecItem(current);
    if (cleaned) items.push(cleaned);
    current = null;
  };
  for (const rawLine of lines) {
    const bullet = rawLine.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (bullet?.[1]) {
      pushCurrent();
      current = parseSpecListItem(bullet[1]);
      continue;
    }
    const text = rawLine.trim();
    if (!text) continue;
    if (!current) {
      current = { heading: fallbackHeading, body: text };
      continue;
    }
    const existing = asOptionalString(current.body) || "";
    current.body = existing ? `${existing}\n${text}` : text;
  }
  pushCurrent();
  if (items.length > 0) return items;
  const fallbackBody = normalizedText(body).trim();
  return fallbackBody ? [{ heading: fallbackHeading, body: fallbackBody }] : [];
}

export function specItemsFromRaw(value: unknown): JsonObject[] {
  return asArray(value)
    .map((entry) => {
      if (typeof entry === "string") return cleanSpecItem({ heading: entry, body: "" });
      return cleanSpecItem(asJsonObject(entry));
    })
    .filter((entry): entry is JsonObject => Boolean(entry));
}

export function specJsonFromText(trackId: string, text: string): JsonObject {
  const parsed = splitMarkdownSections(text || `# Spec: ${trackId}\n`);
  const descriptionParts = [parsed.body].filter(Boolean);
  const functionalRequirements: JsonObject[] = [];
  const nonFunctionalRequirements: JsonObject[] = [];
  const acceptanceCriteria: JsonObject[] = [];
  const outOfScope: JsonObject[] = [];
  for (const rawSection of parsed.sections) {
    const section = asJsonObject(rawSection);
    const heading = asOptionalString(section.heading) || "";
    const body = asOptionalString(section.body) || "";
    const kind = specSectionKind(heading);
    if (kind === "description") descriptionParts.push(body);
    else if (kind === "functional_requirements") functionalRequirements.push(...parseSpecListItems(body, heading));
    else if (kind === "non_functional_requirements") nonFunctionalRequirements.push(...parseSpecListItems(body, heading));
    else if (kind === "acceptance_criteria") acceptanceCriteria.push(...parseSpecListItems(body, heading));
    else if (kind === "out_of_scope") outOfScope.push(...parseSpecListItems(body, heading));
    else if (body) descriptionParts.push(`### ${heading}\n\n${body}`);
  }
  return {
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: trackId,
    title: parsed.title,
    description: descriptionParts.join("\n\n").trim(),
    functional_requirements: functionalRequirements,
    non_functional_requirements: nonFunctionalRequirements,
    acceptance_criteria: acceptanceCriteria,
    out_of_scope: outOfScope,
    updated_at: utcNow(),
  };
}

export function normalizedSpecFromRaw(raw: JsonObject): JsonObject {
  if (asOptionalString(raw.description)
    || asArray(raw.functional_requirements).length > 0
    || asArray(raw.non_functional_requirements).length > 0
    || asArray(raw.acceptance_criteria).length > 0
    || asArray(raw.out_of_scope).length > 0) {
    return {
      ...raw,
      description: asOptionalString(raw.description || raw.summary) || "",
      functional_requirements: specItemsFromRaw(raw.functional_requirements),
      non_functional_requirements: specItemsFromRaw(raw.non_functional_requirements),
      acceptance_criteria: specItemsFromRaw(raw.acceptance_criteria),
      out_of_scope: specItemsFromRaw(raw.out_of_scope),
    };
  }
  const title = asOptionalString(raw.title) || `Spec: ${asOptionalString(raw.track_id) || "track"}`;
  const parts = [`# ${title}`, ""];
  const summary = asOptionalString(raw.summary);
  if (summary) parts.push(summary, "");
  for (const rawSection of asArray(raw.sections)) {
    const section = asJsonObject(rawSection);
    const heading = asOptionalString(section.heading);
    const body = asOptionalString(section.body);
    if (heading && body) parts.push(`## ${heading}`, "", body, "");
  }
  return specJsonFromText(asOptionalString(raw.track_id) || "track", parts.join("\n"));
}

export function appendSpecItemSection(parts: string[], heading: string, items: JsonObject[]): void {
  if (items.length === 0) return;
  parts.push(`## ${heading}`, "");
  for (const item of items) {
    const itemHeading = asOptionalString(item.heading) || "Item";
    const body = normalizedText(asOptionalString(item.body) || "").trim();
    if (!body) {
      parts.push(`- ${itemHeading}`);
      continue;
    }
    if (!body.includes("\n")) {
      parts.push(`- **${itemHeading}**: ${body}`);
      continue;
    }
    parts.push(`- **${itemHeading}**`);
    for (const line of body.split("\n")) {
      parts.push(line.trim() ? `  ${line}` : "");
    }
  }
  parts.push("");
}

export function renderSpecMarkdown(raw: JsonObject): string {
  const spec = normalizedSpecFromRaw(raw);
  const title = asOptionalString(spec.title) || `Spec: ${asOptionalString(spec.track_id) || "track"}`;
  const parts = [`# ${title}`, ""];
  const description = asOptionalString(spec.description);
  if (description) parts.push("## Description", "", description, "");
  appendSpecItemSection(parts, "Functional Requirements", specItemsFromRaw(spec.functional_requirements));
  appendSpecItemSection(parts, "Non-Functional Requirements", specItemsFromRaw(spec.non_functional_requirements));
  appendSpecItemSection(parts, "Acceptance Criteria", specItemsFromRaw(spec.acceptance_criteria));
  appendSpecItemSection(parts, "Out Of Scope", specItemsFromRaw(spec.out_of_scope));
  return normalizedText(parts.join("\n"));
}

export function renderStyleGuideMarkdown(raw: JsonObject): string {
  const id = asOptionalString(raw.id) || "styleguide";
  const title = asOptionalString(raw.title) || id;
  const parts = [`# ${title}`, ""];
  const summary = asOptionalString(raw.summary);
  if (summary) parts.push(summary, "");
  const rules = asArray(raw.rules);
  if (rules.length > 0) {
    parts.push("## Rules", "");
    for (const rawRule of rules) {
      const rule = asJsonObject(rawRule);
      const severity = asOptionalString(rule.severity);
      const suffix = severity ? ` (${severity})` : "";
      parts.push(`- ${asOptionalString(rule.summary) || asOptionalString(rule.id) || "Rule"}${suffix}`);
      const rationale = asOptionalString(rule.rationale);
      if (rationale) parts.push(`  Rationale: ${rationale}`);
    }
    parts.push("");
  }
  for (const rawSection of asArray(raw.sections)) {
    const section = asJsonObject(rawSection);
    const heading = asOptionalString(section.heading);
    const body = asOptionalString(section.body);
    if (heading && body) parts.push(`## ${heading}`, "", body, "");
  }
  return normalizedText(parts.join("\n"));
}
