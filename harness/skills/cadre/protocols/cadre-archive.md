---
description: Archive completed tracks
---

# Cadre Archive

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Archive completed or selected tracks using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "archive"` and the resolved root. Pass
   `trackId` when archiving one track; omit it to archive completed tracks.
3. Present the dry-run `tracks` list, packet warnings, and any cleanup scope
   returned by the packet; do not inspect or move Cadre track files manually.
4. To archive, call `cadre_workflow` again with `workflow: "archive"` and
   `execute: true` plus `humanConfirmed: true` after explicit approval.
5. Summarize archived track ids, packet warnings, and any packet errors.

All archive movement, index repair, and shared-control synchronization belongs to
the MCP packet. Product build/test commands are not part of this workflow.
