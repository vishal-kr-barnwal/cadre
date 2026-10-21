import { z } from "zod/v4";
import { GitHubClient } from "./transport.js";
import { assertAcyclic, digest, slug, type GitHubOperation } from "./model.js";
import { readLedger } from "./ledger.js";
import { parsePlanContent } from "../plan.js";
import { requireValidatorEnvironment } from "./environment.js";

const trackSchema = z.object({ trackId: slug, dependencies: z.array(slug).default([]),
  revision: z.number().int().positive(), status: z.string(), commits: z.object({ plan: z.string().optional(), spec: z.string().optional() }).optional() });
export function requireProtection(client: GitHubClient, branch: string): void {
  requireValidatorEnvironment(client, branch);
  const protection = z.object({
    enforce_admins: z.object({ enabled: z.literal(true) }),
    required_status_checks: z.object({ strict: z.literal(true), contexts: z.array(z.string()) }),
    required_pull_request_reviews: z.object({ required_approving_review_count: z.number().min(1),
      dismiss_stale_reviews: z.literal(true), require_code_owner_reviews: z.literal(true),
      require_last_push_approval: z.literal(true),
      bypass_pull_request_allowances: z.object({ users: z.array(z.unknown()), teams: z.array(z.unknown()), apps: z.array(z.unknown()) }).optional() }),
    allow_force_pushes: z.object({ enabled: z.literal(false) }), allow_deletions: z.object({ enabled: z.literal(false) })
  }).parse(client.repo(`/branches/${encodeURIComponent(branch)}/protection`));
  for (const check of ["cadre-github", ...client.config.requiredChecks]) {
    if (!protection.required_status_checks.contexts.includes(check)) throw new Error(`Required GitHub check missing: ${check}`);
  }
  const bypass = protection.required_pull_request_reviews.bypass_pull_request_allowances;
  if (bypass && [...bypass.users, ...bypass.teams, ...bypass.apps].length) throw new Error("GitHub review bypass allowances must be empty");
  const settings = z.object({ allow_squash_merge: z.literal(false), allow_rebase_merge: z.literal(false) }).safeParse(client.repo());
  if (!settings.success) throw new Error("Strict GitHub mode requires squash/rebase merging disabled");
}
export function scopeDigest(client: GitHubClient, tracks: string[], ref = "HEAD"): string {
  const paths = [".cadre/product.md", ".cadre/guidelines.md", ".cadre/workflow.md", ".cadre/tech-stack.md", ".cadre/github.json",
    ".cadre/patterns", ".cadre/styleguides", ...tracks.flatMap((id) => {
      slug.parse(id); return [`.cadre/tracks/${id}/spec.md`, `.cadre/tracks/${id}/plan.md`, `.cadre/tracks/${id}/dependency-context.json`];
    })];
  // plan.md contains completion markers: assessments bind specification + dependency context;
  // plan revisions and graph shape are validated separately by Cadre's provenance validator.
  const graphs = tracks.map((id) => {
    const path = `.cadre/tracks/${id}/plan.md`, result = client.run("git", ["show", `${ref}:${path}`]);
    return [id, result.status === 0 ? parsePlanContent(result.stdout, path).digest : null];
  });
  return digest({ sources: client.git("ls-tree", "-r", ref, "--", ...paths.filter((path) => !path.endsWith("/plan.md"))), graphs });
}
export function readTrack(client: GitHubClient, ref: string, id: string) {
  slug.parse(id);
  const body = client.file(ref, `.cadre/tracks/${id}/state.json`) ?? client.file(ref, `.cadre/archive/${id}/state.json`);
  return body ? trackSchema.parse(JSON.parse(body)) : null;
}
export function requireDelivered(client: GitHubClient, id: string, base: string): void {
  const ledger = readLedger(client);
  const operation = ledger ? [...ledger.value.operations].reverse().find((entry) => entry.workflow === "implement" && entry.tracks.includes(id) && entry.state === "merged") : undefined;
  const track = readTrack(client, base, id);
  if (!track || !["completed", "archived"].includes(track.status)) throw new Error(`Dependency ${id} is not complete on default`);
  // Tracks completed before explicit adoption retain their accepted baseline.
  if (!operation) {
    const adopted = readTrack(client, client.config.adoptionCommit, id);
    if (adopted && ["completed", "archived"].includes(adopted.status) && adopted.revision === track.revision) return;
    throw new Error(`Dependency ${id} has no verified merged implementation PR`);
  }
  const recovery = operation.recoveredBy ? ledger?.value.operations.find((entry) => entry.id === operation.recoveredBy && entry.state === "merged") : undefined;
  if ((!operation.review && !recovery?.review) || !operation.pr) throw new Error(`Dependency ${id} lacks clean review evidence`);
  const pr = client.pr(operation.pr);
  if (!pr.merged || !pr.merge_commit_sha || client.run("git", ["merge-base", "--is-ancestor", pr.merge_commit_sha, base]).status !== 0) {
    throw new Error(`Dependency ${id} is not delivered: ${operation.url}`);
  }
}
export function requireDependencies(client: GitHubClient, operation: GitHubOperation, base: string, delivery: boolean): void {
  const graph = new Map<string, string[]>();
  const open = client.prs(); // Pagination is mandatory; labels are only presentation.
  const ledger = readLedger(client);
  for (const entry of ledger?.value.operations ?? []) {
    if (!["reserved", "open"].includes(entry.state)) continue;
    const pr = open.find((candidate) => candidate.number === entry.pr);
    if (!pr) continue;
    for (const id of entry.tracks) {
      const track = readTrack(client, pr.head.sha, id);
      if (track) graph.set(id, track.dependencies);
    }
  }
  const visit = (id: string, seen = new Set<string>()) => {
    if (seen.has(id)) return;
    seen.add(id);
    const track = readTrack(client, base, id);
    if (!track) throw new Error(`Track ${id} plan is not merged into default`);
    if (!graph.has(id)) graph.set(id, track.dependencies);
    for (const dependency of track.dependencies) {
      if (delivery) requireDelivered(client, dependency, base);
      visit(dependency, seen);
    }
  };
  for (const id of operation.tracks) {
    if (operation.workflow === "track") {
      const track = readTrack(client, operation.branch, id);
      if (track) {
        graph.set(id, track.dependencies);
        for (const dependency of track.dependencies) visit(dependency);
      }
    } else {
      visit(id);
      // Approved same-PR revisions can add dependencies beyond the original default plan.
      const proposed = readTrack(client, operation.branch, id);
      for (const dependency of proposed?.dependencies ?? []) {
        if (delivery) requireDelivered(client, dependency, base);
        visit(dependency);
      }
    }
  }
  assertAcyclic(graph);
}

/** Recheck the actual reviewed commit, never a repository-wide latest result. */
export function requireSuccessfulChecks(client: GitHubClient, head: string, active = true): void {
  const statuses = client.pages(`/commits/${head}/statuses?per_page=100`);
  const latest = new Map<string, string>();
  for (const value of statuses) {
    const status = z.object({ context: z.string(), state: z.string() }).parse(value);
    if (!latest.has(status.context)) latest.set(status.context, status.state); // API is newest first.
  }
  const pages = JSON.parse(client.command("gh", ["api", "--hostname", client.config.hostname, "--paginate", "--slurp",
    `repos/${client.config.repository}/commits/${head}/check-runs?filter=latest&per_page=100`])) as unknown;
  const runs = z.array(z.object({ check_runs: z.array(z.object({ name: z.string(), head_sha: z.string(),
    status: z.string(), conclusion: z.string().nullable() })) })).parse(pages).flatMap((page) => page.check_runs);
  for (const name of [...client.config.requiredChecks, ...(active ? ["cadre-github"] : [])]) {
    const matching = runs.filter((run) => run.name === name && run.head_sha === head);
    const status = latest.get(name);
    if ((status !== undefined && status !== "success")
      || matching.some((run) => run.status !== "completed" || !["success", "neutral", "skipped"].includes(run.conclusion ?? ""))
      || (status === undefined && !matching.length)) throw new Error(`Required check ${name} did not pass at ${head}`);
  }
}
export function requireIndependentApproval(client: GitHubClient, prNumber: number, head: string): void {
  const pr = client.pr(prNumber);
  const reviews = client.pages(`/pulls/${prNumber}/reviews?per_page=100`);
  const latest = new Map<string, { state: string; commit_id: string }>();
  for (const entry of reviews) {
    const review = z.object({ user: z.object({ login: z.string() }), state: z.string(), commit_id: z.string() }).parse(entry);
    if (review.state !== "COMMENTED") latest.set(review.user.login, review);
  }
  if (![...latest].some(([login, review]) => login !== pr.user.login && review.state === "APPROVED" && review.commit_id === head)) {
    throw new Error(`Independent teammate approval required for PR #${prNumber} at ${head}`);
  }
}
