---
title: Workflow Engine
description: How skills, MCP state transitions, journals, Git, and human decisions cooperate.
section: Contributor Guide
order: 155
---

# Workflow Engine

Cadre's “engine” is the cooperation of explicit skill procedures and
deterministic MCP operations. There is no generic workflow dispatcher.

## Responsibility Split

| Owner | Responsibilities |
|---|---|
| Workflow skill | Context discovery, repository reasoning, clarification, artifact drafting, presenting decisions, host commands, commits, conflict resolution, and recovery procedure. |
| MCP runtime | Client-native workflow forms, versioned templates, centralized validation, graph derivation, digest-gated state transitions, derived index, and constrained worktree Git operations. |
| Main agent | Sole scheduler, worker creator, integrator, Cadre-state coordinator, and presenter of human decisions. |
| Worker | Bounded product-file implementation and focused verification in one assigned worktree. |
| Human | Approval of artifacts, mutations, commits, integrations, verification, findings, accepted risks, and lifecycle transitions. |

## Workflow Entry

Stateful skills begin with `project_status` and use its embedded centralized
validation. `implement` also reads graph/worktree status; `status` remains
read-only. Skills do not repeatedly call `state_validate` at entry.

Known immutable templates are fetched in one `template_get_many` bundle and
retained across approval turns while their version/hash remains unchanged.

## Clarification Before Mutation

The agent inspects repository evidence and asks only when a material choice
cannot be safely inferred. Typical gates include root, greenfield/brownfield,
feature/bug, scope, compatibility, dependencies, treatment of partial work,
and project-context change intent.

Questions occur before artifacts or state are written. A plausible guess is not
a substitute for user authority when it changes approved scope or invalidates
work.

The main agent presents the minimum context needed, then inspects the active
host policy before calling `workflow_elicit`. When task context reports a
non-interactive policy such as Codex Full Access, it skips the form and asks the
same short question once in chat. Otherwise, a client that advertises MCP form
elicitation renders the structured form. Missing capability or an explicit
`fallback_required` result also uses the single chat fallback. A decline or
cancel from a form that was actually displayed remains a negative human
response.

## Decision Boundary

A decision-ready proposal contains exact artifacts, paths, state consequences,
Git consequences, verification, and risks. Approval binds only that proposal.

When content or consequences change, the workflow rebuilds the proposal and
asks again. Where a deterministic MCP preview exists, its digest binds the
approval to current state.

Approval forms are bound to that preview digest or to an immutable verification
checkpoint containing the relevant track, execution/node, and commit. The form
does not mutate state or approve on the MCP server's behalf. Only an explicit
`approved` response authorizes the already-presented binding; request-changes,
decline, cancel, and fallback responses do not.

## Mutation And Commit Boundary

Multi-step procedures record an operation before the first write. Artifact
progress advances durably. Validation and derived-index checks occur before the
expected commit. The resulting SHA is then recorded in state, sometimes in a
small follow-up commit when it cannot safely be part of the artifact commit.

This two-commit pattern is intentional: a successful Git commit may occur just
before interruption, and the next run must record rather than repeat it.

## Execution Transitions

Execution nodes use explicit legal statuses such as `pending`, `running`,
`awaiting_approval`, `committed`, `integrating`, `conflicted`, `integrated`,
`awaiting_manual_verification`, `completed`, and `blocked`.

Single transitions use `execution_node_*`. Immediately valid ordered
bookkeeping can use `execution_nodes_*`, but a batch cannot cross a boundary
whose evidence does not yet exist: approval, commit, test, integration,
conflict resolution, or manual verification.

## Finality

- `implement` can reach only `ready_for_review`.
- `review` alone can reach `completed`.
- `archive` alone can reach `archived`.
- Completed and archived history is immutable; changed intent becomes a
  successor track.

These ownership rules belong in skills, domain validation, tests, and docs so a
single layer cannot silently weaken them.
