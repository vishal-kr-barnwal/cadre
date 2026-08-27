---
title: Release Notes
description: Cadre 3.x release changes and migration guidance.
section: Reference
order: 230
---

# Release Notes

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
