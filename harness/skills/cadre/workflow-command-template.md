---
name: "{{command}}"
description: "Use when the user invokes {{command}} or asks to start or continue the Cadre {{workflow}} workflow."
---

# {{command}}

Run Cadre's `{{workflow}}` workflow through its MCP packet.

1. Call `cadre_workflow` with project `root`, `workflow:"{{workflow}}"`, workflow
   `input`, and `execute:false`. Keep fields in `input`; omit `approval` initially.
2. Follow `decision`. If `next` is non-null, invoke exactly `next.tool` with `next.arguments`
   once. For clarification or formatting, fill only
   `decision.writable_paths` in `decision.resume`. For an explicit current-stage
   edit, do the same with `decision.amend`. Invoke the returned full call; its
   approval object contains only `session_id` and is not approval.
   A structured value replaces its path; send the complete object.
   Apply prompt `value_map` patches or `selected_id(s)` exactly, preserving
   `false` and `[]`; use custom text only when `allowCustom` is true.
3. Use `cadre_action`, `cadre_read`, provider write-back, worker completion,
   merge, or cleanup only through the exact returned typed call.
4. Generate and review only the current stage: `decision.stage` for approval or
   `decision.current_stage` for clarification and formatting. Later stages stay
   pending. After explicit user approval of the complete current stage, send
   its exact `stage`, `stage_hash`, `stage_revision`, and cumulative
   `approved_stages`. When no stage remains, invoke the exact returned `next`
   unchanged.

Do not infer later actions from prose, edit Cadre-owned state manually, or treat
Markdown projections as canonical input. If required project-skill rules do not
fit, report the requested narrowing instead of truncating them.
