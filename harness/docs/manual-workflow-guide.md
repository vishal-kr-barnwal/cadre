# Manual Workflow Guide

This guide describes the Cadre workflow sequence for humans supervising an
agent. The implementation path is still packet-owned: ask the Cadre skill for
the workflow, let the agent call Cadre MCP, and inspect the returned packet
state, resources, and next actions.

## Before Any Workflow

The agent should verify Cadre MCP with `cadre_project` ping. For project-scoped
work, every packet must include `root`. If MCP is unavailable, stop and repair
the plugin/runtime before continuing.

## Setup

Ask for `cadre-setup` in the target project. The workflow gathers product,
tech-stack, topology, sync, provider, Beads, CI, and optional LSP preferences,
then executes setup through Cadre MCP.

Success means:

- `cadre/` context files exist
- Beads initialization is recorded
- `cadre/beads.json` and `cadre/config.json` exist
- shared sync and CI assets are configured when requested
- optional `cadre/lsp.json` is written when requested

## New Track

Ask for `cadre-newtrack "<description>"`. The packet returns planning evidence,
file-claim analysis, dependency hints, Beads tree evidence, and a worktree plan.
Approve only when acceptance criteria are testable, file annotations are clear,
and dependencies are explicit.

## Implement

Ask for `cadre-implement` with a track ID when needed. The packet selects or
claims a track, returns bounded context, style-guide selection, collision
evidence, and a phase schedule.

For parallel phases, use `cadre_parallel` packets for `next_wave`,
`setup_workers`, `record_finish`, `merge_back`, and `cleanup`. Workers are
dependency-aware and file-claim-aware.

## Complete A Task

After code is implemented and committed, use `cadre_complete_task`. The packet
runs or records verification, updates plan state, writes metadata, records
coverage, writes Beads notes, closes mapped Beads tasks, and keeps a recovery
journal.

## Status And Team Boards

Ask for `cadre-status` or read compact resources:

- team board
- mine/next actions
- available work
- review queue
- handoff inbox
- fleet board
- collision scan

Use these packet results to choose work or identify blockers.

## Review

Ask for `cadre-review`. The packet gathers track context, plan completion,
machine-gate evidence, TODO/stub findings, LSP evidence when enabled, and hosted
provider requirements. Local review can be ready while provider evidence is
pending; ship/land enforce hosted evidence when configured.

Record final review verdicts through Cadre packets so review gates can enforce
them later.

## Ship Or Land

Use `cadre-ship` for monorepo publication planning and `cadre-land` for
polyrepo publication planning. These packets return provider actions, git action
plans, continuation tokens, required evidence, and phase state.

Run hosted provider actions through official provider MCPs, then write the
normalized evidence back into Cadre.

## Handoff, Refresh, Revise, Revert, Archive, Release

- `cadre-handoff` writes resumable context for another session or teammate.
- `cadre-refresh` updates derived context, LSP setup recommendations, and
  project learning stamps.
- `cadre-revise` collects impact evidence before changing specs or plans.
- `cadre-revert` plans and executes tracked revert operations through the
  workflow packet.
- `cadre-archive` moves completed tracks into archive state and refreshes the
  derived index.
- `cadre-release` creates release artifacts from completed track metadata.

## Failure Handling

When a packet returns `ok:false`, follow its `stage`, `phase_state`,
`next_actions`, `sync_pre`, `sync_post`, and recovery evidence. Do not bypass
packet recovery by editing Cadre state manually.
