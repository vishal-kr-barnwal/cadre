# Parallel Task Execution Design

## Overview

This document describes the architecture for parallel task/phase execution in Cadre, inspired by [swarm-tools](https://github.com/joelhooks/swarm-tools).

## Current State (Sequential)

```
Phase 1 → Phase 2 → Phase 3
  ↓
Task 1 → Task 2 → Task 3 (within each phase)
```

**Total time = sum of all tasks**

## Proposed State (Parallel-capable)

```
       ┌─ Task 1A (files: auth.ts)     ─┐
Phase 1├─ Task 1B (files: config.ts)   ─┼→ Phase 1 Complete
       └─ Task 1C (files: utils.ts)    ─┘
                    │
       ┌─ Task 2A (files: api.ts)      ─┐
Phase 2├─ Task 2B (files: models.ts)   ─┼→ Phase 2 Complete
       └─ Task 2C depends on 2A        ─┘
```

**Total time = max of parallel tasks + sequential dependencies**

---

## Plan.md Format Changes

### Current Format

```markdown
## Phase 1: Setup

- [ ] Task 1: Create auth module
- [ ] Task 2: Create config module
- [ ] Task 3: Create utils module
```

### New Format (Parallel-aware)

```markdown
## Phase 1: Setup
<!-- execution: parallel -->

- [ ] Task 1: Create auth module
  <!-- files: src/auth.ts, src/auth.test.ts -->
  
- [ ] Task 2: Create config module
  <!-- files: src/config.ts -->
  
- [ ] Task 3: Create utils module
  <!-- files: src/utils.ts -->
  <!-- depends: task1 -->

## Phase 2: UI Components
<!-- execution: parallel -->
<!-- depends: -->
<!-- (No phase dependency = can run parallel with Phase 1) -->

- [ ] Task 1: Create login page
  <!-- files: src/pages/login.tsx -->

## Phase 3: Integration
<!-- execution: sequential -->
<!-- depends: phase1, phase2 -->

- [ ] Task 1: Wire up auth with UI
```

### Metadata Annotations

#### Phase-Level Annotations

| Annotation | Purpose | Example |
|------------|---------|---------|
| `<!-- execution: parallel \| sequential -->` | Task execution mode within phase | `<!-- execution: parallel -->` |
| `<!-- depends: phase1, phase2 -->` | Phase dependencies (which phases must complete first) | `<!-- depends: phase1 -->` |
| `<!-- depends: -->` | No phase dependencies (can start immediately) | `<!-- depends: -->` |

**Phase Dependency Rules:**
- If NO `<!-- depends: -->` annotation: Phase depends on ALL previous phases (sequential, default behavior)
- If `<!-- depends: -->` is empty: Phase has NO dependencies (can run parallel with any phase)
- If `<!-- depends: phase1, phase2 -->`: Phase waits for listed phases only
- Runtime scheduling is not inferred ad hoc by the agent. `cadre-implement` calls
  MCP `cadre_track` with `action: "phase_schedule"`, then dispatches only the returned
  conflict-free `ready_groups[]`.

#### Task-Level Annotations

| Annotation | Purpose | Example |
|------------|---------|---------|
| `<!-- files: path1, path2 -->` | Exclusive file ownership | `<!-- files: src/auth.ts -->` |
| `<!-- depends: task1, task2 -->` | Task dependencies within phase | `<!-- depends: task1 -->` |
| `<!-- parallel-group: groupName -->` | Group tasks for parallel execution | `<!-- parallel-group: core-setup -->` |

---

## Architecture

### Coordinator Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    CADRE IMPLEMENT                       │
│                    (Coordinator Agent)                       │
│  - Calls Cadre packets for schedule/conflict state           │
│  - Dispatches packet-selected workers                       │
│  - Records worker evidence through MCP                      │
│  - Runs packet-owned merge-back and cleanup                 │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Worker 1   │   │  Worker 2   │   │  Worker 3   │
    │ packet job  │   │ packet job  │   │ packet job  │
    │             │   │             │   │             │
    │ files:      │   │ files:      │   │ files:      │
    │ auth.ts     │   │ config.ts   │   │ utils.ts    │
    └─────────────┘   └─────────────┘   └─────────────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
                    ┌─────────────────┐
                    │ Coordinator MCP │
                    │ + Beads Graph   │
                    └─────────────────┘
```

### State Management

#### `cadre/tracks/<track_id>/parallel_state.json`

This file is packet-owned. It is shown here as an implementation artifact, not
as a file agents should edit or reconstruct directly.

```json
{
  "phase": "Phase 1: Setup",
  "execution_mode": "parallel",
  "started_at": "2024-12-30T10:00:00Z",
  "workers": [
    {
      "worker_id": "worker_1_auth",
      "task": "Task 1: Create auth module",
      "files": ["src/auth.ts", "src/auth.test.ts"],
      "status": "merged",
      "started_at": "2024-12-30T10:00:00Z",
      "completed_at": "2024-12-30T10:05:00Z",
      "commit_sha": "abc1234"
    },
    {
      "worker_id": "worker_2_config",
      "task": "Task 2: Create config module",
      "files": ["src/config.ts"],
      "status": "in_progress",
      "started_at": "2024-12-30T10:00:00Z"
    }
  ],
  "completed_workers": 1,
  "total_workers": 3
}
```

---

## File Reservation System

### Purpose
Prevent multiple workers from modifying the same file simultaneously.

### Implementation

1. **Pre-spawn validation**: Before spawning workers, validate no file conflicts
2. **Coordinator audit**: Record worker/file ownership through
   `cadre_mutate` with `action: "record_worker"`; `parallel_state.json` is audit-only
3. **Dependency coordination**: Beads dependencies and assignees determine which
   workers can start and which dependents are unblocked
4. **Conflict detection**: If plan-level conflicts are found, fall back to
   sequential execution or revise the plan before spawning workers

```typescript
function detectConflicts(tasks: ParallelTask[]): Conflict[] {
  const fileMap = new Map<string, string[]>();
  for (const task of tasks) {
    for (const file of task.files) {
      if (!fileMap.has(file)) fileMap.set(file, []);
      fileMap.get(file)!.push(task.id);
    }
  }
  return Array.from(fileMap.entries())
    .filter(([_, tasks]) => tasks.length > 1)
    .map(([file, tasks]) => ({ file, conflicting_tasks: tasks }));
}
```

---

## Worker Spawning

The worker prompt below is platform-agnostic; only the **dispatch mechanism**
differs per tool. See [`parallel-execution.md`](../plugins/cadre-claude/skills/cadre/references/parallel-execution.md)
(bundled with every plugin skill) for the full table:

| Platform | Dispatch |
|----------|----------|
| **Claude Code** | `Task` tool, one call per worker (awaitable) |
| **OpenAI Codex** | use multi-agent tools to spawn one `worker` sub-agent per task and wait for the wave |
| **No parallel primitive** | sequential fallback — one agent runs each task in its worktree |

### Worker Dispatch Shape

Claude Code uses `Task` once per returned worker. OpenAI Codex uses the
available multi-agent worker primitive. Other platforms use a sequential
fallback only when the Cadre packet permits it. The worker prompt carries the
same packet payload on every platform:

```markdown
Track: ${track_id}
Phase: ${phase_name}
Task: ${task_description}
Repo root/worktree: ${worker.worktree}
Owned files: ${files.join('\n')}

Follow workflow.md for TDD implementation, only modify packet-owned files, keep
commits local, and return commit/test/coverage evidence to the coordinator.
```

### Worker Completion Protocol

Workers do not edit Cadre state directly. Each worker returns a structured
evidence packet to the coordinator: worker id, task key, commit SHA, tests run,
coverage value/source, files changed, and notes. The coordinator records that
packet through MCP `cadre_mutate` with `action: "record_worker"`. After a clean merge-back, the
coordinator calls the same tool with `status: "merged"` and `completeTask: true`
so `cadre_complete_task` records plan, metadata, coverage, and Beads together.

---

## Cadre-Implement Changes

> The coordinator mechanics below now live in the sliced reference
> [`parallel-execution.md`](../plugins/cadre-claude/skills/cadre/references/parallel-execution.md)
> (bundled with every plugin skill), not inline in `cadre-implement.md`. The
> per-worker prompt stays inline in `cadre-implement.md`. This section
> documents the design.

### Phase Processing (Updated)

`cadre-implement` does not parse or mutate parallel state itself. It calls
`cadre_workflow` with `workflow: "implement"` to obtain the current schedule,
then uses `cadre_parallel` actions in this order: `next_wave`, `setup_workers`,
platform worker dispatch, `record_finish`, `merge_back`, and `cleanup`.
Dependency release, file conflicts, Beads status, worker audit state, task
completion, and cleanup remain packet-owned.

---

## Newtrack Changes

### Plan Generation with Parallel Annotations

`cadre-newtrack` calls the new-track workflow packet with the generated plan
text. The packet returns `plan_assist` with file-claim analysis,
parallel-candidate phases, likely tests, semantic impact, and worktree planning.
Agents use that packet output to revise the proposed plan before creating the
track; they do not hand-maintain worker state.

---

## Beads Integration

Beads provides robust coordination for parallel task execution with its concurrency-safe features.

### Why Beads is Ideal for Parallel Execution

| Feature | Benefit |
|---------|---------|
| **Hash-based IDs** | No collision when parallel workers create tasks |
| **Assignee field** | Each worker claims exclusive ownership |
| **Dolt transactions** | Serializes concurrent writes safely |
| **Packet-assigned workers** | Workers receive only their ready task payload |
| **Packet-owned sync** | Shared control-plane sync happens through Cadre MCP |

### Coordinator Protocol

```text
cadre_parallel { action: "next_wave" }
cadre_parallel { action: "setup_workers", execute: true }
dispatch exactly the returned workers using the current platform primitive
cadre_parallel { action: "record_finish", execute: true, ...workerEvidence }
cadre_parallel { action: "merge_back", execute: true }
cadre_parallel { action: "cleanup", execute: true }
```

### Worker Protocol

Workers return evidence to the coordinator instead of directly mutating Cadre or
Beads completion state:

```json
{
  "worker_id": "worker_1_auth",
  "task_key": "task-1",
  "commit_sha": "abc1234",
  "tests": ["npm test -- auth"],
  "coverage": 84.2,
  "files_changed": ["src/auth.ts", "src/auth.test.ts"],
  "notes": ["Found and fixed token expiry edge case"]
}
```

The coordinator records start/progress/failure through
`cadre_mutate` with `action: "record_worker"`. After a clean merge-back, it calls the same MCP
tool with `status: "merged"` and `completeTask: true`; discovered issues become
coordinator-owned Beads notes or follow-up tasks.

### Concurrent Safety Guarantees

| Scenario | How Beads Handles It |
|----------|---------------------|
| Multiple workers update simultaneously | Dolt transactions serialize writes |
| Same task updated by two workers | Avoided by unique `--assignee` per task |
| Parallel `bd create` calls | Hash-based IDs guarantee no collision |
| Rapid status changes | Dolt transactions serialize all writes safely |
| Worker crashes mid-update | Coordinator clears assignee for retry |

### Error Recovery

Coordinator recovery also goes through packets: record timeout or failure
evidence with `cadre_parallel` / `cadre_mutate`, then let the next
`cadre_parallel` packet release ownership, retry, or block with recovery steps.

---

## Error Handling

### Worker Failure

```markdown
1. **Worker Timeout:** If worker doesn't update state in 60 minutes
   - Mark worker as `timed_out`
   - Release file locks
   - Offer to retry or skip

2. **Worker Error:** If worker reports error
   - Record the failure through `cadre_mutate` with `action: "record_worker"`
   - Block dependent tasks
   - Ask user for resolution

3. **File Conflict at Runtime:** If worker needs files not in its list
   - Worker pauses and reports conflict
   - Coordinator resolves by:
     a) Expanding file list
     b) Making task sequential
     c) Aborting parallel execution
```

---

## Migration Path

### Phase 1: Add Annotations (non-breaking)
- New `plan.md` format with optional annotations
- Existing plans work unchanged (default: sequential)

### Phase 2: Coordinator Logic
- Update `cadre-implement` to parse annotations
- Add parallel state management
- Implement worker spawning

### Phase 3: Enhanced Newtrack
- Auto-detect parallelizable tasks
- Generate annotations automatically

---

## Example: Full Parallel Track

### spec.md
```markdown
# User Authentication Feature

## Requirements
- OAuth login (Google, GitHub)
- Session management
- Profile page
```

### plan.md
```markdown
## Phase 1: Core Auth Setup
<!-- execution: parallel -->

- [ ] Task 1: Create OAuth provider module
  <!-- files: src/auth/oauth.ts, src/auth/oauth.test.ts -->
  
- [ ] Task 2: Create session management module
  <!-- files: src/auth/session.ts, src/auth/session.test.ts -->
  
- [ ] Task 3: Create auth config module
  <!-- files: src/config/auth.ts -->

## Phase 2: UI
<!-- execution: parallel -->
<!-- depends: -->

- [ ] Task 1: Create login page
  <!-- files: src/pages/login.tsx, src/pages/login.test.tsx -->
  
- [ ] Task 2: Create profile page
  <!-- files: src/pages/profile.tsx, src/pages/profile.test.tsx -->

## Phase 3: Integration
<!-- execution: sequential -->
<!-- depends: phase1, phase2 -->

- [ ] Task 1: Integrate OAuth with sessions
  
- [ ] Task 2: Create login route handler
  
- [ ] Task 3: Create logout route handler
```

**Execution Flow:**
```
        ┌─ Phase 1 (parallel tasks) ─┐
        │  - OAuth module            │
Start ──┤  - Session module          ├──┐
        │  - Auth config             │  │
        └────────────────────────────┘  │
                                        ├── Phase 3 (sequential)
        ┌─ Phase 2 (parallel tasks) ─┐  │   - Integrate
        │  - Login page              ├──┘   - Login route
        │  - Profile page            │      - Logout route
        └────────────────────────────┘
```

Phase 1 and Phase 2 run in parallel (no dependencies between them).
Phase 3 waits for both Phase 1 and Phase 2 to complete.

---

## Polyrepo: repo-scoped parallelism

In polyrepo mode (see [POLYREPO.md](POLYREPO.md)) parallel execution is
**repo-scoped**: file-conflict detection compares `(repo, file)` tuples (identical
relative paths in different repos do not conflict); worker worktrees live per repo
at `.worktrees/<track_id>/<repo>_worker_<N>_<name>/` created in submodule context;
each worker branch merges into **its own repo's** `track/<id>` branch; and
`parallel_state.json` worker entries record a `repo` field. The single shared Beads
Dolt graph still coordinates all workers regardless of repo.

---

## Workflow Reference

| Workflow | Description |
|---------|-------------|
| `cadre-implement` | Now supports parallel phases (repo-scoped in polyrepo) |
| `cadre-newtrack` | Asks about parallel execution |
| `cadre-status` | Shows parallel worker status |
| `cadre-validate` | Validates parallel annotations |
