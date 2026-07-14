---
name: cadre
description: Packet-led context-driven development for Cadre projects and workflows.
---

# Cadre

Call `cadre_workflow` directly with one nested request:
`{root, workflow, input, execute, approval}`. The call itself verifies Cadre
and resolves the root. Follow the returned `decision` and load only returned
resource URIs. A non-null `next` is the sole typed continuation: invoke exactly
`next.tool` with `next.arguments`, at most once for that packet. It is the sole
immediate single-agent Cadre continuation. The only typed callbacks outside
`next` are `decision.required.write_back`, used after collecting the requested
external provider evidence, and each parallel worker's
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

Send `approval` only after explicit user approval of the current human-facing
document. Its canonical JSON/JSONL and generated projection are one immutable
review pair and never receive separate approvals. `execute:true` authorizes a
mutation or side effect; it is not document approval. If a packet is blocked,
report its error or requested narrowing; do not truncate or invent required
project-skill rules.
