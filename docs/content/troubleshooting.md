---
title: Troubleshooting
description: Resolve installation, MCP, state, journal, plan, worktree, integration, and review failures.
section: Operations
order: 130
---

# Troubleshooting

Start with the smallest read-only diagnostic that owns the problem. Preserve
files, journals, branches, and worktrees until Cadre has reconciled them.

## The `cadre-ai` Command Is Missing

```bash
npm install -g cadre-ai
cadre-ai --version
cadre-ai doctor
```

The executable is `cadre-ai`, not `cadre`. `doctor` verifies the packaged CLI,
MCP runtime, manifests, skills, and templates.

## The Plugin Is Missing Or Stale

```bash
cadre-ai install
codex plugin list --json
claude plugin list --json
```

Then start a new Codex conversation or run `/reload-plugins` in Claude Code.
For Zed, open a new Agent thread and inspect AI → Skills and AI → MCP Servers.
Use `--target codex`, `--target claude`, `--target zed`, or `--target all` to
remove auto-detection ambiguity.

If another marketplace named `cadre` points elsewhere, review the path and rerun
with `--replace-marketplace` only when replacement is intended.

## Claude Still Prompts Or Does Not Start Cadre MCP

Rerun `cadre-ai install --target claude`. The installer should preserve
unrelated JSONC settings while ensuring both:

- `cadre` is present in `enabledMcpjsonServers`;
- `mcp__cadre__*` is present in `permissions.allow`.

If `permissions.deny` blocks Cadre tools, installation stops rather than
overriding the deny rule. Remove or narrow the conflicting rule deliberately.

## Zed Skills Or MCP Are Missing

Rerun `cadre-ai install --target zed`. Cadre refuses to replace any existing
`~/.agents/skills/cadre-*` path that it does not own. Move or rename the
conflicting skill deliberately, then retry. In `~/.config/zed/settings.json`,
confirm `context_servers.cadre` points to the packaged `cadre-mcp.mjs`; the
installer preserves unrelated JSONC settings and refuses to replace a
different server already named `cadre`.

## Cadre MCP Is Unavailable

Confirm `cadre-ai doctor`, native plugin listings, and client reload first.
Stateful workflows require the installed MCP runtime and must stop rather than
reconstructing templates or state logic from memory. `wisp` is the only
workflow that can remain a stateless exploration without MCP.

## Cadre Finds The Wrong Project

Run Git root discovery from the intended directory:

```bash
git rev-parse --show-toplevel
```

Cadre rejects filesystem roots and home directories. `create` never initializes
a nested repository when an enclosing worktree exists. If the repository
boundary is materially ambiguous, choose it explicitly before approval.

## Create Finds Existing State

If `.cadre/project.json` exists, `create` resumes its setup checkpoint. It does
not overwrite or reinitialize the project. Use `status` to inspect the current
operation, then continue `create` or use `refresh` after setup is complete.

## A Workflow Reports A Journal Mismatch

Inspect the reported files, Git status, HEAD, branches, commits, and worktrees.
Do not delete the journal or reset the repository.

Common legitimate recovery cases are:

- approved files are dirty and ready for their expected commit;
- the expected commit already exists and only its SHA needs recording;
- artifact work is committed while follow-up state bookkeeping remains dirty;
- a worker commit or merge exists but its node transition is not recorded.

Anything else requires a deliberate reconciliation decision.

Cadre 3.9.1 preserves the reviewed product HEAD across bookkeeping commits and
recognizes already committed receipts. Upgrade the installed integration if
implementation/review keeps requesting another bookkeeping commit. Resume the
existing track and reconcile its original operation receipt; keep the verified
product HEAD and approval evidence. Replaying a committed operation should
return the original receipt with zero changes. Do not reset the repository or
create a new receipt merely to record the previous commit's SHA.

## Autonomous Stops After A Revision

A committed revision record and a reconciled receipt do not prove that the
approved manifest included the matching state and execution transition.
Compare the record's revision numbers, canonical state, spec/plan references,
Autonomous scope reference, and the original receipt manifest. Reconcile that
receipt once; repeated reconciliation cannot supply missing approved fields.
Preserve the journals and Git evidence and prepare an explicitly approved
revise/refresh repair. Do not clear the operation, rewrite the journal graph,
or change Autonomous authority by hand. Keep the old revision record immutable
and use a fresh repair artifact. If the active journal and canonical graph
differ, the repair must name the journal's original graph digest and reachable
plan commit under `Recovery evidence`; the runtime verifies that committed
baseline before proposing supersession.

Cadre 3.9.2 requires the complete revision state and record before approval. At a safe
boundary it includes the old execution as superseded history and starts a new
execution for the revised graph, retaining modes and completed work. This
behavior fixes the active-revision gap in 3.9.1. Update both the global CLI and
installed integrations, then start a fresh client session. An already broken
track still requires the explicitly approved repair described above.

## Revise Or Refresh Stops After Worker Cleanup

Completed journals retain worker branch names and paths, including provenance
carried into later executions. Cadre 3.9.2 checks registered worktrees, remaining
directories, and actual Git branches instead of treating those historical strings
as active workers. Finish supported cleanup of integrated workers before preparing
a revision or refresh; preserve the journal evidence. A remaining worker branch,
orphaned directory, or unsafe symlink still blocks promotion.

A v5 refresh that changes active scope must include one fresh revision record per
affected track, proposed state with the next track revision, a reassessed plan,
and synchronized learning/dependency context. Keep authored execution and
Autonomous authority fields unchanged; the runtime previews their resulting
transition within the same approval. Context-only refresh retains counters and
current scope authority. Complete legacy contract/policy migration first, then
prepare a separate v5 scope proposal if needed.

## Resume Reports OPERATION_INPUT_DRIFT

The pending operation's unchanged pattern, dependency or context inputs differ
from the exact approved fingerprints. Resume stops before further promotion and
keeps its original journal and approval. Preserve the changed files and inspect
the reported paths. Deliberately restore the approved inputs, or obtain an exact
repair approval; do not replace the journal, change its hashes, or repeat product
work. A committed operation still replays without changes after later guidance
updates. Recovery fingerprints live in temporary state; published receipts remain
unchanged. Older pending receipts check fingerprints retained in proposed artifacts.

## Refresh Rejects Authored Autonomous Authority

Context refresh retains the entire original loop: authorization, cumulative
review baseline, findings, recorded attempts and blockers. Keep these fields
unchanged in staged state. Use the review/revision procedures for their permitted
lifecycle changes, and the explicit legacy policy migration for an old execution's
first Autonomous authority. Changing context is not permission to shorten the
review range or remove a finding attempt.

## Revising An Imported Draft Specification

An imported track at `drafting-plan` can revise its already approved specification
without approving the unfinished plan. Include next track/spec/draft-plan counters,
a fresh revision record, and reassessed plan/learning/dependency context. Preserve
authored commit references and keep status `drafting-plan`; the runtime records the
old specification approval and leaves `commits.plan` null. The approved baseline
comes from the reachable specification commit, even when requested edits are
already present on disk. An initial draft that
has no plan uses previous plan revision 0. Resume track planning and obtain plan
approval before implementation. Draft-plan-only edits remain in the track flow.

## Plan Graph Validation Fails

Check that:

- every regular phase explicitly declares its phase dependencies;
- every regular task explicitly declares same-phase task dependencies;
- references exist and the graph is acyclic;
- each phase ends with exactly one derived `User Manual Verification` barrier;
- the final track-level verification phase contains only its manual task and
  depends on every delivery phase;
- completed tasks contain reachable commit provenance appropriate to state.

Update the proposal and rerun graph validation before seeking approval.

## Implementation Is Not Spawning Workers

Parallel mode creates workers only when at least two safe nodes are ready. One
ready node executes in main. Also inspect:

- incomplete declared track dependencies;
- phase/task dependencies;
- active or conflicted nodes;
- the workflow worker bound and host capacity;
- whether a phase has an active phase-worker lease that must reach a clean
  handoff before task-worker fan-out.

The generated workflow defaults to three delegated workers, while the runtime
accepts `maxWorkers` values from `1` through `32`. A higher value does not create
workers when the host exposes fewer child slots or the DAG has fewer safe ready
nodes. A retained worktree is not necessarily an active worker slot.

This is expected scheduling behavior, not necessarily a failure.

## Integration Or Cleanup Is Refused

Integration requires clean source and target worktrees and unchanged branch
evidence. Cleanup additionally requires that ancestry prove the branch is fully
integrated.

Resolve task conflicts in the phase worktree and phase conflicts in the
canonical worktree. Rerun combined verification and obtain approval before
recording the merge. Never force cleanup or branch deletion.

## Review Cannot Complete A Track

Review requires `ready_for_review`, a current completed execution, a matching
plan revision and graph digest, a reviewed HEAD, and clean centralized
validation. Approved actionable findings return the track to implementation.
Only an approved clean cycle—or explicit accepted-risk completion—can mark it
completed.

## Archive Rejects A Batch

Every selected track must already be completed with a clean review bound to its
current execution and plan. One ineligible track rejects the whole batch. Fix
or remove that selection and prepare the complete batch again.

## Source Checkout Validation Fails

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
```

Edit TypeScript sources, workflow skill files, agents, templates, manifests,
and marketplace catalogs. Do not edit ignored `harness/dist/` bundles as source.
