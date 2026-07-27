---
name: cadre-track
description: Create or resume a Cadre feature or bug track, including a functional/non-functional specification, acceptance criteria, dependencies, phased task plan, manual-verification gates, and relevant pattern learning seed. Use for the track command or new scoped delivery work.
---

# Cadre Track

Create only `feature` or `bug` tracks. Resume an existing drafting track instead of replacing it.

## Required context

Read `.cadre/workflow.md`, `project.json`, `product.md`, `guidelines.md`, `tech-stack.md`, relevant styleguides, `patterns/index.md`, and every declared dependency. Before editing an existing artifact, read it and its directly relevant context; never guess its contents.

## Procedure

1. Normalize a stable track ID. If its project entry or track state exists, reconcile its operation journal, working tree, and recent commits first. Resume the recorded checkpoint; never replace or restart an interrupted track. Otherwise determine type, goal, scope, dependencies, risks, and unknowns with the human.
2. Apply the workflow clarification gate before drafting. Ask targeted questions whenever repository evidence and the request do not clearly establish a material choice such as feature versus bug, in/out of scope behavior, affected users/interfaces/data, compatibility or rollout expectations, acceptance measures, dependency tracks, or whether existing behavior must be preserved. Do not silently choose an interpretation.
3. Use `templates/track/spec.md` to draft functional requirements, non-functional requirements, acceptance criteria, additional information, and dependency impact. Present it and wait for approval before writing or changing state.
4. After approval, create/update track state with the spec operation journal before writing `spec.md`. Advance artifact checkpoints through written, validated, and `commit-pending`. Commit as `cadre(track): specify <track-id>`, then record its SHA, clear the operation, move to `drafting-plan`, and commit the state record.
5. Use `templates/track/plan.md` to draft ordered phases and tasks. Every delivery phase must end with `User Manual Verification`; the final phase must be `Track-level User Manual Verification`. Include tests, formatting, documentation, and Definition of Done work explicitly. If planning exposes a new material ambiguity, ask before finalizing the plan.
6. Build the marked `Pattern Seed` section at the top of `learning.md` from patterns relevant to this spec and plan. Cite pattern file paths and explain relevance. Do not invent patterns. Present the plan and learning seed for approval.
7. After approval, journal the plan operation before writing `plan.md` and `learning.md`. Advance checkpoints through written, validated, and `commit-pending`; set the track/project status to `planned`, regenerate `tracks.md`, validate, and commit `cadre(track): plan <track-id>`. Then record its SHA, clear the operation, set checkpoint `ready`, and commit `cadre(track): record plan <track-id>`.

For either track commit, reconcile interruptions before continuing:

- Journal plus matching dirty artifacts: continue the pending write/validation/commit.
- Journal plus clean tree and matching expected HEAD: record that commit; do not repeat it.
- Recorded SHA plus dirty bookkeeping: finish the state-record commit.
- Any mismatch: present it and stop rather than regenerating approved spec, plan, or learning.

The plan is the execution source of truth. Dependency changes or a modified spec require impact assessment and human approval through `$cadre-revise`.
