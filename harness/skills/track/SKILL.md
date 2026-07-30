---
name: track
description: Create or resume a Cadre feature or bug track, including a functional/non-functional specification, acceptance criteria, dependencies, phased task plan, manual-verification gates, and relevant pattern learning seed. Use for the track command or new scoped delivery work.
---

# Cadre Track

Create only `feature` or `bug` tracks. Resume an existing drafting track instead of replacing it.

## Required context

Read `.cadre/workflow.md`, `project.json`, `product.md`, `guidelines.md`, `tech-stack.md`, relevant styleguides, `patterns/index.md`, and every declared dependency. Before editing an existing artifact, read it and its directly relevant context; never guess its contents.

Call `project_status` first and use its embedded structured validation; do not repeat `state_validate` at command entry. If required Cadre MCP tools are unavailable, stop; never recreate templates or runtime logic from memory.

## Procedure

1. Normalize a stable track ID. Look for its state at the status-derived active or archive location. If track state exists, reconcile its operation journal, working tree, and recent commits first. Resume the recorded checkpoint; never replace or restart an interrupted track. Otherwise determine title, type, goal, scope, dependencies, risks, and unknowns with the human.
2. Apply the workflow clarification gate before drafting. Ask targeted questions whenever repository evidence and the request do not clearly establish a material choice such as feature versus bug, in/out of scope behavior, affected users/interfaces/data, compatibility or rollout expectations, acceptance measures, dependency tracks, or whether existing behavior must be preserved. Do not silently choose an interpretation.
3. Call `template_get_many` once for `track/spec`, `track/state`, `track/plan`, and `track/learning`; retain the versioned bundle through the decision. Render the functional requirements, non-functional requirements, acceptance criteria, additional information, dependency impact, and proposed track state.
4. Draft an acyclic phase/task graph from that proposed specification. Every regular phase explicitly declares phase dependencies and every regular task explicitly declares same-phase task dependencies. Do not repeat derived barriers: each phase's final `User Manual Verification` depends on every sibling task, while the final `Track-level User Manual Verification` phase contains only its manual task and depends on every preceding phase. Include tests, formatting, documentation, and Definition of Done work explicitly. Call `execution_graph_validate_draft` with the proposed plan Markdown and target status `planned`; resolve every unknown reference, cycle, missing declaration, or material ambiguity before approval. Do not write an unapproved plan into `.cadre/` or create a temporary project copy for validation.
5. Build the marked `Pattern Seed` section at the top of `learning.md` from patterns relevant to the proposed spec and plan. Root phases read the seed; other phases read learning from their declared dependency phases. Cite pattern file paths and explain relevance. Do not invent patterns.
6. Expected human decision count is one for a clear new track. Present the exact specification, state summary, validated plan graph, learning seed, two planned commits, lifecycle transition to `planned`, and deterministic derived-state consequences as one authorization envelope. A human may explicitly request staged specification/plan review; otherwise do not create a specification-only approval prompt. Changed scope or plan content requires one corrected combined proposal.
7. After approval, create/update track state with one operation journal covering `spec.md`, `plan.md`, and `learning.md`, then write all three exact approved artifacts to the durable worktree before the first commit so a resumed session never has to reconstruct approved plan content from conversation memory. Direct writes are intentional; do not search for an undeclared mutation tool. Validate the specification, preview/apply derived `tracks.md`, stage only the specification-stage files, commit `cadre(track): specify <track-id>`, and record its SHA while the approved plan/learning remain journaled dirty artifacts. Preserve and transition the same approval envelope into planning instead of clearing it or asking again. Validate `plan.md` and `learning.md`, set status to `planned`, preview/apply `tracks.md`, commit `cadre(track): plan <track-id>`, record its SHA, clear the operation, set checkpoint `ready`, and commit `cadre(track): record plan <track-id>`. All generated indexes, validation, commits, and state-record bookkeeping are unchanged deterministic consequences and require no additional approval.

For either track commit, reconcile interruptions before continuing:

- Journal plus matching dirty artifacts: continue the pending write/validation/commit under the recorded combined envelope.
- Journal plus clean tree and matching expected HEAD: record that commit; do not repeat it.
- Recorded SHA plus dirty bookkeeping: finish the state-record commit.
- Any mismatch: present it and stop rather than regenerating approved spec, plan, or learning.

The plan is the execution source of truth. Dependency changes or a modified spec require impact assessment and human approval through `$revise`.
