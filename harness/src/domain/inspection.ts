import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface InspectionMetrics { fileReads: number; reusedReads: number; readBytes: number; gitProcesses: number }
interface Inspection { text: Map<string, string>; json: Map<string, unknown>; metrics: InspectionMetrics }
const current = new AsyncLocalStorage<Inspection>();
export function inspectionMetrics(): InspectionMetrics { return { fileReads: 0, reusedReads: 0, readBytes: 0, gitProcesses: 0 }; }

/** Scoped to a read-only validation operation, never retained across mutations. */
export function inspectOnce<T>(read: () => T, metrics = inspectionMetrics()): T {
  return current.run({ text: new Map(), json: new Map(), metrics }, read);
}
export function readInspectionText(path: string, encoding: "utf8" = "utf8"): string {
  const cache = current.getStore(), key = resolve(path);
  if (cache?.text.has(key)) { cache.metrics.reusedReads++; return cache.text.get(key)!; }
  const body = readFileSync(path, encoding);
  if (cache) { cache.text.set(key, body); cache.metrics.fileReads++; cache.metrics.readBytes += Buffer.byteLength(body); }
  return body;
}
export function readInspectionJson<T>(path: string): T {
  const cache = current.getStore(), key = resolve(path);
  if (cache?.json.has(key)) return cache.json.get(key) as T;
  const value: unknown = JSON.parse(readInspectionText(path));
  cache?.json.set(key, value);
  return value as T;
}
export function countGitProcess(): void { const context = current.getStore(); if (context) context.metrics.gitProcesses++; }
