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
import { readJson } from "../../infrastructure/runtime/json-store";
import { templateRelativePaths } from "./workflow-response";

export function availableStyleGuideIds(): string[] {
  return templateRelativePaths("styleguides")
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.basename(file, ".json"))
    .sort();
}

export function normalizeStyleGuideId(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^.*code_styleguides\//, "")
    .replace(/^.*styleguides\//, "")
    .replace(/\.(md|json)$/i, "")
    .toLowerCase();
}

export function requestedStyleGuideIds(value: unknown): string[] {
  const raw = typeof value === "string"
    ? value.split(/[,\s]+/)
    : asStringArray(value);
  return Array.from(new Set(raw.map(normalizeStyleGuideId).filter(Boolean))).sort();
}

export function collectTechStackTokens(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectTechStackTokens);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...collectTechStackTokens(entry)]);
}

export function techStackStyleGuideOverrides(techStack: JsonObject): string[] {
  return requestedStyleGuideIds(
    techStack.styleGuideIds
      || techStack.style_guides
      || techStack.codeStyleGuides
      || techStack.code_style_guides
  );
}

export function styleGuideIdsForTechStack(techStack: JsonObject): string[] {
  const tokens = collectTechStackTokens(techStack)
    .map((item) => item.toLowerCase().replace(/[^a-z0-9+#.-]+/g, " ").trim())
    .filter(Boolean);
  const tokenText = ` ${tokens.join(" ")} `;
  const detected = new Set<string>();
  const add = (id: string): void => {
    detected.add(id);
  };
  const has = (pattern: RegExp): boolean => pattern.test(tokenText);
  if (has(/\b(?:typescript|tsx|ts)\b/)) add("typescript");
  if (!detected.has("typescript") && has(/\b(?:javascript|node\.?js|js|jsx)\b/)) add("javascript");
  if (has(/\b(?:html|css|scss|sass|less|tailwind|frontend|web)\b/)) add("html-css");
  if (has(/\b(?:python|pytest|django|flask|fastapi)\b/)) add("python");
  if (has(/\b(?:go|golang)\b/)) add("go");
  if (has(/\b(?:rust|cargo)\b/)) add("rust");
  if (has(/\b(?:dart|flutter)\b/)) {
    add("dart");
    if (has(/\bflutter\b/)) add("flutter");
  }
  if (has(/\b(?:kotlin|gradle|jvm)\b/)) add("kotlin");
  if (has(/\b(?:android|jetpack compose)\b/)) add("android");
  if (has(/\b(?:compose multiplatform|kotlin multiplatform|kmp)\b/)) {
    add("compose-multiplatform");
    add("kotlin");
  }
  if (has(/\b(?:swift|swiftui|ios|macos)\b/)) {
    add("swift");
    if (has(/\bswiftui\b/)) add("swiftui");
  }
  return Array.from(new Set([...detected, ...techStackStyleGuideOverrides(techStack)])).sort();
}

export function techStackFromArgs(args: RuntimeArgs = {}): JsonObject | null {
  return isRecord((args as UnknownRecord).techStack) ? asJsonObject((args as UnknownRecord).techStack) : null;
}

export function loadTechStack(root: string): JsonObject | null {
  return readJson<JsonObject | null>(path.join(root, "cadre", "tech-stack.json"), null);
}

export function techStackForPacket(root: string, args: RuntimeArgs = {}): JsonObject | null {
  return techStackFromArgs(args) || loadTechStack(root);
}

export function summarizeList(label: string, value: unknown): string | null {
  const values = collectTechStackTokens(value)
    .filter((item) => item !== label)
    .slice(0, 12);
  return values.length > 0 ? `${label}: ${values.join(", ")}` : null;
}

export function techStackSummary(root: string, args: RuntimeArgs = {}): CoreResult {
  const techStack = techStackForPacket(root, args);
  if (!techStack) {
    return {
      ok: false,
      root,
      path: path.relative(root, path.join(root, "cadre", "tech-stack.json")),
      error: "Missing structured tech stack: cadre/tech-stack.json",
    };
  }
  const lines = [
    summarizeList("languages", techStack.languages),
    summarizeList("frameworks", techStack.frameworks),
    summarizeList("runtimes", techStack.runtimes),
    summarizeList("platforms", techStack.platforms),
    summarizeList("packageManagers", techStack.packageManagers || techStack.package_managers),
    summarizeList("build", techStack.build),
    summarizeList("test", techStack.test),
    summarizeList("datastores", techStack.datastores),
    summarizeList("services", techStack.services),
    summarizeList("styleGuideIds", techStackStyleGuideOverrides(techStack)),
  ].filter((line): line is string => Boolean(line));
  return {
    ok: true,
    root,
    path: path.relative(root, path.join(root, "cadre", "tech-stack.json")),
    techStack,
    styleGuideIds: styleGuideIdsForTechStack(techStack),
    summary: lines.length > 0 ? lines.join("\n") : "No tech stack details recorded.",
  };
}

export function setupStyleGuides(root: string, args: RuntimeArgs = {}): CoreResult {
  const available = new Set(availableStyleGuideIds());
  const techStack = techStackForPacket(root, args) || {};
  const detected = styleGuideIdsForTechStack(techStack).filter((id) => available.has(id));
  const requested = requestedStyleGuideIds((args as UnknownRecord).styleGuideIds);
  const missing = requested.filter((id) => !available.has(id));
  const selected = Array.from(new Set([
    ...(available.has("general") ? ["general"] : []),
    ...detected,
    ...requested.filter((id) => available.has(id)),
  ])).sort();
  return {
    ok: true,
    valid: missing.length === 0,
    detected,
    requested,
    selected,
    written: [],
    skipped: [],
    missing,
    warnings: missing.length > 0 ? [`Unknown setup style guide id(s) ignored: ${missing.join(", ")}`] : [],
    source: "tech-stack.json",
  };
}

export function humanReviewConfirmed(args: RuntimeArgs = {}): boolean {
  const rawArgs = args as UnknownRecord;
  return rawArgs.approvalComplete === true || rawArgs.approval_complete === true;
}
