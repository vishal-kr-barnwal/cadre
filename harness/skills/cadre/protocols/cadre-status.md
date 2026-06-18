---
description: Display current Cadre project progress
---

# Cadre Status

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Show the current Cadre project status using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "status"` and a `mode` such as `live`,
   `team`, `fleet`, `available`, `collisions`, `beads`, or `doctor`.
3. For rich resources, read the matching MCP resource when useful:
   `cadre://team-board`, `cadre://fleet-board`, `cadre://beads-summary`,
   `cadre://collisions`, or `cadre://workspace-diagnostics`.
4. Summarize active track, ownership, blockers, review queue, fleet health, and
   packet warnings.

Status, index repair, Beads summaries, provider evidence, team board, and fleet
board must come from MCP packets or MCP resources.
