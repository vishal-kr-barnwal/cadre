---
name: cadre
description: Packet-led context-driven development for Cadre projects and workflows.
---

# Cadre

Call `cadre_workflow` directly with the current root candidate, workflow name,
and structured `input`. The call itself verifies Cadre and resolves the root.
Follow the returned `decision`, load only returned resource URIs, and execute at
most the single returned `next` call.

Use `cadre_action` only for a namespaced action returned by a packet and
`cadre_read` only for a relevant resource. Cadre owns control-plane, approval,
provider, worker, merge, and generated-projection state. Never recreate that
state with shell commands or treat Markdown projections as canonical.

Send `approval` only after explicit user approval of the current stage. If a
packet is blocked, report its error or requested narrowing; do not truncate or
invent required project-skill rules.
