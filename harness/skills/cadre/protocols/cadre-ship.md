---
description: Rebase a reviewed track onto main, publish it, and prepare the PR
---

# Cadre Ship

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Ship a reviewed monorepo track using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "ship"` and the requested `trackId`.
3. Use the returned review gate, provider evidence, CI status, and warnings.
4. When the packet reports the workflow is ready to publish, call it again with
   `workflow: "ship"` and `execute: true`.
5. Summarize branch, review gate, provider artifact, CI state, and next packet.

The packet owns publication, provider-resource preparation, review metadata,
Beads shipping state, and control-plane synchronization. Product tests may run
before shipping when the packet or project workflow requires fresh verification.
