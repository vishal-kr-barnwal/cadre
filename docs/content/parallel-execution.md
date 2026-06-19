---
title: Parallel Execution
description: Phase annotations, worker waves, file claims, merge-back, and failure recovery.
section: Scale
order: 7
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
cadre_parallel { action: "next_wave" }
cadre_parallel { action: "setup_workers", execute: true }
dispatch exactly the returned workers
cadre_parallel { action: "record_finish", execute: true, ...workerEvidence }
cadre_parallel { action: "merge_back", execute: true }
cadre_parallel { action: "cleanup", execute: true }
```

Cadre returns ready groups only when dependencies, file claims, repo routing,
worker state, and plan integrity are safe.

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

The audit file is packet-owned. Agents should inspect packet output and compact
resources instead of editing worker state.

## Merge-Back

When a worker finishes, the coordinator records evidence and asks Cadre to
merge the worker branch back into the track worktree. After a clean merge,
Cadre can complete the task, update plan progress, record metadata, write Beads
notes, and close mapped Beads tasks through the same packet-owned path.

Cleanup removes merged workers. Failed or conflicted workers remain available
for recovery unless force cleanup is explicit.

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
