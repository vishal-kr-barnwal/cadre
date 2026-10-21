import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { safeProjectRoot } from "../paths.js";
import { configPath, configSchema, json, type GitHubConfig } from "./model.js";

export function safePath(root: string, path: string): string {
  if (!path || path.split("/").some((part) => !part || part === "." || part === "..") || path.includes("\\")) throw new Error("Unsafe GitHub artifact path");
  let current = safeProjectRoot(root);
  for (const segment of path.split("/")) {
    current = join(current, segment);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Unsafe symbolic link: ${current}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return current;
}
export function atomicWrite(root: string, path: string, content: string): void {
  const target = safePath(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
  const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, target);
  const directory = openSync(dirname(target), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
}
function localRoot(root: string): string | null {
  const dotGit = join(root, ".git");
  if (!existsSync(dotGit)) return null;
  const stat = lstatSync(dotGit);
  if (stat.isSymbolicLink()) return null;
  if (stat.isDirectory()) return dotGit;
  const match = /^gitdir: (.+)\r?\n?$/.exec(readFileSync(dotGit, "utf8"));
  return match ? resolve(root, match[1]!) : null;
}
const localSchema = z.strictObject({ config: configSchema, operation: z.string().nullable(), token: z.string().uuid(),
  configuration: z.strictObject({ digest: z.string(), files: z.record(z.string(), z.string()),
    environment: z.strictObject({ name: z.literal("cadre-github"), branch: z.string().min(1) }),
    before: z.record(z.string(), z.string().nullable()) }).optional(),
  pending: z.strictObject({ checkpoint: z.string(), paths: z.array(z.string()),
    expected: z.record(z.string(), z.string().nullable()).optional() }).nullable() });
export type LocalSession = z.infer<typeof localSchema>;
export function readSession(root: string): LocalSession | null {
  const base = localRoot(root);
  if (!base) return null;
  const path = safePath(base, "cadre-github/session.json");
  return existsSync(path) ? localSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
}
export function writeSession(root: string, session: LocalSession): void {
  const base = localRoot(root);
  if (!base) throw new Error("GitHub mode requires an existing Git repository with a default-branch commit");
  atomicWrite(base, "cadre-github/session.json", json(localSchema.parse(session)));
}
export function readConfig(root: string): GitHubConfig | null {
  const path = safePath(root, configPath), session = readSession(root);
  if (!existsSync(path)) {
    if (session) return session.config; // A deleted or not-yet-merged policy cannot silently disable strict mode.
    return null;
  }
  const config = configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (session && JSON.stringify(session.config) !== JSON.stringify(config)) throw new Error("GitHub policy changed; reconcile it through the owning setup/refresh PR");
  return config;
}
export function sessionFor(root: string, config: GitHubConfig): LocalSession {
  return readSession(root) ?? { config, operation: null, token: randomUUID(), pending: null };
}
