---
name: cadre-implement
description: Resume and execute an approved Cadre track plan phase by phase, enforcing dependency completion, read-before-edit, incremental learning, tests, manual verification, task commits, and ready-for-review transition. Use for the implement command on a planned or in-progress track.
---

# Cadre Implement

Treat the approved `plan.md` as the source of truth. Do not implement drafting, ready-for-review, completed, or archived tracks.

## Start or resume

1. Read `.cadre/workflow.md`, project state, the track spec, plan, state, the marked Pattern Seed and full phase history in `learning.md`, relevant patterns/styleguides, and dependency states.
2. Block if any declared dependency is not `completed` or `archived` as completed. Report the exact dependency.
3. Resume the first in-progress task, otherwise the first pending task. Never repeat completed work.
4. At the start of every phase, read the previous phase's learning section. For phase one, read the marked Pattern Seed section at the top of `learning.md`.

## Execute a task

1. Read every existing file before editing it, plus directly relevant callers, tests, types, and configuration. Inspect the target directory before creating a new file. Never change a file based only on an assumption.
2. Present the intended task change and obtain approval when the workflow requires a mutation gate.
3. Implement only the current task. Add/update tests, run focused checks, then formatting and broader relevant checks.
4. Show the artifact/diff and verification evidence for human review. A manual-verification task completes only after explicit human confirmation.
5. Commit a meaningful unit using Conventional Commits. Large tasks may have multiple meaningful commits; do not create empty checkpoint commits.
6. Append task and phase learning to `learning.md`, including evidence and reusable-pattern candidates. Mark the plan task complete with the implementation commit SHA, update track history, and commit bookkeeping as `cadre(implement): record <track-id> <task-id>`.
7. When the task completes its phase, record a phase completion SHA in both `plan.md` and that phase's learning section. The verified final-task commit may serve as the phase commit.
8. Re-read the plan before selecting the next task.

When all phases—including track-level manual verification—are complete, validate state, set the track-local state to `ready_for_review`, regenerate `tracks.md`, and commit `cadre(implement): ready <track-id>`. Never mark a track completed here.
