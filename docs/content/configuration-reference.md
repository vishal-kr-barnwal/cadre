---
title: Project Artifact Reference
navTitle: Artifact Reference
description: Current project, track, execution, operation, styleguide, pattern, and derived artifacts.
section: Reference
order: 190
---

# Project Artifact Reference

Cadre 4.0 configuration and state are distributed across explicit approved
artifacts. There is no current `cadre/config.json`.

Unapproved artifact proposals live temporarily beneath
`<project-root>/.cadre/stage/<candidate-id>/`. They are visible filesystem
drafts, never canonical `.cadre/` state or Git history. Approval binds their
path/SHA-256 manifest; the matching stage is retained through the artifact
commit checkpoint and then removed.

## Project Artifacts

| Path | Ownership and content |
|---|---|
| `.cadre/project.json` | Runtime/template versions, project identity/context, setup checkpoint/operation/commit, last refresh, and project history. |
| `.cadre/product.md` | Product problem, users, behavior, scope, constraints, and success context. |
| `.cadre/guidelines.md` | Engineering principles, trust boundaries, non-goals, decision rules, and review expectations. |
| `.cadre/tech-stack.md` | Languages, frameworks, platforms, package/build tools, and verification commands. |
| `.cadre/workflow.md` | Lifecycle, approval, testing, review, commit, and delivery rules read by every stateful skill. |
| `.cadre/tracks.md` | Generated project-level index derived from track-local state. |
| `.cadre/patterns/index.md` | Durable, evidenced patterns and provenance. |
| `.cadre/styleguides/*.md` | Approved general and technology-specific conventions. |

`project.json` includes `schemaVersion`, `runtimeVersion`, and
`templateSetVersion`. Completed setup retains status, checkpoint, an operation reference and artifact
progress. New initialization recovery lives under `.cadre/stage/operations/`;
its receipt binds the approved digest and exact artifact path/hash entries.

## Track State

Each active track lives under `.cadre/tracks/<track-id>/`; each archived track
lives under `.cadre/archive/<track-id>/`.

Track `state.json` includes:

| Field | Meaning |
|---|---|
| `schemaVersion` | State schema version. |
| `trackId`, `title`, `type` | Stable identity; type is `feature` or `bug`. |
| `status` | Lifecycle state. |
| `checkpoint` | Durable workflow checkpoint. |
| `revision` | Track baseline revision. |
| `dependencies` | Other track IDs required before implementation. |
| `commits.spec`, `commits.plan` | Approved artifact commit provenance. |
| `artifactProgress` | Completed writes in the pending operation. |
| `operation` | Current journaled mutation or `null`. |
| `lastExecution` | Last execution identity and review-bound evidence. |
| `reviewCycles` | Finding/clean-review history and accepted risks. |
| `history` | Lifecycle and operation history. |

Paths and active phase/task are derived; they are not duplicated in state.

## Track Documents

| Path | Meaning |
|---|---|
| `spec.md` | Goal, scope, functional/non-functional requirements, acceptance criteria, dependencies, additional information, and impact. |
| `plan.md` | Revisioned phase/task DAG, manual barriers, completion markers, and commit SHAs. |
| `learning.md` | Marked Pattern Seed plus phase/task learning and provenance. |
| `bugs/` | Approved review finding artifacts. |
| `revisions/` | Approved semantic revision records. |
| `executions/` | Immutable/resumable execution journals. |

## Execution Journal

`executions/execution-<id>.json` contains:

- execution and track identity;
- `status` and `checkpoint`;
- `requestedMode` and `effectiveMode` (`parallel` or `sequential`);
- `approvalPolicyVersion` (`2` for new authority; legacy Autonomous requires explicit refresh migration);
- `approvalMode` (`governed`, `phase`, `track`, or `autonomous`), defaulting to `track`
  for new executions; legacy journals without it retain governed behavior;
- `maxWorkers`, an approved delegated-worker bound from `1` through `32` (the
  generated workflow defaults to `3`, and host capacity may reduce it);
- plan revision, plan commit, and graph digest;
- base/head commits and start/completion timestamps;
- one entry per phase/task node.

Node entries record status, dependencies, the active worker and retained worker
history, worktree/branch identity, worker and merge commits, verification,
approval, and blockers. Phase-worker release and reassignment preserve that
history across clean execution-mode handoffs. Legal statuses
are `pending`, `running`, `awaiting_approval`, `committed`, `integrating`,
`conflicted`, `integrated`, `awaiting_manual_verification`, `completed`, and
`blocked`.

## Operation Journals

- `.cadre/stage/operations/<operationId>.json` records pending approved
  promotion, original inputs and recovery evidence. It is ignored by Git.
- `.cadre/receipts/<operationId>.json` records immutable approval/provenance
  and belongs in the operation's one commit.
- Track `state.json.operation` binds active implementation and retained workflow
  state; execution journals own task progress.

Resolve `op:<operationId>` through receipt reconciliation before Git range
commands. Preserve legacy `.cadre/operations/` refresh/archive journals as
historical evidence. Pending operations using removed legacy mutation paths
require recovery with Cadre 3.9.0 before returning to 4.0.

## Ignored Runtime Paths

`.cadre/.gitignore` excludes:

- `stage/` — candidate artifacts and approved temporary recovery journals;
- `.worktrees/` — temporary Cadre-managed execution worktrees;
- `wisps/` — disposable untracked exploration output;
- `.build-cache/cadre/` — the runtime-owned build cache.

These paths are excluded from commits. Pending recovery journals and worktrees
can contain essential unfinished work; being ignored does not make them safe to delete.


### Autonomous review state

Track `state.json` stores `autonomousReview` for policy-v2 Autonomous: originating
execution and authorization time, approved specification commit, initial cumulative
review baseline, checkpoint, and stable findings with distinct remediation execution
IDs. Checkpoints are `implementing`, `reviewing`, `remediating`, `awaiting_approval`,
`blocked`, and `completed`. Clean evidence includes the reviewed execution and HEAD;
a blocker explains why continuation needs human input or an external prerequisite.

Review stages `reviews/loop-<cycle>.json` alongside remediation artifacts. The exact
inspected snapshot becomes canonical loop state through the journaled promotion.
Its manifest digest is held by the review operation, separately from human approval.
Legacy Autonomous migration records `approvalModeMigration` with the old execution
ID, chosen Track/Autonomous mode, approval time, and approved `refreshPath`.
Completed execution journals remain historical; active journals and operations are
upgraded together to policy v2 under the same refresh envelope.

An explicitly approved blocked/stalled review retry adds optional
`autonomousReview.retryAuthorization`, containing the approving refresh operation
reference and each finding’s retained `attemptBaseline`. The refresh history entry
keeps the full prior loop, instruction record path and reason. Existing attempts
are never erased; the two-attempt limit counts new attempts beyond that approved
prefix. Automatic remediation, ordinary refresh and revert cannot replace it.
