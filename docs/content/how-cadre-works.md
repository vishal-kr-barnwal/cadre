---
title: Core Concepts
description: Packet-owned workflows, MCP runtime, native Cadre memory, review gates, provider evidence, and code intelligence.
section: User Guide
order: 50
---

# Core Concepts

Cadre separates human-readable project context from deterministic state
operations. Agents read enough context to understand the work, but they use
Cadre MCP packets to inspect and mutate workflow state.

## Packet-Owned Workflows

Cadre workflows are packet-owned. A packet is a structured MCP operation that
owns one workflow checkpoint, such as setup, new-track creation, implementation
prep, review evidence, provider actions, parallel merge-back, or archive.

The operating rule is simple:

1. The agent activates the Cadre skill.
2. The agent calls `cadre_workflow` with a nested request.
3. The agent passes a per-call `root`.
4. Cadre MCP reads the needed state, performs the operation, and returns
   structured output.
5. The agent summarizes the packet result and invokes only the exact typed
   `next` call when one is returned.

Agents should not mutate `metadata.json`, `plan.json`, `tracks.json`, generated
projections, event/message logs, local wisps, parallel state, review verdicts,
or provider evidence by hand.

## Staged Review Previews

For workflows that require staged approval, Cadre separates review output from
final execution. Once prerequisite clarification is complete, a review-producing
dry-run freezes and writes only the active stage's deterministic artifact set to
its intended target paths, such as `cadre/product.md` or
`cadre/tracks/<id>/spec.json`. Later stages remain pending and unmaterialized.
The compact response returns the active review files under `artifacts`, where
each entry reports its path and, when applicable, `target_path` or
`review_path`.

That target preview is intentionally worktree-mutating so humans and agents can
use ordinary `git diff`. New files are marked intent-to-add so their content is
included without being staged. Materialization is not approval: Cadre asks for
one stage at a time, and every canonical/projection pair or grouped file set
owned by that stage remains one hash-pinned atomic review set. Setup therefore
advances through product, product guidelines, grouped technical context, and
workflow policy; new-track and revision reviews advance from spec to plan when
both are in scope.

`approval:{session_id}` alone resumes the active stage and never records
approval. After the user explicitly approves the exact active review set, the
client sends the returned `decision.stage` and the next cumulative
`approved_stages` prefix together with that decision's `stage_hash` and
`stage_revision`. The stamp binds approval to the reviewed bytes and becomes
stale when the stage changes. A clarification's `decision.current_stage` names
the work still being collected; it is not approval. Once a session exists,
clarification and reference-formatting responses use the exact returned
`decision.resume` so the same session and approved prefix are preserved.

Final `execute:true` verifies the frozen target files still match the reviewed
content and fails closed when either side of a pair drifted after approval. An
execution continuation is returned only after all stages are approved, and the
client invokes only that exact `next` call.

Projection repair itself never creates a projection-only approval. Callers
that need non-mutating review can pass `reviewOutputMode:"bundle"` or
`reviewBundleDir`; bundle responses keep the legacy manifest and temp file
paths.

## MCP Runtime

The `cadre-ai` npm package installs a dependency-free stdio MCP server:

```bash
cadre-mcp
```

The installed plugins are thin client entrypoints. They point supported clients
at the global `cadre-mcp` runtime, which embeds only the target-project
templates it needs at runtime. Skill contracts, workflow protocols, and agent
references remain source validation inputs rather than MCP resources.

The server exposes three packet-led tools:

| Surface | What it owns |
|---------|--------------|
| `cadre_workflow` | High-level setup, newtrack, implement, debug, status, review, ship, land, archive, release, handoff, refresh, revise, revert, flag, validate, formula, artifacts, and skill workflows. |
| `cadre_action` | Namespaced actions returned by workflows, including task completion, parallel coordination, review, intelligence, jobs, and artifact operations. |
| `cadre_read` | One targeted resource URI returned by a packet. |

Workflow packets use a compact common envelope with `phase`, `decision`,
`required`, at most one deterministic `next` call, artifact descriptors, and
relevant resource URIs. `next` is the sole immediate single-agent Cadre
continuation, and a client invokes exactly `next.tool` with `next.arguments`
once for that packet. The only deferred or fan-out callbacks are
`decision.resume` after requested clarification or reference formatting,
provider `decision.required.write_back` after external evidence collection, each
parallel worker's `data.workers[].dispatch.record_finish_packet`, and exact
completion or recovery callbacks reissued under
`data.worker_callbacks[].record_finish_packet`. There is no
fallback direct-tool alias. Detailed evidence is fetched explicitly rather
than embedded in every response.

Useful compact resources include `cadre://team-board`, `cadre://my-next-actions`,
`cadre://review-queue`, `cadre://handoff-inbox`, `cadre://quality-gate`,
`cadre://parallel-state`, `cadre://track-spec`, `cadre://artifact-catalog`,
`cadre://artifact-preview`, `cadre://artifact-sync-plan`,
`cadre://styleguide-selection`, `cadre://repo-map`, `cadre://repo-topology`,
`cadre://workspace-health`, `cadre://lsp-status`, `cadre://dap-status`, and
`cadre://integrations`.

Read the specific workspace, dependency, or LSP resource returned by the
workflow when detailed evidence is needed.

## Native Memory

Cadre owns durable task memory directly. Tracks and plans remain the work graph:
`metadata.json` is the epic-level record, `plan.json` phases and tasks are the
children, and `depends_on` plus task `depends` fields are the dependency graph.

During setup, Cadre initializes packet-owned native state. During track creation,
Cadre writes the spec, plan, metadata, learnings, generated projections, and an
event record. During implementation and review, packets record notes, blockers,
completion, tags, labels, handoffs, and operational details in native JSON/JSONL
files.

Durable packet writes also create Conventional Commit history. Product work uses
task-level product commits, while Cadre control-plane changes use
`cadre(workflow): subject` commits plus structured git notes under
`refs/notes/cadre`. Local wisps stay private until they are squashed or poured
into durable Cadre state.

This gives Cadre three useful properties:

- Work survives conversation compaction and session handoff.
- Task dependencies remain structured instead of buried in prose.
- Team boards combine Cadre metadata with native events, messages, review state,
  leases, blockers, and task progress.

In polyrepo projects, the control repo owns the shared Cadre state for every
product repo. Product repos do not receive separate workflow databases.

## Tracks And Plans

A Cadre track is the durable unit of work. Each track has:

| File | Role |
|------|------|
| `metadata.json` | Source of truth for track id, status, owner, reviewer, review state ids, worktree paths, and repo routing. |
| `spec.json` and `spec.md` | Canonical spec JSON plus generated projection for title, description, functional requirements, non-functional requirements, acceptance criteria, and out of scope. |
| `plan.json` and `plan.md` | Canonical plan JSON plus generated projection for phases, tasks, dependencies, file claims, repo annotations, and task completion markers. |
| `learnings.jsonl` and `learnings.md` | Append-only observations plus generated projection for later pattern promotion. |
| `handoff.json` and `HANDOFF.md` | Optional canonical handoff plus generated context for another session or teammate. |

`cadre/tracks.json` is the generated project-level track index. Cadre rebuilds
it from track metadata. Agents should use packets and metadata for live status.

Plan JSON fields drive scheduling:

```json
{
  "phase_index": 1,
  "title": "Phase 1: Core",
  "execution_mode": "parallel",
  "depends_on": [],
  "tasks": [
    {
      "task_index": 1,
      "task_key": "phase1_task1",
      "title": "Add token parser",
      "files": ["src/auth/token.ts", "src/auth/token.test.ts"]
    },
    {
      "task_index": 2,
      "task_key": "phase1_task2",
      "title": "Add session store",
      "files": ["src/auth/session.ts", "src/auth/session.test.ts"],
      "depends_on": ["phase1_task1"]
    }
  ]
}
```

Cadre parses the canonical JSON, detects file claims, checks dependencies, and
returns ready work. Generated Markdown projections display the same information
for human review only.

## Review Gates

Review is a stateful gate, not just a conversational review. `cadre-review`
collects:

- Track context and plan completion.
- Machine gate evidence such as typecheck, build, check, lint, and tests.
- Coverage evidence when configured.
- TODO/stub findings.
- Optional LSP/code-intelligence findings.
- Hosted provider requirements when `provider_mode` is `github` or `gitlab`.

The final verdict is written through Cadre packets. `cadre-ship` and
`cadre-land` re-check the review gate before publication so a stale approval
does not slip through.

## Provider Evidence

Hosted provider state is evidence, not the Cadre source of truth. In GitHub or
GitLab mode, PR/MR metadata, reviews, checks, and CI status must come from the
matching provider MCP and be written back through Cadre packets.

There is no workflow fallback to raw provider shell commands. If the required
provider MCP is unavailable, provider-dependent packets fail closed with
required evidence. After collecting that evidence, invoke only the returned
`decision.required.write_back` callback, then follow any new `next` call.

Local mode skips hosted provider evidence and keeps delivery local.

## Code Intelligence, LSP, And DAP

Cadre uses code intelligence to reduce blind spots:

- `repo_map` summarizes symbols and repo structure.
- `workspace_diagnostics` detects likely build/test adapters.
- `test_impact` maps changed files to likely tests and manifests.
- `dependency_graph` reports repo-qualified dependency edges.
- `lsp_setup` recommends language servers and can write `cadre/lsp.json`.
- `lsp_warm_review` reuses initialized language servers for repeated reviews.
- `dap_setup` recommends conservative debug adapter entries and can write
  `cadre/dap.json`.
- `dap_snapshot` launches or attaches through a configured Debug Adapter
  Protocol adapter, applies breakpoints, captures stack/variable/output
  evidence, then disconnects.
- `cadre://integrations` summarizes optional MCP availability and LSP
  and DAP coverage, so teams can see provider, code-search, issue, CI, logging,
  knowledge-base, language-server, and debugger support in one place.

LSP is optional. If `cadre/lsp.json` is absent, Cadre records that code
intelligence was skipped instead of blocking ordinary work.

Custom config names stay in the project control plane: Cadre accepts only
`cadre/lsp.json` or `cadre/lsp-*.json` for LSP and `cadre/dap.json` or
`cadre/dap-*.json` for DAP. Absolute, traversing, cross-purpose, and symlinked
config paths are rejected before a language server or debug adapter can start.

DAP is also optional and adapter-driven. Cadre can speak DAP to any configured
adapter, but language support depends on the adapter command installed for the
project. A snapshot selects an adapter and configuration already stored in the
project config; callers cannot provide an inline adapter command, and breakpoint
paths must remain inside the project. V1 snapshots are bounded diagnostics, not
a full interactive debugger.

## Failure Model

Packets fail closed when required state or evidence is missing. Common blocking
conditions include missing MCP, sync conflicts,
ownership conflicts, dependency gates, provider gates, failed review gates, and
invalid plan annotations.

Agents should retry only when a packet marks the operation retryable or
idempotent. Otherwise they report the packet's structured decision and errors.
