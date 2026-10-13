---
title: Capabilities
description: What Cadre supports today and where its boundaries are.
section: User Guide
order: 40
---

# Capabilities

Cadre is a focused, single-repository delivery harness for OpenAI Codex, Claude
Code, and the native Zed Agent. Codex, Claude Code, and native
Zed Agent integrations are stable. Cadre governs work from project context
through archived learning.

## Supported Today

| Area | Capability |
|---|---|
| Clients | Stable native user plugins for Codex/Claude and stable global skills plus custom MCP for Zed Agent. |
| Project creation | Greenfield/brownfield classification, optional Git initialization, approved context, workflow, styleguides, and patterns. |
| Tracks | Feature and bug specifications, acceptance criteria, dependencies, phased plans, and learning seeds. |
| Planning | Validated acyclic phase/task graphs with derived phase and track manual-verification barriers. |
| Implementation | Parallel-by-default or explicitly sequential execution, with a global ready queue, phase-local task waves, clean mode handoffs, and resumable journals. |
| Isolation | Phase and task workers in Cadre-managed sibling Git worktrees. |
| Governance | Semantic authorization envelopes bind exact proposals to unchanged journals, indexes, commits, transitions, and provenance; implementation adds Governed, Phase, Track (default), or Autonomous boundaries. |
| Review | Evidence-backed findings and remediation cycles; explicit clean-completion approval in every mode. Accepted risks are available only outside Autonomous mode. |
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
- Already-authorized deterministic mutations validate and apply in one call;
  multi-file promotions use journaled recovery and atomic per-file writes.
  Genuine decision boundaries return a digest-bound proposal token.
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

Cadre 4.0 does not currently provide:

- GitHub Copilot or Google Antigravity plugins;
- project-scoped client installation;
- hosted provider evidence, ship/land/release workflows, or merge trains;
- project-owned executable skills;
- LSP/DAP orchestration or a general code-intelligence service;
- a generic `cadre_workflow` packet API;
- multi-repository orchestration.

Deeper GitHub/GitLab multi-person coordination, a knowledge base built during
delivery and reused as context, and polyrepo support are on the
[upcoming roadmap](team-and-polyrepo.md). Each will be independently opt-in and
disabled by default. Existing phase learning and archive patterns remain core capabilities.
