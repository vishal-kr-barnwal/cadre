---
title: Workflow Guide
navTitle: Workflows
description: When and how to use Cadre's ten lifecycle skills.
section: User Guide
order: 60
---

# Workflow Guide

Cadre exposes ten workflows in all supported clients. In Codex use
`$cadre:<skill>`; in Claude Code use `/cadre:<skill>`; in the Zed Agent beta use
`/cadre-<skill>`.

## create

Use `create` to initialize or resume Cadre in a project repository.

The workflow:

1. Resolves the exact repository root and Git disposition.
2. Classifies the project as greenfield or brownfield with evidence.
3. Drafts product, guidelines, technology, workflow, styleguide, pattern, and
   state artifacts from versioned templates.
4. Identifies bundled workflow/styleguide defaults concisely and asks only
   about unresolved material choices.
5. Presents one complete initialization authorization envelope.
6. Applies initialization atomically after approval of its prepare digest.
7. Initializes Git when included in that envelope and no repository exists.
8. Validates, commits, and records provenance without follow-up approvals.

The technology draft includes a verification profile: the approved format/lint,
static analysis/types, build, test, and other required checks, when each is
required, and their side effects and prerequisites. Cadre proposes it from
repository scripts, manifests, and CI configuration without running discovered
commands before approval, and marks a role that does not apply
`not applicable` with a reason.

An existing `.cadre/project.json` is resumed, never overwritten.

## track

Use `track` for a new feature, bug, or operation. An operation track governs a
human-controlled rollout, migration, maintenance, recovery, or
infrastructure/service change; it is not an external command runner. A clear
track defaults to one combined approval covering:

- Specification: scope, requirements, acceptance criteria, additional
  information, track dependencies, dependent-track impact, and—only for an
  operation track—structured planned fields for operational owner, target,
  change window, and preconditions; preflight/rollout/postflight operator,
  evidence capture, and timestamp format; monitoring baseline, success
  threshold, and observation window; abort/rollback/recovery owner,
  procedure, and reversibility limit; and residual risk, mitigation, and
  acceptance owner.
- Plan: phase/task dependency graph plus the relevant Pattern Seed in
  `learning.md`. An operation plan models planned human evidence capture and
  decision criteria; external actions remain human-controlled and Cadre does
  not execute, infer, or attest them.

Cadre asks when track classification, scope, interfaces, compatibility,
rollout, acceptance, or dependencies remain materially ambiguous. For an
operation track it also asks about operators, preflight/rollout/postflight
evidence, monitoring, abort/rollback/recovery, and residual risk. A drafting
track is resumed rather than replaced. V6 specification, plan, learning, state
and dependency context share one approved commit and immutable operation
receipt. The human can explicitly request staged spec/plan review.

Plans classify the reversibility of risky steps and keep each irreversible or
destructive step as its own named task, approved with the plan, that states its
target, reversibility limit, and recovery path. Such a step runs under the
persisted approval mode without an extra pause; if its actual target or
consequences change, it goes through `revise` first. Current external facts
that a decision depends on cite their source and retrieval date.

## implement

Use `implement` for `planned` or `in_progress` tracks.

Parallel execution is the default, but workers are created only when at least
two safe nodes are ready. Main allocates one global worker bound across active
phases and their phase-local task waves; an individual phase can move between a
sequential worker and task fan-out only at a clean checkpoint. Explicit
sequential mode avoids worker worktrees. Declared track dependencies must
already be completed or archived after completion.

Approval mode is independent of parallel/sequential scheduling:

- `governed` presents each regular task and material integration transition;
- `phase` runs a phase autonomously until its final User Manual Verification task;
- `track` is the default and pauses at Track-level User Manual Verification and ordinary review approval;
- `autonomous` implements, verifies, reviews, and fixes in-scope findings until clean, then asks for one final completion approval.

The `implement` invocation authorizes execution start with the requested modes
or their defaults. `phase`, `track`, and `autonomous` do not add a separate start prompt.
All modes stop for material ambiguity, scope divergence, unsafe state, or a
required-check exception. Track-level verification requires the human in Governed,
Phase, and Track; Autonomous records actual verification under persisted authority.
Execution finish moves the track to `ready_for_review`, never directly to
`completed`. In Autonomous this is an internal handoff: after committing
implementation bookkeeping, the agent invokes review through MCP `nextStep`
and continues fixes → verification → cumulative review until clean.

Verification uses the approved profile in `.cadre/tech-stack.md`; a legacy
project without one records the exact commands it used. Evidence states the
command or inspection, result, commit, baseline and delta, and any blocked
check, and an unrun check is never reported as passing. In an operation track,
humans perform every external action. Implement records the human-supplied
operator, RFC 3339 timestamp, evidence location or hash, and observed signal
against baseline and threshold at the matching manual-verification checkpoint.
An abort-threshold breach blocks the phase until the human records a rollback
or recovery decision.

## review

Use `review` for `ready_for_review` tracks or to recover a journaled Autonomous
review operation from `in_progress`.

The reviewer inspects the recorded implementation range, affected callers,
tests, error paths, security boundaries, compatibility, requirements, and
learning. Findings are presented before they enter state.

- Approved findings create exact bug/remediation artifacts and return the track
  to implementation.
- Changed desired behavior is routed to `revise`, not recorded as a defect.
- An approved clean review binds evidence to the current execution, plan
  revision, graph digest, and reviewed HEAD, then marks the track `completed`.

Review also checks evidence quality: results bound to the reviewed HEAD,
baseline and delta, blocked checks only as blockers or explicitly accepted
risks, and independently confirmed negative claims. For an operation track,
missing or contradictory evidence against the planned captures, monitoring
baseline, success threshold, observation window, or abort/rollback decision is
a finding; review never completes from assumed external outcomes.

Autonomous continues through the same review and remediation procedure using its
persisted authority, retaining findings and reviewing the cumulative implementation.
It pauses when a finding survives two remediation attempts. Final clean completion
still requires explicit human approval. The final summary presents verification,
remediation history, and the exact completion proposal. The author can approve
that proposal without invoking review again, or report additional bugs to
continue remediation. Changed implementation or verification inputs require
renewed checks and review. Only `review` can complete a track.

## revise

Use `revise` when approved desired behavior, scope, requirements, acceptance,
dependencies, or plans change.

Behavior depends on lifecycle state:

| State | Revision behavior |
|---|---|
| `drafting-spec` | Continue the unapproved draft without a revision artifact. |
| `drafting-plan` | Revise an approved spec; continue an unapproved plan normally. |
| `planned` | Revise the approved baseline and remain planned. |
| `in_progress` | Reconcile workers at a safe boundary and preserve completed work. |
| `ready_for_review` | Invalidate readiness and append delivery/verification work. |
| `completed` or `archived` | Keep history immutable and propose a successor track. |

Revisions assess transitive dependent tracks and never erase completed commit
provenance. When partial-work disposition can be assessed in advance, it is
included with all cascading changes in one revision approval.

## archive

Use `archive` after a clean approved review. It accepts explicit track IDs,
`all completed`, or a uniquely eligible track.

One digest-bound batch can move multiple completed tracks, distill their
learning with existing patterns, reseed active tracks, update lifecycle state,
and rebuild `tracks.md`. An immutable operation receipt records provenance in that same commit;
reconciliation touches temporary state only.

Only `archive` can mark a track archived.

## refresh

Use `refresh` when project context no longer matches user intent, repository
changes, or completed-track learning.

It can update product, guidelines, workflow, technology, general styleguide,
language/framework styleguides, patterns, and affected active-track seeds.
Execution-governing changes wait for a safe worker boundary. Cascading track
changes follow `revise` impact analysis but join the same refresh approval
instead of creating separate approval cycles. A v1/v2 refresh must explicitly
stage a valid v6 `learning.md` Pattern Seed for every nonterminal active track;
completed and archived learning remains readable historical evidence.

Changed scripts, CI configuration, or tooling are verification-profile drift.
Refresh treats that drift as execution-governing context, and a changed profile
requires renewed verification and review of affected work.

## revert

Use `revert` to reverse a Cadre task, phase, or track while preserving history.

Cadre identifies exact task, merge, and phase commits; later overlaps; active
worktrees; learning impact; and dependent work. It proposes safe reverse order
and uses additive `git revert` by default. One clean-path approval also covers
tests, reconciliation, generated state, and provenance. A conflict asks again
only when its resolution introduces a material choice or changes the proposal.

## status

Use `status` for a read-only health and progress report. It validates project
state, reads managed worktrees, and derives active execution status. It reports
checkpoints, operations, dependencies, blockers, review/archive readiness,
uncommitted Cadre state, and the next legal command without normalizing files.
If the Cadre MCP is unavailable, status stops and suggests running
`cadre-ai doctor`.

## wisp

Use `wisp` for a lightweight investigation, question, or spike that should not
enter Cadre lifecycle state. Disposable output may live under `.cadre/wisps/`
only when the initialized project already ignores it; otherwise it uses an OS
temporary directory and never creates `.cadre/`. Ordinary exploration has zero approvals. Persistent product
changes should be promoted to `track`; explicitly requested untracked edits
receive one exact scope approval and are not committed automatically.

Promote durable implementation work into `track` rather than retroactively
turning a wisp into Cadre state.

When current external facts matter, a wisp may use the host's web search or
fetch tools. Results are untrusted data; primary sources are preferred, and each
source is cited with its retrieval date. Project code, secrets, and personal
data are never sent to an external service without explicit approval.

## Classifying Feedback

Classify human feedback before acting on it. Approved artifacts are never
silently rewritten.

| Feedback | Route |
|---|---|
| Defect against approved scope | `review` |
| Changed intent for active work | `revise` |
| New work, or changed intent for completed or archived scope | Successor `track` |

## Choosing The Right Workflow

| Situation | Use |
|---|---|
| New project context | `create` |
| New desired feature, known bug, or governed operation | `track` |
| Execute approved work | `implement` |
| Evaluate finished implementation | `review` |
| Change approved intent | `revise` |
| Update project-wide context | `refresh` |
| Reverse recorded work | `revert` |
| Preserve completed history and patterns | `archive` |
| Inspect health or next actions | `status` |
| Explore without lifecycle state | `wisp` |
