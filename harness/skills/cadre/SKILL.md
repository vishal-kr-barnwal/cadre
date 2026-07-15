---
name: cadre
description: Run or continue Cadre packet-owned setup, planning, implementation, review, delivery, refresh, and project-skill workflows through the three-tool MCP contract. Use when a user invokes Cadre or asks to operate a Cadre-initialized project.
---

# Cadre

Call `cadre_workflow` directly with one nested request:
`{root, workflow, input, execute, approval}`. The call itself verifies Cadre
and resolves the root. Follow the returned `decision` and load only returned
resource URIs. A non-null `next` is the sole immediate continuation: invoke
exactly `next.tool` with `next.arguments`, at most once for that packet. The
typed deferred continuations outside `next` are an exact `decision.resume`
after collecting clarification or formatted reference content,
`decision.required.write_back` after collecting requested external provider
evidence, and each parallel worker's
`data.workers[].dispatch.record_finish_packet`, used once with that worker's
result. While workers remain incomplete or need recovery, Cadre reissues their
exact callbacks under `data.worker_callbacks[].record_finish_packet`. Never
infer a callback from prose or hardcode later merge or cleanup actions; a
subsequent packet returns those operations through `next` only when safe.

Use `cadre_action` only as `{root, action, input, execute}` for the namespaced
action returned by a packet. Use `cadre_read` only as `{uri}` for a relevant
resource. Cadre owns control-plane, approval, provider, worker, merge, and
generated-projection state. Never recreate that state with shell commands or
treat Markdown projections as canonical.

For staged workflows, collect and review only the current stage:
`decision.stage` for approval or `decision.current_stage` for clarification and
formatting. Later stages remain pending and unmaterialized. Treat every file in
the current stage as one atomic review set, including canonical/projection pairs
and grouped technical or reference files. `approval:{session_id}` alone resumes
the same session and is not approval. Only after explicit user approval send the
exact returned `stage`, `stage_hash`, `stage_revision`, and cumulative
`approved_stages` prefix. These values bind approval to the reviewed revision;
never reuse them after the stage changes. When no stage remains, invoke the
exact returned `next` unchanged; it carries execution and completion
authorization. Execution never substitutes for stage approval. If a
packet is blocked, report its error or requested narrowing; do not truncate or
invent required project-skill rules.
