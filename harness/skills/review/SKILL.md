---
name: review
description: Review a Cadre track that is ready for review, present evidence-backed bugs for approval, add remediation phases, or mark a clean review cycle completed. Use for the review command and implement-review remediation cycles.
---

# Cadre Review

Review only a `ready_for_review` track. Load `.cadre/workflow.md`, all track artifacts and learning, dependency context, relevant patterns/styleguides, implementation commits, and repository tests. Read every reviewed file before judging or proposing edits.

Call `project_status` first and use its embedded structured validation; do not repeat `state_validate` at command entry. If the Cadre MCP is unavailable, stop without changing review state.

## Read context once

Build one bounded context inventory from `project_status`, the current track paths, and the reviewed Git range. Read each required artifact once. Do not run a line-count pass before reading, repeat `rg --files` discovery, or reread a whole file after truncated output; continue from the first unread line. During consecutive review cycles in the same flow, reuse unchanged product, workflow, pattern, and styleguide context and verify it by Git path/hash; reread the current state, plan, execution, new review range, and affected files/callers. Use batched parallel reads where independent.

The declared review mutation surface is `review_complete_preview`/`review_complete_apply` for clean completion. Finding-bearing review uses the explicitly journaled direct-write procedure below. Do not inspect the installed runtime, global tool catalog, or generated MCP bundle looking for another review-state tool.

Expected human decision count is one per review cycle when the human accepts the recommended exact remediation, approves a clean review, or explicitly rejects findings and approves clean completion. Ask again only when the human changes the proposal or new evidence changes its content or consequences.

## Procedure

1. Determine the commit range from the plan's recorded task commits. Inspect diffs and affected callers, tests, security boundaries, error paths, compatibility, acceptance criteria, and non-functional requirements.
2. Run relevant verification without mutating production behavior. Report findings by severity with file/line evidence, impact, reproduction, and proposed acceptance criteria. Do not write a bug file yet.
3. Prepare one decision-ready proposal before asking for approval:
   - If findings exist, call `template_get_many` for `track/bug`, retain the versioned result, and draft the exact bug artifact plus the recommended dependency-aware remediation phases for all actionable findings. Every regular task declares same-phase dependencies, every added phase declares the phases it consumes and ends in the derived `User Manual Verification` barrier. Renumber the final phase/tasks as needed, reset that final manual barrier and phase completion to pending, and preserve its prior verification provenance in the review cycle/execution journal rather than leaving a second final phase. Call `execution_graph_validate_draft` with the complete proposed plan Markdown and target status `in_progress`; do not validate the stale canonical plan or create a temporary project copy.
   - Present the findings, exact artifact/plan diff, consequences, and choices together. One response may approve both the finding disposition and the unchanged exact artifacts. The human may instead request a subset or different remediation, reject all findings while explicitly accepting their risks and approve clean completion, or stop without mutation.
   - If the human changes the finding subset or remediation, rebuild and validate the exact proposal and request approval once for that changed proposal. Do not reuse approval for superseded content.
   - If no findings exist, present clean-review evidence and the exact completion transition once, then ask approval to complete the track.
4. For approved changes, record a resumable `review` operation before changing the bug artifact, plan, or state. Increment the plan revision, set state to `in_progress`, reset review readiness, and record the review cycle. Call `tracks_render_preview`, show and apply its unchanged digest with `tracks_render_apply`, call `state_validate`, and commit `cadre(review): request changes for <track-id>`. Record that commit SHA as the new approved plan commit, clear the operation, and use `cadre(review): record changes for <track-id>` for follow-up bookkeeping when needed. The prior completed execution remains historical until `implement` starts a new execution ID for the changed graph.
5. For an approved clean review, including an explicit reject-and-complete decision, bind the clean cycle and any accepted risks to `lastExecution.executionId`, its plan revision, graph digest, and reviewed HEAD. Call `review_complete_preview` with the exact approval record, evidence, and accepted risks, then pass its unchanged digest to `review_complete_apply`; this writes the completed track state and derived index together and returns final validation. Do not repeat `tracks_render_*`, `state_validate`, or `project_status` when that result is valid/current. If the preview differs materially from the transition already shown to the human, present the correction and obtain new approval before apply. Commit `cadre(review): complete <track-id>`.

Repeat review → implement → review until a human approves a clean review. Only this command may mark a track completed.
