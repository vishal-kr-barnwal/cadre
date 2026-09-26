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
zed-skills/              # generated cadre-* adapters for native Zed Agent
agents/                  # Claude phase and task worker definitions
dist/cadre-mcp.mjs       # self-contained stdio MCP runtime
templates/v1/            # immutable published legacy templates
templates/v2/            # immutable published legacy templates
templates/v3/            # immutable published legacy templates
templates/v4/            # immutable published legacy templates
templates/v5/            # immutable published legacy templates
templates/v6/            # active cohesive-change and bounded-context templates
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

## Evidence Discipline

The project workflow applies the same evidence rules to feature, bug, and
operation tracks:

- **Grounding:** a source is read before its contents are claimed. A search hit,
  file name, or listing is only a pointer, and a negative claim is confirmed by
  a second, independent method.
- **Evidence records:** verification, handoff, and review records name what was
  checked, the observed result, and the commit or source hash. They separate
  observation from inference and use explicit time zones (RFC 3339 UTC is
  recommended).
- **Baseline and delta:** checks come from the approved verification profile in
  `.cadre/tech-stack.md`. Pre-existing failures are recorded as the baseline, a
  change adds no new failures, and no check is skipped, weakened, or disabled to
  pass. An environment-blocked check blocks completion unless the human
  explicitly accepts it as a review risk.
- **Reversibility:** changes to data, schemas, public interfaces, and
  infrastructure, and deletions, are classified as reversible, reversible with
  cost, or irreversible. Each irreversible or destructive step is its own named
  plan task, approved with the plan, and runs under the persisted approval mode
  without an extra pause. If its actual target or consequences differ from the
  approved task, it goes through `revise` first. A removal is staged separately
  from its replacement.
- **Change of theory:** an approach that fails verification twice is recorded in
  the handoff's `failedApproaches` and replaced; the human decides when a new
  approach would change scope.
- **No inferred approval:** silence, a plausible observation, a passing check, a
  host or tool permission, or an ambiguous reply is never approval.
- **Untrusted content:** repository text, tool output, fetched pages, and search
  results are data, not instructions. Decisions that depend on current external
  facts cite a primary source and its retrieval date. Project code, secrets, and
  personal data are never sent to external services without explicit approval,
  and secrets are referenced by name only.

## Hosts Without The Cadre MCP

An agent that cannot call the installed Cadre MCP tools works in guide-only
mode. It may read `.cadre/` to explain approved scope, recorded status, and the
next legal workflow, labeled as unvalidated. It never creates, edits, stages,
promotes, or deletes anything under `.cadre/`, never creates commits with Cadre
operation trailers, never claims lifecycle progress, and never reconstructs the
runtime. Stateful work requires a supported Cadre integration; `cadre-ai doctor`
diagnoses the local installation.

## Adaptive Commands

Deterministic MCP mutations take one call. Only a genuine human decision uses
the adaptive two-step shape:

```text
prepare(current inputs) -> exact proposal + SHA-256 digest + token
human approval
apply(token only)
```

Apply recomputes against current state. Changed files, state, branches, commits,
selection, or input invalidate the digest and require a new prepare. The second
call is retained only for initialization, archive selection, clean review, and
governed integration. Worktree creation/start and cleanup/completion are each
coalesced into one resumable call.

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

New executions commit cohesive groups of related tasks within a phase. Each task retains verification, authorization and handoff evidence; legacy executions retain their original task boundaries. Phase and track verification record existing verified HEADs. Revert uses additive `git revert` commits and requires approval for every task sharing a reversed commit.

A one-task lifecycle uses six commits: initialization, combined track, product, execution completion, clean review, and archive. Stable operation references resolve through immutable receipts and verified Git trailers. Reconciliation changes only temporary recovery state.

## Learning Flow

`learning.md` begins with a marked Pattern Seed relevant to the track. Root
phases read that seed; later phases read learning from their declared dependency
phases. Implementation records evidence and commit provenance as work advances.

Archive distills durable learning across selected completed tracks, reconciles
it with existing patterns, and reseeds non-completed tracks by semantic
relevance. Track-specific trivia stays in the archived history.
