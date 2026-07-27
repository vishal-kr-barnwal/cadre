---
name: status
description: Validate and summarize current Cadre project, track, dependency, phase, review, refresh, and archive state without mutation. Use for the status command, progress reports, blockers, or deciding the next legal workflow action.
---

# Cadre Status

Read `.cadre/workflow.md`, `project.json`, generated `tracks.md`, and track-local state/spec/plan files discovered under both `tracks/` and `archive/`. Read dependency state from each track's `state.json`, never from `tracks.md`. This command is read-only. If the Cadre MCP is unavailable, stop and report it; do not use a copied or reconstructed runtime.

Call `project_status`, `state_validate`, and `worktree_status` with the exact project root. For every active implementation operation, also call `execution_status`. If their results disagree with files you read, report the inconsistency rather than repairing it.

Present:

- project setup checkpoint, pending operation journal, setup commit, and last-refresh commit;
- each track's type, status, durable checkpoint, pending operation, execution mode, ready/running/awaiting-approval/blocked/conflicted/integrated nodes, dependencies, revision, and next legal command;
- registered Cadre worktrees, worker branches, dirty/conflicted worktrees, and orphaned runtime directories;
- blockers and stale dependent-track assessments;
- ready-for-review, completed-not-archived, and archived counts;
- validation errors and uncommitted Cadre state changes.

Read any file before quoting or interpreting it. Do not mutate files, run commits, or silently normalize state.
