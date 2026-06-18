# Polyrepo Routing And Worktrees

Cadre supports monorepo and polyrepo projects. Polyrepo topology, worktree
planning, branch routing, merge ordering, validation, and teardown are owned by
Cadre MCP packets.

## Topology

Call `cadre_project` with `action: "topology"` or the workflow packet requested
by the protocol. The packet reports whether the project is monorepo or polyrepo,
the control repo, enabled product repos, default repo, and any topology warnings.

If topology data is missing or invalid, halt on the packet error. Do not infer
repository layout by reading or rewriting Cadre state directly.

## Task Repository Routing

Plan tasks may carry repo annotations, and polyrepo metadata may carry per-repo
branch and worktree information. Agents consume this routing only through packet
results such as:

- `cadre_track` with `action: "context"`
- `cadre_track` with `action: "worktree_plan"`
- `cadre_parallel` worker packets
- `cadre_workflow` with `workflow: "ship"`, `workflow: "land"`, or
  `workflow: "validate"`

Task completion, commit evidence, repo-specific SHA evidence, and progress
recording go through `cadre_complete_task` or the packet named by the current
workflow result.

## Product Commands

Workers may run product implementation, verification, and commit commands inside
the repo/worktree path provided by a packet. These commands are for target
project code only. They must not mutate Cadre control-plane files, Beads state,
worktree topology, merge state, or cleanup state.

## Ship, Land, Revert, And Cleanup

Use `cadre_workflow` packets for ship, land, revert, archive, and release
operations. Use `cadre_parallel` packets for worker setup, merge-back, and
cleanup. If a packet returns a hard gate for missing submodules, branch state,
provider evidence, review state, or validation, halt and report it.
