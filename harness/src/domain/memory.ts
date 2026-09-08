import { readInspectionText } from "./inspection.js";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { CadreError } from "./errors.js";
import { safeProjectRoot } from "./paths.js";
import type { PlanGraph } from "./plan.js";

export const MAX_HANDOFF_BYTES = 8 * 1024;
export const SEED_START = "<!-- cadre:pattern-seed:start -->";
export const SEED_END = "<!-- cadre:pattern-seed:end -->";
export const MEMORY_START = "<!-- cadre:memory:start -->";
export const MEMORY_END = "<!-- cadre:memory:end -->";
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const portablePath = z.string().min(1).refine((path) =>
  !path.startsWith("/") && !path.includes("\\") && !path.includes("\0")
  && !path.split("/").some((part) => !part || part === "." || part === ".."), "expected a safe relative path");
export const sourceReferenceSchema = z.strictObject({ path: portablePath, sha256: digest });
export const handoffSchema = z.strictObject({
  decisions: z.array(z.string().min(1)),
  failedApproaches: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
  nextAction: z.string().min(1),
  sources: z.array(sourceReferenceSchema)
}).refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_HANDOFF_BYTES,
  "handoff exceeds 8 KiB; move longer evidence to a source file and reference its path/hash; never truncate evidence");
export type Handoff = z.infer<typeof handoffSchema>;
export const seedMemorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  specRevision: z.number().int().positive(),
  planRevision: z.number().int().positive(),
  patterns: z.array(z.strictObject({ path: z.string().regex(/^patterns\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/), sha256: digest }))
}).refine((value) => new Set(value.patterns.map((pattern) => pattern.path)).size === value.patterns.length,
  "pattern references must be unique");
export type SeedMemory = z.infer<typeof seedMemorySchema>;
export interface FreshnessFinding { trackId: string; path: string; reason: string }
export interface MemoryInspection { metadata: SeedMemory | null; errors: string[]; stale: FreshnessFinding[] }

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Every path component is checked, including the project-local control plane. */
export function readSafeArtifact(projectRoot: string, path: string): string {
  portablePath.parse(path);
  let target = safeProjectRoot(projectRoot);
  for (const component of path.split("/")) {
    target = join(target, component);
    if (lstatSync(target).isSymbolicLink()) throw new Error(`refusing artifact symbolic link: ${path}`);
  }
  if (!lstatSync(target).isFile()) throw new Error(`artifact is not a regular file: ${path}`);
  return readInspectionText(target);
}

export function seedSection(body: string): string | null {
  if (body.split(SEED_START).length !== 2 || body.split(SEED_END).length !== 2) return null;
  const start = body.indexOf(SEED_START), end = body.indexOf(SEED_END);
  return start < end ? body.slice(start, end + SEED_END.length) : null;
}

export function inspectMemory(input: {
  trackId: string; path: string; body: string; graph: Pick<PlanGraph, "specRevision" | "planRevision"> | null;
  required: boolean; historical: boolean; readPattern: (path: string) => string;
}): MemoryInspection {
  const result: MemoryInspection = { metadata: null, errors: [], stale: [] };
  const section = seedSection(input.body);
  if (!section) {
    result.errors.push(`${input.path}: missing or invalid marked Pattern Seed section`);
    return result;
  }
  const hasMetadata = section.includes(MEMORY_START) || section.includes(MEMORY_END);
  if (!hasMetadata && (!input.required || input.historical)) return result;
  try {
    if (section.split(MEMORY_START).length !== 2 || section.split(MEMORY_END).length !== 2) {
      throw new Error("expected exactly one versioned memory block inside Pattern Seed");
    }
    const start = section.indexOf(MEMORY_START) + MEMORY_START.length, end = section.indexOf(MEMORY_END);
    if (end < start) throw new Error("memory markers are out of order");
    result.metadata = seedMemorySchema.parse(JSON.parse(section.slice(start, end).trim()));
  } catch (error) {
    result.errors.push(`${input.path}: invalid seed memory (${error instanceof Error ? error.message : String(error)})`);
    return result;
  }
  const prose = section.replace(section.slice(section.indexOf(MEMORY_START), section.indexOf(MEMORY_END) + MEMORY_END.length), "");
  // Recognize inline/reference links, backticks and bare paths. Unusual paths are
  // rejected instead of being silently omitted from required guidance.
  const referenced = [...prose.matchAll(/(?:\.cadre\/)?(patterns\/[^\s`<>"\])}]+\.md)/g)].map((match) => match[1]!);
  for (const path of new Set(referenced)) {
    if (path === "patterns/index.md") continue; // Catalog, not an applicable pattern.
    if (!/^patterns\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)) {
      result.errors.push(`${input.path}: unsafe or unsupported pattern reference ${path}`);
    } else if (!result.metadata.patterns.some((pattern) => pattern.path === path)) {
      result.errors.push(`${input.path}: human-readable pattern reference ${path} is missing from memory metadata`);
    }
  }
  if (input.historical) return result;
  const stale = (path: string, reason: string) => result.stale.push({ trackId: input.trackId, path, reason });
  if (input.graph && (result.metadata.specRevision !== input.graph.specRevision
    || result.metadata.planRevision !== input.graph.planRevision)) stale(input.path, "seed revisions differ from the approved plan");
  for (const reference of result.metadata.patterns) {
    try {
      if (contentHash(input.readPattern(reference.path)) !== reference.sha256) stale(reference.path, "pattern content changed; reassess applicability and constraints");
    } catch (error) {
      stale(reference.path, `pattern unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/** Execution gates inspect the selected track; unrelated stale learning cannot block repair. */
export function requireFreshTrackMemory(projectRoot: string, trackId: string): void {
  const root = safeProjectRoot(projectRoot);
  const project = JSON.parse(readSafeArtifact(root, ".cadre/project.json")) as { templateSetVersion?: string };
  if (!["v3", "v4"].includes(project.templateSetVersion ?? "")) return;
  const path = `.cadre/tracks/${trackId}/learning.md`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trackId)) throw new Error("invalid trackId");
  const plan = readSafeArtifact(root, `.cadre/tracks/${trackId}/plan.md`);
  const graph = {
    specRevision: Number(plan.match(/^- Spec revision: (\d+)$/m)?.[1]) || null,
    planRevision: Number(plan.match(/^- Plan revision: (\d+)$/m)?.[1]) || null
  };
  const inspected = inspectMemory({ trackId, path, body: readSafeArtifact(root, path), graph, required: true,
    historical: false, readPattern: (pattern) => readSafeArtifact(root, `.cadre/${pattern}`) });
  if (inspected.errors.length || inspected.stale.length) throw new CadreError("MEMORY_REASSESSMENT_REQUIRED",
    `Reassess learning for ${trackId} before execution.`, { errors: inspected.errors, stale: inspected.stale });
}

export function sourceFreshness(projectRoot: string, reference: { path: string; sha256: string }, read = (path: string) => readSafeArtifact(projectRoot, path)): "current" | "changed" | "unavailable" {
  try { return contentHash(read(reference.path)) === reference.sha256 ? "current" : "changed"; }
  catch { return "unavailable"; }
}
