---
title: Release Notes
description: Cadre 3.x release changes and migration guidance.
section: Reference
order: 230
---

# Release Notes

## 3.7.1 - 2026-09-07

Fixes finding-bearing review and scope-revision proposals that failed validation
before Cadre could return an approval digest. Inspection now validates the proposed
lifecycle transition while preserving the canonical state and completed execution
until approval. The digest requirement remains intact.

Completed former final verification phases keep their titles, task IDs, commit
provenance, and original dependencies when remediation adds a new final gate.
Replacement executions carry that completed work forward. Between approved
promotion and replacement execution, `context_read` labels retained handoffs as
historical evidence instead of blocking on the older graph.

Validation also rejects conflicting staged state/plan targets, empty approved
plans, malformed staged plan syntax, and reopening terminal tracks. Active
execution checks remain enforced, and missing or malformed unapproved drafts
can still be repaired through staging.

### Upgrade

```bash
npm install -g cadre-ai@3.7.1
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new Zed
Agent thread. Template set v3 and published v1/v2/v3 files are unchanged.
Existing projects, including 3.7.0 projects, remain readable and use the approved
`refresh` workflow to record runtime 3.7.1 before delivery. Re-inspect a blocked
review proposal with the updated server, then obtain approval bound to its digest.

### Validation

The 82 automated tests cover staged review, nested revision, repeated verification
cycles, replacement execution, historical context, and Codex/Claude structured
responses plus Zed text responses. Release checks include type checking, package
validation and dry-run inspection, documentation checks, and native installer,
discovery, and MCP activation. Zed remains beta.

## 3.7.0 - 2026-09-06

Adds template v3, durable task handoffs, seed-freshness validation, scoped `context_read` with drift-sensitive pagination, compact status/detail views, and batched provenance validation. Existing projects require an approved refresh before further delivery; v1/v2 templates and historical evidence remain unchanged. The runtime remains self-contained, and approval, verification, and commit provenance requirements remain intact.

### Audit corrections

Cadre 3.7.0 checks linked pattern references and Markdown fences, rejects invalid staged revision paths and lost execution bindings, verifies plan provenance, and reads archived execution detail. Review preparation evidence is separate from the confirmation recorded by apply. Error messages remain visible in native Claude. Refresh bookkeeping retains history against committed artifacts, and revert preparation explicitly preserves the target worktree and index. Resetting execution evidence requires an exact original journal snapshot, and completion retains the approval digest and resulting commit provenance in a durable receipt/history entry.

Context reuse requires retained source text in the current session; fresh sessions read it again. Aggregate byte measurements include requests and a cold resume. Small projects can have higher overhead. Bytes are not tokens, and structural checks do not prove the truth of agent-authored learning. Native installation and activation across all three clients remain release prerequisites.

The native Zed audit also made the revert write order explicit: persist and reread the approval receipt before restoring implement ownership, initially leaving the reconciliation SHA null. Commit that receipt with reconciliation, then record the actual SHA and history entry. This keeps approval evidence available during interrupted bookkeeping.

### Upgrade

```bash
npm install -g cadre-ai@3.7.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new Zed Agent thread. Existing projects need one approved refresh before delivery can continue.

### Validation

All 79 automated tests, package checks, and documentation checks passed. Native Claude/Codex audits and native Zed installation, discovery, MCP, staged-revert, and fresh-session recovery checks passed. Zed remains beta; native testing does not cover every possible workflow branch.

## 3.6.0 - 2026-09-02

### Agent-visible MCP results

- All 22 MCP tools now publish output schemas covering their stable
  agent-facing fields and exact success/error variants.
- Every response ends with compact JSON that is deeply equal to
  `structuredContent`, including elicitation, templates, status, execution,
  mutations, and structured failures. Agents can safely recover
  `proposalToken` and every other follow-up field from model-visible text.
- Approval-required results include the complete proposal and
  `proposalToken`; applied results omit the token. Template and candidate
  bodies remain outside mirrored descriptors.
- The serialized tool-catalog limit is now 64 KiB to accommodate output
  schemas while preserving Node 18 support and the existing 22 tool names and
  wire shapes.
- Zed installation now refreshes Node executable-path changes for an existing
  server that still targets the exact Cadre-managed MCP file; foreign server
  targets remain protected from replacement.

Canonical artifact formats and template set v2 are unchanged. Existing 3.5.1
projects remain readable and use the normal approved `refresh` workflow to
record runtime 3.6.0 before further mutation.

```bash
npm install -g cadre-ai@3.6.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new
Zed Agent thread so each client loads the 3.6.0 schemas and runtime guidance.

## 3.5.1 - 2026-08-27

Cadre 3.5.1 hardens all ten workflows against validation, routing, stale-stage,
and interrupted-write failures. Codex and Claude Code support remains stable;
native Zed Agent support remains beta.

### Candidate and status recovery

- Candidate inspection validates every staged root or nested `plan.md` through
  exact `planValidations`, returns sorted `plans`, and binds validation context
  into the approval digest.
- Candidate preparation accepts `expectedFiles` and safely prunes obsolete
  regular files after a complete symlink/non-file preflight.
- Project status reports sorted staged candidates in project view and keeps
  canonical, candidate-only, shadowed, malformed, and unknown states distinct.
  Focused views include complete errors and a selected-track/dependency subset.
- Track, revise, review, revert, refresh, status, and archive guidance now stop
  or resume at the correct lifecycle boundary instead of confusing an
  unapproved stage with canonical state.

### Convergent operations

- Project initialization resumes when partial canonical files exactly match
  the approved proposal.
- Execution finish reuses persisted completion evidence and completes any
  remaining journal, state, plan, or index writes.
- Clean-review retry repairs a stale index without duplicating its review
  cycle. Its Git range is derived from execution base through reviewed HEAD.
- Archive apply and record resume from their approved operation journal and do
  not duplicate track or project history.
- Implementation creates one final `cadre(implement): complete <track-id>`
  bookkeeping commit before review.

### Corrected MCP schemas

The four approval-aware tools now use strict `request` prepare/apply unions,
and `execution_checkpoint` uses strict `scope` plus event-specific `action`
objects. The retired `candidate_inspect.targetStatus`, singular `plan` result,
and `review_complete.commitRangeStart` are removed. The MCP surface remains 22
tools within the 18 KiB catalog limit.

Unapproved 3.5.0 candidate stages must be re-inspected. Approved operation
journals remain readable and resumable. Existing 3.5.0 projects use the normal
approved `refresh` workflow to record runtime 3.5.1; template set v2 is
unchanged.

```bash
npm install -g cadre-ai@3.5.1
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new
Zed Agent thread so each client loads the corrected schemas and skills.

## 3.5.0 - 2026-08-27

Cadre 3.5.0 adds beta support for the native Zed Agent. Codex and Claude Code
remain stable integrations, and Cadre's lifecycle, governance, project state,
and active v2 template semantics are unchanged.

### Native Zed Agent beta

- `cadre-ai install --target zed` installs all ten workflows as global
  `/cadre-*` skills and configures the packaged Cadre MCP server.
- Auto-detection includes Zed when its CLI is installed, and `--target all`
  now selects Codex, Claude Code, and Zed.
- Installation preserves Zed JSONC comments and unrelated settings, uses
  collision-safe skill links, and adds one exact allow rule for each of the 22
  Cadre MCP tools unless `--prompt-mcp-tools` is supplied.
- Uninstall removes only Cadre-owned skill links and a matching context-server
  entry. It preserves permission preferences and unrelated configuration.

### Zed runtime compatibility

- Generated Zed skills request `template_get_many` with
  `contentMode: "text"`; Codex and Claude retain the embedded-resource default.
- Zed uses the existing single-question chat fallback because it does not
  advertise MCP form elicitation.
- The MCP tool catalog is centralized so server registration, permissions,
  validation, and tests cannot drift.

### Compatibility and upgrade

Existing 3.4 projects remain readable. After installing 3.5.0, run Cadre
`refresh` and approve the runtime-version update before further state mutation;
the template set remains v2 and no lifecycle migration is introduced.

```bash
npm install -g cadre-ai@3.5.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation, run `/reload-plugins` in Claude Code, and open
a new Zed Agent thread. In Zed, verify the ten beta `cadre-*` skills, the
active Cadre MCP server, and `/cadre-status`.

## 3.4.0 - 2026-08-27

Cadre 3.4 is a breaking MCP and template-efficiency release. It reduces the
public surface to 22 tools, makes adaptive schemas honest, coalesces execution
bookkeeping, and introduces compact v2 project workflow defaults.

### Breaking MCP migration

- Every approval-aware command now requires `mode: "prepare" | "apply"` and
  rejects mixed shapes. Apply accepts only `proposalToken`.
- `candidate_inspect` replaces separate manifest and staged-plan reads.
- `project_status` gains project, track, and implementation views; implementation
  preflight is one call.
- Template discovery and individual reads use MCP resources; known bundles use
  `template_get_many`. Template bodies occur once as embedded resources and
  structured data contains descriptors only.
- Apply receipts contain status, digest/checkpoint, counts, and changed paths
  instead of repeated manifests or canonical bodies.

### Candidate and initialization safety

- Candidate staging now lives under `.cadre/stage/<candidate-id>/`; Cadre
  enforces `/stage/` in `.cadre/.gitignore` before files are written.
- `.cadre/init/*` is never a project destination. During initial creation the
  `.cadre` bootstrap shell may contain only `.gitignore` and `stage`.
- Initialization requires staged product, guidelines, and tech-stack files.
  The MCP generates unchanged workflow and selected styleguide defaults, binds
  them into the approval digest, and accepts staged overrides.

### v1 to v2 refresh

- Published v1 templates remain immutable and readable; new projects use v2.
- Existing v1 projects report `upgradeRequired`. Status, wisp, and explicit
  refresh remain available; other mutations fail with
  `PROJECT_REFRESH_REQUIRED`.
- Upgrade occurs only through a human-approved refresh containing the compact
  v2 workflow, runtime/template versions, and ignore rule. Nothing rewrites a
  legacy project automatically.

### Execution and budgets

- Worktree creation records start, integration records merge state, and cleanup
  records completion. Lost-response retries finish only the missing half.
- A normal delegated task uses four MCP calls; governed integration uses five.
- Regression budgets cap the tool catalog at 18 KiB, workflow at 6 KiB, common
  template/status bundles at 4–8 KiB, and checkpoint/apply receipts at 4 KiB.

### Compatibility and upgrade

- Direct MCP clients must migrate removed template/candidate/worktree reads to
  resources, `candidate_inspect`, and scoped `project_status`, and must send
  the explicit adaptive `mode` shapes.
- Existing v1 projects stay readable after installation. Run Cadre `refresh`
  and approve the complete v2 workflow/version proposal before using other
  state mutations.
- Proposal tokens created by 3.3.0 are not portable to 3.4.0; prepare the
  operation again under the new schema.

```bash
npm install -g cadre-ai@3.4.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code so both
clients load the 3.4 schemas and skills.

## 3.3.0 - 2026-08-09

Cadre 3.3.0 is an MCP reliability and context-efficiency release. Compared
with 3.2.0, it makes preview/apply proposals restart-safe and replaces repeated
full-journal and full-artifact responses with compact, digest-bound receipts
and manifests. Existing `.cadre` project state remains compatible.

### Durable Proposal Capabilities

- Replaces self-contained gzip/base64 proposal tokens—which could exceed
  27,000 characters during project initialization—with 42-character opaque
  capabilities backed by Cadre-owned runtime records.
- Stores normalized input, proposal kind, semantic digest, schema version, and
  creation time under `${CADRE_HOME:-~/.cadre}/runtime/proposals` so apply can
  continue after an MCP server restart.
- Bounds retention to seven days, 256 records, 32 MiB total, and 8 MiB per
  proposal, with oldest-first cleanup.
- Uses 192-bit random identifiers, exclusive writes, fsync, restrictive file
  permissions, ownership checks, and symlink/path protections. Callers never
  provide a proposal filesystem path.
- Preserves digest recomputation and stale-state rejection for every
  preview/apply pair. A durable token is a capability to the approved input,
  not permission to bypass current-state validation.

### Compact Execution Protocol

- Execution checkpoint preparation now returns the proposed event as a compact
  `from` → `through` → `to` transition receipt plus its checkpoint and digest.
- Execution checkpoint mutation returns the applied receipt and compact
  `derivedStatus`: ready phases, ready tasks, active nodes, blocked nodes, and
  focused event guidance. The complete journal is no longer echoed after every
  transition.
- `execution_status` now defaults to a scheduler view with execution metadata,
  counts, scheduling arrays, minimal active/blocked node records, and relevant
  guidance. Optional `nodeId` returns full detail for one node.
- Full execution journals remain unchanged on disk and remain the canonical
  source for atomic transitions, validation, recovery, and provenance.

In the production journal that exposed the issue, the execution contained 46
nodes. The old derived status represented about 19.5 KiB before MCP framing;
the installed 3.3.0 server returned a complete 3.1 KiB MCP status response with
no embedded journal. Regression budgets cap checkpoint responses below 4 KiB
and a 50-node default status view below 8 KiB.

### Manifest-Based Mutation Results

Large preview/apply families now return concise outcome metadata and
path/SHA-256 manifests instead of repeating canonical content:

- Project initialization returns the complete initialization path/hash
  manifest without echoing the 30 KiB workflow template.
- Execution start reports execution identity, modes, node count, and initial
  scheduling state rather than its complete journal and track state.
- Execution finish reports the final status and hashes for journal, state,
  plan, and `tracks.md`.
- Review and archive report lifecycle outcomes, moves, commits, and hashes
  without repeating complete states, pattern content, seeds, or indexes.
- Derived track-index preview reports its path and SHA-256 digest rather than
  the complete rendered index.

### Compatibility

Existing 3.2.0 projects, operation journals, and execution journals require no
migration. Tool names, `proposalToken` inputs, semantic event names, proposal
digests, and scheduler arrays remain stable. Direct MCP clients must adapt to
the compact response shapes and use reported paths when complete canonical
artifacts are genuinely required.

Proposal tokens created by 3.2.0 are not portable into 3.3.0. Re-run the
matching preview after upgrading; no project mutation is repeated by doing so.

### Upgrade

```bash
npm install -g cadre-ai@3.3.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code after
upgrading so both clients load the 3.3.0 MCP response schemas.

## 3.2.0 - 2026-08-07

Cadre 3.2.0 is a breaking simplification of the MCP execution and governance
surface, based on failure and approval-flow analysis from a complete production
delivery session. It removes compatibility aliases and shifts deterministic
identity, Git, and bookkeeping decisions into the runtime.

### Smaller Execution Contract

- Replaces low-level execution node mutation tools with semantic checkpoint
  commands.
- Uses semantic events—`start`, `record_commit`, `record_integration`,
  `record_verification`, `complete`, `block`, and `resume`—that expand into
  complete legal transition sequences.
- Changes `execution_status` from low-level next-status guidance to semantic
  event guidance with the evidence required by each event.
- Keeps `phase` as the default approval mode and inherits the recorded mode
  when an execution resumes.

### Opaque Preview/Apply Binding

- Every mutation preview returns an opaque `proposalToken`; apply accepts only
  that token.
- Removes repeated apply arguments, caller-supplied proposal digests, and the
  `proposalDigest` compatibility alias.
- Derives execution IDs, timestamps, Git bases and heads, review heads, archive
  IDs and commits, and worktree ancestry from authoritative local state.
- Restricts template inputs to catalog IDs and archive writes to structured
  pattern, pattern-index, and active-track-seed updates.

### Git And Finalization Reliability

- Validates that persisted project, track, plan, execution, review, revision,
  and archive commit references are reachable from repository history.
- Allows canonical integration when only its exact active execution journal is
  dirty while continuing to reject unrelated product or Cadre changes.
- Atomically writes completed plan markers, the execution journal,
  `ready_for_review` state, and the generated `tracks.md` index at finish.
- Derives clean-review evidence with ancestry checks and selects all eligible
  completed tracks in dependency order for a bare archive command.

### Compatibility And Upgrade

The removed 3.1.x MCP tools, repeated apply inputs, and digest alias are not
retained. Existing persisted project state remains validated by the 3.2.0
runtime, but active clients must reinstall the plugin to receive the new tool
schemas.

```bash
npm install -g cadre-ai@3.2.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code after
upgrading.

## 3.1.0 - 2026-07-30

Compared with 3.0.2, Cadre 3.1.0 makes approval frequency an explicit,
persisted execution policy and reduces routine implementation overhead without
weakening digest-gated mutations or manual verification.

### Approval Governance

- Adds `governed`, `phase`, and `autonomous` implementation approval modes.
  `phase` is the default: regular phase work runs autonomously and pauses once
  at the phase's final manual-verification task. `autonomous` pauses only at
  track-level verification; `governed` retains task-by-task gates.
- Treats one approved semantic proposal as an authorization envelope over its
  unchanged deterministic journals, indexes, validation, commits, lifecycle
  transitions, and provenance. Create, track, review, revise, refresh, revert,
  and archive no longer split one decision into mechanical follow-up prompts.
- Keeps material ambiguity, scope changes, failed required checks, unsafe
  state, destructive work, and remote publication outside those envelopes.

### Native Interaction

- Adds the read-only `workflow_elicit` MCP tool for bounded client-native
  clarification and approval forms in Codex and Claude Code.
- Binds approval forms to a proposal digest or immutable verification
  checkpoint and normalizes approval, requested changes, decline, and cancel.
- Uses one concise text question when form elicitation is unsupported or the
  active host policy is non-interactive, including Codex Full Access. Policy
  rejection is not reported as a human decline.
- Summarizes unchanged workflows and defaults instead of printing their full
  content into the conversation.

### Execution Runtime And Efficiency

- Makes `execution_status` self-describing with legal next transitions and
  required evidence. MCP failures now return structured errors, and every
  mutation preview exposes a uniform `proposalDigest` alias.
- Adds ordered execution-node batching guidance, avoids global tool-catalog
  discovery and speculative previews, runs independent read-only checks in
  parallel, and reuses verification when only `.cadre/**` bookkeeping changed.
- Infers task worktree phase identity from its task node ID and makes cleanup
  interruption-safe after an integrated node was already marked complete.
- Finalizes the execution journal, `ready_for_review` state, and derived
  `tracks.md` under one digest, eliminating a separate index-repair step.
- Keeps distinct product-task commits while reducing Cadre-only Git commits to
  phase and final readiness checkpoints.

### Compatibility And Upgrade

Existing 3.0.x projects and execution journals remain readable; missing legacy
approval-mode fields are interpreted as `governed`. Run `refresh` to adopt the
new project workflow guidance. New executions default to `phase` unless the
human explicitly selects another mode.

```bash
npm install -g cadre-ai@3.1.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code after
upgrading.

## 3.0.2 - 2026-07-29

Compared with 3.0.1, Cadre 3.0.2 validates proposed execution graphs directly
from plan Markdown so approval workflows no longer need temporary project
copies or premature writes to canonical `.cadre/` state.

### Fixed

- Adds read-only validation for an exact unapproved proposal with an explicit
  target lifecycle status.
- Updates `track` to validate the proposed plan as `planned`, and updates
  review remediation to validate the replacement graph as `in_progress` rather
  than checking the stale approved plan under `ready_for_review` rules.
- Updates `revise` to validate changed plan content against its intended
  post-approval status before any approved artifact is replaced.
- Eliminates the temporary control-plane copy workaround and its associated
  cleanup prompts and residue risk.

### Runtime And Compatibility

- Extracts a reusable content parser while preserving the existing file-backed
  parser and canonical `execution_graph_validate` contract for approved plans.
- Bounds draft Markdown input at 256 KiB and accepts an optional diagnostic
  source label without granting the tool access to project paths.
- Adds coverage for derived manual-verification barriers, lifecycle-sensitive
  validation, oversized input rejection, compiled MCP exposure, and zero
  filesystem mutation.

There are no project state-schema, template, command-name, or migration changes
from 3.0.1. Existing initialized projects and approved plan validation remain
compatible.

### Install Or Upgrade

```bash
npm install -g cadre-ai@3.0.2
cadre-ai doctor
cadre-ai install
```

Start a new Codex conversation or reload Claude Code plugins after upgrading.

## 3.0.1 - 2026-07-29

Cadre 3.0.1 fixes project creation in the published npm package and adds
package-boundary safeguards for every native workflow and immutable template.

### Fixed

- Restores the logical `project/gitignore` template required by project
  initialization. npm treated the former nested `.gitignore` source
  file as packlist configuration, omitted the template itself, and also
  suppressed the disposable `wisps/` placeholder from the package.
- Stores the provider asset under the packaging-safe physical name
  `gitignore.template` while preserving the public template ID, content hash,
  generated `.cadre/.gitignore` path, and initialization behavior.
- Makes both `cadre-ai doctor` and `cadre-ai install` reject an incomplete
  immutable template catalog before a marketplace is changed.

### Packaging And Documentation

- Defines the complete 38-template `v1` catalog as an explicit runtime
  contract and rejects missing, unexpected, or duplicate template IDs.
- Adds npm packlist regression coverage for all ten workflow skills, both
  worker definitions, both runtime bundles, native plugin manifests, MCP
  configurations, and every immutable template.
- Audits `track`, `implement`, `review`, `revise`, `archive`, `refresh`,
  `revert`, `status`, and `wisp`; no other workflow asset was missing from the
  published package.
- Points both the repository README and the npm package README to the canonical
  [Cadre documentation](https://cadre-docs.pages.dev/).

There are no command, state-schema, template-content, or migration changes from
3.0.0. Existing initialized projects remain compatible.

### Install Or Upgrade

```bash
npm install -g cadre-ai@3.0.1
cadre-ai doctor
cadre-ai install
```

Start a new Codex conversation or reload Claude Code plugins after upgrading.

## 3.0.0 - 2026-07-28

Cadre 3.0 is a major simplification around a human-governed, Git-aware
create-to-archive lifecycle for OpenAI Codex and Claude Code.

### Workflow Model

- Replaces the prior generic packet workflow with ten native skills: `create`,
  `track`, `implement`, `review`, `revise`, `archive`, `refresh`, `revert`,
  `status`, and `wisp`.
- Uses `.cadre/` for approved mutable target-project state.
- Adds explicit greenfield/brownfield creation, separate workflow/styleguide
  acceptance, feature/bug specifications, validated dependency DAG plans, and
  derived manual-verification barriers.
- Makes parallel implementation the default when multiple safe nodes are ready,
  with explicit sequential mode available.
- Supports clean, journaled handoffs between sequential phase execution and
  task-worker fan-out while retaining worker history and one main scheduler.
- Preserves completed/archived history by routing changed intent to successor
  tracks.

### Human Governance And Recovery

- Adds digest-gated preview/apply operations for deterministic project, review,
  archive, execution, derived-index, and worktree changes.
- Journals setup, track, execution, revision, review remediation, refresh,
  revert, and archive work before mutation.
- Reconciles expected commits, dirty artifacts, worktrees, branches, commits,
  and merges after interruption rather than restarting or discarding state.
- Binds clean review to execution ID, plan revision, graph digest, reviewed
  HEAD, and accepted risks.

### Parallel Worktrees

- Adds phase/task dependency scheduling and bounded workers.
- Keeps phase and task worktrees as safe sibling paths.
- Makes the main agent the sole scheduler, state owner, integrator, conflict
  resolver, cleanup owner, and recorder of human approval.
- Allocates one global worker bound across parallel phases and phase-local task
  waves without concurrent mutating modes inside the same phase.
- Adds constrained preview/apply worktree creation, non-squash integration, and
  ancestry-proven cleanup.

### Runtime And Packaging

- Publishes a self-contained `cadre-ai` package with one executable,
  `cadre-ai`.
- Builds two bundles: `dist/cadre-cli.mjs` and `dist/cadre-mcp.mjs`.
- Installs `cadre@cadre` through a local dual-client marketplace for Codex and
  Claude Code at user scope.
- Ships ten workflow skills, Claude worker definitions, immutable template set
  `v1`, typed validation, and 35 purpose-built MCP tools.
- Configures narrow Codex MCP approval and both Claude server enablement plus
  tool allowlisting while preserving unrelated settings.

### Project Context And Learning

- Ships product, engineering-guideline, technology, workflow, pattern,
  styleguide, track, execution, revision, revert, refresh, and archive
  templates.
- Includes default styleguides for Go, Java, Kotlin, Maven, Gradle, JavaScript,
  TypeScript, React, HTML/CSS, Dart, Flutter, Swift, SwiftUI, and Python.
- Carries dependency-phase learning forward and distills durable patterns during
  multi-track archive batches.

### Breaking Migration From 2.x

Cadre 3.0 does not support the prior 2.x state or command contract in place.
Important removals include:

- the `cadre` executable alias (use `cadre-ai`);
- `cadre/` project state (3.0 uses `.cadre/`);
- generic `cadre_workflow`, `cadre_action`, and `cadre_read` packets;
- the 19-workflow setup/newtrack/ship/land/release family;
- Copilot and Antigravity plugins;
- provider evidence, team boards, merge trains, project skills, formulas,
  LSP/DAP, and polyrepo orchestration.

Polyrepo mode is planned but not included. See
[Polyrepo Mode — Coming Soon](team-and-polyrepo.md).

For an existing 2.x project, preserve its state and Git history. Install 3.0,
start a new client session, and run `create` only after choosing a deliberate
migration or fresh `.cadre/` initialization strategy. Do not mechanically rename
`cadre/` to `.cadre/`; the schemas and lifecycle differ.

### Install Or Upgrade

```bash
npm install -g cadre-ai@3.0.0
cadre-ai doctor
cadre-ai install
```

Reload Codex or Claude Code and confirm `cadre@cadre` is installed and enabled.
