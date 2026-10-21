# GitHub collaboration validation — 2026-10-21

The feature is opt-in. The original source checkout and installed Cadre were not
modified. All source changes and checks ran in the isolated
`codex/github-collaboration` worktree. No release or deployment was performed.

## Final review fixes

- Restrict the validator credential to the `cadre-github` environment, allowing
  only the exact default branch. Repository-wide secrets can be requested by
  proposed workflows before governance review.
- Create and verify that environment during approved configuration. Preserve
  existing stronger settings; reject broader policies without overwriting them.
- Verify the environment again during activation and strict mutation preflights.
- Keep the generated job's ordinary Actions token read-only.
- Correct skill references to pass the returned `digest` as `approvalDigest`.
- Add regression coverage for environment drift and a complete local execution
  with a failing `gh` stub, no remote, no GitHub artifacts, and no GitHub session.

## Automated checks

- Full harness suite: **508 passed, 0 failed**.
- Final focused GitHub suite: **29 passed, 0 failed** (includes the additional
  complete local-workflow regression added while the full suite was running).
- Harness TypeScript check, package validation, and package dry run: passed.
- Full documentation content, lint, types, static build and SEO checks: passed.
- Git whitespace checks: passed.

## Complete strict track, before final credential isolation hardening

The disposable public repository `vishal-kr-barnwal/cadre-strict-validation-20261021`
ran the built candidate validator on GitHub Actions with strict protection active.
Five owning PRs merged: adoption/setup, planning, implementation, a CI refresh
between implementation phases, and bypass reconciliation.

The two-phase track exercised native execution, verified task and manual
checkpoints, automatic receipt pushes, unpublished-progress rejection, current
default synchronization, fresh assessment, clean review, independent approval,
required product CI, protected merge, and merge-provenance audit. Direct pushes
were rejected while protection was enabled. Deliberately disabled protection and
a synthetic direct push triggered a persistent incident; a reviewed protected
reconciliation PR and explicit recovery restored operation.

Distinct identities were the Actions bot and authenticated owner, not two human
accounts. Expected failures and coordination races were resumed without rewriting
history. The original fixture used a repository Actions secret with explicit
user authorization; the final implementation requires an environment secret.
This historical full-track run did not exercise that later isolation change.

`strict-track-report.json` records the checkpoints and merge SHAs. Implementation
merge: `581fdd6b6f2782e388458687026f07b6cf509e84`. Final hosted audit:
`39559332883`, success. The repo and its secret were deleted and authenticated
GET returned 404 at `2026-10-21T07:05:55Z`.

## Live validation of the final environment boundary

A second synthetic public repo,
`vishal-kr-barnwal/cadre-environment-validation-20261021`, exercised the candidate's
actual environment configuration and validation code. Its environment secret was
an inert sentinel, not a real credential.

| Execution | Run | Result |
| --- | --- | --- |
| Trusted default workflow dispatch | 39562368845 | Success; environment secret available |
| Trusted `pull_request_target` | 39562389008 | Success; environment secret available |
| Ordinary `pull_request` | 39562388645 | Rejected: `refs/pull/1/merge` cannot access environment |
| Feature-branch dispatch | 39562451378 | Rejected: `codex/untrusted-fixture` cannot access environment |

A deliberately widened deployment policy was also rejected by the candidate;
restoring the exact default-only rule passed verification. `environment-actions.json`
contains the hosted run outcomes. The repository and environment secret were
then deleted; `environment-cleanup.json` records authenticated GET 404.

These are recorded live results, not tests that automatically create public
repositories or consume credentials when the local suite runs. GitHub links to
the deleted fixtures intentionally no longer resolve.
