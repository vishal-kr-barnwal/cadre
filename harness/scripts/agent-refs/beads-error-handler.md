# Beads Packet Error Handling

Cadre MCP is mandatory for every workflow that touches Cadre or Beads state. If
a packet that owns Beads state returns `ok:false`, halt and report the packet
error. Do not inspect or repair the Beads store with shell commands from the
workflow prompt.

## Standard Response

When a required Cadre packet reports a Beads-related error:

1. Summarize the packet name, requested action, and packet error.
2. If the packet result marks the operation as retryable or idempotent, retry the
   same packet once with the same inputs.
3. If the retry fails, halt and ask the user to restore the Cadre MCP or Beads
   prerequisite named by the packet.

## No Degraded Mode

Do not continue in a file-only mode. Durable task graph state, ownership claims,
handoff routing, review labels, and compaction survival are packet-owned. If the
packet cannot update them, the workflow is blocked.

## Packet Routing

- Use `cadre_beads` only when a Cadre packet result explicitly asks for a Beads
  operation.
- Use `cadre_workflow`, `cadre_mutate`, `cadre_complete_task`, `cadre_parallel`,
  or `cadre_project` for higher-level workflows instead of reconstructing Beads
  state.
- Product implementation commands may still run when they are part of the target
  project work and not Cadre orchestration.
