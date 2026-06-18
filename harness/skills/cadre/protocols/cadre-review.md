---
description: Review a track's diff before shipping (quality gate)
---

# Cadre Review

This workflow is packet-only for Cadre orchestration. Cadre MCP is mandatory. If
a required packet returns `ok:false`, halt and report the packet error. Do not
recreate Cadre control-plane, Beads, index, worktree, or provider state with
shell commands.

Review the work on a track before it ships.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "review"` and the requested `trackId`.
3. Use the returned track context, review assistance, machine gate, review gate,
   and packet warnings as the review basis.
4. When provider evidence is required, call `cadre_review` with
   `action: "provider_evidence"` and include the returned evidence in the review
   summary.
5. To record a verdict, call `cadre_mutate` with `action: "record_review"` and the
   packet-derived verdict fields.
6. Summarize findings first, then gate state, evidence, and next packet.

LSP, provider checks, review labels, review metadata, and Beads review state are
packet-owned. Product test commands may run only to verify the product behavior
under review.
