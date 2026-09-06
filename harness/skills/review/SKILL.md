---
name: review
description: Review a Cadre track that is ready for review, present evidence-backed bugs for approval, add remediation phases, or mark a clean review cycle completed. Use for the review command and implement-review remediation cycles.
---

# Cadre Review

Review only a `ready_for_review` track. Load `.cadre/workflow.md`, all track artifacts and learning, dependency context, relevant patterns/styleguides, implementation commits, and repository tests. Read every reviewed file before judging or proposing edits.

At every required clarification or approval boundary, show a concise finding/evidence summary and focused diff. Inspect the active host policy before calling `workflow_elicit`: if the task context reports approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise prefer `workflow_elicit`, using `clarification` for at most three questions and `approval` bound to the current proposal digest or reviewed execution/HEAD. Treat only an `approved` result as approval. If it returns `fallback_required`, or immediately returns `declined` while the task explicitly reports policy `never`, ask the same short question once in chat; the latter is policy rejection, not a human decline. Never request secrets or retry the form.

Call `project_status` first with `view: "track"` and `trackId`; use its embedded structured validation and do not repeat `state_validate` at command entry. Stop when `valid` is false. Continue only for `kind: "canonical_track"` and `ready_for_review`; candidate-only or any other lifecycle state stops with its returned next action.

## Read context once

Build one bounded context inventory from `project_status`, the current track paths, and the reviewed Git range. Read each required artifact once. Do not run a line-count pass before reading, repeat `rg --files` discovery, or reread a whole file after truncated output; continue from the first unread line. During consecutive review cycles in the same flow, reuse unchanged product, workflow, pattern, and styleguide context and verify it by Git path/hash; reread the current state, plan, execution, new review range, and affected files/callers. Use batched parallel reads where independent.

The declared review mutation surface is adaptive `review_complete` for clean completion. Finding-bearing review uses the explicitly journaled direct-write procedure below. Do not inspect the installed runtime, global tool catalog, or generated MCP bundle looking for another review-state tool.

Expected human decision count is one per review cycle when the human accepts the recommended exact remediation, approves a clean review, or explicitly rejects findings and approves clean completion. Ask again only when the human changes the proposal or new evidence changes its content or consequences.

## Procedure

1. Read the completed execution journal and review its exact `baseCommit..headCommit` range, which includes the first implementation commit. Inspect diffs and affected callers, tests, security boundaries, error paths, compatibility, acceptance criteria, and non-functional requirements.
2. Run relevant verification without mutating production behavior. Report findings by severity with file/line evidence, impact, reproduction, and proposed acceptance criteria. Do not write a bug file yet.
3. Prepare one decision-ready proposal before asking for approval:
   - If findings exist, call `template_get_many` for `track/bug`, then `candidate_stage_prepare` for `review-<track-id>` with `expectedFiles` equal to the exact bug artifact paths plus `plan.md`. Draft only those files beneath the stage so removed findings cannot remain. Do not pass plan Markdown through MCP or create a temporary project copy.
   - Call `candidate_inspect` once for the complete staged bug/plan set with `planValidations: [{ path: "plan.md", targetStatus: "in_progress" }]`. Present findings, exact diff, graph summary, manifest, consequences, and choices together, bound to its digest. One response may approve both the finding disposition and the unchanged exact artifacts, or reject all findings while explicitly accepting their risks and approve clean completion.
   - If the human changes the finding subset or remediation, rebuild and validate the exact proposal and request approval once for that changed proposal. Do not reuse approval for superseded content.
   - If no findings exist, present clean-review evidence and the exact completion transition once, then ask approval to complete the track.
4. For approved changes, record a resumable `review` operation containing the approved manifest digest and path/hash entries before changing the bug artifact, plan, or state. Promote only those staged files, verify their canonical hashes, increment the plan revision, set state to `in_progress`, reset review readiness, and record the review cycle. Call `tracks_render` once, validate, and commit `cadre(review): request changes for <track-id>` without staging `.cadre/stage/`. Record that commit SHA as the new approved plan commit, clear the operation, and use `cadre(review): record changes for <track-id>` for follow-up bookkeeping when needed. Remove only the matching candidate stage after its canonical hashes and commits are recorded. The prior completed execution remains historical until `implement` starts a new execution ID for the changed graph.
5. For an approved clean review, call `review_complete` with `request: { mode: "prepare", projectRoot, trackId, approval, acceptedRisks? }`. The server derives the range from the completed execution base through its reviewed HEAD. After approval, call only `request: { mode: "apply", proposalToken }`. A retry converges a matching cycle/index without duplicating history. Commit `cadre(review): complete <track-id>`.

Repeat review → implement → review until a human approves a clean review. Only this command may mark a track completed.

## Memory contract

Preserve phase history and existing handoffs. For active v3 tracks, keep the marked `cadre:memory` JSON block inside Pattern Seed synchronized with the proposed spec/plan revisions and exact approved pattern hashes. Every applicable pattern requires its safe `patterns/<slug>.md` path, SHA-256, and human-readable relevance/constraints; never invent or silently omit guidance. When a staged plan changes revisions, include the reassessed learning file in `expectedFiles`. Inspect `candidate_inspect.learning` and `memoryInputs` as well as `plans`; resolve invalid or stale memory before approval. Immediately before direct promotion, re-inspect and compare the complete approved digest, including unchanged memory inputs; changed inputs require reassessment and a corrected approval. Archive apply performs this check in the runtime. Completed and archived learning remains historical evidence, not a claim that old hashes describe current patterns.

The legacy input field `approval` carries prepared review evidence, not a claim of a human decision. State stores it as `reviewEvidence`. Prepare once, obtain approval of the exact digest, and apply its token unchanged. The runtime adds `approvalConfirmation` with the bound digest, confirmation time and `explicit-apply` method, separately from the evidence. Do not re-prepare merely to replace pending-approval prose. This receipt records the approved application, not an authenticated identity or a fabricated quotation from a human.
