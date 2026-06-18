---
description: Validate Cadre project integrity
---

# Cadre Validate

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Validate Cadre integrity for a monorepo or polyrepo project.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "validate"` and any requested track or
   fleet scope.
3. Use the returned doctor report, team inventory, plan integrity, collision scan,
   fleet status, and Beads summary.
4. When packet-supported repair is requested, call the workflow packet again with
   `execute: true` and the requested repair scope.
5. Summarize errors before warnings, then repaired items, remaining risks, and
   next packets.

Validation repair, generated-asset checks, provider evidence, Beads health, LSP
coverage, and fleet checks belong to MCP packets. Product test commands may run
as independent quality evidence, not as Cadre state repair.
