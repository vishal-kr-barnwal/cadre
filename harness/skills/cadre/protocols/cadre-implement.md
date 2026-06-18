---
description: Execute tasks from a track's implementation plan
---

# Cadre Implement

This workflow is packet-only for Cadre orchestration. Cadre MCP is mandatory. If
a required packet returns `ok:false`, halt and report the packet error. Do not
recreate Cadre control-plane, Beads, index, worktree, or provider state with
shell commands.

Implement the requested track from the workflow arguments. Product code edits,
project tests, builds, and product commits may use normal project commands when
the selected task requires them.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. Call `cadre_workflow` with `workflow: "implement"`, the resolved root, and the
   requested `trackId`. Pass `execute: true` when taking ownership.
3. Use the returned `prepare_implementation` and `phase_schedule` to choose the
   next packetized phase or task.
4. For parallel work, use `cadre_parallel` packets for planning, worker setup,
   next-wave selection, finish recording, merge-back, and cleanup.
5. After each task, call `cadre_complete_task` with coverage and commit evidence.
6. Summarize completed work, tests run, coverage, commits, and remaining packet
   actions.

Cadre progress is recorded only through task-completion and mutation packets. Do
not edit Cadre plan, metadata, Beads, or index files directly.
