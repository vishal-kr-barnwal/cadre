---
description: Manage track templates (Beads formulas) - list, show, create, wisp
---

# Cadre Formula

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Manage reusable track formulas using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "formula"` and the requested formula
   action, formula name, track id, or template payload.
3. For direct Beads formula operations exposed by MCP, call `cadre_beads` with the
   packet operation returned or requested by the workflow packet.
4. Summarize available formulas, generated draft tracks, or packet errors.

Template discovery, formula expansion, ephemeral exploration, and Beads
coordination must stay inside MCP packets.
