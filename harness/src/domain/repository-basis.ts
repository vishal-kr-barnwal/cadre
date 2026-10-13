import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import { safeProjectRoot } from "./paths.js";
import { countGitProcess } from "./inspection.js";

const path = z.string().min(1).refine((value) => !value.startsWith("/") && !value.includes("\\")
  && !value.split("/").some((part) => !part || part === "." || part === ".."));
export const repositoryBasisSchema = z.strictObject({
  schemaVersion: z.literal(1), head: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  index: z.array(z.strictObject({path, mode: z.string(), oid: z.string().regex(/^[0-9a-f]{40}$/), stage: z.string()})),
  files: z.array(z.strictObject({path, kind: z.enum(["file", "symlink", "absent", "gitlink"]),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(), executable: z.boolean()}))
});
export type RepositoryBasis = z.infer<typeof repositoryBasisSchema>;
const hash = (content: Buffer | string) => createHash("sha256").update(content).digest("hex");

export function reversalScopes(trackId: string): string[][] {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trackId)) throw new Error("invalid trackId");
  return [[".", ":(exclude).cadre/**"], [".cadre/workflow.md", ".cadre/guidelines.md", ".cadre/tech-stack.md",
    ".cadre/product.md", ".cadre/styleguides", ".cadre/patterns", `.cadre/tracks/${trackId}/spec.md`]];
}

/** Exact bytes, file types and index entries; never follow a worktree symlink. */
export function captureRepositoryBasis(rootInput: string, dirtyOnly = false, trackId?: string): RepositoryBasis {
  const root = realpathSync(safeProjectRoot(rootInput));
  const env = {...process.env, GIT_OPTIONAL_LOCKS: "0"};
  const run = (args: string[]) => {countGitProcess(); return spawnSync("git", args, {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});};
  const detected = run(["rev-parse", "--show-toplevel"]);
  const index: RepositoryBasis["index"] = [], paths = new Set<string>();
  let head: string | null = null;
  if (detected.status === 0) {
    if (realpathSync(detected.stdout.trim()) !== root) throw new Error("Initialization requires the exact Git worktree root");
    const read = (args: string[]) => {const result = run(args); if (result.status !== 0) throw new Error("Cannot fingerprint repository approval inputs"); return result.stdout;};
    const current = run(["rev-parse", "--verify", "HEAD"]); head = current.status === 0 ? current.stdout.trim() : null;
    const scopes = trackId ? reversalScopes(trackId) : [[".", ":(exclude).cadre/**"]];
    const entries = [...new Set(scopes.flatMap((scope) => read(["ls-files", "--stage", "-z", "--", ...scope]).split("\0").filter(Boolean)))].sort();
    for (const entry of entries) {
      const match = /^(\d+) ([0-9a-f]{40}) ([0-3])\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error("Invalid repository index evidence");
      index.push({mode: match[1]!, oid: match[2]!, stage: match[3]!, path: match[4]!});
    }
    if (dirtyOnly && head) {
      for (const scope of scopes) for (const args of [["diff", "--name-only", "-z", head, "--", ...scope],
        ["diff", "--cached", "--name-only", "-z", head, "--", ...scope]]) {
        for (const name of read(args).split("\0").filter(Boolean)) paths.add(name);
      }
    } else for (const entry of index) paths.add(entry.path);
    for (const scope of scopes) for (const name of read(["ls-files", "--others", "--exclude-standard", "-z", "--", ...scope]).split("\0").filter(Boolean)) paths.add(name);
  } else {
    if (dirtyOnly) throw new Error("Reversal baseline requires a Git repository");
    const visit = (directory: string, prefix = "") => {
      for (const entry of readdirSync(directory, {withFileTypes: true})) {
        if (!prefix && [".git", ".cadre"].includes(entry.name)) continue;
        const name = prefix + entry.name;
        if (entry.isDirectory()) visit(join(directory, entry.name), `${name}/`); else paths.add(name);
        if (paths.size > 50000) throw new Error("Repository approval input limit exceeded");
      }
    }; visit(root);
  }
  const files = [...paths].sort().map((name): RepositoryBasis["files"][number] => {
    path.parse(name);
    // A tracked path may now pass through an untracked/dirty symlink directory.
    let parent = root;
    for (const part of name.split("/").slice(0, -1)) {
      parent = join(parent, part);
      try {if (lstatSync(parent).isSymbolicLink()) throw new Error(`Unsafe repository input symlink parent: ${name}`);}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;}
    }
    try {
      const absolute = join(root, name), stat = lstatSync(absolute);
      const executable = Boolean(stat.mode & 0o111);
      if (stat.isSymbolicLink()) return {path: name, kind: "symlink", sha256: hash(readlinkSync(absolute)), executable: false};
      if (stat.isFile()) return {path: name, kind: "file", sha256: hash(readFileSync(absolute)), executable};
      if (stat.isDirectory() && index.some((entry) => entry.path === name && entry.mode === "160000")) {
        countGitProcess();
        const submodule = spawnSync("git", ["-C", absolute, "status", "--porcelain=v1", "-z"], {env, encoding: "utf8"});
        countGitProcess();
        const revision = spawnSync("git", ["-C", absolute, "rev-parse", "HEAD"], {env, encoding: "utf8"});
        if (submodule.status !== 0 || revision.status !== 0 || submodule.stdout) throw new Error(`Submodule input is unavailable or dirty: ${name}`);
        return {path: name, kind: "gitlink", sha256: hash(revision.stdout), executable: false};
      }
      throw new Error(`Unsupported repository approval input: ${name}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {path: name, kind: "absent", sha256: null, executable: false};
    }
  });
  return repositoryBasisSchema.parse({schemaVersion: 1, head, index: index.filter((entry) => !dirtyOnly || paths.has(entry.path)), files});
}

export function requireRepositoryBasis(root: string, expected: RepositoryBasis): void {
  if (!isDeepStrictEqual(captureRepositoryBasis(root), repositoryBasisSchema.parse(expected))) {
    throw new Error("Repository inputs changed after create approval; preserve the proposal and prepare a fresh approval");
  }
}
