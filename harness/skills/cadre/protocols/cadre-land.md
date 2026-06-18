---
description: Open and link the cross-repo PR group for a polyrepo track, then let the merge train land it
---

# Cadre Land

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Land a reviewed polyrepo track using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "land"` and the requested `trackId`.
3. Use the returned topology, polyrepo preflight, review gate, fleet status, and
   provider evidence.
4. When the packet reports the workflow is ready to execute provider actions, call
   it again with `execute: true`.
5. Summarize every repo result, linked review artifact, CI state, packet warnings,
   and next action.

The packet owns branch publication, provider-resource creation, cross-repo
linking, merge-train metadata, and control-plane synchronization.
