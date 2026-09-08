---
title: State And Artifacts
description: Sources of truth, generated indexes, operation journals, and project layout.
section: Contributor Guide
order: 160
---

# State And Artifacts

An initialized repository keeps approved mutable Cadre state under `.cadre/`.
The installed plugin owns the runtime and immutable template catalog.

## Project Layout

```text
.cadre/
├── .gitignore
├── project.json
├── product.md
├── guidelines.md
├── tech-stack.md
├── workflow.md
├── tracks.md
├── styleguides/
├── patterns/
│   └── index.md
├── operations/
│   ├── refresh-<id>.json
│   └── archive-<id>.json
├── refreshes/
├── tracks/
│   └── <track-id>/
│       ├── state.json
│       ├── spec.md
│       ├── plan.md
│       ├── learning.md
│       ├── executions/
│       ├── bugs/
│       └── revisions/
├── archive/
├── stage/                  # ignored unapproved candidate artifacts
├── .worktrees/             # ignored execution worktrees
└── wisps/                  # optional ignored output in initialized projects
```

## Sources Of Truth

- `project.json` owns runtime/template versions, project identity, setup state,
  refresh history, and project history. It does not duplicate tracks.
- Track `state.json` owns identity, type, lifecycle status, dependencies,
  revision, checkpoints, commits, pending operation, last execution, review
  cycles, and history.
- `spec.md` owns requirements, scope, acceptance, and dependency impact.
- `plan.md` owns the phase/task graph, completion markers, and commit
  provenance.
- `executions/execution-<id>.json` owns runtime node status, active and
  historical worker identity, worktree/branch data, verification, approval,
  commits, merges, and blockers.
- `learning.md` owns the marked Pattern Seed plus phase/task learning.
- `tracks.md` is a generated index derived from track-local state. Never edit
  it by hand.

Track paths are derived from lifecycle status and track ID. Active tracks live
under `tracks/`; archived tracks live under `archive/`. The path itself is not
persisted in track state.

## Lifecycle States

```text
drafting-spec -> drafting-plan -> planned -> in_progress -> ready_for_review
                                      ^              |
                                      | approved bugs|
                                      +--------------+

ready_for_review -> completed -> archived
```

`revise` can move active work back to planning or implementation. Completed and
archived tracks remain immutable; changed intent creates a successor.

## Operation Journals

A plan may retain completed `Track-level User Manual Verification` phases from
earlier review or revision cycles. Preserve their titles, task IDs, checks, and
commit provenance. Each depends on the phases preceding it, as it did when it
was the final gate. Appended work must end with a new final verification phase;
an unfinished verification phase cannot become historical. Replacement
executions carry completed nodes forward and preserve the earlier journal.
Between approved promotion and replacement execution, `context_read` returns
handoffs from the retained completed execution as historical evidence, labeled
with their recorded revision and graph. Reassess them against the new plan;
they do not describe its execution state or grant approval.

Every multi-step mutation records intent and progress before changing the next
artifact or Git state. Common fields include:

- action and operation/batch/execution identity;
- base commit and expected commit;
- approved timestamp and artifact set;
- artifact progress and durable checkpoint;
- source/target status and operation-specific evidence;
- resulting commit when it becomes known.

The journal is part of recovery correctness, not temporary metadata. Do not
delete or replace it to make a blocked workflow appear fresh.

## Derived State

`tracks_render` reads all track-local state, validates the exact deterministic
`tracks.md` content, and writes it atomically in one idempotent call.

Central validation checks both canonical state and whether derived state is
current. A valid track with stale `tracks.md` is still an unhealthy project
until the approved index repair is applied.

## Versioning

`runtimeVersion` identifies Cadre behavior. `templateSetVersion` identifies the
immutable artifact format bundle. Cadre 3.7 creates v3 projects; published v1/v2
projects remain readable and require approved refresh before delivery. Active
resources use `cadre://templates/v4/...` URIs and include SHA-256 hashes.

## Candidate and historical evidence

Candidate inspection validates state/plan/journal relationships in one canonical overlay, including journal-only updates. Paths cannot start with `.cadre/` or alias the same artifact. Stage the final reconciliation state; generate the temporary digest-bound operation journal after approval, before mutation, without unresolved placeholders in promoted bytes.

New executions record `planSource`; its committed plan must match the approved revision and graph. Completed project-operation fingerprints address the original artifact commit, so later authorized edits do not corrupt old evidence. Clean-review cycles store proposal prose in `reviewEvidence` and the apply receipt in `approvalConfirmation` with the proposal digest, confirmation time, and explicit-apply method. Legacy approval prose remains readable as historical evidence.

Reverts preserve the exact pre-revert journal in an approved `reverts/revert-<id>-execution-before.json` snapshot before resetting task evidence. Before restoring implement ownership, the workflow persists and rereads `reverts/revert-<id>.json` with the actual approval digest, original/reversal commits, and a null reconciliation commit. This receipt is included in the reconciliation commit; its actual SHA and one history entry are then recorded in a follow-up commit. A null reconciliation SHA means bookkeeping remains unfinished and recovery must inspect Git before creating another commit. Receipt/history recording is part of the original approved bookkeeping; status validity alone does not certify that every workflow consequence was recorded.
