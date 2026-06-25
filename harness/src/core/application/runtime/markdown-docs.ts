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

import { textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { asArray } from "./status";

export function normalizedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
}

export function generatedMarker(source: string, schema: string, body: string): string {
  return `<!-- cadre:generated from="${source}" schema="${schema}" hash="${textHash(body).slice(0, 16)}" -->`;
}

export function withGeneratedMarker(source: string, schema: string, body: string): string {
  const normalized = normalizedText(body);
  return `${generatedMarker(source, schema, normalized)}\n${normalized}`;
}

export function appendCanonicalJsonBlock(parts: string[], value: JsonObject, heading = "Canonical JSON"): void {
  parts.push(`## ${heading}`, "", "```json", JSON.stringify(value, null, 2), "```", "");
}

export function hasGeneratedMarker(text: string): boolean {
  return /<!--\s*cadre:generated\b/.test(text);
}

export function splitMarkdownSections(text: string): { title: string; body: string; sections: JsonObject[] } {
  const lines = normalizedText(text).split("\n");
  const firstHeadingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  const title = firstHeadingIndex >= 0
    ? lines[firstHeadingIndex]?.replace(/^#\s+/, "").trim() || "Untitled"
    : "Untitled";
  const bodyStart = firstHeadingIndex >= 0 ? firstHeadingIndex + 1 : 0;
  const bodyLines: string[] = [];
  const sections: JsonObject[] = [];
  let current: JsonObject | null = null;
  for (const line of lines.slice(bodyStart)) {
    const section = line.match(/^##+\s+(.+?)\s*$/);
    if (section?.[1]) {
      if (current) sections.push(current);
      current = { heading: section[1].trim(), body: "" };
      continue;
    }
    if (current) {
      current.body = `${asOptionalString(current.body) || ""}${line}\n`;
    } else {
      bodyLines.push(line);
    }
  }
  if (current) sections.push(current);
  return {
    title,
    body: normalizedText(bodyLines.join("\n")).trim(),
    sections: sections.map((section) => ({
      heading: asOptionalString(section.heading) || "",
      body: normalizedText(asOptionalString(section.body) || "").trim(),
    })),
  };
}

export function markdownDocJson(kind: string, markdown: string, extras: JsonObject = {}): JsonObject {
  const parsed = splitMarkdownSections(markdown);
  return {
    version: 1,
    schema: `cadre.${kind}.v1`,
    kind,
    title: parsed.title,
    summary: parsed.body,
    sections: parsed.sections,
    updated_at: utcNow(),
    ...extras,
  };
}

export function renderMarkdownDoc(value: JsonObject, fallbackTitle: string): string {
  const title = asOptionalString(value.title) || fallbackTitle;
  const parts: string[] = [`# ${title}`, ""];
  const summary = asOptionalString(value.summary);
  if (summary) parts.push(summary, "");
  for (const rawSection of asArray(value.sections)) {
    const section = asJsonObject(rawSection);
    const heading = asOptionalString(section.heading);
    if (!heading) continue;
    parts.push(`## ${heading}`, "");
    const body = asOptionalString(section.body);
    if (body) parts.push(body, "");
  }
  appendCanonicalJsonBlock(parts, value);
  return normalizedText(parts.join("\n"));
}

export function markerForPlanStatus(status: unknown): string {
  const normalized = String(status || "pending");
  if (normalized === "completed") return "x";
  if (normalized === "in_progress") return "~";
  if (normalized === "blocked") return "!";
  if (normalized === "skipped") return "-";
  return " ";
}
