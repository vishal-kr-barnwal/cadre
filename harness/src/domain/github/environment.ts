import { z } from "zod/v4";
import { GitHubClient } from "./transport.js";

export const validatorEnvironment = "cadre-github";
const endpoint = `/environments/${validatorEnvironment}`;
const policy = { protected_branches: false, custom_branch_policies: true };

function readEnvironment(client: GitHubClient): unknown | null {
  const result = client.run("gh", ["api", "--hostname", client.config.hostname, `repos/${client.config.repository}${endpoint}`]);
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/\(HTTP 404\)/.test(result.stderr)) return null;
  throw new Error(`Cannot inspect validator environment: ${result.stderr.slice(0, 1500)}`);
}
function branchPolicies(client: GitHubClient) {
  const result = client.command("gh", ["api", "--hostname", client.config.hostname, "--paginate", "--slurp",
    `repos/${client.config.repository}${endpoint}/deployment-branch-policies?per_page=100`]);
  return z.array(z.object({ branch_policies: z.array(z.object({ name: z.string(), type: z.enum(["branch", "tag"]) })) }))
    .parse(JSON.parse(result)).flatMap((page) => page.branch_policies);
}
function requireCustomPolicy(environment: unknown): void {
  const parsed = z.object({ deployment_branch_policy: z.object({
    protected_branches: z.literal(false), custom_branch_policies: z.literal(true)
  }) }).safeParse(environment);
  if (!parsed.success) throw new Error("Validator environment must restrict access to the default branch; reconcile existing environment settings explicitly");
}
function requireExactBranch(policies: ReturnType<typeof branchPolicies>, branch: string): void {
  if (policies.length !== 1 || policies[0]!.name !== branch || policies[0]!.type !== "branch") {
    throw new Error("Validator environment must allow only the exact default branch, with no tag or PR policies");
  }
}

/** The credential belongs here, never in repository/organization-wide Actions secrets. */
export function requireValidatorEnvironment(client: GitHubClient, branch: string): void {
  requireCustomPolicy(readEnvironment(client));
  requireExactBranch(branchPolicies(client), branch);
}

/** Called only while applying approved opt-in configuration. Never weaken an existing environment. */
export function configureValidatorEnvironment(client: GitHubClient, branch: string): void {
  const existing = readEnvironment(client);
  if (existing === null) client.repo(endpoint, "PUT", { deployment_branch_policy: policy });
  else requireCustomPolicy(existing);
  const policies = branchPolicies(client);
  if (!policies.length) client.repo(`${endpoint}/deployment-branch-policies`, "POST", { name: branch, type: "branch" });
  else requireExactBranch(policies, branch);
  requireValidatorEnvironment(client, branch);
}
