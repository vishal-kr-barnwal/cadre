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
3. Use the returned doctor report, workspace diagnostics, dependency graph, LSP
   status, and tech-stack summary to ask only for missing product, structured
   tech-stack JSON, workflow, repo topology, Beads, LSP, CI, and provider
   decisions.
4. Present the returned setup review artifacts to the user using
   `review_bundle` when present. The bundle contains full dry-run files and a
   manifest on disk so clients can open or render the proposed `product.md`,
   `product_guidelines.md`, `tech-stack.json`, `workflow.md`, `patterns.md`,
   selected style guides, and topology artifacts without pasting whole file
   contents into the model context. Show the manifest/path list and any packet
   warnings; do not replace the file review with a prose summary. Ask for
   corrections and wait for explicit approval before writing.
5. When the user confirms the setup payload and review artifacts, call
   `cadre_workflow` with
   `workflow: "setup_scaffold"`, `productText`, structured `techStack`, and
   `execute: true`, and `humanConfirmed: true`. Include any confirmed
   `styleGuideIds`; do not drop the user-supplied list to hide setup warnings.
   For polyrepo setup, include the confirmed `repos` payload and topology/CI
   options returned or requested by the packet. For LSP setup, pass `lsp: true`
   or use `cadre_intel` with `action: "lsp_setup"` when setup recommendations
   need a separate review/write step.
6. Summarize created files, selected code style guides, Beads initialization,
   LSP/provider status, warnings, and the first recommended packet.

The packet owns all setup files, generated runtime assets, Beads initialization,
repo topology, merge-driver configuration, and validation repair.
Use `cadre_project` with `action: "tech_stack_summary"` for a human-readable
summary of `cadre/tech-stack.json`.
