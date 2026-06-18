import type { JsonObject, JsonValue, UnknownRecord } from "./types";

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asJsonObject(value: unknown): JsonObject {
  return isRecord(value) ? (value as JsonObject) : {};
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function asJsonArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? (value.filter(isJsonValue) as JsonValue[]) : [];
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => entry === undefined || isJsonValue(entry));
}

export function getString(record: UnknownRecord | JsonObject, key: string, fallback = ""): string {
  return asString(record[key], fallback);
}

export function getOptionalString(record: UnknownRecord | JsonObject, key: string): string | undefined {
  return asOptionalString(record[key]);
}

export function getNumber(record: UnknownRecord | JsonObject, key: string, fallback = 0): number {
  return asNumber(record[key], fallback);
}

export function getOptionalNumber(record: UnknownRecord | JsonObject, key: string): number | undefined {
  return asOptionalNumber(record[key]);
}

export function getBoolean(record: UnknownRecord | JsonObject, key: string, fallback = false): boolean {
  return asBoolean(record[key], fallback);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}
