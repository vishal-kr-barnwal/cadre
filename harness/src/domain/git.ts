import { countGitProcess } from "./inspection.js";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { safeProjectRoot } from "./paths.js";

export function gitRoot(projectRoot: string): string {
  const root = realpathSync(safeProjectRoot(projectRoot));
  countGitProcess();
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "project is not a Git worktree").trim());
  const detected = realpathSync(resolve(result.stdout.trim()));
  if (detected !== root) throw new Error(`project root ${root} is not the Git worktree root ${detected}`);
  return root;
}

export function resolveGitCommit(projectRoot: string, revision = "HEAD"): string {
  const root = gitRoot(projectRoot);
  const result = spawnSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git commit is not reachable: ${revision}`);
  return result.stdout.trim();
}

export function readGitFileAtCommit(projectRoot: string, revision: string, path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\")
    || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid Git file path: ${path}`);
  }
  const root = gitRoot(projectRoot);
  const commit = resolveGitCommit(root, revision);
  const result = spawnSync("git", ["show", `${commit}:${path}`], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git commit ${commit} does not contain ${path}`);
  return result.stdout;
}

export function isGitAncestor(projectRoot: string, ancestor: string, descendant = "HEAD"): boolean {
  const root = gitRoot(projectRoot);
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    encoding: "utf8"
  }).status === 0;
}

/** Completion may follow bookkeeping commits, but never unreviewed product edits. */
export function requireReviewedProductUnchanged(projectRoot: string, reviewedHead: string, trackId: string): void {
  const root = gitRoot(projectRoot);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trackId)) throw new Error("invalid trackId");
  const scopes = [[".", ":(exclude).cadre/**"],
    [".cadre/workflow.md", ".cadre/guidelines.md", ".cadre/tech-stack.md", ".cadre/product.md",
      ".cadre/styleguides", ".cadre/patterns", `.cadre/tracks/${trackId}/spec.md`]];
  for (const scope of scopes) for (const args of [
    ["diff", "--name-only", "-z", reviewedHead, "HEAD", "--", ...scope],
    ["diff", "--name-only", "-z", reviewedHead, "--", ...scope],
    ["diff", "--cached", "--name-only", "-z", reviewedHead, "--", ...scope],
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...scope]
  ]) {
    countGitProcess();
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error("Cannot verify reviewed product content");
    if (result.stdout) throw new Error("Product content changed or verification policy changed after reviewed HEAD; verify and review the current product before completion");
  }
}

export function reachableGitCommits(projectRoot: string, revisions: Iterable<string>): Map<string, boolean> | null {
  let root: string;
  try {
    root = gitRoot(projectRoot);
  } catch {
    return null;
  }
  const unique = [...new Set(revisions)].filter(Boolean);
  if (!unique.length) return new Map();
  if (unique.some((revision) => /[\r\n\0]/.test(revision))) throw new Error("invalid Git revision");
  countGitProcess();
  const listed = spawnSync("git", ["rev-list", "--all"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error((listed.stderr || listed.stdout || "cannot enumerate Git history").trim());
  const history = new Set(listed.stdout.split(/\r?\n/).filter(Boolean));
  countGitProcess();
  const resolved = spawnSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    cwd: root, encoding: "utf8", input: unique.map((revision) => `${revision}^{commit}\n`).join(""),
    maxBuffer: 64 * 1024 * 1024
  });
  if (resolved.status !== 0) throw new Error((resolved.stderr || "cannot resolve Git provenance").trim());
  const lines = resolved.stdout.trimEnd().split(/\r?\n/);
  if (lines.length !== unique.length) throw new Error("incomplete Git provenance resolution");
  return new Map(unique.map((revision, index) => {
    const match = /^([0-9a-f]{40}) commit$/.exec(lines[index]!);
    return [revision, Boolean(match && history.has(match[1]!))];
  }));
}

/** Batch blob reads preserve missing-object semantics and count bytes, not JS characters. */
export function readGitBlobs(projectRoot: string, requests: string[]): Map<string, string | null> {
  if (!requests.length) return new Map();
  if (requests.some((request) => !/^[0-9a-f]{7,40}:[^\r\n\0]+$/.test(request))) throw new Error("invalid Git blob request");
  countGitProcess();
  const result = spawnSync("git", ["cat-file", "--batch"], { cwd: safeProjectRoot(projectRoot),
    input: requests.join("\n") + "\n", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("cannot inspect committed artifact provenance");
  let offset = 0;
  const values = new Map<string, string | null>();
  for (const request of requests) {
    const end = result.stdout.indexOf(10, offset);
    if (end < 0) throw new Error("incomplete Git blob response");
    const header = result.stdout.subarray(offset, end).toString("utf8"); offset = end + 1;
    const match = /^[0-9a-f]{40} blob (\d+)$/.exec(header);
    if (!match) { if (!header.endsWith(" missing")) throw new Error(`not a committed file: ${request}`); values.set(request, null); continue; }
    const length = Number(match[1]);
    if (offset + length >= result.stdout.length) throw new Error("truncated Git blob response");
    values.set(request, result.stdout.subarray(offset, offset + length).toString("utf8")); offset += length + 1;
  }
  return values;
}
