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

import { CoreResult, LockOptions, LockedOperation } from "../../application/runtime/contracts";
import { readJson, safeName, utcNow, writeJson } from "./json-store";
import { gitIdentity } from "./system";

export function lockRoot(root: string): string {
  return path.join(root, "cadre", ".locks");
}

export function processAlive(pid: unknown): boolean {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

export function readLockInfo(lockDir: string): LockInfo {
  return readJson<LockInfo | null>(path.join(lockDir, "owner.json"), null) ?? {};
}

export function lockIsStale(info: LockInfo, nowMs = Date.now()): boolean {
  const stamp = Date.parse(info.updated_at || info.acquired_at || "");
  if (Number.isFinite(stamp) && nowMs - stamp > LOCK_STALE_MS) return true;
  if (info.pid && !processAlive(info.pid)) return true;
  return false;
}

export function acquireLock(root: string, name: string, options: LockOptions = {}): CadreLock {
  const now = utcNow();
  const dir = path.join(lockRoot(root), `${safeName(name)}.lock`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (let attempt = 1; attempt <= Number(options.retries || 3); attempt += 1) {
    try {
      fs.mkdirSync(dir);
      const info: LockInfo = {
        name,
        pid: process.pid,
        owner: options.owner || gitIdentity(root) || null,
        acquired_at: now,
        updated_at: now,
        hostname: os.hostname(),
      };
      writeJson(path.join(dir, "owner.json"), info);
      return { ok: true, dir, info, attempts: attempt };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        return { ok: false, dir, error: errorMessage(error), attempts: attempt };
      }
      const current = readLockInfo(dir);
      if (lockIsStale(current)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          continue;
        } catch (removeError) {
          return {
            ok: false,
            dir,
            conflict: true,
            stale: true,
            holder: current,
            error: errorMessage(removeError),
            attempts: attempt,
          };
        }
      }
      return {
        ok: false,
        dir,
        conflict: true,
        stale: false,
        holder: current,
        error: `Lock already held: ${name}`,
        attempts: attempt,
      };
    }
  }
  return { ok: false, dir, conflict: true, error: `Unable to acquire lock: ${name}` };
}

export function releaseLock(lock: CadreLock | null | undefined): CoreResult {
  if (!lock || !lock.ok || !lock.dir) return { ok: true, skipped: true };
  try {
    fs.rmSync(lock.dir, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function withLock<T = CoreResult>(root: string, name: string, fn: LockedOperation<T>, options: LockOptions = {}): CoreResult {
  const lock = acquireLock(root, name, options);
  if (!lock.ok) return { ok: false, stage: "lock", lock };
  try {
    const value = fn(lock);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.prototype.hasOwnProperty.call(value, "ok")
        ? { ...value, lock }
        : { ok: true, value, lock };
    }
    return { ok: true, value, lock };
  } catch (error) {
    return { ok: false, stage: "locked_operation", error: errorMessage(error), lock };
  } finally {
    releaseLock(lock);
  }
}

export function trackLockName(trackId: string): string {
  return `track:${trackId}`;
}

export function withTrackLock<T = CoreResult>(root: string, trackId: string, fn: LockedOperation<T>, options: LockOptions = {}): CoreResult {
  return withLock(root, trackLockName(trackId), fn, options);
}
