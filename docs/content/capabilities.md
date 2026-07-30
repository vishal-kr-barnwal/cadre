---
title: Capabilities
description: What Cadre 3.0 supports today and where its boundaries are.
section: User Guide
order: 40
---

# Capabilities

Cadre 3.0 is a focused, single-repository delivery harness for OpenAI Codex and
Claude Code. It governs work from project context through archived learning.

## Supported Today

| Area | Capability |
|---|---|
| Clients | Native user plugins for Codex and Claude Code. |
| Project creation | Greenfield/brownfield classification, optional Git initialization, approved context, workflow, styleguides, and patterns. |
| Tracks | Feature and bug specifications, acceptance criteria, dependencies, phased plans, and learning seeds. |
| Planning | Validated acyclic phase/task graphs with derived phase and track manual-verification barriers. |
| Implementation | Parallel-by-default or explicitly sequential execution, with a global ready queue, phase-local task waves, clean mode handoffs, and resumable journals. |
| Isolation | Phase and task workers in Cadre-managed sibling Git worktrees. |
| Governance | Persisted governed, phase-default, or autonomous implementation approval boundaries, with explicit artifact, track-level verification, review, and archive decisions. |
| Review | Evidence-backed findings, approved remediation cycles, accepted-risk recording, and clean completion. |
| Change control | Lifecycle-aware revision, project-context refresh, and additive Git-aware revert. |
| Learning | Dependency-phase learning, pattern seeds, pattern distillation, and active-track reseeding. |
| Recovery | Setup, execution, revision, review, refresh, revert, and archive reconciliation after interruption. |
| Exploration | Stateless `wisp` investigations outside tracked delivery state. |

## Built-In Styleguides

Cadre bundles idiomatic defaults for:

- Go, Java, Kotlin, JavaScript, TypeScript, Dart, Python, and Swift;
- React, Flutter, SwiftUI, and HTML/CSS;
- Maven and Gradle;
- general repository engineering guidance.

During `create`, applicable guides are resolved from the approved technology
list. Each can be accepted, amended, or replaced before project initialization.

## Safety Boundaries

Cadre's MCP runtime is intentionally constrained:

- It exposes immutable versioned templates and typed state operations.
- Deterministic mutations use paired preview/apply calls with stale-state
  digests.
- Git support is limited to derived worktree creation, non-squash integration,
  status, and verified cleanup.
- It does not run arbitrary shell commands, edit product files for workers,
  approve its own proposals, resolve conflicts, or commit on a worker's behalf.
- It rejects broad project roots and validates managed paths and lifecycle
  invariants.

Agent skills still perform explicitly approved artifact writes and Git commits
where the MCP does not own that mutation. Multi-step changes are journaled
before the first artifact or Git mutation.

## Not In The Current Release

Cadre 3.0 does not currently provide:

- GitHub Copilot or Google Antigravity plugins;
- project-scoped client installation;
- hosted provider evidence, ship/land/release workflows, or merge trains;
- project-owned executable skills;
- LSP/DAP orchestration or a general code-intelligence service;
- a generic `cadre_workflow` packet API;
- multi-repository orchestration.

Polyrepo delivery is planned. See [Polyrepo Mode](team-and-polyrepo.md) for the
current boundary and intended direction.
