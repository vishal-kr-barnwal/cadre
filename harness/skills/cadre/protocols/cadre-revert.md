---
description: Revert tracks, phases, or tasks through Cadre packets
---

# Cadre Revert

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Prepare or execute a revert of Cadre-tracked work using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "revert"` and the requested `trackId`,
   phase, task, or commit evidence.
3. Present the packet's revert scope, affected files, state changes, and risk
   summary for explicit user confirmation when changes would be destructive.
4. To execute an approved revert, call `cadre_workflow` again with
   `workflow: "revert"` and `execute: true`.
5. Summarize reverted scope, tests requested or run, packet warnings, and any
   unresolved risks.

The packet owns history analysis, Cadre state updates, Beads synchronization, and
index refresh. Product test commands may run after the revert packet changes
product code.
