---
description: Initialize project with Cadre context-driven development
---

# Cadre Setup

This workflow is packet-only. Cadre MCP is mandatory even before `cadre/` exists.
If a required packet returns `ok:false`, halt and report the packet error. Do not
recreate Cadre control-plane, Beads, index, worktree, or provider state with shell
commands.

Initialize this project with context-driven development using the workflow
arguments and confirmed user context.

## Packet Flow

1. Call `cadre_project` with `action: "ping"` to confirm MCP availability.
2. Call `cadre_workflow` with `workflow: "setup"` and the root candidate. This is
   the only workflow packet allowed to run before a Cadre project marker exists.
3. Use the returned doctor report, workspace diagnostics, dependency graph, and
   LSP status to ask only for missing product, tech-stack, workflow, repo, Beads,
   and provider decisions.
4. When the user confirms the setup payload, call `cadre_workflow` with
   `workflow: "setup_scaffold"` and `execute: true`.
5. Summarize created files, Beads initialization, LSP/provider status, warnings,
   and the first recommended packet.

The packet owns all setup files, generated runtime assets, Beads initialization,
repo topology, merge-driver configuration, and validation repair.
