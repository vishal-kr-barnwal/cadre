# Optional strict GitHub collaboration

Apply this reference only after explicit project opt-in through `.cadre/github.json`. Local projects keep every existing workflow, approval, commit, and scheduling rule. Never install Actions, contact GitHub, require `gh`, or change branches for a project that has not opted in.

## Entry and ownership

Use `github_status {projectRoot}` to inspect the repository, active operations, PR references and unpublished checkpoint. Use `github_operation` with `action: "audit"` when default has advanced. Preserve incidents and report their reference; never edit the coordination ledger to clear one.

Every mutation belongs to one PR. Call `github_operation` with `{projectRoot, action: "begin", workflow, tracks}` to preview the operation, then pass the unchanged returned `digest` as `approvalDigest`. The workflow invocation and enabled policy authorize opening the scoped draft PR; retain any existing human artifact approvals. An existing reservation returns its owning PR; join that PR instead of opening a duplicate. Review and revision join the open planning/implementation PR. Reserve every affected track for refresh, archive, revert, or reconciliation.

Fetch the returned branch and switch to it without discarding or stashing user work. Work from that branch for the whole operation. Only the coordinator owns Cadre state. Renew the ten-minute writer lease with `action: "renew"` before it expires; `action: "release"` hands off the writer role. Another writer must wait for release or expiry. Anyone with repository write permission can subsequently join. If publication was interrupted, repeat begin to recover the existing reservation and PR.

Read proposed specifications and relevant diffs from all open Cadre PRs, not just their titles/labels. Record dependency IDs and PR links. B may be drafted while A is pending, but B's plan waits for A's plan merge and B's implementation waits for A's reviewed implementation merge. The initial plan must be on default. After waiting, reassess current scope, plan and dependencies before implementation; material scope changes need revision approval.

## Phase synchronization and publication

Before each phase starts, after its verified work is integrated, and before final review:

1. Commit and publish the preceding approved checkpoint.
2. Drain active tasks and integrate verified worker results. Workers never push.
3. Preview `action: "sync"`, inspect its exact HEAD/default/branch and pass its unchanged `digest` as `approvalDigest` under the workflow's synchronization authorization. This explicitly fetches and merges default; it never rebases or force-pushes.
4. On conflict, preserve the merge and resolve only within approved scope. Stop for a material decision. Re-run affected verification.
5. Publish the synchronized checkpoint, then reassess the specification, plan and dependency context; use `action: "assess", evidence: "..."` with the actual fresh assessment. Changed scope on an implementation branch requires an independent teammate approval of the published revision checkpoint before execution resumes.
6. Commit and publish any additional approved reconciliation, then assess again before proceeding.

In GitHub mode, durable progress commits supplement the local workflow's final bookkeeping commit: after execution start, each completed task/commit group or manual-verification checkpoint, each phase completion, and each approved spec/plan/revision/refresh/review/archive/revert, commit only the approved checkpoint files and receipt if present. Preserve task product SHAs; do not rewrite receipts or create self-referential record-SHA commits.

For parallel work, integrate each completed group's verified product commits into the owning PR branch using normal non-squash Git merges under its existing integration authorization before publishing its journal. Retain phase/worktree provenance for normal cleanup; do not publish references to worker commits that only exist locally. Main alone performs these merges.

Then call `github_operation {projectRoot, action: "publish", evidence: "<checkpoint>"}`. Receipt reconciliation automatically publishes in opted-in projects; use explicit publish for execution/node checkpoints without receipts. Never stage arbitrary files or push default, all branches, tags, or worker branches. A failed push leaves work committed locally and blocks dependent work. Inspect/retry publication, not implementation. A concurrent remote advance requires fetching, reconciliation and verification, never force.

If that verified reconciliation changes a pending checkpoint's approved bytes, commit the reviewed merge and use `action: "reconcile-publication", evidence: "<affected verification and resolution>"`. Inspect and explicitly approve its returned digest, then publish. This accepts current reconciled checkpoint content, never replacement immutable receipts. Publication and collaborator handoff remain blocked until recovery and the push succeed.

## Review and recovery

Only mark the PR ready after a fresh clean Cadre review and all committed checkpoints are published: `action: "ready"`. GitHub independently requires teammate approval and required checks before merge. Readiness does not merge the PR. Local `completed` means reviewed, awaiting merge until remote delivery is verified. Archive/dependent implementation must wait for verified delivery.

If default advances after an already clean review, preserve the historical completion receipt. Synchronize, verify the entire resulting change, perform a fresh semantic Cadre review, and use `action: "review", evidence: "<fresh verification, review and remaining risks>"` to prepare revalidation. Present its exact digest for explicit approval, then apply with `approvalDigest`. This records current-head evidence without rewriting prior reviews. Findings must be fixed and freshly reviewed; do not attest clean while findings remain. If default changes before the first clean completion, use an approved appended verification/remediation cycle through the existing revision/review machinery rather than rewriting execution history.

When enforcement is bypassed, read-only inspection remains available. Restore required protection, then begin a `workflow: "reconcile"` PR covering the affected tracks. Review the incident's entire change, adopt it with correct Cadre evidence or add an approved revert, and run fresh verification. Record a fresh approved `action: "review"`, then mark ready and obtain independent approval. After that reconciliation PR merges, prepare/apply `action: "recover", pr: <number>` with its exact digest. This records adoption and releases affected historical reservations without fabricating original approvals. No hard reset, history rewrite, silent adoption, or automatic merge is allowed.

## First-time activation

Only on explicit opt-in, prepare a policy containing repository/hostname, adoption commit, pinned validator package version, required project CI check names and CODEOWNERS. Use `cadre-ai github configure --config <file>` to inspect the complete generated files/digest, then apply with `--approval-digest`. This writes policy, versioned Actions and ownership rules. Reserve the create/refresh PR, switch to its branch, and include those approved files in its commits.

The first approved bootstrap PR must merge before its trusted workflow exists on default. Publish a package containing the GitHub commands before choosing its exact version for CI. Approved configuration creates the `cadre-github` environment restricted to the exact default branch. Add `CADRE_GITHUB_TOKEN` only as a secret in that environment, never as a repository or organization secret, with repository-scoped contents/statuses write and administration/actions/pull-requests/checks read permissions; the standard Actions token cannot inspect all protection settings. Use a dedicated automation identity and keep this credential restricted to the trusted workflow. After a successful enforcement run at current default, preview/apply `action: "activate"` with approval of the exact repository settings and protection proposal. Activation stays pending if permissions, plan support, or checks fail. Do not report strict enforcement active until verification succeeds. Empty repositories need an initial default-branch commit before this opt-in; never initialize a remote implicitly.
