---
name: status
description: Validate and summarize current Cadre project, track, dependency, phase, review, refresh, and archive state without mutation. Use for the status command, progress reports, blockers, or deciding the next legal workflow action.
---

# Cadre Status

Read `.cadre/workflow.md` and use structured status for routine reporting. Do not open every active or archived spec/plan. Request `detail: "full"` or read a specific source only when diagnosing, quoting, or interpreting its contents. This command is read-only. If the Cadre MCP is unavailable, stop and report it; do not use a copied or reconstructed runtime.

Call `project_status` once with the narrowest view and use its embedded structured validation; do not repeat `state_validate` at command entry. Treat `errors` as the complete explanation for `valid` and `focusedErrors` as the selected-track subset. Project view reports staged candidates; focused view distinguishes candidate-only, canonical-with-stage, malformed canonical, and unknown IDs. Never silently treat a stage as canonical or omit a shadowed candidate.

For a whole-project report, consume `listing.nextCursor` until `listing.complete` is true. `statuses` filters rows only; counts and validation remain project-wide. Restart on `STATUS_SNAPSHOT_CHANGED`. Label a deliberately partial or filtered report. Request focused implementation views only for tracks whose live scheduler details are needed. Report `staleMemory` separately from structural errors.

Present:

- project setup checkpoint, pending operation journal, setup commit, and last-refresh commit;
- each track's type, status, durable checkpoint, pending operation, scheduling mode, approval mode, ready/running/awaiting-approval/blocked/conflicted/integrated nodes, dependencies, revision, and next legal command;
- registered Cadre worktrees, worker branches, dirty/conflicted worktrees, and orphaned runtime directories;
- blockers and stale dependent-track assessments;
- ready-for-review, completed-not-archived, and archived counts;
- validation errors and uncommitted Cadre state changes.
- staged proposal manifests, malformed stages, and canonical candidates awaiting safe cleanup.

Read any file before quoting or interpreting it. Do not mutate files, run commits, or silently normalize state.
