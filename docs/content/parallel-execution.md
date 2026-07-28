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
plan revision, plan commit, graph digest, base commit, and every node. Changing
mode mid-execution requires a clean safe boundary and approval.

## Scheduler Ownership

The main agent is the only scheduler and Cadre-state owner. It:

- derives ready nodes from MCP execution status;
- creates all worktrees and workers;
- supplies exact context, allowed paths, dependencies, and verification;
- presents worker diffs and evidence to the human;
- directs task commits after approval;
- integrates task branches into phase parents and phase branches into main;
- resolves and re-verifies conflicts;
- records learning, manual verification, state, and provenance;
- cleans worktrees only after integration is proven.

Workers never spawn workers, edit `.cadre/**`, merge branches, resolve
integration conflicts, remove worktrees, or record human approval.

## Phase And Task Strategies

A phase uses exactly one strategy:

1. A **phase worker** owns the phase worktree and executes its tasks internally
   in dependency order, stopping after every regular task for approval and a
   distinct commit.
2. The **main agent coordinates task workers**, each with its own task worktree
   whose branch integrates into a phase worktree or directly into the canonical
   branch.

A phase cannot simultaneously have a phase worker and independent task workers.
A phase integration worktree without a phase worker ID is coordination state,
not worker ownership.

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

Task branches merge without squashing into their derived parent. Phase branches
merge without squashing into the canonical branch. Before integration the MCP
verifies clean source/target worktrees, protected Cadre paths, branch tips, and
changed files.

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
