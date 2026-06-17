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
│  - Parses plan.md for parallel annotations                  │
│  - Detects file conflicts                                   │
│  - Spawns sub-agents via Task()                             │
│  - Monitors completion via state files                      │
│  - Aggregates results                                       │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Worker 1   │   │  Worker 2   │   │  Worker 3   │
    │  Task()     │   │  Task()     │   │  Task()     │
    │             │   │             │   │             │
    │ files:      │   │ files:      │   │ files:      │
    │ auth.ts     │   │ config.ts   │   │ utils.ts    │
    └─────────────┘   └─────────────┘   └─────────────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  State Store    │
                    │  (JSON files)   │
                    └─────────────────┘
```

### State Management

#### `cadre/tracks/<track_id>/parallel_state.json`

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
      "status": "completed",
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
  "file_locks": {
    "src/auth.ts": "worker_1_auth",
    "src/config.ts": "worker_2_config"
  },
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
2. **Lock acquisition**: Record file locks in `parallel_state.json`
3. **Lock release**: Remove lock when worker completes
4. **Conflict detection**: If conflicts found, fall back to sequential execution

```typescript
interface FileLock {
  path: string;
  worker_id: string;
  acquired_at: string;
  ttl_seconds: number;  // Auto-release after timeout (default: 3600)
}

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

### Example: Claude Code's Task() Tool

```markdown
Task({ 
  description: "Implement Task 1: Create auth module",
  prompt: `
    You are a sub-agent implementing a single task for Cadre.
    
    ## Context
    - Track: ${track_id}
    - Phase: ${phase_name}
    - Task: ${task_description}
    
    ## Files Owned (exclusive access)
    ${files.join('\n')}
    
    ## Instructions
    1. Follow workflow.md for TDD implementation
    2. Only modify files in your owned list
    3. Commit with message: "feat(${scope}): ${description}"
    4. Return commit/test/coverage evidence to the coordinator
    5. NEVER run git push - all commits stay local
    
    ## Spec Context
    ${spec_excerpt}
    
    ## Success Criteria
    - All tests pass
    - Code coverage >80%
    - Commit created with proper message
  `
})
```

### Worker Completion Protocol

Workers do not edit Cadre state directly. Each worker returns a structured
evidence packet to the coordinator: worker id, task key, commit SHA, tests run,
coverage value/source, files changed, and notes. The coordinator records that
packet through MCP `cadre_record_parallel_worker`. After a clean merge-back, the
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

```markdown
## 3.5 PARALLEL PHASE EXECUTION

**PROTOCOL: Execute tasks in parallel when phase allows.**

1. **Parse Phase Metadata:**
   - Check for `<!-- execution: parallel -->` annotation
   - If not found or `sequential`: Use existing sequential flow

2. **Parallel Execution Flow (if parallel):**

   a. **Parse Task Metadata:**
      - Extract `files:` annotations for each task
      - Extract `depends:` annotations for dependencies
      
   b. **Build Dependency Graph:**
      - Identify tasks with no dependencies (can start immediately)
      - Identify dependent tasks (must wait)
   
   c. **Detect File Conflicts:**
      - Check if any two tasks share file ownership
      - If conflicts exist:
        > "⚠️ File conflict detected: [files] claimed by multiple tasks"
        > "A) Resolve by making tasks sequential"
        > "B) Continue - I'll handle file merging manually"
   
   d. **Initialize Parallel State:**
      - Create `parallel_state.json`
      - Record all workers and their file assignments
   
   e. **Spawn Workers:**
      - For each task with no unmet dependencies:
        - Create Task() with full context
        - Include: spec excerpt, files owned, success criteria
        - Workers run concurrently
   
   f. **Monitor Completion:**
      - Wait for worker results and let the coordinator record status through
        MCP `cadre_record_parallel_worker`
      - When a worker completes:
        - Check if dependent tasks can now start
        - Spawn newly unblocked tasks
   
   g. **Aggregate Results:**
      - Wait for all workers to complete
      - Collect commit SHAs from all workers
      - Call `cadre_record_parallel_worker` with `completeTask: true` after each
        clean merge to update plan.md and Beads
      - Proceed to phase checkpoint

3. **Beads Integration (if enabled):**
   - Parallel tasks can update Beads concurrently
   - Use `bd update <id> --status in_progress` at worker start
   - Use `bd close <id>` at worker completion
```

---

## Newtrack Changes

### Plan Generation with Parallel Annotations

```markdown
## 2.3a PARALLEL EXECUTION ANALYSIS

**PROTOCOL: Analyze tasks for parallel execution potential.**

1. **After Generating Plan:**
   - Analyze each phase for parallelizable tasks
   - Ask user:
     > "I've identified potential for parallel execution in this track:"
     > 
     > **Phase 1: Setup** (3 tasks)
     > - Tasks 1, 2, 3 have no file overlaps → Can run in parallel
     > 
     > **Phase 2: Implementation** (4 tasks)
     > - Tasks 1, 2 can run in parallel (different files)
     > - Tasks 3, 4 depend on Task 1 → Must be sequential
     >
     > "Would you like to enable parallel execution? (yes/no)"

2. **If Yes:**
   - Add `<!-- execution: parallel -->` to eligible phases
   - Add `<!-- files: ... -->` annotations to each task
   - Add `<!-- depends: ... -->` where needed

3. **If No:**
   - Keep all phases as `<!-- execution: sequential -->`
```

---

## Beads Integration

Beads provides robust coordination for parallel task execution with its concurrency-safe features.

### Why Beads is Ideal for Parallel Execution

| Feature | Benefit |
|---------|---------|
| **Hash-based IDs** | No collision when parallel workers create tasks |
| **Assignee field** | Each worker claims exclusive ownership |
| **Dolt transactions** | Serializes concurrent writes safely |
| **`bd ready --assignee`** | Workers query only their assigned tasks |
| **`bd dolt push`** | Push changes to remote |

### Coordinator Protocol

```bash
# 1. Before spawning workers - pre-assign all tasks
for task in parallel_tasks:
    bd update <beads_task_id> --status in_progress \
      --assignee worker_<N>_<name> \
      --notes "PARALLEL WORKER: Started" \
      --json

# 2. Spawn workers via Task()
# (Each worker gets its beads_task_id in the prompt)

# 3. After all workers complete - aggregate and verify
bd ready --parent <epic_id> --json  # Verify all complete
bd note <epic_id> "PARALLEL PHASE COMPLETE: <phase>
WORKERS: <N> succeeded
COMMITS: <sha_list>" --json
```

### Worker Protocol

```bash
# At worker start (claimed by coordinator already)
bd note <beads_task_id> "WORKER: <worker_id>
TASK: <task_description>
FILES: <exclusive_files>
STARTED: <timestamp>" --json

# During execution - discovered issues
bd create "Found race condition" \
  -t bug -p 2 \
  --deps discovered-from:<beads_task_id> \
  --assignee <worker_id> \
  --json

# At worker completion
bd note <beads_task_id> "COMPLETED: commit <sha>
DURATION: <time>
FILES_MODIFIED: <list>" --json
# Coordinator only, after clean merge-back:
cadre_record_parallel_worker { status: "merged", completeTask: true, ... }
```

### Concurrent Safety Guarantees

| Scenario | How Beads Handles It |
|----------|---------------------|
| Multiple workers update simultaneously | Dolt transactions serialize writes |
| Same task updated by two workers | Avoided by unique `--assignee` per task |
| Parallel `bd create` calls | Hash-based IDs guarantee no collision |
| Rapid status changes | Dolt transactions serialize all writes safely |
| Worker crashes mid-update | Coordinator clears assignee for retry |

### Error Recovery

```bash
# Coordinator detects worker timeout/failure
bd update <beads_task_id> --status open \
  --notes "Worker <id> timed out. Reassigning." \
  --assignee "" \
  --json
```

---

## Error Handling

### Worker Failure

```markdown
1. **Worker Timeout:** If worker doesn't update state in 60 minutes
   - Mark worker as `timed_out`
   - Release file locks
   - Offer to retry or skip

2. **Worker Error:** If worker reports error
   - Record the failure through `cadre_record_parallel_worker`
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
