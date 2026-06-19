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

import { CoreResult, JsonPatcher, PatchJsonOptions } from "../../application/runtime/contracts";
import { withLock } from "./locking";

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: JsonObject): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function safeName(value: unknown): string {
  return String(value || "lock")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "lock";
}

export function textHash(text: unknown): string {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

export function patchJsonFileUnlocked<T extends JsonObject = JsonObject>(file: string, patcher: JsonPatcher<T>, options: PatchJsonOptions = {}): CoreResult {
  const retries = Number(options.retries || 5);
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let beforeText: string;
    try {
      beforeText = fs.readFileSync(file, "utf8");
    } catch (error) {
      return { ok: false, file, error: `Unable to read JSON file: ${errorMessage(error)}` };
    }
    let before: T;
    try {
      before = asJsonObject(JSON.parse(beforeText || "{}")) as T;
    } catch (error) {
      return { ok: false, file, error: `Invalid JSON: ${errorMessage(error)}` };
    }
    const beforeHash = textHash(beforeText);
    let next: T;
    try {
      next = patcher({ ...before }, before);
    } catch (error) {
      return { ok: false, file, error: `JSON patcher failed: ${errorMessage(error)}` };
    }
    if (!next || typeof next !== "object") {
      return { ok: false, file, error: "JSON patcher must return an object" };
    }
    let latestText: string;
    try {
      latestText = fs.readFileSync(file, "utf8");
    } catch (error) {
      return { ok: false, file, error: `Unable to re-read JSON file: ${errorMessage(error)}` };
    }
    if (textHash(latestText) !== beforeHash) continue;
    writeJson(file, next);
    return {
      ok: true,
      file,
      attempts: attempt,
      before_hash: beforeHash,
      after_hash: textHash(`${JSON.stringify(next, null, 2)}\n`),
      value: next,
    };
  }
  return {
    ok: false,
    file,
    error: `JSON file changed during patch after ${retries} retries`,
    conflict: true,
  };
}

export function patchJsonFile<T extends JsonObject = JsonObject>(file: string, patcher: JsonPatcher<T>, options: PatchJsonOptions = {}): CoreResult {
  if (options.root && options.lockName && options.lock !== false) {
    return withLock(options.root, options.lockName, () => patchJsonFileUnlocked(file, patcher, { ...options, lock: false }), options.lockOptions || {});
  }
  return patchJsonFileUnlocked(file, patcher, options);
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function fileExists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

export function ensureParent(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function writeJsonEnsured(file: string, value: JsonObject): void {
  ensureParent(file);
  writeJson(file, value);
}

export function appendJsonl(file: string, value: JsonObject): void {
  ensureParent(file);
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}
