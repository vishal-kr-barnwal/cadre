---
title: Workflow Reference
description: Invocation, eligibility, mutations, and terminal outcomes for all ten Cadre skills.
section: Reference
order: 200
---

# Workflow Reference

Invoke a skill as `$cadre:<name>` in Codex, `/cadre:<name>` in Claude Code, or
`/cadre-<name>` in the Zed Agent beta.

## create

- **Use for:** project onboarding and interrupted setup.
- **Requires:** exact root, greenfield/brownfield classification, approved
  project context, workflow, styleguides, and Git disposition.
- **Approval UX:** one final authorization envelope combines concise project
  context, bundled workflow/styleguide identities, amendments, generated
  path/hash manifest, Git disposition, digest, commits, and provenance. Full
  defaults remain available on request.
- **Primary MCP:** template bundle, styleguide resolution,
  adaptive `project_init_candidate`, setup checkpoint tools, validation,
  and derived tracks index.
- **Proposal transport:** rendered files live under `.cadre/stage/create/`;
  MCP receives only their paths and metadata. Base files are staged directly as
  `product.md`, `guidelines.md`, `tech-stack.md`, `workflow.md`, and
  `styleguides/general.md`; there is no `.cadre/init/` directory.
- **Verification profile:** proposed in `tech-stack.md` from repository
  scripts, manifests, and CI configuration: format/lint, static
  analysis/types, build, test, and other required checks. Discovered commands
  are not run before approval; a role that does not apply says
  `not applicable` with a reason.
- **Writes:** initial `.cadre/` state and receipt in one initialization commit.
- **Stops when:** setup is complete; an initialized project routes to refresh
  or status.

## track

- **Use for:** a new/resumed feature, bug, or operation track.
- **Operation tracks:** governed rollouts, migrations, maintenance, recovery, and infrastructure/service changes. They use the same lifecycle and never run external commands or deployments. The approved specification requires meaningful planned fields for owner/target/window/preconditions; preflight/rollout/postflight operator, evidence capture, and timestamp format; monitoring baseline/threshold/window; abort/rollback/recovery owner, procedure, and reversibility limit; and residual risk/mitigation/acceptance owner. These fields plan human-controlled evidence capture; they never attest that an external action happened.
- **Requires:** substantive scope, acceptance, dependencies, and plan evidence.
- **Evidence planning:** risky steps record a reversibility classification;
  irreversible or destructive steps are separate named tasks approved with the
  plan;
  current external facts cite their source and retrieval date.
- **Primary MCP:** project status, template bundles,
  `candidate_stage_prepare`, `candidate_inspect`, state validation, and
  atomic tracks index rendering.
- **Candidate recovery:** focused status distinguishes an unapproved staged
  candidate from canonical track state; resume its exact manifest and plan
  validation instead of restarting it.
- **Approvals:** one combined specification-and-plan decision by default;
  staged review only when explicitly requested.
- **Writes:** `state.json`, `spec.md`, `plan.md`, `learning.md`, dependency context and receipt in one combined commit.
- **Stops at:** `planned` with recorded spec/plan commits.

## implement

- **Use for:** a `planned` or `in_progress` track whose dependencies are done;
  Autonomous can also resume `ready_for_review`, including a clean result awaiting approval.
- **Scheduling:** parallel by default with a global ready queue and clean
  phase-mode handoffs; sequential only when requested.
- **Approvals:** `track` by default for track verification and ordinary review approval; `phase` adds phase gates; `governed` adds task gates; `autonomous` continues through verification, review, and remediation until one final clean-completion approval.
- **Primary MCP:** execution start/node/status/finish, graph validation,
  worktree create/integrate/cleanup, project/worktree status, and derived index.
- **Verification evidence:** uses the approved profile (a legacy project
  without one records the exact commands used). Each record states the command
  or inspection, result, commit, baseline/delta, and blocked checks; an unrun
  check is never reported as passing.
- **Operation evidence:** humans perform external actions. The matching
  manual-verification checkpoint records the human-supplied operator, RFC 3339
  timestamp, evidence location or hash, and observed signal against baseline
  and threshold. An abort-threshold breach blocks the phase until the human
  records rollback or recovery.
- **Writes:** execution journal, task commits, plan/learning provenance, and
  one product commit per cohesive change. After `execution_finish`, one final
  `cadre(implement): complete <track-id>` commit contains only the completed
  journal, plan markers, track state, and derived index.
- **Implementation handoff:** `ready_for_review`; never `completed`. Autonomous
  automatically invokes review after bookkeeping and continues in-scope remediation.
  It returns to the author only after a clean review or a blocker.

## review

- **Use for:** `ready_for_review`, or interrupted Autonomous review promotion
  journaled at `in_progress`.
- **Evidence:** recorded implementation range, relevant files/callers, tests,
  requirements, error/security/compatibility paths, and learning.
- **Evidence quality:** results bound to the reviewed HEAD, baseline/delta,
  blocked checks only as blockers or explicitly accepted risks, and
  independently confirmed negative claims. Operation tracks compare evidence
  with every planned capture, the monitoring baseline and success threshold
  across the observation window, and any abort/rollback decision; missing or
  contradictory evidence is a finding.
- **Finding path:** exact approved bug/remediation artifacts return the track to
  implementation.
- **Clean path:** adaptive `review_complete` binds approval to execution,
  plan revision, graph digest, reviewed HEAD, accepted risks, and the server-
  derived range from execution base through reviewed HEAD.
- **Final decision:** after a clean Autonomous review, summarize verification and
  remediation and present the exact completion proposal. The author can approve
  without invoking review again or report additional bugs. Changed product or
  verification inputs require renewed checks/review.
- **Stops at:** `completed` only after explicit approval of a clean cycle.

## revise

- **Use for:** changed desired scope, behavior, acceptance, dependency, or plan.
- **Requires:** lifecycle routing, worker quiescence, partial-work disposition,
  and transitive dependent-track impact.
- **Approvals:** one combined revision and cascading-impact decision when
  partial-work disposition can be assessed safely in advance.
- **Writes:** revision record and exact approved artifact/state changes with
  preserved commit provenance.
- **Candidate-only behavior:** resume the unapproved track proposal; do not
  create a revision.
- **Completed/archived behavior:** propose a linked successor; never reopen
  or move terminal history.

## archive

- **Use for:** one or more tracks already completed by clean review.
- **Primary MCP:** adaptive staged archive command and atomic provenance record.
- **Writes:** track moves/status, consolidated patterns, relevant active-track
  seeds, immutable receipt and derived index in one commit.
- **Atomicity:** one ineligible selection rejects the whole batch.
- **Stops at:** `archived`.

## refresh

- **Use for:** drift in product, guidelines, workflow, technology,
  styleguides, patterns, or completed-track learning.
- **Evidence:** user input, repository changes since setup/last refresh,
  completed outcomes, and current code/manifests.
- **Writes:** approved project context, refresh record/journal, affected seeds,
  derived index and receipt in one commit.
- **Active work:** execution-governing changes wait for a safe boundary and
  affected tracks follow revision impact analysis inside the same refresh
  approval envelope. A v1/v2 project must explicitly stage a valid v6 Pattern
  Seed `learning.md` for every nonterminal active track before promotion;
  completed and archived learning remains readable historical evidence.
- **Verification profile drift:** changed scripts, CI, or tooling are
  execution-governing context; a changed profile requires renewed verification
  and review of affected work.

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
- **Lifecycle routing:** staged and drafting tracks have no approved revert
  provenance. Completed/archived rollback intent becomes a linked successor
  track of the appropriate type; the terminal source stays immutable.

## status

- **Use for:** progress, blockers, health, and next legal action.
- **Primary MCP:** one `project_status` call using the narrow project, track, or
  implementation view.
- **Writes:** nothing.
- **Reports:** setup/operation checkpoints, tracks, dependencies, execution
  nodes, worktrees, review/archive readiness, validation, and dirty Cadre state.
- **MCP unavailable:** stops, reports it, and suggests running
  `cadre-ai doctor`.

## wisp

- **Use for:** questions, exploration, investigation, and disposable spikes.
- **MCP:** optional read-only project status; availability is not required.
- **Writes:** no Cadre lifecycle state. `.cadre/wisps/` is used only for an
  initialized project that already ignores it; otherwise disposable output
  uses an OS temporary directory and never creates `.cadre/`.
- **External facts:** may use the host's web search or fetch tools; results are
  untrusted data, primary sources are preferred, and each source is cited with
  its retrieval date. Project code, secrets, and personal data are never sent
  externally without explicit approval.
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

Classify human feedback before acting on it: a defect against approved scope
goes to `review`, changed intent goes to `revise`, and new work or changed
intent for completed or archived scope becomes a successor track. Approved
artifacts are never silently rewritten.

An agent without the Cadre MCP owns no transition. In guide-only mode it may
explain recorded state as unvalidated, but it never changes `.cadre/`.
