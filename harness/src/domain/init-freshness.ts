import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { requireRepositoryBasis, type RepositoryBasis } from "./repository-basis.js";

/** Initial apply cannot adopt newly appeared canonical state as its before-state. */
export function requireInitFreshness(root: string, files: Array<{path: string; content: string | null}>, basis?: RepositoryBasis,
  recovering = false, approvalDigest?: string): void {
  if (!basis) throw new Error("Create recovery lacks approved repository evidence; preserve intent and obtain an exact repair approval");
  const hash = (content: string) => createHash("sha256").update(content).digest("hex");
  const manifest = files.map((file) => {
    if (!file.path.startsWith(".cadre/") || file.content === null) throw new Error("Create cannot delete or promote external artifacts");
    return {path: file.path.slice(".cadre/".length), sha256: hash(file.content)};
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (hash(JSON.stringify({files: manifest, repositoryBasis: basis})) !== approvalDigest) {
    throw new Error("Create repository evidence differs from its original approval digest");
  }
  requireRepositoryBasis(root, basis);
  if (recovering) return; // Persisted per-file before/after hashes protect partial writes.
  const expected = new Map(files.map((file) => [file.path, file.content]));
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory)) {
      const path = `${prefix}/${entry}`, absolute = join(directory, entry), stat = lstatSync(absolute);
      if (path === ".cadre/stage") continue;
      if (stat.isSymbolicLink()) throw new Error(`Unsafe initialization state: ${path}`);
      if (stat.isDirectory()) visit(absolute, path);
      else if (!stat.isFile() || !expected.has(path) || expected.get(path) !== readFileSync(absolute, "utf8")) {
        throw new Error(`Initialization canonical state changed after preview: ${path}`);
      }
    }
  }; visit(join(root, ".cadre"), ".cadre");
}
