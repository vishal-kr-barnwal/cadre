---
title: Workflow Guide
navTitle: Workflows
description: When and how to use Cadre's ten lifecycle skills.
section: User Guide
order: 60
---

# Workflow Guide

Cadre exposes ten skills in both supported clients. In Codex use
`$cadre:<skill>`; in Claude Code use `/cadre:<skill>`.

## create

Use `create` to initialize or resume Cadre in a project repository.

The workflow:

1. Resolves the exact repository root and Git disposition.
2. Classifies the project as greenfield or brownfield with evidence.
3. Drafts product, guidelines, technology, workflow, styleguide, pattern, and
   state artifacts from versioned templates.
4. Obtains separate workflow and styleguide acceptance.
5. Presents the complete `.cadre/` proposal.
6. Applies initialization atomically behind a preview digest.
7. Initializes Git only when explicitly approved and no enclosing repository
   exists.
8. Validates and records setup commits.

An existing `.cadre/project.json` is resumed, never overwritten.

## track

Use `track` for a new feature or bug. It has two approval/commit stages:

- Specification: scope, requirements, acceptance criteria, additional
  information, track dependencies, and dependent-track impact.
- Plan: phase/task dependency graph plus the relevant Pattern Seed in
  `learning.md`.

Cadre asks when feature versus bug, scope, interfaces, compatibility,
acceptance, or dependencies remain materially ambiguous. A drafting track is
resumed rather than replaced.

## implement

Use `implement` for `planned` or `in_progress` tracks.

Parallel execution is the default, but workers are created only when at least
two safe nodes are ready. Main allocates one global worker bound across active
phases and their phase-local task waves; an individual phase can move between a
sequential worker and task fan-out only at a clean checkpoint. Explicit
sequential mode avoids worker worktrees. Declared track dependencies must
already be completed or archived after completion.

Approval mode is independent of parallel/sequential scheduling:

- `governed` presents each regular task and material integration transition;
- `phase` is the default and runs a phase autonomously until its final User
  Manual Verification task;
- `autonomous` runs through phase barriers and pauses only at Track-level User
  Manual Verification.

The `implement` invocation authorizes execution start with the requested modes
or their defaults. `phase` and `autonomous` do not add a separate start prompt.
All modes stop for material ambiguity, scope divergence, unsafe state, or a
required-check exception. Track-level verification always requires the human.
An approved execution finish moves the track to `ready_for_review`, never
directly to `completed`.

## review

Use `review` only for `ready_for_review` tracks.

The reviewer inspects the recorded implementation range, affected callers,
tests, error paths, security boundaries, compatibility, requirements, and
learning. Findings are presented before they enter state.

- Approved findings create exact bug/remediation artifacts and return the track
  to implementation.
- Changed desired behavior is routed to `revise`, not recorded as a defect.
- An approved clean review binds evidence to the current execution, plan
  revision, graph digest, and reviewed HEAD, then marks the track `completed`.

Only `review` can complete a track.

## revise

Use `revise` when approved desired behavior, scope, requirements, acceptance,
dependencies, or plans change.

Behavior depends on lifecycle state:

| State | Revision behavior |
|---|---|
| `drafting-spec` | Continue the unapproved draft without a revision artifact. |
| `drafting-plan` | Revise an approved spec; continue an unapproved plan normally. |
| `planned` | Revise the approved baseline and remain planned. |
| `in_progress` | Reconcile workers at a safe boundary and preserve completed work. |
| `ready_for_review` | Invalidate readiness and append delivery/verification work. |
| `completed` or `archived` | Keep history immutable and propose a successor track. |

Revisions assess transitive dependent tracks and never erase completed commit
provenance.

## archive

Use `archive` after a clean approved review. It accepts explicit track IDs,
`all completed`, or a uniquely eligible track.

One digest-bound batch can move multiple completed tracks, distill their
learning with existing patterns, reseed active tracks, update lifecycle state,
and rebuild `tracks.md`. A follow-up state commit records the archive commit as
part of the same approved decision.

Only `archive` can mark a track archived.

## refresh

Use `refresh` when project context no longer matches user intent, repository
changes, or completed-track learning.

It can update product, guidelines, workflow, technology, general styleguide,
language/framework styleguides, patterns, and affected active-track seeds.
Execution-governing changes wait for a safe worker boundary. Cascading track
changes follow `revise` rules and require approval.

## revert

Use `revert` to reverse a Cadre task, phase, or track while preserving history.

Cadre identifies exact task, merge, and phase commits; later overlaps; active
worktrees; learning impact; and dependent work. It proposes safe reverse order
and uses additive `git revert` by default. Conflicts stop for human-guided
resolution and combined verification.

## status

Use `status` for a read-only health and progress report. It validates project
state, reads managed worktrees, and derives active execution status. It reports
checkpoints, operations, dependencies, blockers, review/archive readiness,
uncommitted Cadre state, and the next legal command without normalizing files.

## wisp

Use `wisp` for a lightweight investigation, question, or spike that should not
enter Cadre lifecycle state. Disposable output may live under ignored
`.cadre/wisps/`; product edits require explicit scope approval and are not
committed automatically.

Promote durable implementation work into `track` rather than retroactively
turning a wisp into Cadre state.

## Choosing The Right Workflow

| Situation | Use |
|---|---|
| New project context | `create` |
| New desired feature or known bug | `track` |
| Execute approved work | `implement` |
| Evaluate finished implementation | `review` |
| Change approved intent | `revise` |
| Update project-wide context | `refresh` |
| Reverse recorded work | `revert` |
| Preserve completed history and patterns | `archive` |
| Inspect health or next actions | `status` |
| Explore without lifecycle state | `wisp` |
