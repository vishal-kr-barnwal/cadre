---
name: revert
description: Prepare and execute a human-approved Git-aware revert of a Cadre task, phase, or track while preserving history and reconciling dependent state. Use for the revert command; prefer additive git revert commits over destructive history rewriting.
---

# Cadre Revert

Load `.cadre/workflow.md`, project/track state, spec, plan, learning, review/revision history, recorded task commits, Git history, working tree, and dependent tracks. Read every affected file and relevant later diff before proposing a revert.

Call `project_status` and `state_validate` first. If the Cadre MCP is unavailable, stop without beginning the revert.

1. Resolve the exact task, phase, or track and its worker commits, task-to-phase merge commits, phase-to-canonical merge commits, and execution journal. Detect shared commits, later overlapping edits, active workers/worktrees, dirty changes, and dependent work.
2. Build a revert proposal: commits in safe reverse order, conflicts/overlaps, expected file changes, state rollback, invalidated learning/patterns/marked learning seeds, and downstream impacts.
3. Present the proposal and exact Git operations. Wait for explicit approval. Never use destructive reset/checkout or rewrite public history by default.
4. Reach a quiescent execution boundary before reverting. Use `git revert` to create additive reversal commits, using the correct mainline parent for an approved merge-commit revert. Stop and present conflicts rather than guessing resolutions; rerun combined verification after resolution.
5. Reconcile plan checkboxes without erasing provenance, append a revert history entry, set the earliest affected task/phase back to pending or blocked, and mark dependent tracks for approved revision/reseed as needed.
6. Run relevant tests, present resulting diffs, preview and apply `tracks.md` through `tracks_render_preview` and `tracks_render_apply` with the unchanged approved digest, call `state_validate`, and commit Cadre bookkeeping as `cadre(revert): reconcile <track-id>`.

If exact commit provenance is missing or commits mix unrelated work, stop with a precise manual recovery plan.
