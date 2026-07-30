---
title: Project Configuration
navTitle: Configuration
description: Configure Cadre through approved project context, workflow, styleguides, and track plans.
section: Operations
order: 90
---

# Project Configuration

Cadre 3.0 does not use the retired `cadre/config.json` policy model. Persistent
behavior is defined by approved, version-controlled artifacts under `.cadre/`.

## Configuration Sources

| Artifact | Governs |
|---|---|
| `.cadre/product.md` | Product purpose, users, behavior, scope, and constraints. |
| `.cadre/guidelines.md` | Engineering principles, trust boundaries, non-goals, and decision rules. |
| `.cadre/tech-stack.md` | Languages, frameworks, build tools, platforms, and verification commands. |
| `.cadre/workflow.md` | Lifecycle, approval, testing, review, commit, and delivery expectations. |
| `.cadre/styleguides/*.md` | General and technology-specific implementation conventions. |
| `.cadre/patterns/index.md` | Durable reusable patterns and provenance. |
| Track `spec.md` | Track scope, requirements, acceptance, and dependencies. |
| Track `plan.md` | Execution DAG, tasks, verification barriers, and task provenance. |
| Execution journal | Requested/effective mode, worker bound, graph identity, and runtime evidence. |

These files are human-readable sources of truth, not generated projections of
a hidden configuration database.

## Change Project Context

Use `refresh` when product, engineering, workflow, technology, styleguide, or
pattern context drifts:

```text
$cadre:refresh
/cadre:refresh
```

Refresh inspects user input, repository changes since setup or the last
refresh, completed-track outcomes, and current code/manifests. It proposes
focused diffs and a refresh record before writing. Exact cascading changes to
active tracks join the same authorization envelope rather than requiring
separate revision approvals.

Changes that affect active execution wait for a safe boundary. Changes that
affect track scope or plans follow `revise` impact analysis inside the same
refresh approval envelope.

## Change A Track

Use `revise` for a change to an approved specification, acceptance criterion,
dependency, or plan. Do not edit track state by hand or use `refresh` to bypass
track-specific impact assessment.

## Choose Execution Mode

Implementation defaults to parallel mode. Ask for sequential mode in the
workflow request:

```text
$cadre:implement checkout sequentially
/cadre:implement checkout sequentially
```

The execution journal persists requested/effective mode and its worker bound.
Changing mode after execution starts requires a clean safe boundary and
approval.

Approval prompts are configured independently. `phase` is the default;
explicitly request `governed` for task-by-task approval or `autonomous` to pause
only at track-level verification:

```text
$cadre:implement checkout governed
$cadre:implement checkout autonomous
```

The selected `approvalMode` is persisted in the execution journal and active
track operation. Changing it after execution starts also requires a clean safe
boundary and approval.

## Change Styleguides

`create` resolves a complete default set from the proposed technology list and
includes it in the single final initialization approval. It asks only when a
material convention cannot be inferred, rather than requesting acceptance for
each guide. Later changes belong in `refresh` so the technology list,
styleguide set, active-track impact, and Git record stay consistent.

## Safe Editing Rule

Cadre artifacts are ordinary version-controlled files, but stateful workflows
expect their changes to be approved, journaled, validated, and committed with
matching provenance. Use the owning workflow instead of manually changing
`project.json`, track `state.json`, execution journals, operation journals, or
the generated `tracks.md` index.
