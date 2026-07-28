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
Use `--target codex`, `--target claude`, or `--target all` to remove
auto-detection ambiguity.

If another marketplace named `cadre` points elsewhere, review the path and rerun
with `--replace-marketplace` only when replacement is intended.

## Claude Still Prompts Or Does Not Start Cadre MCP

Rerun `cadre-ai install --target claude`. The installer should preserve
unrelated JSONC settings while ensuring both:

- `cadre` is present in `enabledMcpjsonServers`;
- `mcp__cadre__*` is present in `permissions.allow`.

If `permissions.deny` blocks Cadre tools, installation stops rather than
overriding the deny rule. Remove or narrow the conflicting rule deliberately.

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
or remove that selection and preview the complete batch again.

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
