---
name: implement
description: Execute or resume an approved Cadre plan as a dependency DAG, using bounded parallel workers when useful, isolated Git worktrees, verified integration, learning, and commit provenance. Use for implement on a planned or in-progress track.
---

# Cadre Implement

Treat approved `plan.md` as the source of truth. Implement only `planned` or `in_progress` tracks. Main is the sole scheduler and `.cadre/**` owner; workers never spawn workers, edit Cadre state, integrate branches, resolve conflicts, clean worktrees, or record human approval.

At a clarification or manual-verification boundary, inspect host policy before `workflow_elicit`. Under approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise use a concise form bound to execution ID, node ID, and verified commit. Treat only `approved` as approval. On `fallback_required`, or an immediate policy-driven `declined`, ask once in chat; policy rejection is not a human decline. Never request secrets or retry the form.

## Conditional references

Read only the references required by current state:

- parallel or delegated work: `references/parallel-workers.md`
- `governed` approval mode: `references/governed-mode.md`
- an integration conflict: `references/conflict-handling.md`
- interrupted or inconsistent execution: `references/resume-recovery.md`

## Entry and modes

1. Call `project_status` once with `view: "implementation"`, `trackId`, and the known `executionId` if resuming. This is the complete preflight: validation, graph, scheduler, dependency, and worktree state; do not repeat `state_validate` at command entry. Stop if `valid` or `graph.valid` is false, `upgradeRequired` is true, the track is candidate-only, or the MCP is unavailable.
2. Read `.cadre/workflow.md`, track spec/plan/learning/state, relevant dependency learning, pattern/styleguide context, and repository instructions. Read before editing.
3. Scheduling defaults to `parallel`; use `sequential` only when requested. Approval mode defaults to `phase`; use `governed` or `autonomous` only when explicitly requested. Resume journaled modes. A mode authorizes only work bounded by the approved spec and plan.
4. For a new execution, the implement invocation authorizes `execution_start`; call it once with the modes. Do not add a start approval outside `governed`. Resume an existing operation instead of creating another.

`governed` pauses for regular task diffs and integrations. `phase` runs regular phase work autonomously and pauses at each phase's final `User Manual Verification`. `autonomous` also performs phase verification autonomously and pauses only at `Track-level User Manual Verification`.

Host security permission is distinct from Cadre approval. Request only a narrow required command permission, centralize shared network/dependency preparation in main, use existing scripts, and run independent read-only checks in parallel. A permission prompt never approves an artifact, commit, merge, or lifecycle transition.

## Execute ready work

Use the scheduler returned by the preflight or latest mutation receipt. Plan order only breaks ties.

- Execute one ready task directly in main when delegation adds no value. Follow returned `eventGuidance`: `record_commit` requires commit, verification, and authorization; `record_verification` requires those same fields; `record_integration` requires commit and verification; `block` requires a blocker. A running-phase `complete` also requires commit, verification, and authorization.
- Delegate only independent or cohesive work. Read `references/parallel-workers.md` before doing so.
- Never checkpoint evidence before it exists. Each regular task has one Conventional Commit and a distinct recorded SHA. `record_commit` includes focused verification and authorization evidence.
- A `.cadre/**`-only bookkeeping commit does not invalidate product verification while product files, tests, inputs, and verification policy remain unchanged.

For a delegated node, the normal lifecycle is four MCP calls:

1. `worktree_create` creates or reconciles the derived worktree and records `start` with its path and branch.
2. After main reviews the returned worker diff/checks and the worker creates its clean task commit, `execution_checkpoint` records `record_commit` with SHA, verification, and mode/human authorization.
3. `integration` with `request: { mode: "prepare", projectRoot, trackId, executionId, nodeId }` validates and merges immediately in `phase`/`autonomous`, recording `record_integration` in its receipt. In `governed` it returns `approval_required`; after human approval call only `request: { mode: "apply", proposalToken }`. Never make the governed calls consecutively without human input.
4. `worktree_cleanup` verifies integration, removes the worktree/branch, and records `complete` when all invariants hold.

Do not add standalone `start`, `record_integration`, or `complete` calls around this composite path. Retried calls reconcile an existing worktree, merge commit, removed worktree, or missing journal transition. Keep standalone checkpoints for direct-main work, manual verification, blockers, conflict recovery, and interruption repair.

## Verification, learning, and finish

- A phase barrier depends on all sibling tasks. Prepare evidence against the phase head. In `governed` and `phase`, present it once and record human approval; in `autonomous`, record persisted-mode authorization.
- After the barrier, integrate the phase, record dependency-aware learning and task/merge provenance in canonical plan/learning, and make one `cadre(implement): record <track-id> <phase-id>` bookkeeping commit. Start dependents only after cleanup/completion.
- The final `Track-level User Manual Verification` runs in main against fully integrated canonical HEAD and always requires explicit human approval.
- When every node is complete, learning/provenance is recorded, worktrees are gone, and final verification is approved, run full relevant checks and call `execution_finish`. It converges interrupted final writes using the persisted completion identity. Commit only its completed journal, plan markers, `ready_for_review` state, and `tracks.md` as `cadre(implement): complete <track-id>`; never let review absorb this bookkeeping.

Never mark a track `completed`; only an approved clean review may do that.
