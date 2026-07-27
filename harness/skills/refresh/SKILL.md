---
name: refresh
description: Refresh Cadre product, guidelines, workflow, styleguides, and tech-stack from user input, repository changes since setup/last refresh, and completed tracks, with an approved project refresh record. Use for the refresh command when project context drifts.
---

# Cadre Refresh

Read `.cadre/workflow.md`, `project.json`, all project context files, the last refresh record, Git history since the recorded setup/refresh commit, completed-track outcomes, and current repository manifests/code. Read every target context file before editing it.

1. Determine evidence sources: user input, committed repository changes, completed tracks, or a combination.
2. Apply the workflow clarification gate before drafting. Ask when the refresh request or evidence does not clearly establish the commit/time range, which context artifacts are in scope, whether files should describe current reality or a desired future state, how to resolve conflicts between user input and repository evidence, or whether cascading active-track updates are intended now.
3. Draft focused diffs for product, guidelines, workflow, tech stack, general styleguide, and language/framework styleguides. Add/remove language guides only when the approved tech stack requires it.
4. Assess impact on all active track specs, plans, and marked Pattern Seed sections in learning files. Route required track changes through the same cascading approval rules as `$revise`. Ask if a material impact remains uncertain after inspection.
5. Create a proposed `refreshes/refresh-<ts>.md` from the template containing evidence range, decisions, affected files, and unresolved questions. Present all diffs for approval.
6. Apply only approved changes, append project history, reseed affected active tracks, regenerate `tracks.md`, and validate.
7. Commit `cadre(refresh): update project context`, then record that commit as `lastRefresh.commit` in a follow-up `cadre(refresh): record refresh commit` state commit.
