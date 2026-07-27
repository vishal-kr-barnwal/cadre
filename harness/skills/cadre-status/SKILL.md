---
name: cadre-status
description: Validate and summarize current Cadre project, track, dependency, phase, review, refresh, and archive state without mutation. Use for the status command, progress reports, blockers, or deciding the next legal workflow action.
---

# Cadre Status

Read `.cadre/workflow.md`, `project.json`, generated `tracks.md`, active track state/spec/plan files, and archive entries. This command is read-only.

Run `node .cadre/bin/cadre-state.mjs status` and `node .cadre/bin/cadre-state.mjs validate`. If they disagree with files, report the inconsistency rather than repairing it.

Present:

- project setup checkpoint, pending operation journal, setup commit, and last-refresh commit;
- each track's type, status, durable checkpoint, pending operation, active phase/task, dependencies, revision, and next legal command;
- blockers and stale dependent-track assessments;
- ready-for-review, completed-not-archived, and archived counts;
- validation errors and uncommitted Cadre state changes.

Read any file before quoting or interpreting it. Do not mutate files, run commits, or silently normalize state.
