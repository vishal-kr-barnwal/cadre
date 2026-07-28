---
title: Project Artifact Reference
navTitle: Artifact Reference
description: Current project, track, execution, operation, styleguide, pattern, and derived artifacts.
section: Reference
order: 190
---

# Project Artifact Reference

Cadre 3.0 configuration and state are distributed across explicit approved
artifacts. There is no current `cadre/config.json`.

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
`templateSetVersion`. Setup state contains status, checkpoint, commit,
artifact progress, and an operation with repository root and Git disposition.

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

- `.cadre/operations/refresh-<id>.json` records a project refresh.
- `.cadre/operations/archive-<id>.json` records an archive batch.
- Track `state.json.operation` records specification, planning, revision,
  review remediation, or revert work.

All record approved artifact membership, durable progress, expected Git
provenance, and the resulting commit when known.

## Ignored Runtime Paths

`.cadre/.gitignore` excludes:

- `.worktrees/` — temporary Cadre-managed execution worktrees;
- `wisps/` — disposable untracked exploration output.

Neither path is durable delivery state.
