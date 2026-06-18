---
description: Sync context docs with current codebase state
---

# Cadre Refresh

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Refresh Cadre context from the current codebase using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "refresh"` and any scope requested by the
   user.
3. Use the returned doctor, workspace diagnostics, dependency graph, and LSP
   status to decide what context needs refreshing.
4. When packet-supported document updates are requested, call the workflow packet
   again with `execute: true`.
5. Summarize refreshed context, stale areas, diagnostics, and packet warnings.

Codebase analysis may inspect product files, but Cadre context writes and
control-plane synchronization must be packetized.
