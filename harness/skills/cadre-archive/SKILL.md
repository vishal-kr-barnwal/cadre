---
name: cadre-archive
description: Archive one or more completed Cadre tracks in one approved, resumable batch; distill their incremental learning with existing patterns, rebuild the pattern catalog, and reseed non-completed tracks by relevance. Use for the archive command after clean approved reviews.
---

# Cadre Archive

Archive one or more `completed` tracks in a single batch. Read `.cadre/workflow.md`, every artifact and recorded commit for every selected track, the full pattern catalog, all active track specs/plans and marked learning seeds, and relevant implementation files. Read existing pattern and learning files before proposing changes.

1. Accept an explicit list of track IDs or `all completed`. If the selection is omitted or ambiguous, list eligible completed tracks and ask which to include. Preserve the approved order and remove duplicates.
2. Verify the entire selection before changing anything. Every selected track must be `completed`, have a final approved clean review, and have no pending state mutation. Reject the batch without partial mutation if any selected track is ineligible. Ignore completed tracks that were not selected.
3. If an in-progress `.cadre/operations/archive-<timestamp>.json` exists, reconcile it before accepting a new batch. Resume from its first incomplete checkpoint. If its journal, files, Git state, or expected commit disagree, stop and present the mismatch.
4. Distill durable, evidenced learning across the selected tracks as one corpus; discard track-specific trivia. Merge, replace, split, or retire existing patterns when justified, preserving provenance to every contributing track/phase/task commit. Reconcile overlapping or conflicting learning once so batch order cannot silently change the result.
5. Compute relevant Pattern Seed section changes in `learning.md` for every non-completed, non-archived track using the final proposed pattern set. Never seed by keyword alone; explain semantic relevance.
6. Present the full selected-track list, every archive move, consolidated pattern diffs, and all learning-seed diffs as one batch proposal. Obtain explicit approval for the complete batch; a partial approval creates a new, smaller proposal.
7. After approval and before any move, instantiate `.cadre/operations/archive-<timestamp>.json` from `.cadre/templates/project/archive-operation.json`. Record the batch ID, ordered selection, base commit, expected commit, approved artifacts, approval time, checkpoint, and per-track/artifact progress.
8. Move each selected directory from `.cadre/tracks/<track-id>` to its status-derived `.cadre/archive/<track-id>` location, set only its track-local state to `archived`, and advance the journal after each durable step. Do not create a project-level track entry or persist a path. Then apply the approved consolidated pattern/index and active-track seed updates and regenerate `tracks.md`.
9. Validate once for the completed batch and commit all approved archive moves and derived changes together. Use `cadre(archive): archive <id-list>` when concise, otherwise `cadre(archive): archive batch <batch-id>`; the exact expected message must be in the journal.
10. Record the archive commit SHA in every selected track state, the project history, and the batch journal. Mark the journal completed and create `cadre(archive): record batch <batch-id>` as the follow-up state commit.

If interrupted before the archive commit, resume the journal's first incomplete track or artifact. If the worktree is clean and HEAD matches the journal's expected commit and base relationship, treat the archive commit as successful and record that SHA. If the SHA is recorded but follow-up state is uncommitted, finish only the state commit. Never repeat completed moves, redistill from a partial selection, or start a second archive batch while one is active.

Do not delete learning, review cycles, revisions, bug reports, or commit provenance.
