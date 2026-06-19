---
title: Getting Started
description: Install Beads, install the Cadre plugin, and initialize a target project.
section: Start
order: 2
---

# Getting Started

This guide gets Cadre installed in Claude Code or OpenAI Codex and initializes
the first target project.

## Prerequisites

Cadre requires Beads. Beads provides the durable task graph that survives across
agent sessions and stores implementation notes, dependencies, blockers, labels,
and handoff evidence.

Install Beads once:

```bash
npm install -g @beads/bd
```

Other supported install routes are Homebrew and Go:

```bash
brew install beads
go install github.com/steveyegge/beads/cmd/bd@latest
```

Verify the CLI:

```bash
bd --version
```

If `bd` is unavailable, `cadre-setup` stops before writing the project control
plane.

## Install The Plugin

Cadre ships as generated plugins for Claude Code and OpenAI Codex. Both plugin
bundles are generated from the same master skill, protocols, templates,
references, and TypeScript runtime.

### Claude Code

Claude reads the repository marketplace at `.claude-plugin/marketplace.json`.

```text
/plugin marketplace add vishal-kr-barnwal/Cadre
/plugin install cadre@cadre
```

The installed Claude plugin contains:

- `skills/cadre/` with the Cadre skill, protocols, references, and templates.
- `mcp-config.json` for the Cadre MCP server.
- `scripts/` with the MCP runtime and helper scripts.
- `agents/cadre-worker.md` for worker dispatch when parallel phases are ready.

### OpenAI Codex

Codex reads the repository marketplace at `.agents/plugins/marketplace.json`.

```bash
codex plugin marketplace add vishal-kr-barnwal/Cadre --sparse .agents/plugins --sparse harness/plugins/cadre
codex plugin add cadre@cadre
```

The installed Codex plugin contains:

- `.codex-plugin/plugin.json`.
- `.mcp.json` for the Cadre MCP server.
- `skills/cadre/` with the generated Codex-facing skill bundle.
- `scripts/` with the MCP runtime and helper scripts.

## First Project Setup

In the target project, activate the Cadre skill and run setup:

```text
$cadre
cadre-setup
```

Setup asks for product context, tech stack, topology, sync mode, provider mode,
quality gate, optional CI templates, and LSP setup. When language-server
recommendations are detected, setup writes `cadre/lsp.json` by default unless
you opt out. The workflow is packet-owned: the agent should call Cadre MCP, and
Cadre MCP writes the control plane.

Successful setup creates:

| File | Purpose |
|------|---------|
| `cadre/product.md` | Product goals, users, workflows, constraints, and domain notes. |
| `cadre/product_guidelines.md` | Product principles, trust boundaries, non-goals, decision rules, and review checklist. |
| `cadre/tech-stack.json` | Languages, frameworks, package managers, platforms, and test commands. |
| `cadre/workflow.md` | Development, verification, review, and commit expectations. |
| `cadre/patterns.md` | Reusable implementation patterns promoted from completed work. |
| `cadre/tracks.md` | Derived human index rebuilt from track metadata. |
| `cadre/config.json` | Sync mode, provider mode, review, and quality settings. |
| `cadre/beads.json` | Beads integration settings. |
| `cadre/repos.json` | Polyrepo topology when enabled. |
| `cadre/lsp.json` | Language-server configuration generated during setup when recommendations exist. |

Track directories later live under `cadre/tracks/<track_id>/` and contain
`metadata.json`, `spec.md`, `plan.md`, `learnings.md`, and optional handoff or
revision artifacts.

## Verify The Runtime

At the beginning of any Cadre workflow, the agent verifies the MCP server:

```json
{ "action": "ping" }
```

For project-scoped operations, every Cadre MCP call includes a per-call `root`
argument pointing at the project root or a path inside it:

```json
{ "root": "/path/to/project" }
```

This is important because one long-running MCP process can serve multiple
projects. Cadre does not depend on remembered server cwd for routing.

## Create And Implement Work

Create a track:

```text
cadre-newtrack "Add OAuth login"
```

Cadre returns planning evidence: likely files, dependency hints, test impact,
parallel candidates, Beads tree preview, and a worktree plan. When the track is
created, Beads receives the mapped task tree.

Start or resume implementation:

```text
cadre-implement
```

The implementation packet selects or claims a track, returns bounded context,
runs collision checks, chooses style-guide context, and computes the next phase
schedule. If the next work can run in parallel, Cadre returns worker payloads
through `cadre_parallel`; otherwise the agent proceeds sequentially.

## Review And Deliver

Run review:

```text
cadre-review
```

Cadre assembles plan completion, review evidence, machine gate output,
TODO/stub findings, optional LSP findings, and hosted provider requirements.

For a monorepo, publish with:

```text
cadre-ship
```

For a polyrepo control repo, publish with:

```text
cadre-land
```

After delivery, archive completed tracks:

```text
cadre-archive
```

Use `cadre-release` to summarize completed track metadata into release
artifacts.
