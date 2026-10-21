import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configPath, configSchema, digest, json, type GitHubConfig } from "./model.js";
import { atomicWrite, safePath, sessionFor, writeSession, readSession } from "./storage.js";
import { validateProject } from "../state.js";
import { GitHubClient } from "./transport.js";
import { requireProtection } from "./policy.js";
import { readLedger, writeLedger } from "./ledger.js";
import { z } from "zod/v4";
import { configureValidatorEnvironment, requireValidatorEnvironment, validatorEnvironment } from "./environment.js";

export function enforcementFiles(client: GitHubClient): Record<string, string> {
  const identity = client.identity();
  if (/["\\\n\r]/.test(identity.defaultBranch)) throw new Error("Default branch cannot be rendered safely");
  const moduleRoot = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleRoot, "../../../templates/github-v1/enforcement.yml"),
    resolve(moduleRoot, "../../../../templates/github-v1/enforcement.yml"), resolve(moduleRoot, "../templates/github-v1/enforcement.yml")];
  const path = candidates.find(existsSync);
  if (!path) throw new Error("Packaged GitHub enforcement template unavailable");
  const workflow = readFileSync(path, "utf8").replaceAll("{{DEFAULT_BRANCH}}", identity.defaultBranch)
    .replaceAll("{{VALIDATOR_INSTALL}}", client.config.validatorArchiveSha256
      ? `printf '%s  %s\\n' '${client.config.validatorArchiveSha256}' '.github/cadre/validator.tgz' | sha256sum --check --strict\n          npm install --ignore-scripts --no-audit --no-fund --prefix "$RUNNER_TEMP/cadre-validator" "$GITHUB_WORKSPACE/.github/cadre/validator.tgz"`
      : `npm install --ignore-scripts --no-audit --no-fund --prefix "$RUNNER_TEMP/cadre-validator" "cadre-ai@${client.config.validatorVersion}"`);
  const ownersPath = safePath(client.root, ".github/CODEOWNERS");
  const owners = existsSync(ownersPath) ? readFileSync(ownersPath, "utf8") : "";
  const marker = "# Cadre GitHub governance", end = "# End Cadre GitHub governance";
  const lines = ["/.github/workflows/", "/.github/cadre/", "/.github/CODEOWNERS", "/.cadre/github.json", "/.cadre/github/"].map((entry) => `${entry} ${client.config.codeOwners.join(" ")}`);
  const block = `${marker}\n${lines.join("\n")}\n${end}\n`;
  if (owners.includes(marker) && !owners.endsWith(block)) throw new Error("Existing Cadre CODEOWNERS rules require an explicitly reviewed refresh");
  return { [configPath]: json(client.config), ".github/workflows/cadre-github.yml": workflow,
    ".github/CODEOWNERS": owners.endsWith(block) ? owners : `${owners}${owners.endsWith("\n") || !owners ? "" : "\n"}\n${block}` };
}
export function previewConfigure(root: string, config: GitHubConfig, client = new GitHubClient(root, config)) {
  configSchema.parse(config);
  if (existsSync(safePath(root, ".cadre/project.json"))) {
    const validation = validateProject(root);
    if (validation.errors.length || [...validation.states.values()].some((state) => state.operation)) {
      throw new Error("GitHub adoption requires a valid, committed project at a quiescent boundary; finish pending local operations first");
    }
  }
  const identity = client.identity();
  if (identity.base !== config.adoptionCommit) throw new Error("New opt-in adoptionCommit must equal current default; inspect the updated baseline");
  const files = enforcementFiles(client);
  for (const [path, content] of Object.entries(files)) {
    const target = safePath(root, path);
    if (path !== ".github/CODEOWNERS" && existsSync(target) && readFileSync(target, "utf8") !== content) throw new Error(`Preserve existing ${path}; refresh needs an exact reviewed replacement`);
  }
  const before = Object.fromEntries(Object.keys(files).map((path) => [path, existsSync(safePath(root, path)) ? readFileSync(safePath(root, path), "utf8") : null]));
  const environment = { name: validatorEnvironment, branch: identity.defaultBranch } as const;
  return { files, before, environment, digest: digest({ config, files, before, environment }) };
}
export function configure(root: string, config: GitHubConfig, approvalDigest: string, client = new GitHubClient(root, config)) {
  const session = sessionFor(root, config);
  if (json(session.config) !== json(config)) throw new Error("Configuration differs from the approved pending policy");
  const proposal = session.configuration ?? previewConfigure(root, config, client);
  if (proposal.digest !== approvalDigest) throw new Error("GitHub configuration proposal changed");
  for (const [path, content] of Object.entries(proposal.files)) {
    const current = existsSync(safePath(root, path)) ? readFileSync(safePath(root, path), "utf8") : null;
    if (current !== proposal.before[path] && current !== content) throw new Error(`Configuration recovery drift in ${path}; preserve and review it`);
  }
  writeSession(root, { ...session, configuration: proposal });
  if (client.identity().defaultBranch !== proposal.environment.branch) throw new Error("Default branch changed during configuration; review the environment policy again");
  configureValidatorEnvironment(client, proposal.environment.branch);
  for (const [path, content] of Object.entries(proposal.files)) atomicWrite(root, path, content);
  const { configuration: _configuration, ...completed } = readSession(root)!;
  writeSession(root, completed);
  return { files: Object.keys(proposal.files), status: "pending_activation" };
}
export function previewActivation(client: GitHubClient) {
  const identity = client.identity(), snapshot = readLedger(client);
  requireValidatorEnvironment(client, identity.defaultBranch);
  if (!snapshot) throw new Error("Begin the approved setup or refresh PR first");
  const body = client.file(identity.base, configPath);
  if (!body || json(configSchema.parse(JSON.parse(body))) !== json(client.config)) throw new Error("Approved GitHub configuration must merge into default before activation");
  const owner = z.object({ owner: z.object({ type: z.enum(["User", "Organization"]) }) }).parse(client.repo()).owner;
  const rules = {
    required_status_checks: { strict: true, checks: [] as Array<{ context: string; app_id: number }> },
    enforce_admins: true, required_pull_request_reviews: { dismiss_stale_reviews: true, require_code_owner_reviews: true,
      require_last_push_approval: true,
      required_approving_review_count: 1,
      ...(owner.type === "Organization" ? { bypass_pull_request_allowances: { users: [], teams: [], apps: [] } } : {}) },
    restrictions: null, required_linear_history: false, allow_force_pushes: false, allow_deletions: false,
    required_conversation_resolution: true
  };
  const before = client.run("gh", ["api", "--hostname", client.config.hostname,
    `repos/${client.config.repository}/branches/${encodeURIComponent(identity.defaultBranch)}/protection`]);
  if (before.status && !/\(HTTP 404\)/.test(before.stderr)) throw new Error("Cannot inspect existing branch protection");
  // Never silently remove unrelated checks or push restrictions.
  const previous = before.status ? null : z.object({
    required_status_checks: z.object({ contexts: z.array(z.string()).optional(),
      checks: z.array(z.object({ context: z.string(), app_id: z.number().nullable() })).optional() }).nullish(),
    restrictions: z.unknown().optional(), required_linear_history: z.object({ enabled: z.boolean() }).optional(),
    lock_branch: z.object({ enabled: z.boolean() }).optional(),
    required_pull_request_reviews: z.object({ required_approving_review_count: z.number().optional(),
      dismissal_restrictions: z.object({ users: z.array(z.unknown()).optional(), teams: z.array(z.unknown()).optional(), apps: z.array(z.unknown()).optional() }).optional()
    }).nullish()
  }).parse(JSON.parse(before.stdout));
  if (previous?.restrictions) throw new Error("Existing push restrictions require administrator reconciliation; Cadre will not overwrite them");
  const dismissals = previous?.required_pull_request_reviews?.dismissal_restrictions;
  if (previous?.required_linear_history?.enabled || previous?.lock_branch?.enabled
    || (dismissals && [...dismissals.users ?? [], ...dismissals.teams ?? [], ...dismissals.apps ?? []].length)) {
    throw new Error("Existing linear-history, branch lock or review-dismissal restrictions require administrator reconciliation; Cadre will not weaken them");
  }
  const previousChecks = previous?.required_status_checks?.checks ?? [];
  const requiredContexts = [...new Set(["cadre-github", ...client.config.requiredChecks,
    ...(previous?.required_status_checks?.contexts ?? []), ...previousChecks.map((check) => check.context)])];
  // GitHub's request schema accepts contexts OR checks, never both.
  rules.required_status_checks.checks = requiredContexts.map((context) => ({
    context, app_id: previousChecks.find((check) => check.context === context)?.app_id ?? -1
  }));
  rules.required_pull_request_reviews.required_approving_review_count = Math.max(1, previous?.required_pull_request_reviews?.required_approving_review_count ?? 1);
  const proposal = { base: identity.base, defaultBranch: identity.defaultBranch, rules,
    repositorySettings: { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false },
    previous, ledgerHead: snapshot.head };
  return { ...proposal, digest: digest(proposal) };
}
export function activate(client: GitHubClient, approvalDigest: string) {
  const proposal = previewActivation(client);
  if (proposal.digest !== approvalDigest) throw new Error("GitHub activation proposal changed");
  const workflow = client.file(proposal.base, ".github/workflows/cadre-github.yml");
  if (workflow !== enforcementFiles(client)[".github/workflows/cadre-github.yml"]) throw new Error("Exact trusted pinned enforcement workflow has not merged");
  const owners = client.file(proposal.base, ".github/CODEOWNERS");
  if (!owners || ["/.github/workflows/", "/.github/cadre/", "/.github/CODEOWNERS", "/.cadre/github.json", "/.cadre/github/"].some((path) =>
    !owners.includes(`${path} ${client.config.codeOwners.join(" ")}\n`))) throw new Error("Approved governance CODEOWNERS must be present on default");
  const runs = z.object({ workflow_runs: z.array(z.object({ head_sha: z.string(), conclusion: z.string().nullable(), path: z.string() })) })
    .parse(client.repo("/actions/workflows/cadre-github.yml/runs?per_page=100"));
  if (!runs.workflow_runs.some((run) => run.head_sha === proposal.base && run.conclusion === "success" && run.path === ".github/workflows/cadre-github.yml")) {
    throw new Error("Enforcement workflow must successfully validate current default before activation");
  }
  client.repo("", "PATCH", proposal.repositorySettings);
  client.repo(`/branches/${encodeURIComponent(proposal.defaultBranch)}/protection`, "PUT", proposal.rules);
  requireProtection(client, proposal.defaultBranch);
  const snapshot = readLedger(client)!;
  // Partial remote configuration is resumable; active is only set after verification.
  if (snapshot.head !== proposal.ledgerHead) throw new Error("Coordination changed during activation; inspect and retry");
  writeLedger(client, snapshot, { ...snapshot.value, active: true });
  return { active: true, defaultBranch: proposal.defaultBranch };
}
