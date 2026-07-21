import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { errorCode, errorMessage } from "../../../guards";
import type { CadreLock, LockInfo } from "../../../types";
import { LOCK_STALE_MS } from "../../domain/lease-policy";

import type { CoreResult, LockOptions, LockedOperation } from "../../application/runtime/contracts";
import { readJson, safeName, utcNow, writeJson } from "./json-store";
import { gitIdentity } from "./system";

const LOCK_INITIALIZATION_GRACE_MS = 5_000;

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

export function lockIsStale(info: LockInfo, nowMs = Date.now(), hostname = os.hostname()): boolean {
  if (!info.pid && !info.acquired_at && !info.updated_at && !info.hostname) return true;
  const locallyCheckablePid = (!info.hostname || info.hostname === hostname) && Boolean(info.pid);
  if (locallyCheckablePid) return !processAlive(info.pid);
  const expires = Date.parse(info.expires_at || "");
  if (Number.isFinite(expires) && nowMs > expires) return true;
  const stamp = Date.parse(info.updated_at || info.acquired_at || "");
  if (!Number.isFinite(expires) && Number.isFinite(stamp) && nowMs - stamp > LOCK_STALE_MS) return true;
  return false;
}

function lockDirectoryIsStale(dir: string, info: LockInfo, nowMs = Date.now()): boolean {
  if (!info.pid && !info.acquired_at && !info.updated_at && !info.hostname && !info.token) {
    try {
      return nowMs - fs.statSync(dir).mtimeMs > LOCK_INITIALIZATION_GRACE_MS;
    } catch (error) {
      return errorCode(error) === "ENOENT";
    }
  }
  return lockIsStale(info, nowMs);
}

function sameLockOwner(left: LockInfo, right: LockInfo): boolean {
  const fields: Array<keyof LockInfo> = ["token", "pid", "hostname", "acquired_at", "updated_at", "expires_at"];
  return fields.every((field) => left[field] === right[field]);
}

function quarantineStaleLock(dir: string, current: LockInfo, token: string, attempt: number): CoreResult {
  const quarantine = `${dir}.stale-${token}-${attempt}`;
  try {
    fs.renameSync(dir, quarantine);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: true, retry: true };
    return { ok: false, error: errorMessage(error) };
  }
  const moved = readLockInfo(quarantine);
  if (!sameLockOwner(current, moved)) {
    try {
      if (!fs.existsSync(dir)) fs.renameSync(quarantine, dir);
    } catch (error) {
      return { ok: false, error: `A changed lock owner was quarantined and could not be restored: ${errorMessage(error)}` };
    }
    return { ok: false, conflict: true, holder: moved, error: "Lock ownership changed during stale-lock takeover" };
  }
  try {
    fs.rmSync(quarantine, { recursive: true, force: true });
    return { ok: true, reaped: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function acquireLock(root: string, name: string, options: LockOptions = {}): CadreLock {
  const now = utcNow();
  const dir = path.join(lockRoot(root), `${safeName(name)}.lock`);
  const token = randomUUID();
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const requestedMs = Number(options.timeoutMs || 0);
  const leaseMs = Math.max(LOCK_STALE_MS, Number.isFinite(requestedMs) ? requestedMs + 5 * 60 * 1000 : 0);
  const info: LockInfo = {
    name,
    token,
    pid: process.pid,
    owner: options.owner || gitIdentity(root) || null,
    acquired_at: now,
    updated_at: now,
    expires_at: new Date(Date.now() + leaseMs).toISOString(),
    hostname: os.hostname(),
  };
  for (let attempt = 1; attempt <= Number(options.retries || 3); attempt += 1) {
    const candidate = `${dir}.candidate-${token}-${attempt}`;
    try {
      try {
        fs.mkdirSync(candidate);
        writeJson(path.join(candidate, "owner.json"), info);
      } catch (error) {
        fs.rmSync(candidate, { recursive: true, force: true });
        return { ok: false, dir, error: errorMessage(error), attempts: attempt };
      }
      if (fs.existsSync(dir)) {
        const exists = new Error(`Lock already exists: ${name}`) as NodeJS.ErrnoException;
        exists.code = "EEXIST";
        throw exists;
      }
      fs.renameSync(candidate, dir);
      return { ok: true, dir, info, attempts: attempt };
    } catch (error) {
      fs.rmSync(candidate, { recursive: true, force: true });
      if (!["EEXIST", "ENOTEMPTY"].includes(errorCode(error) || "")) {
        return { ok: false, dir, error: errorMessage(error), attempts: attempt };
      }
      const current = readLockInfo(dir);
      if (lockDirectoryIsStale(dir, current)) {
        const takeover = quarantineStaleLock(dir, current, token, attempt);
        if (takeover.ok && (takeover.reaped === true || takeover.retry === true)) continue;
        if (!takeover.ok) {
          return {
            ok: false,
            dir,
            conflict: true,
            stale: true,
            holder: (takeover.holder as LockInfo | undefined) || current,
            error: takeover.error || "Unable to quarantine stale lock",
            attempts: attempt,
          };
        }
      }
      const retryDelayMs = Number(options.retryDelayMs || 0);
      if (attempt < Number(options.retries || 3) && Number.isFinite(retryDelayMs) && retryDelayMs > 0) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
        continue;
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
    if (!fs.existsSync(lock.dir)) return { ok: true, released: false, missing: true };
    const current = readLockInfo(lock.dir);
    if (!lock.info?.token || current.token !== lock.info.token) {
      return { ok: false, stage: "lock_release_owner", conflict: true, holder: current, error: "Refusing to release a lock now owned by another operation" };
    }
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
