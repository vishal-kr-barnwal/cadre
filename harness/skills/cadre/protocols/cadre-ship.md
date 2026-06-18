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
3. Use the returned review gate, `git_actions`, `provider_actions`,
   `phase_state`, `continuation_token`, CI status, and warnings.
4. When the packet reports `phase_state: "ready"` or `"pending_provider"`, call
   it again with `workflow: "ship"` and `execute: true` to run packet-owned git
   publication.
5. If the packet returns `phase_state: "pending_provider"`, execute the returned
   provider action specs through the official provider MCP. Then call
   `cadre_workflow` again with `workflow: "ship"`, `execute: true`,
   `continuationToken`, and normalized `providerEvidence`.
6. Summarize branch, review gate, provider artifact, CI state, and next packet.

The packet owns git publication, provider-resource specifications, review
metadata, Beads shipping state, and control-plane synchronization. Provider
resource creation and CI/review reads happen only through official provider MCPs.
Product tests may run before shipping when the packet or project workflow
requires fresh verification.
