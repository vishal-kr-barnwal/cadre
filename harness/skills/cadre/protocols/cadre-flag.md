---
description: Flag the current task as blocked or skipped with a reason
---

# Cadre Flag

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Flag a track or task as blocked, skipped, or otherwise statused using the
workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "flag"`, the resolved root, and any
   `trackId`, `status`, `reason`, `taskId`, `note`, or assignee fields supplied by
   the user.
3. Present the dry-run status change, selected track, reason, and packet
   warnings for explicit confirmation; do not edit metadata, Beads, or indexes
   manually.
4. When mutation is intended, pass `execute: true` and `humanConfirmed: true` so
   the packet records the status and Beads synchronization.
5. Summarize the selected track, resulting status, reason, and packet warnings.

The packet owns ownership checks, status writes, Beads labels or notes, and index
refresh. If the packet cannot determine the active track, ask the user for a
track id and call the packet again.
