---
title: How Cadre Works
description: Approval gates, versioned templates, durable journals, Git provenance, and recovery.
section: User Guide
order: 50
---

# How Cadre Works

Cadre combines agent workflow skills with a typed local MCP runtime. Skills own
the human conversation and repository reasoning; MCP tools own deterministic
templates, validation, state transitions, derived indexes, and constrained Git
worktree operations.

## Plugin Model

The installed `cadre@cadre` plugin contains:

```text
skills/                  # create, track, implement, review, revise, archive,
                         # refresh, revert, status, and wisp
agents/                  # Claude phase and task worker definitions
dist/cadre-mcp.mjs       # self-contained stdio MCP runtime
templates/v1/            # immutable project, track, styleguide, and operation templates
.codex-plugin/           # Codex manifest
.claude-plugin/          # Claude manifest
```

The target repository receives none of that runtime. It receives approved
mutable state under `.cadre/`.

## Human Governance

Cadre separates four decisions that are easy to blur:

1. **Host permission** allows a shell, network, filesystem, container, or MCP
   operation to run.
2. **Artifact approval** accepts exact proposed content.
3. **Execution approval** accepts an exact state or Git transition.
4. **Evidence approval** accepts a commit, integration, or manual-verification
   result.

One does not imply another. Installing Cadre's narrow MCP allow rules removes
repetitive client prompts, but it never approves a specification, plan, commit,
merge, review, or lifecycle change.

## Preview And Apply

Deterministic MCP mutations generally come in pairs:

```text
preview(current inputs) -> exact proposal + SHA-256 digest
human approval
apply(same inputs + unchanged digest)
```

Apply recomputes the proposal against current state. Any changed file, state,
branch, commit, selection, or input invalidates the digest and requires a new
preview. Important pairs cover project initialization, execution start and
finish, execution-node transitions, worktree creation/integration/cleanup,
clean review completion, archive batches, and the derived track index.

The MCP server cannot infer approval from a prior conversation or approve a
proposal itself.

## Journal Before Mutation

Longer workflows write durable intent before changing artifacts or Git:

- `project.json.setup.operation` records project creation.
- Track-local `state.json.operation` records specification, planning,
  revision, review remediation, and revert work.
- `.cadre/operations/refresh-*.json` records project refresh.
- `.cadre/operations/archive-*.json` records archive batches.
- `executions/execution-*.json` records implementation nodes and evidence.

The journal stores the base commit, expected commit, approved artifacts,
checkpoint, progress, and operation-specific evidence. It makes the next
invocation a reconciliation rather than a restart.

## Recovery Rules

On resume, Cadre compares the journal with files, Git status, HEAD, recorded
commits, worktree registrations, worker branches, and merges:

- Matching dirty artifacts resume at the first incomplete checkpoint.
- A clean tree at the expected commit records the existing commit instead of
  repeating it.
- Completed artifact work with pending bookkeeping finishes only the state
  record.
- Committed or integrated execution nodes are not rerun.
- Any disagreement stops and is presented to the human.

Cadre never treats a mismatch as permission to reset, discard, reconstruct,
force-delete, or silently restart work.

## Plans As Dependency Graphs

The approved `plan.md` is the implementation source of truth. Cadre parses it
into:

- regular phase nodes with explicit phase dependencies;
- regular task nodes with explicit same-phase dependencies;
- a derived manual-verification barrier for every delivery phase;
- one final track-level manual-verification phase depending on all delivery
  phases.

The runtime rejects cycles, unknown references, missing dependency declarations,
invalid barrier shape, and lifecycle-inconsistent completion markers. Ready and
active nodes are derived from the execution journal; track state does not carry
duplicated `activePhase` or `activeTask` fields.

## Git Provenance

Product work uses Conventional Commits. Cadre-only state uses command-scoped
messages such as:

```text
cadre(create): initialize project harness
cadre(track): plan passwordless-login
cadre(implement): ready passwordless-login
cadre(review): complete passwordless-login
```

Every regular implementation task has a distinct approved commit SHA. Phase
and track verification can record existing phase-head or merge evidence instead
of manufacturing empty commits. Revert prefers additive `git revert` commits.

## Learning Flow

`learning.md` begins with a marked Pattern Seed relevant to the track. Root
phases read that seed; later phases read learning from their declared dependency
phases. Implementation records evidence and commit provenance as work advances.

Archive distills durable learning across selected completed tracks, reconciles
it with existing patterns, and reseeds non-completed tracks by semantic
relevance. Track-specific trivia stays in the archived history.
