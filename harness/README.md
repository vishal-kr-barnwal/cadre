# Cadre

**Measure twice, code once.**

Cadre is a context-driven development harness for AI coding agents. It combines
spec-first tracks, Beads-backed durable task memory, review gates, team boards,
parallel worker orchestration, and mono/polyrepo delivery into one packet-owned
workflow.

## What Cadre Provides

- **Structured work:** setup, new track, implementation, review, ship/land,
  archive, release, handoff, refresh, revise, validate, flag, and formula flows.
- **Persistent memory:** Beads stores task graph, dependencies, notes, handoffs,
  and resume evidence; agents access it through Cadre packets.
- **Team safety:** ownership, advisory leases, collision scans, review queues,
  shared sync, and compact MCP dashboard resources.
- **Polyglot intelligence:** repo maps, dependency graphs, test impact,
  workspace diagnostics, LSP setup, warm LSP review, and async job artifacts.
- **Two agent surfaces:** Claude Code and OpenAI Codex plugins are generated from
  the same master skill, protocols, references, templates, and TypeScript
  runtime.

## Install

Install Beads first; setup requires the `bd` CLI to be available.

```bash
npm install -g @beads/bd
bd --version
```

Install the Cadre plugin from this repository's marketplace shim.

Claude Code:

```text
/plugin marketplace add vishal-kr-barnwal/Cadre
/plugin install cadre@cadre
```

OpenAI Codex:

```bash
codex plugin marketplace add vishal-kr-barnwal/Cadre --sparse .agents/plugins --sparse plugins/cadre
codex plugin add cadre@cadre
```

## Use

In a target project, activate the Cadre skill and ask for the workflow you need:

```text
$cadre
cadre-setup
cadre-newtrack "Add OAuth login"
cadre-implement
cadre-review
cadre-ship
```

Cadre workflows are packet-owned. The agent verifies Cadre MCP, passes a
per-call `root`, and lets the runtime perform state reads/writes, Beads work,
parallel worker state, provider evidence write-back, and shared sync. Do not
maintain Cadre state by hand.

## Setup Outputs

`cadre-setup` writes the project control plane:

- `cadre/product.md`
- `cadre/tech-stack.json`
- `cadre/workflow.md`
- `cadre/tracks.md` as a derived human index
- `cadre/learnings.md`
- `cadre/patterns.md`
- `cadre/config.json`
- `cadre/beads.json`
- `cadre/code_styleguides/`
- optional `cadre/repos.json` for polyrepo topology
- optional `cadre/lsp.json` for LSP recommendations

Setup also initializes Beads, can configure shared-sync merge attributes, and
can scaffold hosted CI checks when requested.

## Team And Repo Modes

Cadre supports monorepos and polyrepo control repos. For teams, use shared sync
so ownership, leases, review state, blockers, and available work are visible to
everyone. Product code publication still happens through ship/land workflows;
shared sync is for the Cadre control plane.

Compact MCP resources provide bounded views for larger teams:

- team board and next actions
- review queue and handoff inbox
- quality gate and parallel worker state
- repo topology, repo map, workspace diagnostics, test impact, and LSP status
- provider action plans and async job results

## Harness Development

This repository is the Cadre harness/package repo. Runtime sources live in
`src/`, master skill/protocol sources live in `skills/cadre/`, references live
in `scripts/agent-refs/`, and templates live in `templates/`.

Run package commands from this directory:

```bash
pnpm generate
pnpm check
```

Generated plugin bundles under `.agents/`, `.claude/`, and `plugins/` are
rebuilt from master sources. Edit the masters, then regenerate.

More detail:

- [Install & Version Guide](docs/INSTALL.md)
- [Platform Usage Guide](docs/PLATFORM_USAGE.md)
- [Polyrepo Guide](docs/POLYREPO.md)
- [MCP/LSP Guide](docs/MCP_LSP.md)
- [Parallel Execution Guide](docs/PARALLEL_EXECUTION.md)
