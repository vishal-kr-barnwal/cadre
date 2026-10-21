import { z } from "zod/v4";
import { createHash } from "node:crypto";

export const sha = z.string().regex(/^[0-9a-f]{40}$/);
export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(96);
export const workflow = z.enum(["create", "track", "implement", "review", "revise", "refresh", "archive", "revert", "reconcile"]);
export const configPath = ".cadre/github.json";
export const coordinationBranch = "cadre/coordination";
export const configSchema = z.strictObject({
  schemaVersion: z.literal(1), mode: z.literal("github-strict"),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  hostname: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/),
  adoptionCommit: sha, validatorVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  validatorArchiveSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  requiredChecks: z.array(z.string().min(1).max(100)).min(1),
  codeOwners: z.array(z.string().regex(/^@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/)).min(1)
});
export type GitHubConfig = z.infer<typeof configSchema>;
export const operationSchema = z.strictObject({
  id: slug, workflow, tracks: z.array(slug), branch: z.string().regex(/^cadre\/github\/[a-z0-9/-]+$/),
  base: sha, pr: z.number().int().positive().nullable(), url: z.string().url().nullable(),
  state: z.enum(["reserved", "open", "merged", "cancelled"]),
  recoveredBy: slug.optional(),
  lease: z.strictObject({ owner: z.string().min(1), token: z.string().uuid(), expires: z.number().int() }).nullable(),
  published: sha.nullable(), synchronized: sha.nullable(),
  assessment: z.strictObject({ base: sha, scope: z.string(), evidence: z.string().min(1) }).nullable(),
  review: z.strictObject({ head: sha, base: sha, scope: z.string(), evidence: z.string().min(1),
    source: z.enum(["cadre-receipt", "revalidation"]) }).nullable()
});
export type GitHubOperation = z.infer<typeof operationSchema>;
export const ledgerSchema = z.strictObject({ schemaVersion: z.literal(1),
  operations: z.array(operationSchema), audited: sha, incident: z.string().nullable(), active: z.boolean() });
export type Ledger = z.infer<typeof ledgerSchema>;
export const prSchema = z.object({ number: z.number().int().positive(), html_url: z.string().url(),
  state: z.enum(["open", "closed"]), draft: z.boolean().optional(), merged: z.boolean().optional(),
  merge_commit_sha: sha.nullable(), user: z.object({ login: z.string() }),
  head: z.object({ sha, ref: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ sha, ref: z.string(), repo: z.object({ full_name: z.string() }) }) });
export type PullRequest = z.infer<typeof prSchema>;
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export function blocks(a: Pick<GitHubOperation, "workflow" | "tracks">, b: Pick<GitHubOperation, "workflow" | "tracks">): boolean {
  if (a.workflow === "create" || b.workflow === "create") return true;
  if (["refresh", "archive"].includes(a.workflow) && ["refresh", "archive"].includes(b.workflow)) return true;
  return a.tracks.some((track) => b.tracks.includes(track));
}
export function assertAcyclic(graph: Map<string, string[]>): void {
  const active = new Set<string>(), done = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new Error(`GitHub dependency cycle at ${id}`);
    if (done.has(id)) return;
    active.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    active.delete(id); done.add(id);
  }
  for (const id of graph.keys()) visit(id);
}
