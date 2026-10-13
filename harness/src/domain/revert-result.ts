import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countGitProcess } from "./inspection.js";

/** Use Git's actual reversal merge, with refs, index, worktree and objects all disposable. */
export function isolatedReverseResult(root: string, objects: string, target: string, parent: string, onto: string,
  mainline?: number): {tree: string | null; allowedPaths: Set<string>} {
  const temporary = mkdtempSync(join(tmpdir(), "cadre-revert-proof-"));
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const env = {...cleanEnv, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_DIR: join(temporary, "git"), GIT_WORK_TREE: join(temporary, "worktree"),
    GIT_INDEX_FILE: join(temporary, "index"), GIT_OBJECT_DIRECTORY: join(temporary, "objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(objects)};
  const run = (args: string[]) => {countGitProcess(); return spawnSync("git", ["-c", "core.hooksPath=/dev/null",
    "-c", "core.autocrlf=false", "-c", "core.attributesFile=/dev/null", ...args], {cwd: root, env, maxBuffer: 64 * 1024 * 1024});};
  const text = (args: string[]) => {const result = run(args); if (result.status !== 0) throw new Error("Cannot compute isolated reversal result");
    const body = result.stdout.toString("utf8"); return args.includes("-z") ? body : body.trim();};
  try {
    mkdirSync(env.GIT_WORK_TREE); mkdirSync(env.GIT_OBJECT_DIRECTORY);
    countGitProcess();
    const initialized = spawnSync("git", ["init", "--bare", env.GIT_DIR], {cwd: temporary,
      env: {...cleanEnv, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null"}});
    if (initialized.status !== 0) throw new Error("Cannot initialize isolated reversal storage");
    text(["config", "core.bare", "false"]);
    text(["update-ref", "HEAD", onto]);
    text(["read-tree", "--reset", "-u", onto]);
    const names = text(["diff", "--name-only", "--no-renames", "-z", target, parent, "--"]);
    const allowedPaths = new Set(names.split("\0").filter(Boolean));
    if (!allowedPaths.size) throw new Error("Approved reversal target has no reverse patch");
    // Follow only Git-verified renames of the target's paths through later history.
    const changes = text(["diff", "--name-status", "--find-renames", "-z", target, onto, "--"]).split("\0");
    for (let i = 0; i < changes.length && changes[i];) {
      const status = changes[i++]!, from = changes[i++]!;
      if (/^[RC]/.test(status)) {const to = changes[i++]!; if (status.startsWith("R") && allowedPaths.has(from)) allowedPaths.add(to);}
    }
    const result = run(["revert", "--no-commit", ...(mainline === undefined ? [] : ["-m", String(mainline)]), target]);
    if (result.status === 0) return {tree: text(["write-tree"]), allowedPaths};
    if (result.status !== 1 || !text(["ls-files", "--unmerged", "-z"])) throw new Error("Cannot compute isolated reversal result");
    return {tree: null, allowedPaths};
  } finally {rmSync(temporary, {recursive: true, force: true});}
}
