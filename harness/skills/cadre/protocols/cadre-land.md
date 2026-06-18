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
3. Use the returned topology, polyrepo preflight, review gate, fleet status,
   `git_actions`, `provider_actions`, `phase_state`, `continuation_token`, and
   provider evidence requirements.
4. When the packet reports `phase_state: "ready"` or `"pending_provider"`, call
   it again with `workflow: "land"` and `execute: true` to run packet-owned
   repo-scoped git publication.
5. If the packet returns `phase_state: "pending_provider"`, execute the returned
   provider action specs through the official provider MCP. Then call
   `cadre_workflow` again with `workflow: "land"`, `execute: true`,
   `continuationToken`, and normalized `providerEvidence`.
6. Summarize every repo result, linked review artifact, CI state, packet warnings,
   and next action.

The packet owns branch publication, provider-resource specifications, cross-repo
linking metadata, merge-train metadata, and control-plane synchronization.
Provider resource creation and CI/review reads happen only through official
provider MCPs.
