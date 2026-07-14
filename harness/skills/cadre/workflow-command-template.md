---
name: "{{command}}"
description: "Use when the user invokes {{command}} or asks to start or continue the Cadre {{workflow}} workflow."
---

# {{command}}

Start or continue Cadre's `{{workflow}}` workflow through the packet-owned MCP
contract.

1. Call `cadre_workflow` with one nested request containing the resolved
   project `root`, `workflow:"{{workflow}}"`, workflow-specific `input`, and
   `execute:false`. Keep workflow fields inside `input` and omit `approval` on
   the initial call.
2. Follow the returned `decision`. If `next` is non-null, invoke exactly
   `next.tool` with `next.arguments` once for that packet.
3. Use `cadre_action` and `cadre_read` only when the packet returns that exact
   action or resource. Outside `next`, use only an exact returned
   `decision.required.write_back`, `data.workers[].dispatch.record_finish_packet`,
   or `data.worker_callbacks[].record_finish_packet`; never invent merge or
   cleanup callbacks.
4. Send `approval` only after explicit user approval of the current reviewed
   document and its canonical pair. Treat `execute:true` as mutation
   authorization, not approval.

Do not infer later actions from prose, edit Cadre-owned state manually, or treat
Markdown projections as canonical input. If required project-skill rules do not
fit, report the requested narrowing instead of truncating them.
