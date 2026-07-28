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

For a new execution, call `execution_start_preview`, show the exact journal/state proposal, obtain approval, and pass the unchanged digest to `execution_start_apply`. Commit `cadre(implement): start <track-id>`. For an existing `implement` operation, reconcile it instead of creating another execution.

## Resume before scheduling

1. Read `.cadre/workflow.md`, project and track state, spec, plan, execution journal, marked Pattern Seed, dependency-phase learning, patterns/styleguides, and declared track dependencies.
2. Reconcile journal nodes with worker identities, `git worktree list`, branch tips, dirty files, commits, and merges. Never repeat a committed or integrated node.
3. Block when a declared track dependency is not completed or archived after completion.
4. Stop and present any journal/Git mismatch. Never reset, discard, reconstruct, force-delete, or silently restart.

## Schedule the DAG

Call `execution_status` after every durable transition. Plan display order breaks ties only.

- A root phase reads the Pattern Seed. Any other phase reads learning from all declared dependency phases.
- A phase is either assigned to one phase worker for internally sequential work or coordinated by main through task workers; never both simultaneously. A phase integration worktree without a phase `workerId` is coordination state, not phase-worker ownership.
- The main agent creates every worker. On Codex, use an available implementation worker subagent with the bounded prompt below. On Claude Code, prefer the plugin-provided `cadre-phase-worker` and `cadre-task-worker`. Do not use Claude agent teams.
- If only one safe execution node is ready, execute it in main.
- Phase and task worktrees are siblings. Use `worktree_create_preview` and `worktree_create_apply`; record the returned absolute path/branch through `execution_node_preview` and `execution_node_apply` before spawning.

### Worker prompt contract

Provide the exact absolute worktree, track/execution/node IDs, approved outcome, dependencies and learning to read, relevant files, required checks, and expected Conventional Commit scope. State explicitly:

- operate only in the assigned worktree and read files before editing;
- edit product files only and never edit `.cadre/**`;
- do not spawn agents, merge, rebase, reset, clean up, or force Git operations;
- run focused verification and return changed files, tests/checks, risks, learning candidates, and the proposed commit message;
- stop with changes uncommitted at `awaiting_approval` until main presents them and the human approves.

## Approve, commit, and integrate

1. Transition a worker node from `running` to `awaiting_approval` with its verification summary.
2. Read the worker diff and evidence. Present them to the human through main.
3. After approval, direct the worker to create its Conventional Commit, verify the worktree is clean, and record its SHA as `committed`.
4. For a task worker, call `integration_preview` and show the exact task merge. The MCP derives its parent as the registered phase worktree when one exists, otherwise the canonical worktree. Pass the unchanged digest to `integration_apply`. A task executed directly by main or internally by a phase worker is already on its parent branch: verify its approved commit is reachable and do not invent an integration step. For a phase worktree, use the same gate for phase-to-canonical integration. Never squash.
5. If integration reports conflicts, mark `conflicted`. Resolve task conflicts in the phase worktree and phase conflicts in main, read every conflicted file and both sides, rerun combined verification, present the resolution, and record the resulting merge commit only after approval.
6. For a worker worktree, mark the node `integrated`, then preview/apply worktree cleanup. Cleanup must refuse dirty, conflicted, or unintegrated work and must not force branch deletion.
7. Mark a task complete after its worker integration, or after its approved direct/phase-worker commit is verified on the parent branch. Mark it complete in `plan.md` with its reachable task commit SHA during canonical phase bookkeeping.

## Verification barriers and learning

- Phase `User Manual Verification` is a derived barrier over all sibling tasks. Prepare technical evidence in the phase worktree through its phase worker when present, otherwise through main. The main agent always presents and records the human approval.
- After approval, integrate the phase branch, record every task commit, the phase completion merge SHA, and dependency-aware phase learning in canonical `plan.md`/`learning.md`; commit `cadre(implement): record <track-id> <phase-id>`.
- Track-level `User Manual Verification` is a derived barrier over every phase. Execute it only in main, against the fully integrated canonical worktree, and obtain explicit human approval.

## Complete execution

When all journal nodes and plan tasks are complete, all phase learning/provenance is recorded, all worktrees are removed, and track verification is approved:

1. Run the relevant full checks and inspect the final diff/history.
2. Call `execution_finish_preview`; present its exact completed journal and `ready_for_review` transition.
3. After approval, call `execution_finish_apply` with the unchanged digest.
4. Preview/apply `tracks.md`, call `state_validate`, and commit `cadre(implement): ready <track-id>`.

Never mark a track `completed`; only an approved clean `review` may do that.
