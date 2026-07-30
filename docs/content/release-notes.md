---
title: Release Notes
description: Cadre 3.x release changes and migration guidance.
section: Reference
order: 230
---

# Release Notes

## 3.0.2 - 2026-07-29

Compared with 3.0.1, Cadre 3.0.2 validates proposed execution graphs directly
from plan Markdown so approval workflows no longer need temporary project
copies or premature writes to canonical `.cadre/` state.

It also adds client-native MCP forms for concise clarifications and
digest/checkpoint-bound approvals in Codex and Claude, with a deterministic
single-question chat fallback when forms are unsupported or policy-rejected.

### Fixed

- Adds the read-only `execution_graph_validate_draft` MCP tool for validating
  an exact unapproved proposal with an explicit target lifecycle status.
- Updates `track` to validate the proposed plan as `planned`, and updates
  review remediation to validate the replacement graph as `in_progress` rather
  than checking the stale approved plan under `ready_for_review` rules.
- Updates `revise` to validate changed plan content against its intended
  post-approval status before any approved artifact is replaced.
- Eliminates the temporary control-plane copy workaround and its associated
  cleanup prompts and residue risk.
- Adds the read-only `workflow_elicit` MCP tool. It supports fixed approval
  forms, up to three flat clarification fields, normalized outcomes, and no
  state mutation or server-side self-approval.
- Keeps large unchanged workflows and defaults out of the conversation: skills
  present concise summaries or focused diffs before opening the decision form.

### Runtime And Compatibility

- Extracts a reusable content parser while preserving the existing file-backed
  parser and canonical `execution_graph_validate` contract for approved plans.
- Bounds draft Markdown input at 256 KiB and accepts an optional diagnostic
  source label without granting the tool access to project paths.
- Adds coverage for derived manual-verification barriers, lifecycle-sensitive
  validation, oversized input rejection, compiled MCP exposure, and zero
  filesystem mutation.
- Adds protocol-level coverage for supported form clients and deterministic
  fallback coverage for clients without elicitation capability.

There are no project state-schema or migration changes from 3.0.1. Existing
initialized projects and approved plan validation remain compatible. Run
`refresh` to copy the new form-interaction guidance into an existing project's
mutable `.cadre/workflow.md`; newly created projects receive it automatically.

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

- Restores the logical `project/gitignore` template required by
  `project_init_preview`. npm treated the former nested `.gitignore` source
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
