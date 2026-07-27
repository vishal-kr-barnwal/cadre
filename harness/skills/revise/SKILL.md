---
name: revise
description: Revise the approved specification or plan of a Cadre track that is not completed or archived, with dependency impact analysis, cascading-change approval, revision history, and reseeding. Use for the revise command or user-requested scope/plan changes.
---

# Cadre Revise

Reject completed and archived tracks. Read `.cadre/workflow.md`, the full target track, its dependencies, all tracks that depend on it, relevant repository files, and applicable patterns. Read each artifact before editing; never propose a revision from guessed contents.

Call `project_status` and `state_validate` first. If the Cadre MCP is unavailable, stop without modifying the track.

1. Restate the requested change and identify spec, acceptance, plan, learning seed/phase history, and state consequences.
2. Apply the workflow clarification gate before drafting changes. Ask when the requested revision leaves materially different interpretations of the desired outcome, scope, acceptance criteria, treatment of completed/in-progress tasks, compatibility, dependency changes, or whether dependent tracks should be changed now. Do not infer permission to invalidate approved work.
3. Trace transitive dependent tracks. For each, classify impact as none, reseed-only, plan change, spec change, or invalidated work, with evidence. If evidence cannot resolve a material impact, ask the human before choosing a classification.
4. Call `template_get` for `track/revision`, render `revisions/revision-<ts>.md`, and draft exact diffs for every affected artifact. Preserve completed task history; supersede rather than erase it.
5. Present the target revision and all cascading dependent-track changes together. Wait for explicit approval; partial approval must narrow the change set and trigger a new assessment.
6. Apply approved changes, increment revision numbers, update the marked Pattern Seed sections of relevant active-track learning files, set affected execution states appropriately, append each affected track's local history, then preview and apply `tracks.md` through `tracks_render_preview` and `tracks_render_apply` using the unchanged approved digest.
7. Call `state_validate` and commit `cadre(revise): update <track-id>`. Record the commit in the revision entry with a follow-up state commit if needed.
