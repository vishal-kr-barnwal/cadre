---
description: Create a new feature or bug track with spec and plan
---

# Cadre New Track

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Create a new track from the workflow arguments.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Draft the spec and plan text from the user's request and current project
   context.
3. Call `cadre_workflow` with `workflow: "newtrack"`, `trackId`, `specText`,
   `planText`, and metadata. Treat the first call as a dry run unless the user has
   explicitly asked to create it now.
4. Review the returned spec, plan, metadata, learnings starter, plan assistance,
   Beads tree preview, worktree plan, and warnings with the user. Ask for
   corrections and wait for explicit approval before creating files or Beads
   tasks.
5. To create the track after approval, call `cadre_workflow` again with
   `workflow: "newtrack"`, `execute: true`, and `humanConfirmed: true`.
6. Summarize the created track id, Beads mapping, worktree plan, and next
   implementation packet.

The packet owns all track files, template-backed learnings, Beads
initialization, index refresh, and worktree orchestration metadata.
