---
name: revise
description: Route a requested track change according to lifecycle state, revise an approved active baseline with resumable journaling, or propose a successor for completed or archived work. Use for the revise command or user-requested scope/plan changes.
---

# Cadre Revise

Read `.cadre/workflow.md`, the full target track, its dependencies, all tracks that depend on it, relevant repository files, and applicable patterns. Read each artifact before editing; never propose a revision from guessed contents.

At every required clarification or approval boundary, show a concise impact summary or focused diff. Inspect the active host policy before calling `workflow_elicit`: if the task context reports approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise prefer `workflow_elicit`, using `clarification` for at most three questions and `approval` bound to the exact revision proposal checkpoint. Treat only an `approved` result as approval. If it returns `fallback_required`, or immediately returns `declined` while the task explicitly reports policy `never`, ask the same short question once in chat; the latter is policy rejection, not a human decline. Never request secrets or retry the form.

Call `project_status` first with `view: "implementation"` and `trackId` for active canonical work, otherwise `view: "track"`; use its embedded structured validation and do not repeat `state_validate` at command entry. Stop on invalid status. A `staged_track_candidate` has no approved baseline: route its changes through the track proposal without creating a revision artifact or operation.

## Route by current status

- `drafting-spec`: follow the `track` specification procedure and resume its journal. The content is not yet an approved baseline, so do not create a revision artifact or increment a revision.
- `drafting-plan`: if the approved specification changes, perform the semantic revision procedure below and remain `drafting-plan`; if only the unapproved plan changes, resume the `track` planning procedure without a revision artifact.
- `planned`: perform the semantic revision and remain `planned`.
- `in_progress`: perform the semantic revision at a safe task boundary. Remain `in_progress` when all approved dependencies are complete; move to `planned` if an approved dependency is incomplete.
- `ready_for_review`: distinguish a defect against the approved specification from a changed desired outcome. Route a defect through `review`. For a scope, requirement, or acceptance change, perform the semantic revision, invalidate review readiness, append delivery and manual-verification work, and move to `in_progress`, or `planned` if an approved dependency is incomplete.
- `completed` or `archived`: do not mutate or reopen the track. Present a linked successor feature or bug track proposal referencing the immutable source, then use the Cadre track workflow only after approval.

## Semantic revision procedure

Expected human decision count is one when the requested change and partial-work disposition can be presented together. A separate preliminary decision is justified only when active work cannot be made safe or fully assessed without first choosing whether to complete, preserve, or revert it.

1. Reconcile `state.json.operation`, any execution journal, managed worktrees, workers, the working tree, and recent commits before drafting. Resume a matching `revise` operation from its first incomplete artifact. Observe a safe quiescent boundary before changing an active execution graph; do not stop workers, integrate work, or clean worktrees before the authorization envelope permits the exact disposition. Finish or reconcile any other recorded operation first; never replace it.
2. Restate the requested change and identify specification, acceptance, plan, learning seed/phase history, review readiness, and state consequences. Inspect active and dirty task work. When it overlaps the requested change, include its exact disposition—complete, preserve as superseded, or additive revert—in the combined revision proposal rather than creating a separate approval when that disposition can be safely assessed in advance.
3. Apply the workflow clarification gate. Ask when materially different interpretations remain for the desired outcome, scope, acceptance criteria, compatibility, dependency changes, treatment of completed or partial work, or whether dependent tracks should change now. Do not infer permission to invalidate approved work.
4. Trace transitive dependent tracks. For each, classify impact as none, reseed-only, plan change, spec change, or invalidated work, with evidence. If evidence cannot resolve a material impact, ask before choosing a classification.
5. Call `template_get_many` once for `track/revision` and `track/revise-operation`, then `candidate_stage_prepare` for `revise-<track-id>` with `expectedFiles` equal to the exact revision and affected artifact paths. Render only that set beneath the stage, preserving eventual track-relative paths and completed provenance.
6. Increment revisions exactly once and restore derived manual-verification barriers. A changed plan uses a new execution ID. Do not pass plan Markdown through MCP, validate the stale canonical plan, or create a temporary project copy.
7. Call `candidate_inspect` once for every staged revision and cascading artifact. Supply one `planValidations` entry for every staged root or nested `plan.md`, using its exact candidate-relative path and intended resulting track status; omit the list only when the candidate contains no plans. Present every plan result, the target revision, manifest, partial-work disposition, dependent changes, lifecycle transitions, commits, and bookkeeping together, bound to its digest. Partial approval requires a fresh inspection.
8. Before changing approved artifacts, write the rendered `revise` operation into every affected track's `state.json`. Use the same expected commit, record the approved manifest digest and path/hash entries, record per-artifact progress, and advance the durable checkpoint after each promoted staged file.
9. Promote only the authorized staged changes, verify their canonical hashes, update relevant marked Pattern Seed sections without overwriting phase learning, set the approved source-to-target states, mark the earliest affected plan nodes pending in the replacement execution graph, and append track-local history. Do not add singular active phase/task fields to track state. Call `tracks_render` once without another prompt. Never stage `.cadre/stage/`; remove only the matching candidate stage after its canonical hashes and commits are recorded.
10. Call `state_validate` and commit `cadre(revise): update <track-id>`. Reconcile interruption using the workflow journal rules. Record the commit in every revision entry, clear each completed operation, and use a follow-up `cadre(revise): record <track-id>` commit when bookkeeping cannot be part of the artifact commit. These unchanged deterministic consequences remain inside the revision authorization envelope.

## Memory contract

Preserve phase history and existing handoffs. For active v3 tracks, keep the marked `cadre:memory` JSON block inside Pattern Seed synchronized with the proposed spec/plan revisions and exact approved pattern hashes. Every applicable pattern requires its safe `patterns/<slug>.md` path, SHA-256, and human-readable relevance/constraints; never invent or silently omit guidance. When a staged plan changes revisions, include the reassessed learning file in `expectedFiles`. Inspect `candidate_inspect.learning` and `memoryInputs` as well as `plans`; resolve invalid or stale memory before approval. Immediately before direct promotion, re-inspect and compare the complete approved digest, including unchanged memory inputs; changed inputs require reassessment and a corrected approval. Archive apply performs this check in the runtime. Completed and archived learning remains historical evidence, not a claim that old hashes describe current patterns.

## Revision provenance

Use `revisions/revision-<id>.md` (including the `revision-` prefix) and include the same path in the approved manifest and operation. Before clearing the revision operation, set `state.commits.spec` and `state.commits.plan` to the revision artifact commit for every spec/plan changed by that commit. Confirm the committed plan has the proposed revisions and graph; a reachable SHA alone is insufficient. Include these pointer updates in the original approval envelope and follow-up record commit. Do not start delivery with pointers to an older revision. Retain the previous execution binding and handoffs while an approved repair operation owns state.
