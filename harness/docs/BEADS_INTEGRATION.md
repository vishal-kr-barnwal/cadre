# Cadre And Beads Integration

> Status: Implemented
> Cadre Version: 2.0.0

## Overview

Cadre integrates with Beads through Cadre MCP packets. Agents never operate the
Beads store directly from workflow prompts. Beads remains the durable task graph;
Cadre MCP owns every read, write, claim, dependency, note, close, sync, and
repair operation that touches that graph.

## Design Principles

1. Cadre owns planning, specs, workflow policy, and human-readable context.
2. Beads owns durable task graph state and cross-session task memory.
3. Cadre MCP is the only workflow-facing integration layer.
4. If a required packet returns `ok:false`, the workflow halts with the packet
   error.
5. In polyrepo projects, the control repo owns the single shared Beads graph for
   all product repos.

## Packet Responsibilities

- `cadre_workflow` coordinates setup, new-track creation, implementation,
  status, review, validation, handoff, ship, land, archive, release, revise,
  refresh, flag, revert, and formula flows.
- `cadre_track` exposes track context, plan parsing, implementation prep,
  phase scheduling, Beads tree creation, and worktree plans.
- `cadre_parallel` owns worker-wave planning, worker setup, finish records,
  merge-back, and cleanup.
- `cadre_complete_task` owns task completion, coverage gates, commit evidence,
  plan progress, metadata updates, and Beads completion notes.
- `cadre_beads` is the low-level packet used only when another Cadre packet or
  implementation code explicitly needs a Beads operation.
- `cadre_project` owns doctor, topology, control-plane sync, and polyrepo
  preflight checks.

## Workflow Mapping

Setup initializes Cadre context and Beads configuration through
`cadre_workflow`. The setup packet copies bundled templates, writes selected code
style guides, and reports any missing payload or style guide ids.

New-track creation uses `cadre_workflow` to preview and then create the track,
including track files, Beads task mapping, dependency previews, and index
refresh.

Implementation uses `cadre_workflow` for preparation, `cadre_parallel` for
parallel worker orchestration, and `cadre_complete_task` for task completion
evidence. Product code commands may run inside worker scope; Cadre state changes
remain packet-owned.

Status, review, validation, handoff, ship, land, archive, release, revise,
refresh, flag, revert, and formula workflows use their corresponding
`cadre_workflow` packet routes. Agents summarize packet results and stop when
the packet blocks.

## Session Memory

Structured implementation notes, blockers, decisions, review evidence, and
handoff context are recorded by packets. This keeps state durable across
conversation compaction while preserving Cadre's human-readable project context.

## Failure Policy

There is no prompt-side degraded mode. Missing MCP, unavailable Beads support,
sync failures, ownership conflicts, dependency gates, provider gates, and
validation failures are surfaced through packet results. Agents may retry only
when the packet marks the operation retryable or idempotent; otherwise they halt
and report the packet error.
