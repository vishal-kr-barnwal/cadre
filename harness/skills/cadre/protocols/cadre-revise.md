---
description: Update spec/plan when implementation reveals issues
---

# Cadre Revise

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Revise a track's spec or plan when implementation reveals new information.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "revise"` and the requested `trackId`,
   files, symbols, or impact scope.
3. Use the returned track context and impact analysis to draft the proposed
   revision.
4. When packet-supported mutation is requested, call the workflow packet again
   with the revised `specText` or `planText` payload as a dry run first. Review
   `review_bundle` when present so the full revised files stay on disk instead
   of in model context. After approval, call the workflow packet again with the
   confirmed payload, `execute: true`, and `humanConfirmed: true`.
5. Summarize the changed requirement, affected tasks, tests to update, and packet
   warnings.

Spec, plan, Beads, and index mutations belong to MCP packets. Product code edits
remain part of implementation workflows, not revise itself.
