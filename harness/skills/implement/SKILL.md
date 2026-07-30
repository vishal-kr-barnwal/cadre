---
name: implement
description: Execute or resume an approved Cadre plan as a dependency DAG, using parallel workers by default when safe, sequential execution when requested, isolated Git worktrees, main-agent integration, incremental learning, verification, and commit provenance. Use for the implement command on a planned or in-progress track.
---

# Cadre Implement

Treat the approved `plan.md` as the source of truth. Implement only `planned` or `in_progress` tracks. The main agent is the sole scheduler and Cadre-state owner: workers must never spawn workers, edit `.cadre/**`, merge branches, resolve integration conflicts, remove worktrees, or record human approval.

Call `project_status`, `execution_graph_validate`, and `worktree_status` before selecting work. Use the structured validation embedded in `project_status`; do not repeat `state_validate` at command entry. If the required Cadre MCP is unavailable, stop at the current checkpoint.

## Select and persist execution modes

- Default to `parallel` when the human does not specify a mode.
- Use `sequential` only when explicitly requested.
- Parallel mode creates workers only when at least two safe executable nodes are ready. Otherwise execute in main without worktree overhead.
- Bound worker count by ready nodes, host capacity, and the workflow maximum.
- Persist requested/effective mode in the execution journal. Changing it during execution requires a clean safe boundary, a presented proposal, and approval.

Select and persist one approval mode independently of scheduling:

- `governed`: present every regular task diff before commit, every conflict resolution, every manual-verification barrier, and every integration or other material mutation required by the approved workflow.
- `phase` (default): run all regular work inside a phase autonomously, including task commits, clean integrations, conflict resolution within approved scope, worktree lifecycle, journal/index updates, and bookkeeping. Pause exactly once for that phase's final `User Manual Verification` task. The final track-level verification phase is also a phase and therefore pauses at its single verification task.
- `autonomous`: run regular work and phase-level verification autonomously. Pause only for the `Track-level User Manual Verification` task.

Use `phase` unless the human explicitly requests `governed` or `autonomous`. Record the selected `approvalMode` in both the execution journal and active track operation. A mode authorizes only work already bounded by the approved spec and plan; any material ambiguity, scope divergence, failed required check, unsafe state, or need for new authority is a blocker or clarification, not an approval prompt. Changing approval mode during execution requires an approved clean boundary and a journaled update.

For a new execution, the human's `implement` invocation authorizes an exact execution start using the requested modes or their documented defaults. Call `execution_start_preview` and pass its unchanged digest to `execution_start_apply`. In `phase` or `autonomous`, do not add an execution-start approval prompt; report a concise start summary and proceed. In `governed`, present the start proposal when the current workflow requires that mutation gate. The generated `tracks.md` update and execution-start bookkeeping are deterministic consequences of the same authorization: preview/apply and commit them without another human approval when unchanged. Stop for clarification if the preview exposes a material choice or consequence not covered by the approved plan and invocation. For an existing `implement` operation, reconcile it instead of creating another execution.

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
- Create every task-worker wave from the same recorded clean phase HEAD. Merge ready tasks into the phase worktree one at a time; derive the next wave only after those merges, so downstream tasks start from the updated phase HEAD.
- The main agent creates every worker. On Codex, use an available implementation worker subagent with the bounded prompt below. On Claude Code, prefer the plugin-provided `cadre-phase-worker` and `cadre-task-worker`. Do not use Claude agent teams.
- If only one safe execution node is ready, execute it in main.
- Phase and task worktrees are siblings. Use `worktree_create_preview` and `worktree_create_apply`; record the returned absolute path/branch through `execution_node_preview` and `execution_node_apply` before spawning. In `phase` and `autonomous`, these deterministic worktree and journal mutations run under the implementation authorization without another approval. In `governed`, present them when the current workflow requires an explicit mutation approval.

### Worker prompt contract

Provide the exact absolute worktree, track/execution/node IDs, approved outcome, dependencies and learning to read, relevant files, required checks, and expected Conventional Commit scope. State explicitly:

- operate only in the assigned worktree and read files before editing;
- edit product files only and never edit `.cadre/**`;
- do not spawn agents, merge, rebase, reset, clean up, or force Git operations;
- a phase worker must stop at a requested clean handoff, report the committed phase HEAD and clean status, and remain inactive while task workers for that phase run;
- run focused verification and return changed files, tests/checks, risks, learning candidates, and the proposed commit message for the current task;
- in `governed`, stop after each regular task with that task's changes uncommitted at `awaiting_approval` until main presents them and the human approves;
- in `phase` or `autonomous`, return each regular task's uncommitted diff and evidence to main for scope review; after main confirms it stays within the approved task and required checks pass, commit only that task without a human prompt;
- after commit, return the SHA and do not begin the next phase task until main confirms the checkpoint is recorded.

## Approve, commit, and integrate

1. Transition a worker node from `running` to `awaiting_approval` with its verification summary in `governed`; in `phase` or `autonomous`, record the same evidence at the autonomous commit checkpoint without presenting a human approval prompt.
2. Main always reads the worker diff and evidence. In `governed`, present them to the human. In `phase` or `autonomous`, confirm that the diff stays inside the approved task and that required checks pass; stop for clarification only when intent or authority is materially ambiguous.
3. Direct the worker to create its Conventional Commit, verify the worktree is clean, and record its SHA as `committed`. In `phase` or `autonomous`, record approval evidence as authorization by the persisted approval mode rather than claiming a new human approval.
4. For a task worker, call `integration_preview` for the exact task merge. The MCP derives its parent as the registered phase worktree when one exists, otherwise the canonical worktree. Use the canonical fallback only for an explicitly direct, single-task phase; create a phase integration worktree before delegated work in multi-task or phase-verified delivery. In `governed`, show the merge when required by the workflow. In `phase` or `autonomous`, apply a clean in-scope merge without another approval. A task executed directly by main or internally by a phase worker is already on its parent branch: verify its commit is reachable and do not invent an integration step. For a phase worktree, use the same digest gate for phase-to-canonical integration. Never squash.
5. If integration reports conflicts, mark `conflicted`. Resolve task conflicts in the phase worktree and phase conflicts in main, read every conflicted file and both sides, and rerun combined verification. In `governed`, present the resolution for approval. In `phase` or `autonomous`, apply and record an unambiguous in-scope resolution autonomously; stop for clarification when the resolution requires a material product or scope choice.
6. For a worker worktree, mark the node `integrated`, then preview/apply worktree cleanup. Cleanup must refuse dirty, conflicted, or unintegrated work and must not force branch deletion. Cleanups in `phase` and `autonomous` never create a separate approval prompt.
7. Mark a task complete after its worker integration, or after its approved direct/phase-worker commit is verified on the parent branch. Mark it complete in `plan.md` with its reachable task commit SHA during canonical phase bookkeeping.

Every regular task in a phase has its own Conventional Commit and distinct recorded SHA, including tasks executed sequentially by one phase worker. Manual-verification nodes may record the approved phase-head or merge evidence instead of inventing an empty commit. A phase must remain `running` until every sibling task and its manual-verification barrier are `completed`; only then may it advance to approval, commit, integration, and cleanup.

## Verification barriers and learning

- Phase `User Manual Verification` is a derived barrier over all sibling tasks. After task workers are quiescent, prepare technical evidence in the phase worktree through an active phase worker when present, otherwise through main. In `governed` and `phase`, present this final phase task once and record the human approval. In `autonomous`, verify and record it under the persisted mode without a human prompt.
- After the barrier is approved or authorized, automatically checkpoint the journal, integrate the phase branch, record every task commit, the phase completion merge SHA, and dependency-aware phase learning in canonical `plan.md`/`learning.md`, commit `cadre(implement): record <track-id> <phase-id>`, and clean the phase worktree. Do not split those deterministic consequences into additional approvals in `phase` or `autonomous`.
- Track-level `User Manual Verification` is a derived barrier over every phase. Execute it only in main, against the fully integrated canonical worktree, and obtain explicit human approval in all modes.

## Complete execution

When all journal nodes and plan tasks are complete, all phase learning/provenance is recorded, all worktrees are removed, and track verification is approved:

1. Run the relevant full checks and inspect the final diff/history.
2. Call `execution_finish_preview` after the approved track-level verification. Its completed journal, `ready_for_review` transition, derived `tracks.md` update, validation, and `cadre(implement): ready <track-id>` commit are deterministic consequences of that approval; apply them without another prompt when unchanged.

Never mark a track `completed`; only an approved clean `review` may do that.
