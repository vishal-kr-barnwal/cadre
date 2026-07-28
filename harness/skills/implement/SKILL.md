---
name: implement
description: Execute or resume an approved Cadre plan as a dependency DAG, using parallel workers by default when safe, sequential execution when requested, isolated Git worktrees, main-agent integration, incremental learning, verification, and commit provenance. Use for the implement command on a planned or in-progress track.
---

# Cadre Implement

Treat the approved `plan.md` as the source of truth. Implement only `planned` or `in_progress` tracks. The main agent is the sole scheduler and Cadre-state owner: workers must never spawn workers, edit `.cadre/**`, merge branches, resolve integration conflicts, remove worktrees, or record human approval.

Call `project_status`, `execution_graph_validate`, and `worktree_status` before selecting work. Use the structured validation embedded in `project_status`; do not repeat `state_validate` at command entry. If the required Cadre MCP is unavailable, stop at the current checkpoint.

## Select and persist execution mode

- Default to `parallel` when the human does not specify a mode.
- Use `sequential` only when explicitly requested.
- Parallel mode creates workers only when at least two safe executable nodes are ready. Otherwise execute in main without worktree overhead.
- Bound worker count by ready nodes, host capacity, and the workflow maximum.
- Persist requested/effective mode in the execution journal. Changing it during execution requires a clean safe boundary, a presented proposal, and approval.

For a new execution, call `execution_start_preview`, show the exact journal/state proposal, obtain approval, and pass the unchanged digest to `execution_start_apply`. Then preview and apply the derived `tracks.md` update through its digest gate, verify `derivedStateCurrent`, and commit `cadre(implement): start <track-id>`. For an existing `implement` operation, reconcile it instead of creating another execution.

## Resume before scheduling

1. Read `.cadre/workflow.md`, project and track state, spec, plan, execution journal, marked Pattern Seed, dependency-phase learning, patterns/styleguides, and declared track dependencies.
2. Reconcile journal nodes with worker identities, `git worktree list`, branch tips, dirty files, commits, and merges. Never repeat a committed or integrated node.
3. Block when a declared track dependency is not completed or archived after completion.
4. Stop and present any journal/Git mismatch. Never reset, discard, reconstruct, force-delete, or silently restart.

## Preflight host permissions

Before creating workers, inspect the approved plan, repository scripts, lockfiles, and likely verification commands. Distinguish host security permission from Cadre lifecycle approval: a shell/network/listener prompt authorizes the host operation only; it does not approve an artifact, commit, merge, manual-verification result, or state transition.

- Use already-approved commands and prefixes without asking again. Never request permission speculatively or retry equivalent command spellings to obtain a different prompt.
- Centralize shared dependency installation, registry access, image pulls, code generation, and other network preparation in main before workers start. Workers should use locked/offline modes when the repository supports them.
- Prefer existing repository scripts and narrowly scoped commands. Do not combine unrelated or differently privileged shell segments into one command, because the host evaluates each segment independently.
- Avoid scaffolding modes that create nested repositories or require deleting generated `.git` directories. Inspect generator options and target directories first.
- When a required permission is not already available, request one narrow reusable command prefix with the exact reason. If a worker encounters an unexpected prompt, it stops and reports the exact blocked command to main instead of issuing repeated variants.

## Schedule the DAG

Call `execution_status` when resuming an execution or when no mutation response is available. After a successful execution mutation, use its returned `derivedStatus` instead of making a redundant status call. Use `execution_nodes_preview` and `execution_nodes_apply` when one already-approved scheduling or bookkeeping decision produces multiple immediately valid transitions. The ordered batch is a transport optimization only: never batch across a human approval, commit, verification, integration, conflict resolution, or other external action whose evidence does not exist at preview time. Plan display order breaks ties only.

- A root phase reads the Pattern Seed. Any other phase reads learning from all declared dependency phases.
- Treat the track as a hierarchical DAG: phase dependencies determine active phases, task dependencies determine ready work inside each running phase, and main schedules one global ready queue subject to `maxWorkers`. Different phases may use different execution modes concurrently.
- Every non-trivial active phase uses a main-owned integration worktree. A phase `workerId` is a temporary execution lease, not ownership of that worktree. Use direct main execution for one ready task, a phase worker for a tightly coupled sequential chain when delegation is already justified, and task-worker fan-out when at least two independent tasks in that phase are ready.
- A phase has only one mutating execution mode at a time, but may switch modes at a clean checkpoint. Before phase-worker-to-task-worker fan-out, finish and record the current task, verify the phase worktree is clean, record its HEAD in the phase verification, release the phase worker through a `running`-to-`running` node update with `workerId: null`, and keep that worker inactive. Main may assign a new phase worker only after every active task worker in that phase is completed and its integration/cleanup is recorded.
- Create every task-worker wave from the same recorded clean phase HEAD. Merge approved tasks into the phase worktree one at a time; derive the next wave only after those merges, so downstream tasks start from the updated phase HEAD.
- The main agent creates every worker. On Codex, use an available implementation worker subagent with the bounded prompt below. On Claude Code, prefer the plugin-provided `cadre-phase-worker` and `cadre-task-worker`. Do not use Claude agent teams.
- If only one safe execution node is ready, execute it in main.
- Phase and task worktrees are siblings. Use `worktree_create_preview` and `worktree_create_apply`; record the returned absolute path/branch through `execution_node_preview` and `execution_node_apply` before spawning.

### Worker prompt contract

Provide the exact absolute worktree, track/execution/node IDs, approved outcome, dependencies and learning to read, relevant files, required checks, and expected Conventional Commit scope. State explicitly:

- operate only in the assigned worktree and read files before editing;
- edit product files only and never edit `.cadre/**`;
- do not spawn agents, merge, rebase, reset, clean up, or force Git operations;
- a phase worker must stop at a requested clean handoff, report the committed phase HEAD and clean status, and remain inactive while task workers for that phase run;
- run focused verification and return changed files, tests/checks, risks, learning candidates, and the proposed commit message for the current task;
- stop after each regular task with that task's changes uncommitted at `awaiting_approval` until main presents them and the human approves;
- after approval, commit only that task and return its SHA; do not begin the next phase task until main confirms the checkpoint is recorded.

## Approve, commit, and integrate

1. Transition a worker node from `running` to `awaiting_approval` with its verification summary.
2. Read the worker diff and evidence. Present them to the human through main.
3. After approval, direct the worker to create its Conventional Commit, verify the worktree is clean, and record its SHA as `committed`.
4. For a task worker, call `integration_preview` and show the exact task merge. The MCP derives its parent as the registered phase worktree when one exists, otherwise the canonical worktree. Use the canonical fallback only for an explicitly direct, single-task phase; create a phase integration worktree before delegated work in multi-task or phase-verified delivery. Pass the unchanged digest to `integration_apply`. A task executed directly by main or internally by a phase worker is already on its parent branch: verify its approved commit is reachable and do not invent an integration step. For a phase worktree, use the same gate for phase-to-canonical integration. Never squash.
5. If integration reports conflicts, mark `conflicted`. Resolve task conflicts in the phase worktree and phase conflicts in main, read every conflicted file and both sides, rerun combined verification, present the resolution, and record the resulting merge commit only after approval.
6. For a worker worktree, mark the node `integrated`, then preview/apply worktree cleanup. Cleanup must refuse dirty, conflicted, or unintegrated work and must not force branch deletion.
7. Mark a task complete after its worker integration, or after its approved direct/phase-worker commit is verified on the parent branch. Mark it complete in `plan.md` with its reachable task commit SHA during canonical phase bookkeeping.

Every regular task in a phase has its own Conventional Commit and distinct recorded SHA, including tasks executed sequentially by one phase worker. Manual-verification nodes may record the approved phase-head or merge evidence instead of inventing an empty commit. A phase must remain `running` until every sibling task and its manual-verification barrier are `completed`; only then may it advance to approval, commit, integration, and cleanup.

## Verification barriers and learning

- Phase `User Manual Verification` is a derived barrier over all sibling tasks. After task workers are quiescent, prepare technical evidence in the phase worktree through an active phase worker when present, otherwise through main. The main agent always presents and records the human approval.
- After approval, integrate the phase branch, record every task commit, the phase completion merge SHA, and dependency-aware phase learning in canonical `plan.md`/`learning.md`; commit `cadre(implement): record <track-id> <phase-id>`.
- Track-level `User Manual Verification` is a derived barrier over every phase. Execute it only in main, against the fully integrated canonical worktree, and obtain explicit human approval.

## Complete execution

When all journal nodes and plan tasks are complete, all phase learning/provenance is recorded, all worktrees are removed, and track verification is approved:

1. Run the relevant full checks and inspect the final diff/history.
2. Call `execution_finish_preview`; present its exact completed journal and `ready_for_review` transition.
3. After approval, call `execution_finish_apply` with the unchanged digest.
4. Preview/apply `tracks.md`, call `state_validate`, and commit `cadre(implement): ready <track-id>`.

Never mark a track `completed`; only an approved clean `review` may do that.
