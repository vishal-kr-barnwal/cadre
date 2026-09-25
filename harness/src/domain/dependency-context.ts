import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { contentHash, readSafeArtifact } from "./memory.js";

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const dependencyContextSchema = z.strictObject({ schemaVersion: z.literal(1), specRevision: z.number().int().positive(), planRevision: z.number().int().positive(),
  dependencies: z.array(id), graphHash: z.string().regex(/^[0-9a-f]{64}$/),
  sources: z.array(z.strictObject({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
  constraints: z.array(z.strictObject({ id, text: z.string().min(1), sources: z.array(z.string()).min(1) })) });
export type DependencyContext = z.infer<typeof dependencyContextSchema>;

export function dependencySources(root: string, dependencies: string[], read = (path: string) => readSafeArtifact(root, path)) {
  const visiting = new Set<string>();
  const visited = new Set<string>(), graph: Array<{ trackId: string; dependencies: string[] }> = [], sources: Array<{ path: string; sha256: string }> = [];
  const visit = (trackId: string) => {
    id.parse(trackId);
    if (visiting.has(trackId)) throw new Error(`Dependency cycle at ${trackId}`);
    if (visited.has(trackId)) return;
    visiting.add(trackId);
    visited.add(trackId);
    const active = `.cadre/tracks/${trackId}`, archived = `.cadre/archive/${trackId}`;
    if (existsSync(join(root, active, "state.json")) && existsSync(join(root, archived, "state.json"))) throw new Error(`Duplicate dependency ${trackId}`);
    const parent = existsSync(join(root, active, "state.json")) ? active : archived;
    const state = JSON.parse(read(`${parent}/state.json`));
    const parents = z.array(id).parse(state.dependencies ?? []);
    graph.push({ trackId, dependencies: parents });
    for (const file of ["spec.md", "learning.md"]) {
      const path = `${parent}/${file}`;
      sources.push({ path, sha256: contentHash(read(path)) });
    }
    parents.forEach(visit);
    visiting.delete(trackId);
  };
  dependencies.forEach(visit);
  return { graphHash: contentHash(JSON.stringify(graph.sort((a, b) => a.trackId.localeCompare(b.trackId)))), sources: sources.sort((a, b) => a.path.localeCompare(b.path)) };
}

export function inspectDependencyContext(root: string, body: string, dependencies: string[], specRevision: number | null, planRevision: number | null,
  read = (path: string) => readSafeArtifact(root, path)) {
  const context = dependencyContextSchema.parse(JSON.parse(body));
  if (context.specRevision !== specRevision || context.planRevision !== planRevision || JSON.stringify(context.dependencies) !== JSON.stringify(dependencies)) throw new Error("Dependency context does not match the approved specification/plan/dependencies");
  const expected = dependencySources(root, dependencies, read);
  if (context.graphHash !== expected.graphHash || JSON.stringify([...context.sources].sort((a, b) => a.path.localeCompare(b.path))) !== JSON.stringify(expected.sources)) throw new Error("Dependency source coverage is missing or stale; reassess inherited constraints");
  if (new Set(context.constraints.map((item) => item.id)).size !== context.constraints.length) throw new Error("Dependency constraint IDs must be unique");
  const paths = new Set(context.sources.map((source) => source.path));
  for (const constraint of context.constraints) if (constraint.sources.some((path) => !paths.has(path))) throw new Error(`Unknown source for constraint ${constraint.id}`);
  for (const path of paths) if (!context.constraints.some((constraint) => constraint.sources.includes(path))) throw new Error(`Dependency source has no approved constraint or explicit no-applicable-constraint assessment: ${path}`);
  return context;
}
