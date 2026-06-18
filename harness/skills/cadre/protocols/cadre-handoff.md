---
description: Create context handoff for transferring implementation to next section/session
---

# Cadre Handoff

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Create or refresh a track handoff using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "handoff"` and any `trackId`, recipient,
   mode, or `handoffText` supplied by the user.
3. Review the returned `track_context`, Beads summary, and handoff path.
4. To write the handoff, call `cadre_workflow` again with `workflow: "handoff"`
   and `execute: true`.
5. Summarize the handoff path, recipient or audience, open risks, and next
   recommended packet.

The packet owns handoff file writes, recipient routing, Beads coordination, and
shared-control updates.
