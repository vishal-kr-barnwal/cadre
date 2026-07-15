---
title: MCP Reference
description: Public tool schemas, root resolution, workflow envelopes, actions, and Cadre resource families.
section: Reference
order: 220
---

# MCP Reference

Cadre exposes exactly three public MCP tools. The installed skill shim directs
agents to start with a workflow, execute only the exact call in `next`, and read
only a relevant resource URI. Retired direct packet tools are not public
aliases.

## cadre_workflow

Starts or continues a workflow.

```json
{
  "root": "/absolute/project/path",
  "workflow": "review",
  "input": {},
  "execute": false
}
```

| Field | Required | Meaning |
|---|---|---|
| `root` | yes | Project root candidate or a path inside the project. |
| `workflow` | yes | A supported Cadre workflow ID such as `setup`, `implement`, or `review`. |
| `input` | no | Workflow-specific structured input. |
| `execute` | no | `false` previews/decides; `true` requests the confirmed mutation path. |
| `approval` | no | Nested staged-session control. `{session_id}` alone resumes and is not approval; after explicit approval, add the exact `decision.stage` and cumulative `approved_stages` prefix. |

For example, this fragment resumes the current stage without approving it:

```json
{
  "approval": {
    "session_id": "returned-session-id"
  }
}
```

After the user explicitly approves the active `product` stage, the approval
fragment records exactly that next prefix:

```json
{
  "approval": {
    "session_id": "returned-session-id",
    "stage": "product",
    "approved_stages": ["product"]
  }
}
```

Do not add `stage`, `approved_stages`, or `complete` to a session-only resume.
`complete:true` is valid only when every stage is included in the exact
cumulative prefix. Canonical/projection pairs and grouped stage files are
approved atomically. `decision.current_stage` identifies work during
clarification or formatting; never substitute it for `decision.stage` in an
approval.

The response contains the current decision, compact evidence, and at most one
deterministic next call. `next` is the sole immediate single-agent Cadre
continuation. When it is non-null, invoke exactly `next.tool` with
`next.arguments` once for that packet; do not infer a different continuation.

The typed callbacks outside `next` are limited to:

- After collecting requested clarification or formatted reference content,
  continue with the exact returned `decision.resume` data.
- After collecting requested evidence from an external provider integration,
  invoke `decision.required.write_back` with that evidence.
- For parallel fan-out, invoke each
  `data.workers[].dispatch.record_finish_packet` once with that worker's result.
- If worker completion or recovery remains pending, invoke only the exact calls
  reissued under `data.worker_callbacks[].record_finish_packet`.

These callbacks are not permission to derive other actions from response data
or prose. Merge, cleanup, polling, and every other immediate continuation must
arrive in a subsequent packet's `next` field.

`execute:true` is execution authorization for mutations and external side
effects. It does not stand in for document approval, and read-only workflows do
not require either field. In a staged workflow, Cadre returns an execution
continuation only after every stage is approved; invoke only that exact `next`.

## cadre_action

Executes a namespaced action returned by a workflow packet.

```json
{
  "root": "/absolute/project/path",
  "action": "task.complete",
  "input": {},
  "execute": true
}
```

Do not invent action names or use actions as an alternate workflow entry point.
The preceding packet owns action selection and required input. Conditions that
inspect an action continuation use `next.arguments.action`, not `next.action`.

## cadre_read

Reads one targeted Cadre resource:

```json
{
  "uri": "cadre://workspace-health?root=/absolute/project/path"
}
```

`cadre://template-inventory` is the only fixed, rootless resource. Project
resources validate their required query parameters, including `root`.

## MCP Lifecycle

The stdio server supports MCP protocol versions `2025-11-25` and `2025-06-18`.
A client sends `initialize`, accepts the negotiated version in the response,
then sends `notifications/initialized` before listing or calling tools and
resources. The server version is read from the installed `cadre-ai` package.

## Root Contract

Project-scoped calls require a root on every call. Cadre resolves the active
control repository internally. Setup-safe operations accept candidates before
`cadre/` exists. Callers must not cache a guessed root across unrelated tasks.

## Workflow Envelope

The compact v1 envelope contains:

- `ok`, `workflow`, `phase`, and `decision`;
- `required` input or evidence names;
- one immediate single-agent `next` tool call or `null`;
- bounded `artifacts` and relevant `resources`;
- workflow-specific summary fields under `data`;
- `warnings` and structured `errors`.

## Resource Families

| Family | Representative resources |
|---|---|
| Packaged templates | `cadre://template-inventory` |
| Team and status | `cadre://team-board`, `cadre://fleet-board`, `cadre://my-next-actions`, `cadre://review-queue`, `cadre://handoff-inbox` |
| Workspace intelligence | `cadre://workspace-health`, `cadre://repo-map`, `cadre://workspace-diagnostics`, `cadre://test-impact`, `cadre://collisions` |
| Integrations | `cadre://integrations`, `cadre://mcp-readiness`, `cadre://lsp-status`, `cadre://dap-status` |
| Track and review | `cadre://track-context`, `cadre://track-plan`, `cadre://track-spec`, `cadre://review-evidence`, `cadre://quality-gate` |
| Delivery | `cadre://provider-actions`, `cadre://ship-plan`, `cadre://land-plan` |
| Parallel and jobs | `cadre://parallel-state`, `cadre://job-result` |
| Artifacts | `cadre://artifact-catalog`, `cadre://artifact-schema`, `cadre://artifact-preview`, `cadre://artifact-sync-plan` |
| Project skills | `cadre://project-skills`, `cadre://project-skill`, `cadre://project-skill-source`, `cadre://styleguide-selection` |

Resource responses are JSON and may be intentionally bounded. Follow returned
pagination, selectors, or narrower resource links rather than requesting an
unbounded control-plane dump.

MCP discovery keeps the two resource kinds separate. `resources/list` returns
fixed URIs, currently only `cadre://template-inventory`.
`resources/templates/list` returns parameterized URI templates for
project-scoped resources. The source workflow protocols and agent guidance are
maintainer inputs; they are not MCP resources.

`cadre://project-skill-source` is capability-bound. Use only the short-lived,
tokenized URI returned by a `skill` workflow packet; callers cannot construct a
source URI from a project path alone or retarget its token to another file.
Authorization also fails if the source is symlinked or changes after the token
is issued.

## Compatibility Notes

The token-efficient v1 contract replaces older direct Cadre tool families; the
retired flat names are not compatibility aliases. Re-run `cadre install` after
upgrading so the client shim and MCP configuration match the packaged runtime.
Automation should branch on structured decisions and invoke only the returned
`next` call.
