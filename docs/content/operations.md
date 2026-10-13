---
title: Operations
description: Day-to-day status, recovery, refresh, review, archive, and plugin maintenance.
section: Operations
order: 110
---

# Operations

Cadre operations are repository-local and Git-aware. Start with read-only
status, then invoke the workflow that owns any required mutation.

## Daily Status

```text
$cadre:status
/cadre:status
/cadre-status
```

Status reads project state, every active and archived track, managed worktrees,
and current executions. It reports:

- setup and refresh checkpoints;
- pending operation journals;
- track status, dependencies, revisions, and next legal commands;
- ready, running, awaiting-approval, blocked, conflicted, and integrated nodes;
- dirty or orphaned managed worktrees;
- review/archive readiness and validation errors.

Status never repairs or normalizes state.

## Interrupted Workflow

Rerun the same workflow. Cadre first reconciles its journal with files and Git.
Do not remove journals, reset branches, delete worktrees, or regenerate
artifacts to force a restart.

If state matches, the workflow resumes from its first incomplete checkpoint. If
state disagrees, Cadre stops with the exact mismatch so the user can choose a
safe recovery.

## Project Context Drift

Run `refresh` after material repository changes, new product direction,
workflow changes, stack migrations, styleguide changes, or completed-track
learning that should influence future work.

Refresh records its evidence range and exact approved diffs. It also assesses
active tracks and reaches a safe boundary before changing execution-governing
context.

## Review And Remediation

Governed, Phase and Track modes use `review` after implementation reaches
`ready_for_review`; approved findings return to implementation. Autonomous mode
continues into review and bounded in-scope remediation under its persisted
authority without another command. All modes require explicit approval of the
final clean completion. Autonomous cannot waive findings with accepted risks.

## Archive Batches

Archive explicit track IDs or `all completed`. An omitted selection includes all
eligible completed tracks in dependency order. Review the complete selection
and consequences in one batch approval before mutation.

Archive validates the entire selection before promotion. One ineligible track
rejects the batch. Promotion uses journaled, resumable writes and moves; an
interruption may leave partial progress, which resumes under the original
approval before the single archive commit and receipt reconciliation.

## Revert Recorded Work

Use `revert` rather than destructive history rewriting. The workflow traces
task, task-to-phase, and phase-to-main commits, detects later overlaps, proposes
safe reverse order, and journals each applied revert commit.

Mixed or missing provenance stops with a manual recovery plan.

## Update The Plugin

```bash
npm install -g cadre-ai@latest
cadre-ai doctor
cadre-ai install
```

Reload clients after installation. The installer replaces its owned local
marketplace payload and retains the prior one as a timestamped backup.

## Inspect Native Installation

```bash
codex plugin list --json
claude plugin list --json
```

Both clients should show `cadre@cadre` installed and enabled. There is no
current `cadre-ai install --check` option.
