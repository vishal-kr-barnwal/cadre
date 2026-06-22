import path from "node:path";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString } from "../../../guards";
import { readJson, safeName } from "../../infrastructure/runtime/json-store";

const MAX_PREFIX_WORDS = 2;

export interface BeadsPrefixResolution extends JsonObject {
  selected: boolean;
  required: boolean;
  epic_prefix: string;
  source: string;
  example: string;
  max_words: number;
  missing_payload: string[];
  recommendations: JsonObject[];
  error?: string;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return undefined;
}

function words(value: unknown): string[] {
  return String(value || "")
    .trim()
    .split(/[\s_-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function normalizeBeadsEpicPrefix(value: unknown): string {
  const raw = asOptionalString(value);
  if (raw === undefined) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return safeName(trimmed.toLowerCase()).replace(/_+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function prefixError(value: unknown): string | null {
  const raw = asOptionalString(value);
  if (raw === undefined || !raw.trim()) return "beadsEpicPrefix is required";
  if (words(raw).length > MAX_PREFIX_WORDS) return "beadsEpicPrefix must be at most two words";
  return null;
}

function firstWordsSlug(value: unknown, fallback: string): string {
  const selected = words(value).slice(0, MAX_PREFIX_WORDS).join(" ") || fallback;
  return normalizeBeadsEpicPrefix(selected);
}

function productTitle(args: RuntimeArgs = {}): string | undefined {
  const product = asJsonObject((args as UnknownRecord).product);
  return firstString(product.title, product.name, product.id);
}

export function projectBeadsEpicPrefix(root: string): string {
  return firstWordsSlug(path.basename(root), "project");
}

export function productBeadsEpicPrefix(root: string, args: RuntimeArgs = {}): string {
  return firstWordsSlug(productTitle(args), projectBeadsEpicPrefix(root));
}

function exampleFor(prefix: string): string {
  return `${prefix}-<track_id>`;
}

function recommendation(label: string, epicPrefix: string, reason: string, recommended = false): JsonObject {
  return {
    label,
    epic_prefix: epicPrefix,
    example: exampleFor(epicPrefix),
    recommended,
    reason,
  };
}

export function beadsPrefixRecommendations(root: string, args: RuntimeArgs = {}): JsonObject[] {
  const seen = new Set<string>();
  const out: JsonObject[] = [];
  const add = (entry: JsonObject): void => {
    const prefix = asOptionalString(entry.epic_prefix);
    if (!prefix || seen.has(prefix)) return;
    seen.add(prefix);
    out.push(entry);
  };
  const projectPrefix = projectBeadsEpicPrefix(root);
  add(recommendation("Project", projectPrefix, "Derived from the project directory.", true));
  const productPrefix = productBeadsEpicPrefix(root, args);
  add(recommendation("Product", productPrefix, "Derived from the product title."));
  return out;
}

function configuredPrefix(args: RuntimeArgs): string | undefined {
  const rawArgs = args as UnknownRecord;
  const inlineConfig = {
    ...asJsonObject(rawArgs.beadsConfig),
    ...asJsonObject(rawArgs.beads_config),
  };
  return firstString(rawArgs.beadsEpicPrefix, rawArgs.beads_epic_prefix, inlineConfig.epicPrefix, inlineConfig.epic_prefix);
}

export function resolveBeadsEpicPrefix(root: string, args: RuntimeArgs = {}): BeadsPrefixResolution {
  const recommendations = beadsPrefixRecommendations(root, args);
  const directPrefix = configuredPrefix(args);

  if (directPrefix !== undefined) {
    const error = prefixError(directPrefix);
    if (error) {
      return {
        selected: false,
        required: true,
        epic_prefix: "",
        source: "invalid_argument",
        example: exampleFor("<prefix>"),
        max_words: MAX_PREFIX_WORDS,
        missing_payload: ["beadsEpicPrefix"],
        recommendations,
        error,
      };
    }
    const epicPrefix = normalizeBeadsEpicPrefix(directPrefix);
    return {
      selected: true,
      required: false,
      epic_prefix: epicPrefix,
      source: "arguments",
      example: exampleFor(epicPrefix),
      max_words: MAX_PREFIX_WORDS,
      missing_payload: [],
      recommendations,
    };
  }

  const diskConfig = readJson<JsonObject>(path.join(root, "cadre", "beads.json"), {});
  const diskPrefix = firstString(diskConfig.epicPrefix, diskConfig.epic_prefix);
  if (diskPrefix !== undefined) {
    const error = prefixError(diskPrefix);
    if (error) {
      return {
        selected: false,
        required: true,
        epic_prefix: asOptionalString(recommendations[0]?.epic_prefix) || projectBeadsEpicPrefix(root),
        source: "invalid_cadre/beads.json",
        example: exampleFor(asOptionalString(recommendations[0]?.epic_prefix) || projectBeadsEpicPrefix(root)),
        max_words: MAX_PREFIX_WORDS,
        missing_payload: ["beadsEpicPrefix"],
        recommendations,
        error,
      };
    }
    const epicPrefix = normalizeBeadsEpicPrefix(diskPrefix);
    return {
      selected: true,
      required: false,
      epic_prefix: epicPrefix,
      source: "cadre/beads.json",
      example: exampleFor(epicPrefix),
      max_words: MAX_PREFIX_WORDS,
      missing_payload: [],
      recommendations,
    };
  }

  const defaultPrefix = asOptionalString(recommendations[0]?.epic_prefix) || projectBeadsEpicPrefix(root);
  return {
    selected: false,
    required: true,
    epic_prefix: defaultPrefix,
    source: "setup_required",
    example: exampleFor(defaultPrefix),
    max_words: MAX_PREFIX_WORDS,
    missing_payload: ["beadsEpicPrefix"],
    recommendations,
  };
}

export function beadsEpicIdForTrack(root: string, trackId: string, args: RuntimeArgs = {}): string {
  const prefix = resolveBeadsEpicPrefix(root, args).epic_prefix;
  return prefix ? `${prefix}-${trackId}` : trackId;
}
