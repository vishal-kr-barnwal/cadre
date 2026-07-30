---
title: Parallel Execution
description: Dependency scheduling, isolated worktrees, approval gates, integration, and recovery.
section: User Guide
order: 80
---

# Parallel Execution

Cadre executes an approved plan as a dependency DAG. Parallel is the default
mode, but parallelism is used only when it provides safe, bounded benefit.

## Execution Modes

| Mode | Behavior |
|---|---|
| `parallel` | Create workers only when at least two safe nodes are ready; otherwise execute the node in main. |
| `sequential` | Execute one ready node at a time in main unless the workflow needs an integration boundary. |

The execution journal records requested mode, effective mode, maximum workers,
approval mode, plan revision, plan commit, graph digest, base commit, and every
node. Changing either mode mid-execution requires a clean safe boundary and
approval.

## Approval Modes

| Mode | Human approval boundary |
|---|---|
| `governed` | Every regular task diff and material mutation, plus all manual-verification barriers. |
| `phase` | Default. One approval at each phase's final User Manual Verification task; other in-scope work is autonomous. |
| `autonomous` | Only Track-level User Manual Verification; phase-level barriers are verified and recorded autonomously. |

Approval modes never authorize scope expansion, waived required checks,
destructive or remote actions, or guessing through a material ambiguity. Those
conditions stop as blockers or clarification requests rather than routine
approval prompts. Legacy execution journals without `approvalMode` retain the
conservative `governed` behavior.

## Worker Capacity

The generated workflow uses `3` as a conservative default, not an architectural
limit. The execution runtime accepts `maxWorkers` values from `1` through `32`.
At each scheduling checkpoint, the effective delegated concurrency is:

```text
min(safe ready nodes, execution maxWorkers, available host worker slots)
```

A phase worker consumes one slot, and every active task worker consumes one
slot. A phase worker whose lease has been released does not consume scheduler
capacity. A task worker waiting for approval remains an active assignment until
its checkpoint is committed and completed. Worktrees by themselves do not
consume worker slots.

Main is the coordinator and is not counted as a delegated worker in
`maxWorkers`, although the host may reserve one of its total agent slots for
main. Consequently, a host exposing four total agent slots commonly leaves
three child-worker slots. Raising `maxWorkers` above host capacity or the number
of ready nodes has no effect.

Increase the approved project worker bound only when the plan exposes enough
independent work and the repository can tolerate the additional CPU, memory,
test, port, approval, and merge pressure. Use the sizing and rollout procedure
in [Choose The Worker Bound](tuning.md#choose-the-worker-bound).

## Scheduler Ownership

The main agent is the only scheduler and Cadre-state owner. It:

- derives ready nodes from MCP execution status;
- creates all worktrees and workers;
- supplies exact context, allowed paths, dependencies, and verification;
- reviews every worker diff and evidence, presenting it at the boundary selected
  by the persisted approval mode;
- directs task commits after human approval or approval-mode authorization;
- integrates task branches into phase parents and phase branches into main;
- resolves and re-verifies conflicts;
- records learning, manual verification, state, and provenance;
- cleans worktrees only after integration is proven.

Workers never spawn workers, edit `.cadre/**`, merge branches, resolve
integration conflicts, remove worktrees, or record human approval.

## Hierarchical Scheduling

Cadre treats a track as two connected dependency graphs:

- phase dependencies determine which phases may run;
- task dependencies determine which work is ready inside every running phase.

Main combines ready tasks from all running phases into one global queue and
allocates the execution's bounded worker slots. Independent phases can therefore
run concurrently while each phase also moves through sequential and parallel
task waves.

## Phase Execution Modes

Every non-trivial active phase has a main-owned integration worktree. Within
that phase, main selects one mutating mode at a time:

| Mode | Use |
|---|---|
| Direct main | One ready task where delegation provides no benefit. |
| Sequential phase worker | A tightly coupled task chain where retaining worker context is useful. |
| Task-worker fan-out | Two or more independent ready tasks that can safely execute from one phase snapshot. |

Different phases may use different modes concurrently. One phase may also
change modes, but only at a clean, journaled checkpoint. A phase worker finishes
and records its current task, reports a clean phase HEAD, releases its temporary
execution lease, and remains inactive before task workers start. A new phase
worker may be assigned only after active task workers have completed and their
integration and cleanup are recorded.

Task workers in one dependency wave all branch from the same clean phase HEAD.
Main merges their approved branches into the phase worktree one at a time, then
derives the next wave from the updated phase HEAD. Workers never spawn workers.

See the [Complex Parallel Execution Walkthrough](parallel-execution-walkthrough.md)
for a complete mixed sequential/parallel example.

## Worktree Layout

Git worktrees cannot be safely nested, so Cadre uses sibling paths:

```text
.cadre/.worktrees/<track-id>/<execution-id>/
├── phases/P1
└── tasks/P1--T1.1
```

Branches and paths are derived from the track, execution, and node identity.
Creation is digest-gated against an exact base commit.

## Task Checkpoint

For each regular worker task:

1. The worker reads the assigned context and product files.
2. It edits only product files in its worktree.
3. It runs focused verification.
4. It stops with changes uncommitted and returns the diff, checks, risks,
   learning candidates, and proposed commit message.
5. Main records `awaiting_approval` and presents the evidence.
6. After approval, the worker commits only that task.
7. Main verifies the clean worktree and records the commit SHA.
8. Main previews and applies integration when a branch boundary exists.

Every regular task receives a distinct Conventional Commit and recorded SHA,
including tasks handled sequentially by one phase worker.

## Integration And Cleanup

Task branches merge without squashing into their derived parent. Delegated work
in a multi-task or phase-verified delivery phase uses a phase integration
worktree; direct canonical integration is reserved for an explicitly direct
single-task phase. Phase branches merge without squashing into the canonical
branch. Before integration the MCP verifies clean source/target worktrees,
protected Cadre paths, branch tips, and changed files.

If a merge conflicts:

- task conflicts are resolved in the owning phase worktree;
- phase conflicts are resolved in the canonical worktree;
- all conflicted files and both sides are read;
- combined verification is rerun;
- the resolution is presented before its merge commit is recorded.

Cleanup refuses dirty, conflicted, or unintegrated workers. It removes only a
worktree whose branch ancestry proves that its work exists in the parent.

## Manual Verification

Each delivery phase ends with a derived `User Manual Verification` barrier over
all sibling tasks. Technical evidence is prepared in the phase context, but the
main agent presents and records the human decision.

The final track-level manual verification depends on every delivery phase and
runs only in the main agent against the fully integrated canonical worktree.
Manual-verification nodes can record current commit/merge evidence instead of
creating empty commits.

## Host Permission Preflight

Before spawning workers, main inspects scripts, lockfiles, likely checks, and
required external operations. Shared dependency installs, registry access,
image pulls, and code generation are centralized before workers start.

Host permission authorizes only the operation requested. It does not approve a
Cadre artifact, task commit, integration, verification result, or lifecycle
transition. A worker that encounters an unexpected permission prompt stops and
reports the exact command to main.

## Resume And Failure

Cadre reconciles journal nodes with worker IDs, Git worktree registrations,
branch tips, dirty files, commits, and merges before scheduling:

- committed or integrated nodes are not repeated;
- newly ready nodes run after durable transitions;
- a clean branch containing the expected commit advances bookkeeping;
- a conflict remains explicit until resolved and approved;
- an unknown or contradictory state stops rather than being guessed away.

A revision or refresh that changes execution-governing context first quiesces
and reconciles active workers. A changed graph starts a new execution identity;
the prior journal remains historical.
