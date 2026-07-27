---
name: review
description: Review a Cadre track that is ready for review, present evidence-backed bugs for approval, add remediation phases, or mark a clean review cycle completed. Use for the review command and implement-review remediation cycles.
---

# Cadre Review

Review only a `ready_for_review` track. Load `.cadre/workflow.md`, all track artifacts and learning, dependency context, relevant patterns/styleguides, implementation commits, and repository tests. Read every reviewed file before judging or proposing edits.

Call `project_status` and `state_validate` first. If the Cadre MCP is unavailable, stop without changing review state.

## Procedure

1. Determine the commit range from the plan's recorded task commits. Inspect diffs and affected callers, tests, security boundaries, error paths, compatibility, acceptance criteria, and non-functional requirements.
2. Run relevant verification without mutating production behavior. Report findings by severity with file/line evidence, impact, reproduction, and proposed acceptance criteria. Do not write a bug file yet.
3. Present findings to the human:
   - If findings exist, ask which findings are approved as bugs.
   - If none exist, present clean-review evidence and ask approval to complete the track.
4. For approved findings, call `template_get` for `track/bug`, render `bugs/bug-<review-ts>.md`, and append new remediation phases to `plan.md`. Every added phase ends in `User Manual Verification`, followed by a new final `Track-level User Manual Verification` phase. Present the exact bug artifact and plan change and wait for approval.
5. After approval, set state to `in_progress`, record the review cycle, call `tracks_render_preview`, show and apply its unchanged digest with `tracks_render_apply`, call `state_validate`, and commit `cadre(review): request changes for <track-id>`.
6. For an approved clean review, record the clean cycle, set track-local status to `completed`, preview/apply the derived tracks index through the same MCP digest gate, call `state_validate`, and commit `cadre(review): complete <track-id>`.

Repeat review → implement → review until a human approves a clean review. Only this command may mark a track completed.
