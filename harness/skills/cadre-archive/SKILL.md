---
name: cadre-archive
description: Archive a completed Cadre track, distill its incremental learning with existing patterns, rebuild the pattern catalog, and reseed non-completed tracks by relevance. Use for the archive command after a clean approved review.
---

# Cadre Archive

Archive only a `completed` track. Read `.cadre/workflow.md`, every artifact and recorded commit for the track, the full pattern catalog, all active track specs/plans and marked learning seeds, and relevant implementation files. Read existing pattern and learning files before proposing changes.

1. Verify the track is cleanly completed and no active state mutation is pending.
2. Distill durable, evidenced learning; discard track-specific trivia. Merge, replace, split, or retire existing patterns when justified, preserving provenance back to track/phase/task commits.
3. Compute relevant Pattern Seed section changes in `learning.md` for every non-completed, non-archived track. Never seed by keyword alone; explain semantic relevance.
4. Present the archive move, rebuilt pattern diffs, and all learning-seed diffs for human approval.
5. After approval, move the track directory to `.cadre/archive/<track-id>`, retain a project entry with status `archived` and archive path, update pattern history/index, update approved learning seeds, and regenerate `tracks.md`.
6. Validate and commit `cadre(archive): archive <track-id>`. Record the archive commit in state with a follow-up state commit if necessary.

Do not delete learning, review cycles, revisions, bug reports, or commit provenance.
