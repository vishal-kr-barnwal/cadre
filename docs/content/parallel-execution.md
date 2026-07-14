---
title: Parallel Execution
description: Phase annotations, worker waves, file claims, merge-back, and failure recovery.
section: User Guide
order: 80
---

# Parallel Execution

Cadre can run safe portions of a plan in parallel. The scheduler is conservative
by design: it dispatches only work that has explicit dependencies satisfied and
non-overlapping file claims.

## Sequential Default

Without annotations, phases run sequentially and each phase runs one unfinished
task at a time:

```text
Phase 1 -> Phase 2 -> Phase 3
Task 1 -> Task 2 -> Task 3
```

This keeps existing plans compatible.

## Parallel Plan Annotations

Phases can opt into parallel task execution:

```markdown
## Phase 1: Core Auth
<!-- execution: parallel -->

- [ ] Task 1: Add OAuth provider module
  <!-- files: src/auth/oauth.ts, src/auth/oauth.test.ts -->

- [ ] Task 2: Add session module
  <!-- files: src/auth/session.ts, src/auth/session.test.ts -->

- [ ] Task 3: Add auth config
  <!-- files: src/config/auth.ts -->
  <!-- depends: task1 -->
```

Phase annotations:

| Annotation | Purpose |
|------------|---------|
| `<!-- execution: parallel -->` | Tasks in the phase can dispatch concurrently when safe. |
| `<!-- execution: sequential -->` | Tasks in the phase run one at a time. |
| `<!-- depends: phase1, phase2 -->` | Phase waits for specific previous phases. |
| `<!-- depends: -->` | Phase has no phase dependency and can start as soon as its own tasks are ready. |

Task annotations:

| Annotation | Purpose |
|------------|---------|
| `<!-- files: path1, path2 -->` | Files the task expects to modify. |
| `<!-- depends: task1, task2 -->` | Same-phase task dependencies. |
| `<!-- repo: api -->` | Polyrepo product repo ownership. |

If a phase omits `<!-- depends: -->`, it depends on all previous phases.

## Scheduler

`cadre-implement` calls Cadre packets for scheduling. The agent does not parse
the Markdown and spawn workers on its own.

The coordinator loop is:

```text
cadre_workflow {"root":"/path/to/project","workflow":"implement","input":{"trackId":"checkout","agentIdentifier":"codex"},"execute":false}
invoke exactly response.next.tool with response.next.arguments when next is non-null
when a response contains data.workers, dispatch exactly those packet-owned payloads
submit each worker result once through that worker's data.workers[].dispatch.record_finish_packet
when Cadre returns data.worker_callbacks, use those exact reissued completion or recovery callbacks
after every response, invoke only its newly returned next call when non-null
```

Cadre returns ready groups only when dependencies, file claims, repo routing,
worker state, and plan integrity are safe.
Worker setup requires `agentIdentifier` and returns a single
`selected_dispatch` adapter for that caller. Valid identifiers are `codex`,
`claude`, `copilot`, and `antigravity`. The coordinator never derives merge or
cleanup actions from this guide; Cadre returns each safe immediate operation in
the preceding call's `next` field.

Dispatch adapters are client-specific:

| Client | Adapter |
|--------|---------|
| Codex | `multi_agent_v1.spawn_agent` |
| Claude | `Task` |
| Copilot | Copilot CLI custom agent; `/fleet` is allowed only when each worker still returns Cadre evidence. |
| Antigravity | `invoke_subagent` or a dynamically defined Cadre worker subagent. |

## Worker Payloads

Each worker receives a bounded payload:

```text
Track: <track_id>
Phase: <phase_name>
Task: <task_description>
Repo root/worktree: <worker_worktree>
Owned files:
  <files>
```

Workers follow canonical `cadre/workflow.json`, modify only their owned files,
keep commits local, and return evidence to the coordinator:

```json
{
  "worker_id": "worker_1_auth",
  "task_key": "phase1_task1",
  "commit_sha": "abc1234",
  "tests": ["npm test -- auth"],
  "coverage": 84.2,
  "files_changed": ["src/auth/oauth.ts", "src/auth/oauth.test.ts"],
  "notes": ["Added token refresh edge case"]
}
```

Workers do not edit Cadre state directly.
For each returned worker, map its structured result into that worker's exact
`dispatch.record_finish_packet` placeholders and invoke the packet once. Do not
construct a finish action from the example result or reuse one worker's callback
for another worker. If other workers remain incomplete or enter `blocked`,
`failed`, or `conflict`, the latest response is self-contained: it returns exact
completion or recovery calls under `data.worker_callbacks[].record_finish_packet`.
Cadre returns merge and cleanup through `next` only after the resulting worker
state proves every worker is ready for that transition.

The callback's `status` placeholder must be filled from the worker result as
either `awaiting_merge` or `blocked`. `awaiting_merge` requires a commit SHA;
`blocked` may use a null commit and must retain the worker's blockers.

## File Claims

File claims prevent two workers from changing the same file at the same time.
Cadre compares task-level `<!-- files: -->` annotations before dispatch.

If two ready tasks claim the same file, Cadre does not dispatch them together.
The plan can be revised, dependencies can be made explicit, or the phase can
fall back to sequential execution.

In polyrepo mode, claims are repo-scoped. `api/src/user.ts` and
`web/src/user.ts` are different claims because their `(repo, file)` tuples
differ.

## Worker States

Parallel worker records move through states such as:

- `in_progress`
- `awaiting_merge`
- `merged`
- `failed`
- `conflict`

After successful cleanup, a worker remains `merged` for scheduling history, but
its live `worktree` and `worker_ref` fields are cleared. Cadre retains
`cleaned_worktree`, `cleaned_worker_ref`, and cleanup timestamps for auditability,
so later waves do not retry already-completed cleanup commands.

The audit file is packet-owned. Agents should inspect packet output and compact
resources instead of editing worker state.

## Merge-Back

Each worker's typed finish callback records its evidence. The callback response
decides whether another worker is still outstanding, recovery is required, or
a merge is now safe. The coordinator invokes only a non-null `next` returned by
that response. A later packet may similarly return cleanup through `next` after
a clean merge; callers never precompute either operation. Failed or conflicted
workers remain available for packet-directed recovery.

## Failure Recovery

Typical failure handling:

| Failure | Cadre behavior |
|---------|----------------|
| Worker timeout | Records timeout, releases or blocks ownership according to packet result, and reports retry steps. |
| Worker error | Records failure evidence and blocks dependent work. |
| Runtime file conflict | Marks conflict and returns recovery options. |
| Merge conflict | Leaves worker state for human or coordinator recovery. |
| Missing evidence | Refuses completion until required commit, test, or coverage evidence exists. |

Recovery should always go through Cadre packets.
