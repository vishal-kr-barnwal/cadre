---
title: Workflow Reference
description: Invocation, eligibility, mutations, and terminal outcomes for all ten Cadre skills.
section: Reference
order: 200
---

# Workflow Reference

Invoke a skill as `$cadre:<name>` in Codex or `/cadre:<name>` in Claude Code.

## create

- **Use for:** project onboarding and interrupted setup.
- **Requires:** exact root, greenfield/brownfield classification, approved
  project context, workflow, styleguides, and Git disposition.
- **Approval UX:** one final authorization envelope combines concise project
  context, bundled workflow/styleguide identities, amendments, generated
  path/hash manifest, Git disposition, digest, commits, and provenance. Full
  defaults remain available on request.
- **Primary MCP:** template bundle, styleguide resolution,
  `project_init_preview/apply`, setup checkpoint tools, validation, and derived
  tracks index.
- **Writes:** initial `.cadre/` state and setup provenance commits.
- **Stops when:** setup is complete; an initialized project routes to refresh
  or status.

## track

- **Use for:** a new/resumed feature or bug.
- **Requires:** substantive scope, acceptance, dependencies, and plan evidence.
- **Primary MCP:** project status, template bundles, graph validation, state
  validation, and tracks index preview/apply.
- **Approvals:** one combined specification-and-plan decision by default;
  staged review only when explicitly requested.
- **Writes:** `state.json`, `spec.md`, `plan.md`, and `learning.md` with separate
  provenance commits inside the combined authorization envelope.
- **Stops at:** `planned` with recorded spec/plan commits.

## implement

- **Use for:** a `planned` or `in_progress` track whose dependencies are done.
- **Scheduling:** parallel by default with a global ready queue and clean
  phase-mode handoffs; sequential only when requested.
- **Approvals:** `phase` by default, `governed` for task-by-task gates, or
  `autonomous` until track-level manual verification.
- **Primary MCP:** execution start/node/status/finish, graph validation,
  worktree create/integrate/cleanup, project/worktree status, and derived index.
- **Writes:** execution journal, task commits, plan/learning provenance, and
  Cadre bookkeeping commits.
- **Stops at:** `ready_for_review`; never `completed`.

## review

- **Use for:** `ready_for_review` only.
- **Evidence:** recorded implementation range, relevant files/callers, tests,
  requirements, error/security/compatibility paths, and learning.
- **Finding path:** exact approved bug/remediation artifacts return the track to
  implementation.
- **Clean path:** `review_complete_preview/apply` binds approval to execution,
  plan revision, graph digest, reviewed HEAD, and accepted risks.
- **Stops at:** `completed` only after a clean approved cycle.

## revise

- **Use for:** changed desired scope, behavior, acceptance, dependency, or plan.
- **Requires:** lifecycle routing, worker quiescence, partial-work disposition,
  and transitive dependent-track impact.
- **Approvals:** one combined revision and cascading-impact decision when
  partial-work disposition can be assessed safely in advance.
- **Writes:** revision record and exact approved artifact/state changes with
  preserved commit provenance.
- **Completed/archived behavior:** propose a successor; never reopen history.

## archive

- **Use for:** one or more tracks already completed by clean review.
- **Primary MCP:** archive batch preview/apply and provenance record
  preview/apply.
- **Writes:** track moves/status, consolidated patterns, relevant active-track
  seeds, operation journal, derived index, and two provenance commits.
- **Atomicity:** one ineligible selection rejects the whole batch.
- **Stops at:** `archived`.

## refresh

- **Use for:** drift in product, guidelines, workflow, technology,
  styleguides, patterns, or completed-track learning.
- **Evidence:** user input, repository changes since setup/last refresh,
  completed outcomes, and current code/manifests.
- **Writes:** approved project context, refresh record/journal, affected seeds,
  derived index, and provenance commits.
- **Active work:** execution-governing changes wait for a safe boundary and
  affected tracks follow revision impact analysis inside the same refresh
  approval envelope.

## revert

- **Use for:** additive reversal of a Cadre task, phase, or track.
- **Requires:** exact commit/merge provenance, overlap analysis, dependent
  impact, and a clean approved reverse-order proposal.
- **Git behavior:** `git revert`; merge commits use the correct mainline parent.
- **Writes:** revert commits, reconciled plan/state/learning, derived index, and
  provenance.
- **Approvals:** one on the clean path; a corrected proposal only for material
  conflict-resolution changes.
- **Stops when:** conflicts or mixed/missing provenance require manual recovery.

## status

- **Use for:** progress, blockers, health, and next legal action.
- **Primary MCP:** `project_status`, `worktree_status`, and active
  `execution_status`.
- **Writes:** nothing.
- **Reports:** setup/operation checkpoints, tracks, dependencies, execution
  nodes, worktrees, review/archive readiness, validation, and dirty Cadre state.

## wisp

- **Use for:** questions, exploration, investigation, and disposable spikes.
- **MCP:** optional read-only project status; availability is not required.
- **Writes:** no Cadre lifecycle state; optional ignored output under
  `.cadre/wisps/`.
- **Promotion:** recommend `track` before durable implementation work.

## Lifecycle Ownership

| Transition | Owning workflow |
|---|---|
| uninitialized → initialized | `create` |
| drafting → planned | `track` |
| planned/in-progress → ready for review | `implement` |
| ready for review → in progress | `review` findings or `revise` |
| ready for review → completed | `review` only |
| completed → archived | `archive` only |
| completed/archived → new intent | `revise` proposes successor |
