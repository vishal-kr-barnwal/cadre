---
name: revise
description: Route a requested track change according to lifecycle state, revise an approved active baseline with resumable journaling, or propose a successor for completed or archived work. Use for the revise command or user-requested scope/plan changes.
---

# Cadre Revise

Read `.cadre/workflow.md`, the full target track, its dependencies, all tracks that depend on it, relevant repository files, and applicable patterns. Read each artifact before editing; never propose a revision from guessed contents.

Call `project_status` first and use its embedded structured validation; do not repeat `state_validate` at command entry. If the Cadre MCP is unavailable, stop without modifying the track.

## Route by current status

- `drafting-spec`: follow the `track` specification procedure and resume its journal. The content is not yet an approved baseline, so do not create a revision artifact or increment a revision.
- `drafting-plan`: if the approved specification changes, perform the semantic revision procedure below and remain `drafting-plan`; if only the unapproved plan changes, resume the `track` planning procedure without a revision artifact.
- `planned`: perform the semantic revision and remain `planned`.
- `in_progress`: perform the semantic revision at a safe task boundary. Remain `in_progress` when all approved dependencies are complete; move to `planned` if an approved dependency is incomplete.
- `ready_for_review`: distinguish a defect against the approved specification from a changed desired outcome. Route a defect through `review`. For a scope, requirement, or acceptance change, perform the semantic revision, invalidate review readiness, append delivery and manual-verification work, and move to `in_progress`, or `planned` if an approved dependency is incomplete.
- `completed` or `archived`: do not mutate or reopen the track. Present a successor feature or bug track proposal that references the immutable source track and follow `track` only after approval.

## Semantic revision procedure

1. Reconcile `state.json.operation`, any execution journal, managed worktrees, workers, the working tree, and recent commits before drafting. Resume a matching `revise` operation from its first incomplete artifact. Before changing an active execution graph, reach an approved quiescent boundary: finish or stop workers, integrate approved work or preserve it on journaled branches, and clean no worktree by force. Finish or reconcile any other recorded operation first; never replace it.
2. Restate the requested change and identify specification, acceptance, plan, learning seed/phase history, review readiness, and state consequences. Inspect active and dirty task work. If it overlaps the requested change, present the exact work and obtain approval to complete it, preserve it as superseded, or revert it before applying the revision.
3. Apply the workflow clarification gate. Ask when materially different interpretations remain for the desired outcome, scope, acceptance criteria, compatibility, dependency changes, treatment of completed or partial work, or whether dependent tracks should change now. Do not infer permission to invalidate approved work.
4. Trace transitive dependent tracks. For each, classify impact as none, reseed-only, plan change, spec change, or invalidated work, with evidence. If evidence cannot resolve a material impact, ask before choosing a classification.
5. Call `template_get_many` once for `track/revision` and `track/revise-operation`, and retain the versioned bundle. Render `revisions/revision-<ts>.md` and draft exact diffs for every affected artifact. Record source and target status, the base commit, affected phases/tasks, completed and partial-work disposition, review impact, dependency impact, and verification work. Preserve completed tasks and commit markers; append or explicitly supersede work rather than erasing provenance.
6. Increment the track revision exactly once. Increment the specification revision only if `spec.md` changes and the plan revision only if `plan.md` changes; keep the revision values in `state.json`, `spec.md`, `plan.md`, and the marked Pattern Seed consistent. Preserve completed task provenance, update explicit regular phase/task dependencies, and restore derived manual-verification barriers. When the plan changes, call `execution_graph_validate_draft` with the complete proposed plan Markdown and the intended post-approval target status; do not validate the stale canonical plan or create a temporary project copy. A changed plan graph uses a new execution ID; never reuse a completed or superseded execution journal.
7. Present the target revision and all cascading dependent-track changes together. Wait for explicit approval. Partial approval narrows the change set and requires a fresh impact assessment, transition calculation, and proposal.
8. Before changing approved artifacts, write the rendered `revise` operation into every affected track's `state.json`. Use the same expected commit, record each approved artifact and per-artifact progress, and advance the durable checkpoint after each write.
9. Apply only the approved changes, update relevant marked Pattern Seed sections without overwriting phase learning, set the approved source-to-target states, mark the earliest affected plan nodes pending in the replacement execution graph, and append track-local history. Do not add singular active phase/task fields to track state. Preview and apply `tracks.md` through `tracks_render_preview` and `tracks_render_apply` using the unchanged approved digest.
10. Call `state_validate` and commit `cadre(revise): update <track-id>`. Reconcile interruption using the workflow journal rules. Record the commit in every revision entry, clear each completed operation, and use a follow-up `cadre(revise): record <track-id>` commit when bookkeeping cannot be part of the artifact commit.
