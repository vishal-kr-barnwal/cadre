---
name: revert
description: Prepare and execute a human-approved Git-aware revert of a Cadre task, phase, or track while preserving history and reconciling dependent state. Use for the revert command; prefer additive git revert commits over destructive history rewriting.
---

# Cadre Revert

Load `.cadre/workflow.md`, project/track state, spec, plan, learning, review/revision history, recorded task commits, Git history, working tree, and dependent tracks. Read every affected file and relevant later diff before proposing a revert.

At every required clarification or approval boundary, show a concise impact summary or focused diff and prefer `workflow_elicit`: use `clarification` for at most three questions and `approval` bound to the exact revert proposal checkpoint. Treat only an `approved` result as approval. If it returns `fallback_required`, ask the same short question once in chat; never request secrets or retry the form.

Call `project_status` first and use its embedded structured validation; do not repeat `state_validate` at command entry. If the Cadre MCP is unavailable, stop without beginning the revert.

Expected human decision count is one on the clean path. The exact revert proposal authorizes additive Git reversals, tests, plan/state/learning reconciliation, generated indexes, commits, and provenance bookkeeping when their content and consequences remain unchanged.

1. Resolve the exact task, phase, or track and its worker commits, task-to-phase merge commits, phase-to-canonical merge commits, and execution journal. Detect shared commits, later overlapping edits, active workers/worktrees, dirty changes, and dependent work.
2. Build a revert proposal: commits in safe reverse order, conflicts/overlaps, expected file changes, state rollback, invalidated learning/patterns/marked learning seeds, and downstream impacts.
3. Present the proposal, exact Git operations, expected resulting diff, downstream reconciliation, verification, generated index, and commits as one authorization envelope. Wait for explicit approval. Never use destructive reset/checkout or rewrite public history by default.
4. Call `template_get_many` for `track/revert-operation`, render the approved operation into `state.json.operation`, and persist it before any Git mutation. Record the target kind/ID, safe reverse commit order, base commit, expected reconciliation commit, approved artifacts, approval time, checkpoint, and applied revert commits. Resume a matching operation; never replace it.
5. Reach the authorized quiescent execution boundary before reverting. Use `git revert` to create additive reversal commits, using the correct mainline parent for an approved merge-commit revert. After each successful revert commit, record its SHA and advance the operation checkpoint. If a conflict has one unambiguous in-scope resolution that preserves the approved resulting semantics, resolve and verify it inside the envelope. If it introduces a material choice or changes the proposed result, stop and present one corrected proposal rather than accumulating per-file approval prompts.
6. Reconcile plan checkboxes without erasing provenance, append a revert history entry, set the earliest affected task/phase back to pending or blocked, and mark dependent tracks for approved revision/reseed as needed.
7. Run relevant tests, report the resulting diffs, preview and apply `tracks.md` through `tracks_render_preview` and `tracks_render_apply` with its unchanged digest, and call `state_validate`. Commit Cadre bookkeeping as `cadre(revert): reconcile <track-id>`, record that commit, clear the operation, and create a follow-up record commit when the bookkeeping cannot be included safely. Do not turn these deterministic consequences into a second approval. On resume, never repeat a revert SHA already recorded by the operation.

If exact commit provenance is missing or commits mix unrelated work, stop with a precise manual recovery plan.
