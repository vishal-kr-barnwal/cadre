---
name: cadre-revert
description: Prepare and execute a human-approved Git-aware revert of a Cadre task, phase, or track while preserving history and reconciling dependent state. Use for the revert command; prefer additive git revert commits over destructive history rewriting.
---

# Cadre Revert

Load `.cadre/workflow.md`, project/track state, spec, plan, learning, review/revision history, recorded task commits, Git history, working tree, and dependent tracks. Read every affected file and relevant later diff before proposing a revert.

1. Resolve the exact task, phase, or track and its recorded commit set. Detect merge commits, shared commits, later overlapping edits, dirty worktree changes, and dependent work.
2. Build a revert proposal: commits in safe reverse order, conflicts/overlaps, expected file changes, state rollback, invalidated learning/patterns/marked learning seeds, and downstream impacts.
3. Present the proposal and exact Git operations. Wait for explicit approval. Never use destructive reset/checkout or rewrite public history by default.
4. Use `git revert` to create additive reversal commits. Stop and present conflicts rather than guessing resolutions.
5. Reconcile plan checkboxes without erasing provenance, append a revert history entry, set the earliest affected task/phase back to pending or blocked, and mark dependent tracks for approved revision/reseed as needed.
6. Run relevant tests, present resulting diffs, regenerate `tracks.md`, validate, and commit Cadre bookkeeping as `cadre(revert): reconcile <track-id>`.

If exact commit provenance is missing or commits mix unrelated work, stop with a precise manual recovery plan.
