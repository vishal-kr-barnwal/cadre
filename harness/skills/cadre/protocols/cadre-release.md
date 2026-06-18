---
description: Cut a local release - changelog plus version evidence across completed tracks
---

# Cadre Release

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Prepare release evidence from completed Cadre work using the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "release"` and any requested version bump
   or release scope.
3. Review the returned completed tracks, release evidence, warnings, and proposed
   release artifacts.
4. To write release artifacts, call `cadre_workflow` again with
   `workflow: "release"` and `execute: true`.
5. Summarize the release scope, version intent, generated artifacts, and remaining
   human publishing steps.

Release notes, version evidence, tags, and Cadre release metadata belong to MCP
packets. Product build and verification commands may run as project work before
the final release packet.
