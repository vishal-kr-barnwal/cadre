import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configSchema, json } from "../src/domain/github/model.js";
import { previewConfigure, configure } from "../src/domain/github/enforcement.js";
import { githubOperation, githubRequestSchema, githubStatus, runGitHubCI } from "../src/domain/github/service.js";
import { checkPullRequest } from "../src/domain/github/validation.js";
import { GitHubClient } from "../src/domain/github/transport.js";
import { readConfig } from "../src/domain/github/storage.js";

export function runGitHub(args: string[]): number {
  const action = args[0] ?? "status", options = new Map<string, string>();
  const accepted = new Set(["--root", "--workflow", "--tracks", "--evidence", "--approval-digest", "--config", "--event", "--pr"]);
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!accepted.has(key) || !value || options.has(key)) throw new Error(`Unknown, duplicate or incomplete GitHub option ${key}`);
    options.set(key, value);
  }
  const root = resolve(options.get("--root") ?? process.cwd());
  let output: unknown;
  if (action === "status") output = githubStatus(root);
  else if (action === "configure") {
    const source = options.get("--config");
    if (!source) throw new Error("github configure requires --config with the proposed repository policy");
    const config = configSchema.parse(JSON.parse(readFileSync(resolve(source), "utf8"))), approval = options.get("--approval-digest");
    output = approval ? configure(root, config, approval) : previewConfigure(root, config);
  } else if (action === "ci") {
    const path = options.get("--event");
    if (!path) throw new Error("github ci requires --event");
    output = runGitHubCI(root, resolve(path));
  } else if (action === "check") {
    const config = readConfig(root), pr = Number(options.get("--pr"));
    if (!config || !Number.isSafeInteger(pr) || pr < 1) throw new Error("github check requires an opted-in project and --pr");
    output = checkPullRequest(new GitHubClient(root, config), pr);
  } else output = githubOperation(githubRequestSchema.parse({ projectRoot: root, action,
    ...(options.has("--workflow") ? { workflow: options.get("--workflow") } : {}),
    ...(options.has("--tracks") ? { tracks: options.get("--tracks")!.split(",") } : {}),
    ...(options.has("--evidence") ? { evidence: options.get("--evidence") } : {}),
    ...(options.has("--pr") ? { pr: Number(options.get("--pr")) } : {}),
    ...(options.has("--approval-digest") ? { approvalDigest: options.get("--approval-digest") } : {}) }));
  process.stdout.write(json(output));
  return 0;
}
