---
name: review
description: Review a Cadre track that is ready for review, present evidence-backed bugs for approval, add remediation phases, or mark a clean review cycle completed. Use for the review command and implement-review remediation cycles.
---

# Cadre Review

Review only a `ready_for_review` track. Load `.cadre/workflow.md`, all track artifacts and learning, dependency context, relevant patterns/styleguides, implementation commits, and repository tests. Read every reviewed file before judging or proposing edits.

At every required clarification or approval boundary, show a concise finding/evidence summary and focused diff. Inspect the active host policy before calling `workflow_elicit`: if the task context reports approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise prefer `workflow_elicit`, using `clarification` for at most three questions and `approval` bound to the current proposal digest or reviewed execution/HEAD. Treat only an `approved` result as approval. If it returns `fallback_required`, or immediately returns `declined` while the task explicitly reports policy `never`, ask the same short question once in chat; the latter is policy rejection, not a human decline. Never request secrets or retry the form.

Call `project_status` first with `view: "track"` and `trackId`; use its embedded structured validation and do not repeat `state_validate` at command entry. If the Cadre MCP is unavailable, stop without changing review state.

## Read context once

Build one bounded context inventory from `project_status`, the current track paths, and the reviewed Git range. Read each required artifact once. Do not run a line-count pass before reading, repeat `rg --files` discovery, or reread a whole file after truncated output; continue from the first unread line. During consecutive review cycles in the same flow, reuse unchanged product, workflow, pattern, and styleguide context and verify it by Git path/hash; reread the current state, plan, execution, new review range, and affected files/callers. Use batched parallel reads where independent.

The declared review mutation surface is adaptive `review_complete` for clean completion. Finding-bearing review uses the explicitly journaled direct-write procedure below. Do not inspect the installed runtime, global tool catalog, or generated MCP bundle looking for another review-state tool.

Expected human decision count is one per review cycle when the human accepts the recommended exact remediation, approves a clean review, or explicitly rejects findings and approves clean completion. Ask again only when the human changes the proposal or new evidence changes its content or consequences.

## Procedure

1. Determine the commit range from the plan's recorded task commits. Inspect diffs and affected callers, tests, security boundaries, error paths, compatibility, acceptance criteria, and non-functional requirements.
2. Run relevant verification without mutating production behavior. Report findings by severity with file/line evidence, impact, reproduction, and proposed acceptance criteria. Do not write a bug file yet.
3. Prepare one decision-ready proposal before asking for approval:
   - If findings exist, call `template_get_many` for `track/bug`, call `candidate_stage_prepare` for `review-<track-id>`, and draft the exact bug artifacts plus replacement `plan.md` beneath the returned stage. Every added phase declares dependencies and ends in the derived manual-verification barrier. Preserve prior verification provenance. Do not pass plan Markdown through MCP, validate the stale canonical plan, or create a temporary project copy.
   - Call `candidate_inspect` once for the complete staged bug/plan set with `targetStatus: "in_progress"`. Present findings, exact diff, graph summary, manifest, consequences, and choices together, bound to its digest. One response may approve both the finding disposition and the unchanged exact artifacts, or reject all findings while explicitly accepting their risks and approve clean completion.
   - If the human changes the finding subset or remediation, rebuild and validate the exact proposal and request approval once for that changed proposal. Do not reuse approval for superseded content.
   - If no findings exist, present clean-review evidence and the exact completion transition once, then ask approval to complete the track.
4. For approved changes, record a resumable `review` operation containing the approved manifest digest and path/hash entries before changing the bug artifact, plan, or state. Promote only those staged files, verify their canonical hashes, increment the plan revision, set state to `in_progress`, reset review readiness, and record the review cycle. Call `tracks_render` once, validate, and commit `cadre(review): request changes for <track-id>` without staging `.cadre/stage/`. Record that commit SHA as the new approved plan commit, clear the operation, and use `cadre(review): record changes for <track-id>` for follow-up bookkeeping when needed. Remove only the matching candidate stage after its canonical hashes and commits are recorded. The prior completed execution remains historical until `implement` starts a new execution ID for the changed graph.
5. For an approved clean review, call `review_complete` with `mode: "prepare"`, the range start, exact approval record, and accepted risks. Present its `approval_required` proposal. After approval, call only `{ mode: "apply", proposalToken }`; never make the two calls consecutively without human input. This writes completed state and the derived index together. Commit `cadre(review): complete <track-id>`.

Repeat review → implement → review until a human approves a clean review. Only this command may mark a track completed.
