---
name: review
description: Review a Cadre track that is ready for review, present evidence-backed bugs for approval, add remediation phases, or mark a clean review cycle completed. Use for the review command and implement-review remediation cycles.
---

# Cadre Review

Review a `ready_for_review` track. A persisted policy-v2 Autonomous review operation may also resume interrupted promotion from `in_progress`; finish that operation before implementation starts. Apply the Autonomous rules below under the originating persisted authorization and retain explicit human approval for clean completion. Load `.cadre/workflow.md`, all track artifacts and learning, dependency context, relevant patterns/styleguides, implementation commits, and repository tests. Read every reviewed file before judging or proposing edits.

At every required clarification or approval boundary, show a concise finding/evidence summary and focused diff. Inspect the active host policy before calling `workflow_elicit`: if the task context reports approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise prefer `workflow_elicit`, using `clarification` for at most three questions and `approval` bound to the current proposal digest or reviewed execution/HEAD. Treat only an `approved` result as approval. If it returns `fallback_required`, or immediately returns `declined` while the task explicitly reports policy `never`, ask the same short question once in chat; the latter is policy rejection, not a human decline. Never request secrets or retry the form.

Call `project_status` first with `view: "track"` and `trackId`; use its embedded structured validation and do not repeat `state_validate` at command entry. Stop when `valid` is false, `upgradeRequired` is true, relevant memory is stale, or `nextStep.action` is `blocked`. Continue only for `kind: "canonical_track"` and `ready_for_review`, or a journaled Autonomous review operation recovering from `in_progress`. Follow a returned implementation handoff only after review bookkeeping is complete; candidate-only or other lifecycle states stop with their returned next action.

## Read context once

Build one bounded context inventory from `project_status`, the current track paths, and the reviewed Git range. Read each required artifact once. Do not run a line-count pass before reading, repeat `rg --files` discovery, or reread a whole file after truncated output; continue from the first unread line. During consecutive review cycles in the same flow, reuse unchanged product, workflow, pattern, and styleguide context and verify it by Git path/hash; reread the current state, plan, execution, new review range, and affected files/callers. Use batched parallel reads where independent.

The declared review mutation surface is adaptive `review_complete` for clean completion. Finding-bearing review uses the explicitly journaled direct-write procedure below. Do not inspect the installed runtime, global tool catalog, or generated MCP bundle looking for another review-state tool.

Expected human decision count is one per review cycle outside policy-v2 Autonomous when the human accepts the recommended exact remediation, approves a clean review, or explicitly rejects findings and approves clean completion. Ask again only when the human changes the proposal or new evidence changes its content or consequences.

## Procedure

1. Read the completed execution journal and review its exact `baseCommit..headCommit` range (Autonomous uses persisted `initialBaseCommit..headCommit` across all remediation executions), which includes the first implementation commit. Inspect diffs and affected callers, tests, security boundaries, error paths, compatibility, acceptance criteria, and non-functional requirements.
2. Run relevant verification without mutating production behavior. Report findings by severity with file/line evidence, impact, reproduction, and proposed acceptance criteria. Do not write a bug file yet.
3. Prepare one decision-ready proposal before asking for approval (Autonomous binds in-scope findings to persisted authorization as described below):
   - If findings exist, call `template_get_many` for `track/bug`, then `candidate_stage_prepare` for `review-<track-id>` with `expectedFiles` equal to the exact bug artifact paths plus `plan.md`. Draft only those files beneath the stage so removed findings cannot remain. Do not pass plan Markdown through MCP or create a temporary project copy.
   - Append remediation phases and a new final `Track-level User Manual Verification` phase. Preserve every completed former final verification phase with its exact title, task IDs, checkboxes, and commit markers; its dependencies remain the preceding phases it verified. Do not rename it, insert a fictitious delivery task, or reopen it to satisfy validation.
   - Call `candidate_inspect` once for the complete staged bug/plan set with `planValidations: [{ path: "plan.md", targetStatus: "in_progress" }]`. Present findings, exact diff, graph summary, manifest, consequences, and choices together, bound to its digest. One response may approve both the finding disposition and the unchanged exact artifacts, or reject all findings while explicitly accepting their risks and approve clean completion.
   - Inspection validates that target status without changing canonical state. Keep the canonical track `ready_for_review` and its completed execution unchanged until human approval or the exact Autonomous remediation authorization is journaled. If a staged state is included, its status must agree with `targetStatus`; an active execution still requires reconciliation at a safe boundary.
   - If the human changes the finding subset or remediation, rebuild and validate the exact proposal and request approval once for that changed proposal. Do not reuse approval for superseded content.
   - If no findings exist, prepare the clean completion proposal in step 5 before presenting its exact transition for approval.
4. For approved changes, record a resumable `review` operation containing the approved manifest digest and path/hash entries before changing the bug artifact, plan, or state. Promote only those staged files, verify their canonical hashes, increment the plan revision, set state to `in_progress`, reset review readiness, and record the review cycle. Call `tracks_render` once, validate, and commit `cadre(review): request changes for <track-id>` without staging `.cadre/stage/`. Record that commit SHA as the new approved plan commit, clear the operation, and use `cadre(review): record changes for <track-id>` for follow-up bookkeeping when needed. Remove only the matching candidate stage after its canonical hashes and commits are recorded. The prior completed execution remains historical until `implement` starts a new execution ID for the changed graph.
5. For a clean review, call `review_complete` with `request: { mode: "prepare", projectRoot, trackId, approval, acceptedRisks? }`. The server derives the cumulative range for Autonomous and the completed execution range for other modes. Present its exact proposal and evidence, then ask once for explicit approval. After approval, call only `request: { mode: "apply", proposalToken }`. A retry converges a matching cycle/index without duplicating history. Commit `cadre(review): complete <track-id>`.

Repeat review → implement → review until a human approves a clean review. Autonomous continues the loop in this task without asking permission for in-scope remediation. Other approval modes retain their existing gates. Only this command may mark a track completed.

## MCP skill continuation

Follow `nextStep` from focused `project_status` and `execution_finish` using its exact `projectRoot`, `trackId`, and current `executionId`. `invoke_skill` identifies the installed Cadre skill by `plugin` and `skill`; invoke it through the host's native skill mechanism in the same task. Codex/Claude resolve the Cadre plugin workflow; Zed resolves `cadre-<skill>`. If native invocation is unavailable, load the full skill from its host-advertised installed location and execute its procedure. Reuse an already loaded, unchanged skill; a next step naming the current skill means continue it, not recursive re-entry. Never derive sibling filesystem paths or merely print a slash command. If the installed skill cannot be resolved, stop with that blocker.

Satisfy `prerequisite` before handoff: `implementation_bookkeeping_commit` means finish and commit the implementation journal/plan/state/index; `review_bookkeeping_commit` means finish review promotion, provenance, commits, and operation clearance. Check Git and journal evidence on resume so an already satisfied prerequisite does not create another commit. `await_approval` routes to review to revalidate evidence, prepare the exact completion proposal, and obtain the missing human decision. `blocked` stops automatic work with its reason. `null` supplies no Autonomous continuation and leaves ordinary mode gates in effect. MCP returns routing data; the agent performs the skill invocation. Routing never grants new authority or replaces validation.

## Memory contract

Preserve phase history and existing handoffs. For active v3/v4 tracks, keep the marked `cadre:memory` JSON block inside Pattern Seed synchronized with the proposed spec/plan revisions and exact approved pattern hashes. Every applicable pattern requires its safe `patterns/<slug>.md` path, SHA-256, and human-readable relevance/constraints; never invent or silently omit guidance. When a staged plan changes revisions, include the reassessed learning file in `expectedFiles`. Inspect `candidate_inspect.learning` and `memoryInputs` as well as `plans`; resolve invalid or stale memory before approval. Immediately before direct promotion, re-inspect and compare the complete approved digest, including unchanged memory inputs; changed inputs require reassessment and a corrected approval. Archive apply performs this check in the runtime. Completed and archived learning remains historical evidence, not a claim that old hashes describe current patterns.

The legacy input field `approval` carries prepared review evidence, not a claim of a human decision. State stores it as `reviewEvidence`. Prepare once, obtain approval of the exact digest, and apply its token unchanged. The runtime adds `approvalConfirmation` with the bound digest, confirmation time and `explicit-apply` method, separately from the evidence. Do not re-prepare merely to replace pending-approval prose. This receipt records the approved application, not an authenticated identity or a fabricated quotation from a human.

## Autonomous authorization

These rules override intermediate human gates only for a valid policy-v2 persisted Autonomous loop. Use the same candidate, journal, promotion, memory, and commit procedure above. Main owns scheduling and state and performs a separate review pass; no additional reviewer agent is required. Never duplicate a review cycle, execution, or commit during recovery.

Use this exact canonical `state.operation` shape for remediation; a finding disposition such as `request_changes` is not an operation action:

```json
{
  "action": "review",
  "checkpoint": "approved",
  "baseCommit": "<canonical HEAD before promotion>",
  "expectedCommit": "cadre(review): request changes for <track-id>",
  "approvedArtifacts": ["<each inspected relative path>"],
  "approvedArtifactHashes": [{ "path": "<same relative path>", "sha256": "<inspected hash>" }],
  "artifactProgress": [],
  "approvedAt": "<ISO timestamp of this mode-authorized operation>",
  "approvalDigest": "<complete inspected digest>",
  "authorization": { "kind": "persisted-mode", "originExecutionId": "<original execution>", "proposalDigest": "<same digest>" }
}
```

List every inspected file in both artifact arrays, including the loop snapshot and learning. `approvedArtifacts` contains path strings; `approvedArtifactHashes` contains path/hash objects. `expectedCommit` is the intended commit message, not a SHA. After journaling, call `state_validate` and require valid state before the first canonical promotion; repair journal metadata without changing its inspected manifest or authority if validation fails. Record the findings assigned to the next remediation execution as `attemptedFindingIds` on the changes-requested cycle, even though their completed-attempt counters are initially empty.

## Durable authority and checkpoints

`execution_start` creates `state.autonomousReview` for a new explicit Autonomous selection. It preserves that object across remediation executions; `execution_finish` advances it to `reviewing`. Its schema is:

```json
{
  "policyVersion": 2,
  "originExecutionId": "<original-execution-id>",
  "authorizedAt": "<ISO timestamp of explicit invocation or migration>",
  "initialBaseCommit": "<original implementation base SHA>",
  "specCommit": "<approved specification SHA>",
  "checkpoint": "implementing",
  "findings": [
    { "id": "stable-bug-id", "summary": "Root cause and violated acceptance criterion", "status": "open", "attemptExecutionIds": [] }
  ]
}
```

Checkpoints are `implementing`, `reviewing`, `remediating`, `awaiting_approval`, `blocked`, and `completed`. A reviewed result also records `reviewedExecutionId` and `reviewedHead`. A blocked loop records a nonempty `blocker`. Never change the originating authorization, specification commit, or initial baseline during automatic remediation. Changes to scope require human authority through refresh/revise.

## Review and remediation

1. Finish the current implementation journal and commit its bookkeeping before invoking review. At `ready_for_review`, review `initialBaseCommit..lastExecution.headCommit`, all acceptance criteria, affected callers/tests, and prior findings. Verify actual product changes and re-run affected checks. Do not treat the latest remediation diff alone as a clean track review.
2. Keep each finding's ID stable across renames, moves, rewritten fixes, and review wording. Reopen a recurring finding using the same ID. After reviewing a completed execution that attempted that finding, append that execution ID to `attemptExecutionIds` only if absent; never count the original discovery execution or count an interrupted attempt twice. Mark resolved only from actual verification and review evidence. Preserve resolved finding history.
3. If an open finding has two recorded remediation execution IDs, stop with checkpoint `blocked` and a precise blocker. Do the same for material scope decisions, unavailable human-only verification, or external blockers. Present the evidence and ask how to continue; never reset IDs/attempt counts to bypass the stop. Persist this evidence in canonical state using a focused bookkeeping commit. On explicit instructions to retry a stalled finding, use a digest-bound refresh to record those instructions and start a new authorized loop while retaining the former loop in track history.
4. For progressable in-scope findings, stage bug artifacts, appended remediation phases and final verification, learning, and `reviews/loop-<cycle>.json` at the review candidate root. The loop snapshot contains the complete updated `autonomousReview` object: retained authority/findings, reviewed execution/HEAD, and checkpoint `remediating`. Include that exact snapshot path in `expectedFiles`; validate the proposed plan as `in_progress`. Keep canonical state `ready_for_review` until promotion; do not stage `state.json` with a self-referential operation digest. Record attempted finding IDs on the changes-requested review cycle so the next review can identify which findings this execution attempted. Do not reopen or rename completed verification phases.
5. Re-inspect the exact complete staged set immediately before promotion; require valid plan and fresh learning/memory inputs. Bind the current digest to `operation.authorization: { kind: "persisted-mode", originExecutionId, proposalDigest }`, with `proposalDigest` equal to `operation.approvalDigest`. Existing `approvedAt`/`approvedArtifacts` fields record the mode-authorized operation, not a new human decision. Journal the operation before any canonical promotion. Record verification and scope evidence in the review cycle; do not record `approvalConfirmation` for automatic remediation.
6. Promote only the inspected files, copy the approved loop snapshot into `state.autonomousReview` as the deterministic state transition while retaining its active review operation, and follow the revision/index/commit/provenance procedure above. Retain the operation in canonical state until the commit is recorded; re-inspect changed candidates and reconcile interrupted promotion before resuming. After the review bookkeeping commit and operation clearance, call focused `project_status` and follow its `nextStep` into implement with a new execution ID and inherited Autonomous mode. No additional user prompt is needed for these bounded changes.

## Clean result and approval

When no unresolved findings remain, persist checkpoint `awaiting_approval`, findings, and `reviewedExecutionId`/`reviewedHead`, then commit only that evidence as `cadre(review): record clean evidence for <track-id>`. The track remains `ready_for_review`. Call `review_complete` prepare with review evidence, present verification results, remediation history, and its exact completion proposal, and ask once for explicit human approval. Apply only that unchanged token after approval; only the review runtime marks the loop and track completed. Autonomous does not use `acceptedRisks` to waive findings.

Resume `awaiting_approval` by checking the recorded execution/HEAD and product content, preparing a fresh token if needed, and requesting the still-missing final approval. A prior unresolved question is not approval. Changed product or verification inputs require renewed verification/review and a new clean checkpoint; ordinary Cadre bookkeeping alone does not. A request for changes returns to review under the existing scope; cancellation stops with state intact.
