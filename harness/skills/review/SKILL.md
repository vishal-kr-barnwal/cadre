---
name: review
description: Review a Cadre track that is ready for review, present evidence-backed bugs for approval, add remediation phases, or mark a clean review cycle completed. Use for the review command and implement-review remediation cycles.
---

# Cadre Review

Review only a `ready_for_review` track. Load `.cadre/workflow.md`, all track artifacts and learning, dependency context, relevant patterns/styleguides, implementation commits, and repository tests. Read every reviewed file before judging or proposing edits.

Call `project_status` first and use its embedded structured validation; do not repeat `state_validate` at command entry. If the Cadre MCP is unavailable, stop without changing review state.

## Procedure

1. Determine the commit range from the plan's recorded task commits. Inspect diffs and affected callers, tests, security boundaries, error paths, compatibility, acceptance criteria, and non-functional requirements.
2. Run relevant verification without mutating production behavior. Report findings by severity with file/line evidence, impact, reproduction, and proposed acceptance criteria. Do not write a bug file yet.
3. Present findings to the human:
   - If findings exist, ask which findings are approved as bugs.
   - If none exist, present clean-review evidence and ask approval to complete the track.
4. For approved findings, call `template_get_many` for `track/bug`, retain the versioned result, render `bugs/bug-<review-ts>.md`, and insert dependency-aware remediation phases immediately before the existing final track-verification phase. Every regular task declares same-phase dependencies, every added phase declares the phases it consumes and ends in the derived `User Manual Verification` barrier. Renumber the final phase/tasks as needed, reset that final manual barrier and phase completion to pending, and preserve its prior verification provenance in the review cycle/execution journal rather than leaving a second final phase. Call `execution_graph_validate`, then present the exact bug artifact and plan change and wait for approval.
5. After approval, record a resumable `review` operation before changing the bug artifact, plan, or state. Increment the plan revision, set state to `in_progress`, reset review readiness, and record the review cycle. Call `tracks_render_preview`, show and apply its unchanged digest with `tracks_render_apply`, call `state_validate`, and commit `cadre(review): request changes for <track-id>`. Record that commit SHA as the new approved plan commit, clear the operation, and use `cadre(review): record changes for <track-id>` for follow-up bookkeeping when needed. The prior completed execution remains historical until `implement` starts a new execution ID for the changed graph.
6. For an approved clean review, bind the clean cycle to `lastExecution.executionId`, its plan revision, graph digest, and reviewed HEAD. Set track-local status to `completed`, preview/apply the derived tracks index through the same MCP digest gate, call `state_validate`, and commit `cadre(review): complete <track-id>`.

Repeat review → implement → review until a human approves a clean review. Only this command may mark a track completed.
