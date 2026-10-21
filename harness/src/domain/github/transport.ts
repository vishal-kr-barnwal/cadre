import { spawnSync } from "node:child_process";
import { z } from "zod/v4";
import { safeProjectRoot } from "../paths.js";
import { configSchema, prSchema, type GitHubConfig, type PullRequest } from "./model.js";

export interface CommandResult { status: number; stdout: string; stderr: string }
export type Runner = (command: "git" | "gh", args: string[], input?: string) => CommandResult;
export class GitHubClient {
  readonly run: Runner;
  constructor(readonly root: string, readonly config: GitHubConfig, runner?: Runner) {
    safeProjectRoot(root); configSchema.parse(config);
    this.run = runner ?? ((command, args, input) => {
      const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024, ...(input === undefined ? {} : { input }),
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
      return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.error?.message ?? result.stderr ?? "" };
    });
  }
  command(command: "git" | "gh", args: string[], input?: string): string {
    const result = this.run(command, args, input);
    if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr.trim().slice(0, 1500)}`);
    return result.stdout.trim();
  }
  git(...args: string[]): string { return this.command("git", args); }
  api(path: string, method = "GET", body?: unknown): unknown {
    const args = ["api", "--hostname", this.config.hostname, "--method", method, path];
    if (body !== undefined) args.push("--input", "-");
    const value = this.command("gh", args, body === undefined ? undefined : JSON.stringify(body));
    return value ? JSON.parse(value) : null;
  }
  repo(path = "", method = "GET", body?: unknown): unknown {
    return this.api(`repos/${this.config.repository}${path}`, method, body);
  }
  pages(path: string): unknown[] {
    const result = this.command("gh", ["api", "--hostname", this.config.hostname, "--paginate", "--slurp",
      `repos/${this.config.repository}${path}`]);
    return z.array(z.array(z.unknown())).parse(JSON.parse(result)).flat();
  }
  identity(): { defaultBranch: string; base: string } {
    const remote = this.git("remote", "get-url", "origin");
    const match = /^(?:https:\/\/|ssh:\/\/git@|git@)([^/:]+)[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote);
    if (!match || match[1]?.toLowerCase() !== this.config.hostname.toLowerCase()
      || match[2]?.toLowerCase() !== this.config.repository.toLowerCase()) throw new Error("origin does not identify the configured GitHub repository");
    const repo = z.object({ full_name: z.string(), default_branch: z.string(), allow_merge_commit: z.boolean() }).parse(this.repo());
    if (repo.full_name.toLowerCase() !== this.config.repository.toLowerCase()) throw new Error("GitHub repository identity changed");
    if (!repo.allow_merge_commit) throw new Error("GitHub collaboration requires merge commits");
    this.git("check-ref-format", `refs/heads/${repo.default_branch}`);
    const ref = z.object({ object: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }) }).parse(this.repo(`/git/ref/heads/${encodeURIComponent(repo.default_branch)}`));
    return { defaultBranch: repo.default_branch, base: ref.object.sha };
  }
  login(): string { return z.object({ login: z.string() }).parse(this.api("user")).login; }
  fetch(branch: string): string {
    this.git("check-ref-format", `refs/heads/${branch}`);
    this.git("fetch", "--no-tags", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`);
    return this.git("rev-parse", `refs/remotes/origin/${branch}^{commit}`);
  }
  pr(number: number): PullRequest { return prSchema.parse(this.repo(`/pulls/${number}`)); }
  prs(): PullRequest[] { return this.pages("/pulls?state=open&per_page=100").map((pr) => prSchema.parse(pr)); }
  file(ref: string, path: string): string | null {
    // A 404 is absence. Authentication, rate-limit and transport failures must never become absence.
    const args = ["api", "--hostname", this.config.hostname,
      `repos/${this.config.repository}/contents/${path}?ref=${encodeURIComponent(ref)}`];
    const result = this.run("gh", args);
    if (result.status !== 0) {
      if (/\(HTTP 404\)/.test(result.stderr)) return null;
      throw new Error(`Cannot read GitHub artifact: ${result.stderr.slice(0, 1500)}`);
    }
    const file = z.object({ type: z.literal("file"), encoding: z.literal("base64"), content: z.string() }).parse(JSON.parse(result.stdout));
    return Buffer.from(file.content, "base64").toString("utf8");
  }
}
