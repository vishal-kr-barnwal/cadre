---
title: Release Notes
description: Cadre 3.0 release changes and migration guidance.
section: Reference
order: 230
---

# Release Notes

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
