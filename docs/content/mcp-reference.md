---
title: MCP Reference
description: Public tool schemas, root resolution, workflow envelopes, actions, and Cadre resource families.
section: Reference
order: 220
---

# MCP Reference

Cadre 2.1.0 exposes three public MCP tools. The installed skill shim directs
agents to start with a workflow, execute only a returned action, and read only a
relevant resource URI.

## cadre_workflow

Starts or continues a workflow.

```json
{
  "root": "/absolute/project/path",
  "workflow": "review",
  "input": {},
  "execute": false,
  "approval": {}
}
```

| Field | Required | Meaning |
|---|---|---|
| `root` | yes | Project root candidate or a path inside the project. |
| `workflow` | yes | One workflow ID from the packaged skill contract. |
| `input` | no | Workflow-specific structured input. |
| `execute` | no | `false` previews/decides; `true` requests the confirmed mutation path. |
| `approval` | no | Explicit approval of the current human-facing document; canonical JSON and its projection are one pair. |

The response contains the current decision, compact evidence, and at most one
deterministic next call.

`execute:true` is execution authorization for mutations and external side
effects. It does not stand in for document approval, and read-only workflows do
not require either field.

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
The preceding packet owns action selection and required input.

## cadre_read

Reads one targeted Cadre resource:

```json
{
  "uri": "cadre://workspace-health?root=/absolute/project/path"
}
```

Packaged resources such as the skill contract and protocol catalog do not need
a project root. Project resources validate their required query parameters.

## Root Contract

Project-scoped calls require a root on every call. Cadre resolves the active
control repository internally. Setup-safe operations accept candidates before
`cadre/` exists. Callers must not cache a guessed root across unrelated tasks.

## Workflow Envelope

Fields vary by workflow, but the compact envelope can include:

- `ok`, workflow, phase, stage, and decision;
- approval stage, approved stages, and pending stages;
- one `next` tool call;
- bounded track, status, review, provider, or workspace summaries;
- project-skill selection and budget diagnostics;
- warnings and structured errors;
- resource URIs for larger evidence.

## Resource Families

| Family | Representative resources |
|---|---|
| Packaged contracts | `cadre://skill-contract`, `cadre://workflow-protocols`, `cadre://workflow-protocol`, `cadre://agent-references`, `cadre://template-inventory` |
| Team and status | `cadre://team-board`, `cadre://fleet-board`, `cadre://my-next-actions`, `cadre://review-queue`, `cadre://handoff-inbox` |
| Workspace intelligence | `cadre://workspace-health`, `cadre://repo-map`, `cadre://workspace-diagnostics`, `cadre://test-impact`, `cadre://collisions` |
| Integrations | `cadre://integrations`, `cadre://mcp-readiness`, `cadre://lsp-status`, `cadre://dap-status` |
| Track and review | `cadre://track-context`, `cadre://track-plan`, `cadre://track-spec`, `cadre://review-evidence`, `cadre://quality-gate` |
| Delivery | `cadre://provider-actions`, `cadre://ship-plan`, `cadre://land-plan`, `cadre://release-plan` |
| Parallel and jobs | `cadre://parallel-state`, `cadre://job-result` |
| Artifacts | `cadre://artifact-catalog`, `cadre://artifact-schema`, `cadre://artifact-preview`, `cadre://artifact-sync-plan` |
| Project skills | `cadre://project-skills`, `cadre://project-skill`, `cadre://project-skill-source`, `cadre://styleguide-selection` |

Resource responses are JSON and may be intentionally bounded. Follow returned
pagination, selectors, or narrower resource links rather than requesting an
unbounded control-plane dump.

## Compatibility Notes

The token-efficient v1 contract replaces older direct Cadre tool families for
installed clients. Re-run `cadre install` after upgrading so the client shim and
MCP configuration match the packaged runtime. Automation should branch on
structured decisions and returned next calls rather than legacy tool names.
