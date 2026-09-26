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
├── receipts/               # immutable completed operation evidence
├── refreshes/
├── tracks/
│   └── <track-id>/
│       ├── state.json
│       ├── spec.md
│       ├── plan.md
│       ├── learning.md
│       ├── dependency-context.json
│       ├── executions/
│       ├── bugs/
│       └── revisions/
├── archive/
├── stage/                  # ignored unapproved candidate artifacts
├── .build-cache/cadre/     # explicitly ignored owned build cache
├── .worktrees/             # ignored execution worktrees
└── wisps/                  # optional ignored output in initialized projects
```

## Sources Of Truth

- `project.json` owns runtime/template versions, project identity, setup state,
  refresh history, and project history. It does not duplicate tracks.
- Track `state.json` owns identity, type, lifecycle status, dependencies,
  revision, checkpoints, commits, pending operation, last execution, review
  cycles, and history. `state.type: "operation"` is a durable track
  classification; it is not the same field as `state.operation`.
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

## Operation Tracks

`state.type` classifies durable work as `feature`, `bug`, or `operation`.
An `operation` track governs a rollout, migration, maintenance, recovery, or
infrastructure/service change through the normal `track` → `implement` →
`review` → `archive` lifecycle. It does not add a workflow or turn Cadre into
an external command/deployment runner.

Operation specifications must define meaningful planned fields for operational owner, target, change window, and preconditions; preflight, rollout, and postflight operator, evidence capture, and timestamp format; monitoring baseline, success threshold, and observation window; abort threshold, rollback/recovery owner, procedure, and reversibility limit; and residual risk, mitigation, and acceptance owner. These fields plan human-controlled evidence capture. Cadre never infers an approval or an action from a journal, host permission, or observed result, and it never attests that an external action occurred.

`state.operation` is instead transient Cadre journal data for a pending
mutation such as planning, implementation, revision, or revert. It owns
checkpoint, approved artifacts, digest, and recovery metadata, not the
track's business classification or proof that an external action occurred.

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
immutable artifact format bundle. The current source creates v6 projects with
schema-2 state; published v1–v5 projects remain readable and require approved
refresh before delivery. Active resources use `cadre://templates/v6/...` URIs
and include SHA-256 hashes.

## Candidate and historical evidence

Candidate inspection validates state/plan/journal relationships in one canonical overlay, including journal-only updates. Paths cannot start with `.cadre/` or alias the same artifact. Stage the final reconciliation state; generate the temporary digest-bound operation journal after approval, before mutation, without unresolved placeholders in promoted bytes.

New executions record `planSource`; its committed plan must match the approved revision and graph. Completed project-operation fingerprints address the original artifact commit, so later authorized edits do not corrupt old evidence. Clean-review cycles store proposal prose in `reviewEvidence` and the apply receipt in `approvalConfirmation` with the proposal digest, confirmation time, and explicit-apply method. Legacy approval prose remains readable as historical evidence.

Reverts preserve the exact pre-revert journal in an approved `reverts/revert-<id>-execution-before.json` snapshot before resetting task evidence. A shared product commit requires explicit whole-group approval and reconciliation of every affected task. Keep additive reversal commits and one v6 reconciliation commit. Historical SHA-based revert receipts retain their original meaning.

## Stable operation provenance

Schema-2 CommitRef values are existing SHAs or `op:<operationId>`. Immutable `.cadre/receipts/<operationId>.json` records the approval digest, base reference, and exact promoted artifact hashes. The agent's commit includes Cadre-Operation and Cadre-Receipt trailers. Resolution requires exactly one HEAD-reachable claim and verifies the committed receipt/artifacts and base ancestry; a trailer alone is insufficient.

A recovery journal under ignored `.cadre/stage/operations/` is persisted before canonical promotion. Until the expected commit verifies, status reports commit_pending and blocks dependent delivery, including interruption before the first canonical write. Reconciliation cleans temporary state only, eliminating self-referential SHA bookkeeping commits. Historical journals, findings, approvals and archived learning are preserved during an approved quiescent refresh. Existing executions retain their original contract; new executions may declare cohesive-v1 commit groups.

V6 operation receipts and recovery journals are generated by semantic mutations. The older operation templates remain available for legacy recovery; do not add their follow-up SHA commits to a new receipt-based operation. Active dependency context records its approval in `state.commits.dependencyContext`; archive rebases moved source paths under the batch approval while preserving archived learning.
