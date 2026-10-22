---
title: GitHub Integration (Beta)
description: Opt-in GitHub Integration Beta with PR ownership, checkpoint pushes and enforcement; GitLab support is planned.
section: Operations
order: 115
---

# GitHub Integration (Beta)

**Status: Beta.** GitHub integration is explicitly opt-in. Projects without a GitHub
policy keep the existing local workflow: no GitHub calls, no requirement to
install `gh`, no automatic pushes, and no new approval gates.

Install the beta with `npm install -g cadre-ai@beta`, then run the normal client
installer. Version `4.1.0-beta.0` adds `github_status`, `github_operation`, and
`cadre-ai github`. Installing it does not enable GitHub mode in existing projects.
CI must pin an exact version such as `4.1.0-beta.0`, or a candidate archive digest;
the stable 4.0.0 package cannot serve as the new validator.

GitLab support is planned for a future release and is not implemented in this
Beta. No release date is committed. Follow the [roadmap](/team-and-polyrepo).

## One Operation, One PR

Every mutation reserves resources atomically through an append-only coordination
ref and immediately opens or joins its owning draft PR. The PR is the visible
lock. An existing reservation returns its PR URL and branch, including after an
interrupted publication.

Setup has one repository-wide reservation. Track planning and implementation have
separate PRs. Review and active revision use the existing implementation PR.
Refresh, archive and revert reserve their affected resources. Independent tracks
may proceed concurrently. Status and exploration do not need a PR.

Any repository writer may join. A renewable ten-minute writer lease serializes
Cadre state changes; the current coordinator can release it for handoff.
Coordinator sessions and publication recovery are stored in that worktree's Git
directory, outside immutable receipts. Ordinary Git fast-forward rules prevent
collaborators from overwriting each other's branch commits.

## Initial Activation

Use setup for a new Cadre project or an explicitly approved refresh for an
existing project. Start at a quiescent boundary and reconcile pending local
operations first. The repository must already have a default-branch commit.

Prepare a JSON policy with:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `mode` | `github-strict` |
| `repository` | Exact `OWNER/REPO` |
| `hostname` | GitHub hostname, normally `github.com` |
| `adoptionCommit` | Current default-branch commit |
| `validatorVersion` | Exact published Cadre version containing GitHub support |
| `validatorArchiveSha256` | Optional SHA-256 of a candidate package at `.github/cadre/validator.tgz` on trusted default; replaces npm registry installation |
| `requiredChecks` | Existing project CI check names |
| `codeOwners` | GitHub users or teams responsible for governance changes |

Run `cadre-ai github configure --config <policy-file>` to inspect the complete
generated files and approval digest. Apply the same proposal with
`--approval-digest <digest>`. It prepares `.cadre/github.json`,
`.github/workflows/cadre-github.yml`, and ownership rules while preserving
unrelated CODEOWNERS entries. The approved configuration also creates the
`cadre-github` environment with a deployment branch policy allowing only the
exact default branch. Existing broader environment policies are rejected without
being overwritten.

For pre-release validation, commit a built package archive at
`.github/cadre/validator.tgz` and set `validatorArchiveSha256` to its SHA-256.
The generated workflow verifies the trusted default-branch archive before
installing it with lifecycle scripts disabled. Governance ownership also covers
this archive. This supports isolated candidate testing without publishing a release.

Begin the setup/refresh operation, inspect its proposed branch/resources, and
apply its digest. Fetch and switch to the returned PR branch without discarding
local files. Include the approved policy and workflow files in the owning PR.

Add `CADRE_GITHUB_TOKEN` as an **environment secret** in `cadre-github`, using a
dedicated automation identity scoped to this repository with contents and
commit-status write, plus administration, actions, pull-request and checks read
permissions. Do not add this credential as a repository or organization secret: a
proposed workflow could access such a secret before governance review. Protection inspection
needs administration read, which the ordinary Actions token does not provide.
Configuration and activation need administration write. Activation and mutation
preflights verify that the environment still permits only the default branch. Keep the workflow
credential restricted to trusted governance code; never expose it to project CI.
Environment branch restrictions use the execution reference, so the trusted
`pull_request_target` workflow can access the credential while ordinary PR and
feature-branch workflows cannot. See GitHub's
[environment reference rules](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/),
[branch protection API permissions](https://docs.github.com/en/rest/branches/branch-protection)
and the [GitHub CLI API reference](https://cli.github.com/manual/gh_api).

The initial bootstrap PR must merge before its trusted workflow exists on
default. After its enforcement workflow successfully validates current default,
preview and approve `cadre-ai github activate`. Cadre configures required
checks and independent approval, stale-approval dismissal, current branches,
merge commits, and protection from default-branch force pushes/deletion.
Permissions or unsupported protection leave activation pending. Existing
restrictions that cannot safely be preserved require administrator
reconciliation rather than being silently removed.

## Plans and Dependencies

Setup must merge before track creation. A track's initial approved plan must
merge before implementation begins. Discovery paginates all open PRs; labels and
titles are not approval evidence.

For B depending on A, B can be drafted early. Its plan waits for A's plan to
merge; its implementation waits for A's reviewed implementation to merge.
After waiting, B requires a fresh scope, plan and dependency assessment against
current default. Cycles block progress. Material scope changes require approved
revision; revisions during implementation remain in the owning PR.

Dependencies use delivery verified on default, not a local `completed` flag.
An implementation can be reviewed locally while still awaiting merge.

## Automatic Publication and Phase Boundaries

Cadre publishes approved committed checkpoints after operation start,
specification/plan approval, task or commit-group completion, manual verification,
phase completion, synchronization, revision, refresh, review, remediation,
archive and revert. The agent makes the scoped commits; the runtime never stages
arbitrary working-tree files. Receipt reconciliation automatically publishes in
opted-in projects. Execution checkpoints without receipts use
`github_operation` with `action: "publish"`.

Publication targets only the owning PR branch and verifies that the remote
contains the intended commit. It never pushes default, all branches or tags, and
never force-pushes. Network failure preserves local commits and blocks dependent
work. A retry checks remote state before repeating the push.

If conflict reconciliation changes the approved pending checkpoint content, the
`reconcile-publication` action previews the committed resolution and verification
evidence for fresh digest approval. It preserves immutable receipts and does not
clear the publication gate: the reconciled checkpoint must still be pushed.

At the start and end of every phase, and before final review, the coordinator
fetches default, integrates verified worker work, merges default without
rebasing, resolves conflicts within approved scope, reassesses affected context,
and reruns verification. Workers must reach a safe boundary. Verified worker
commits must be reachable from the owning branch before publishing their journal.

The CLI's `sync` action previews HEAD/default and applies the inspected digest.
Publish the synchronized checkpoint before reassessment and further work.
`assess --evidence <text>` records the fresh assessment. Scope changes require an
independent teammate's approval of the revision checkpoint.

## Review, Enforcement and Bypass Recovery

The generated Action runs trusted default-branch workflow code and installs a
pinned validator with package scripts disabled. It treats PR files as data in a
disposable checkout, never runs project scripts with privileged credentials, and
reports the required `cadre-github` status against the exact PR head SHA.
Project tests remain in the project's own CI.

An implementation PR becomes ready after a clean Cadre review and publication.
GitHub independently enforces teammate approval and required checks before merge.
New code, scope, dependency or baseline changes invalidate stale evidence.

After an already clean review, a new baseline requires fresh verification and
semantic review. The digest-approved `review` action records revalidation for
the new head without rewriting the original completion receipt. Before the first
clean completion, baseline changes use an approved appended verification cycle
through the existing revision/review workflow.

Default-branch auditing and mutation preflights detect unexpected changes.
Read-only inspection stays available. A bypass conservatively blocks work when
its impact cannot be bounded. Restore protection and use a reconciliation PR to
review and adopt the changes or add an approved revert. After fresh review,
independent approval and merge, the digest-approved `recover --pr <number>`
action records adoption. It never fabricates missing historical approvals or
resets user history. Administrators who can disable enforcement remain outside
the prevention boundary. This is a coordination and provenance system for trusted
repository collaborators, not a cryptographic attestation of an agent's semantic
review: a repository writer can fabricate files or coordination history outside
Cadre. Independent review and protected governance remain required.

## Interface

`github_status {projectRoot}` reports mode, default branch, operations, PRs,
incidents and pending publication. It returns `enabled: false` without contacting
GitHub for local projects.

`github_operation` accepts `projectRoot`, `action`, and the action's
`workflow`, `tracks`, `evidence`, `pr` or `approvalDigest`. Actions are
`begin`, `renew`, `release`, `cancel`, `publish`, `sync`, `assess`,
`review`, `ready`, `audit`, `recover`, `reconcile-publication` and `activate`.
Begin, sync, activation, review revalidation and recovery return an exact digest
before apply.

Equivalent commands use `cadre-ai github <action>` with `--root`,
`--workflow`, `--tracks a,b`, `--evidence`, `--pr` and
`--approval-digest`. `configure` additionally accepts `--config`;
`check --pr` validates a PR, and `ci --event` is the trusted workflow entrypoint.

V1 supports one repository and same-repository collaborators. Cross-repository
dependencies, forks, squash merges and rebase merges are excluded. GitHub support
does not add a new user workflow or require migration of local-only projects.
