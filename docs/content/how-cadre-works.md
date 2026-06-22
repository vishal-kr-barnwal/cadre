---
title: How Cadre Works
description: Packet-owned workflows, MCP runtime, Beads memory, review gates, provider evidence, and code intelligence.
section: Core Concepts
order: 3
---

# How Cadre Works

Cadre separates human-readable project context from deterministic state
operations. Agents read enough context to understand the work, but they use
Cadre MCP packets to inspect and mutate workflow state.

## Packet-Owned Workflows

Cadre workflows are packet-owned. A packet is a structured MCP operation that
owns one workflow checkpoint, such as setup, new-track creation, implementation
prep, review evidence, provider actions, parallel merge-back, or archive.

The operating rule is simple:

1. The agent activates the Cadre skill.
2. The workflow protocol tells the agent which packet to call.
3. The agent passes a per-call `root`.
4. Cadre MCP reads the needed state, performs the operation, and returns
   structured output.
5. The agent summarizes the packet result and follows returned next actions.

Agents should not mutate `metadata.json`, `plan.json`, `tracks.json`, generated
projections, Beads tasks, parallel state, review verdicts, or provider evidence
by hand.

## MCP Runtime

The `cadre-ai` npm package installs a dependency-free stdio MCP server:

```bash
cadre-mcp
```

The generated plugins are thin client entrypoints. They point Claude Code and
OpenAI Codex at the global `cadre-mcp` runtime, which embeds Cadre contracts,
workflow protocols, references, and target-project templates.

The server exposes workflow tools and compact resources. Important tool groups
include:

| Surface | What it owns |
|---------|--------------|
| `cadre_workflow` | High-level setup, newtrack, implement, status, review, ship, land, archive, release, handoff, refresh, revise, revert, flag, validate, formula, and artifact-sync aliases. |
| `cadre_project` | Runtime ping, doctor output, root resolution, integrations inventory, shared sync, and polyrepo preflight. |
| `cadre_track` | Track context, plan parsing, phase scheduling, integrity, Beads tree creation, and worktree planning. |
| `cadre_mutate` | Controlled state updates such as claim, heartbeat, metadata patch, review record, task result, worker state, status, and index regeneration. |
| `cadre_complete_task` | Verification, coverage gate, plan progress, metadata, and Beads completion in one path. |
| `cadre_parallel` | Worker waves, setup, finish records, merge-back, and cleanup. |
| `cadre_review` | Review assist, machine gate, provider evidence, PR/CI status, and final gate evaluation. |
| `cadre_intel` | Repo map, workspace diagnostics, dependency graph, test impact, LSP setup, LSP impact, and warm review. |
| `cadre_artifact` | Canonical artifact catalog, schema, validation, projection rendering, diff, and sync. |
| `cadre_beads` | Structured low-level Beads operations used by packets. |

Useful compact resources include `cadre://team-board`, `cadre://my-next-actions`,
`cadre://review-queue`, `cadre://handoff-inbox`, `cadre://quality-gate`,
`cadre://parallel-state`, `cadre://track-spec`, `cadre://artifact-catalog`,
`cadre://artifact-preview`, `cadre://artifact-sync-plan`,
`cadre://styleguide-selection`, `cadre://repo-map`, `cadre://repo-topology`,
`cadre://workspace-health`, and `cadre://integrations`.

`cadre://workspace-health` is compact by default. Use
`responseMode=detail` when you need the full workspace, dependency graph, and
LSP inventory.

## Beads Memory

Beads owns durable task memory. Cadre owns how agents interact with it.

During setup, Cadre initializes Beads and records integration settings. During
track creation, Cadre maps the spec and plan into a Beads tree with epic, phase,
task, and dependency nodes. During implementation and review, packets record
notes, blockers, completion, labels, and handoff details.

This gives Cadre three useful properties:

- Work survives conversation compaction and session handoff.
- Task dependencies remain structured instead of buried in prose.
- Team boards can combine Cadre metadata with Beads task state.

In polyrepo projects, the control repo owns one shared Beads graph for every
product repo. Product repos do not receive their own `.beads/` directories.

## Tracks And Plans

A Cadre track is the durable unit of work. Each track has:

| File | Role |
|------|------|
| `metadata.json` | Source of truth for track id, status, owner, reviewer, review state, Beads ids, worktree paths, and repo routing. |
| `spec.json` and `spec.md` | Canonical spec JSON plus generated projection for title, description, functional requirements, non-functional requirements, acceptance criteria, and out of scope. |
| `plan.json` and `plan.md` | Canonical plan JSON plus generated projection for phases, tasks, dependencies, file claims, repo annotations, and task completion markers. |
| `learnings.jsonl` and `learnings.md` | Append-only observations plus generated projection for later pattern promotion. |
| `handoff.json` and `HANDOFF.md` | Optional canonical handoff plus generated context for another session or teammate. |

`cadre/tracks.json` is the generated project-level track index. Cadre rebuilds
it from track metadata. Agents should use packets and metadata for live status.

Plan JSON fields drive scheduling:

```json
{
  "phase_index": 1,
  "title": "Phase 1: Core",
  "execution_mode": "parallel",
  "depends_on": [],
  "tasks": [
    {
      "task_index": 1,
      "task_key": "phase1_task1",
      "title": "Add token parser",
      "files": ["src/auth/token.ts", "src/auth/token.test.ts"]
    },
    {
      "task_index": 2,
      "task_key": "phase1_task2",
      "title": "Add session store",
      "files": ["src/auth/session.ts", "src/auth/session.test.ts"],
      "depends_on": ["phase1_task1"]
    }
  ]
}
```

Cadre parses the canonical JSON, detects file claims, checks dependencies, and
returns ready work. Generated Markdown projections display the same information
for human review only.

## Review Gates

Review is a stateful gate, not just a conversational review. `cadre-review`
collects:

- Track context and plan completion.
- Machine gate evidence such as typecheck, build, check, lint, and tests.
- Coverage evidence when configured.
- TODO/stub findings.
- Optional LSP/code-intelligence findings.
- Hosted provider requirements when `provider_mode` is `github` or `gitlab`.

The final verdict is written through Cadre packets. `cadre-ship` and
`cadre-land` re-check the review gate before publication so a stale approval
does not slip through.

## Provider Evidence

Hosted provider state is evidence, not the Cadre source of truth. In GitHub or
GitLab mode, PR/MR metadata, reviews, checks, and CI status must come from the
matching provider MCP and be written back through Cadre packets.

There is no workflow fallback to raw provider shell commands. If the required
provider MCP is unavailable, provider-dependent packets fail closed with
required evidence and next actions.

Local mode skips hosted provider evidence and keeps delivery local.

## Code Intelligence And LSP

Cadre uses code intelligence to reduce blind spots:

- `repo_map` summarizes symbols and repo structure.
- `workspace_diagnostics` detects likely build/test adapters.
- `test_impact` maps changed files to likely tests and manifests.
- `dependency_graph` reports repo-qualified dependency edges.
- `lsp_setup` recommends language servers and can write `cadre/lsp.json`.
- `lsp_warm_review` reuses initialized language servers for repeated reviews.
- `cadre://integrations` summarizes optional MCP availability and LSP
  coverage, so teams can see provider, code-search, issue, CI, logging, and
  knowledge-base support in one place.

LSP is optional. If `cadre/lsp.json` is absent, Cadre records that code
intelligence was skipped instead of blocking ordinary work.

## Failure Model

Packets fail closed when required state or evidence is missing. Common blocking
conditions include missing MCP, unavailable Beads support, sync conflicts,
ownership conflicts, dependency gates, provider gates, failed review gates, and
invalid plan annotations.

Agents should retry only when a packet marks the operation retryable or
idempotent. Otherwise they report the packet error and next actions.
