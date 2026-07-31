---
name: archive
description: Archive one or more completed Cadre tracks in one approved, resumable batch; distill their incremental learning with existing patterns, rebuild the pattern catalog, and reseed non-completed tracks by relevance. Use for the archive command after clean approved reviews.
---

# Cadre Archive

Archive one or more `completed` tracks in a single batch. Read `.cadre/workflow.md`, every artifact and recorded commit for every selected track, the full pattern catalog, all active track specs/plans and marked learning seeds, and relevant implementation files. Read existing pattern and learning files before proposing changes.

At every required selection or approval boundary, show a concise batch summary or focused diff. Inspect the active host policy before calling `workflow_elicit`: if the task context reports approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise prefer `workflow_elicit`, using `clarification` for at most three questions and `approval` bound to the archive preview digest. Treat only an `approved` result as approval. If it returns `fallback_required`, or immediately returns `declined` while the task explicitly reports policy `never`, ask the same short question once in chat; the latter is policy rejection, not a human decline. Never request secrets or retry the form.

Call `project_status` first and use its embedded structured validation; do not repeat `state_validate` at command entry. If the Cadre MCP is unavailable, stop without starting or advancing an archive batch.

Build one bounded archive inventory after selection. Read every selected artifact exactly once, summarize execution journals structurally in one pass, and verify recorded commit reachability in one Git pass. Do not precede reads with line counts, rediscover the same paths, or restart full reads after truncation; continue from the first unread line. Reuse unchanged workflow/product/styleguide context already loaded in the same flow. Fetch known pattern templates directly with one `template_get_many` call; do not call `template_catalog`. The declared mutation surface is `archive_batch_preview`/`archive_batch_apply` followed by `archive_batch_record_preview`/`archive_batch_record_apply`; do not inspect the installed runtime or tool catalog for alternatives.

Expected human decision count is one for the complete batch. Ask again only when its selection, content, or consequences change.

1. Accept an explicit list of track IDs. When selection is omitted or the human says `all completed`, omit `selectedTracks`; the server selects every eligible completed track in dependency order. Preserve an explicit order and remove duplicates.
2. Verify the entire selection before changing anything. Every selected track must be `completed`, have clean centralized `state_validate`, and have no pending state mutation. Do not recompute its DAG, manual-verification barriers, or review evidence inside archive; those are completed-state invariants. Reject the batch without partial mutation if any selected track is ineligible. Ignore completed tracks that were not selected.
3. If an in-progress `.cadre/operations/archive-<timestamp>.json` exists, reconcile it before accepting a new batch. Resume from its first incomplete checkpoint. If its journal, files, Git state, or expected commit disagree, stop and present the mismatch.
4. Distill durable, evidenced learning across the selected tracks as one corpus; discard track-specific trivia. Merge, replace, split, or retire existing patterns when justified, preserving provenance to every contributing track/phase/task commit. Reconcile overlapping or conflicting learning once so batch order cannot silently change the result.
5. Compute relevant Pattern Seed section changes in `learning.md` for every non-completed, non-archived track using the final proposed pattern set. Never seed by keyword alone; explain semantic relevance.
6. Call `archive_batch_preview` with structured updates: `pattern` plus slug, `pattern_index`, or `active_track_seed` plus track ID. Fetch exact template IDs (`project/pattern`, `project/patterns/index`, and `track/learning`) when needed. Present its complete moves, lifecycle states, content diffs, generated index, and expected commits as one proposal and obtain one explicit approval.
7. After approval, pass only the returned proposal token to `archive_batch_apply`. Commit all approved moves and derived changes together using the proposal's expected commit.
8. Call `archive_batch_record_preview` with the project root and batch ID; it derives the actual current HEAD. Verify its deterministic provenance update, then pass only its proposal token to apply. This bookkeeping needs no second approval. Create `cadre(archive): record batch <batch-id>`.
9. Use the final apply result instead of redundant `state_validate` or `project_status` calls when it is valid/current. Verify only the clean worktree and the two expected commits.

If interrupted before the archive commit, reconcile the batch journal and resume its first incomplete track or artifact through the same approved input. If the worktree is clean and HEAD matches the journal's expected commit and base relationship, treat the archive commit as successful and record that SHA. If the SHA is recorded but follow-up state is uncommitted, finish only the state commit. Never repeat completed moves, redistill from a partial selection, or start a second archive batch while one is active.

Do not delete learning, review cycles, revisions, bug reports, or commit provenance.
