# Cadre + Beads Integration

> **Status**: Implemented
> **Cadre Version**: 2.0.0

## Overview

This spec defines how Cadre's context-driven development methodology integrates with Beads' persistent task memory system, creating a unified workflow that combines:

- **Cadre**: Spec-first planning, human-readable context, TDD workflow
- **Beads**: Dependency-aware graph, cross-session memory, agent-optimized output

## Design Principles

1. **Cadre owns planning** - Specs, product vision, and phase organization
2. **Beads owns execution** - Task tracking, dependencies, and persistent memory
3. **Bidirectional sync** - Changes in either system reflect in both
4. **Required durability** - If Beads is unavailable, Cadre halts until the
   prerequisite is restored.
5. **One graph in polyrepo** - In polyrepo mode the Beads Dolt DB at the control
   repo is the **single shared task graph for all product repos** (submodules get
   no own `.beads/`). In `sync_mode: "shared"` Dolt is the canonical source teammates
   pull/push; `tracks.md` and the state JSON are its human-readable mirror. See
   [POLYREPO.md](POLYREPO.md).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User / AI Agent                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cadre Skill                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ product.md  │  │ tech-stack  │  │     workflow.md     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    tracks.md                             ││
│  │  [x] auth_20241226 ──────────┐                          ││
│  │  [~] api_20241226 ───────────┼──── Track references      ││
│  │  [ ] ui_20241227 ────────────┘                          ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Sync Layer
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Beads (.beads/)                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  Dependency Graph                        ││
│  │                                                          ││
│  │    bd-a3f8 (Epic: auth_20241226)                        ││
│  │       ├── bd-a3f8.1 (Task: Write auth tests)            ││
│  │       │      └── bd-a3f8.1.1 (Subtask: JWT tests)       ││
│  │       └── bd-a3f8.2 (Task: Implement middleware)        ││
│  │              └── blocked-by: bd-a3f8.1                  ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Workflow Integration

### Phase 1: Setup (`cadre-setup` + `bd init`)

When user runs `cadre-setup`:

1. **Cadre creates** standard context files
2. **If Beads available**, also run full-mode initialization:
   ```bash
   bd init --non-interactive --role maintainer
   ```
3. **Create linking config** in `cadre/beads.json` (copied from the bundled
   template; `mode` stays `normal`):
   ```json
   {
     "enabled": true,
     "mode": "normal",
     "memoryStrategy": "beads-primary",
     "epicPrefix": "cadre",
     "autoCreateTasks": true,
     "compactOnPhaseComplete": true,
     "pushOnTaskComplete": false,
     "pushOnPhaseComplete": true,
     "pushOnTrackComplete": true,
     "worktreePerTrack": true,
     "worktreePerWorker": true
   }
   ```

### Phase 2: Track Creation (`cadre-newtrack` + `bd create`)

When creating a new track:

```
User: cadre-newtrack Add user authentication

Cadre Actions:
1. Create cadre/tracks/auth_20241226/
2. Generate spec.md with requirements
3. Generate plan.md with phased tasks

Beads Actions:
4. Create epic: bd create "auth_20241226: Add user authentication" -p 1
   → Returns: bd-a3f8

5. For each phase task in plan.md:
   bd create "Write failing auth tests" -P bd-a3f8 -p 1
   → Returns: bd-a3f8.1

   bd create "Implement JWT middleware" -P bd-a3f8 -p 1
   → Returns: bd-a3f8.2

6. Set dependencies based on phase order:
   bd dep add bd-a3f8.2 bd-a3f8.1  # .2 blocked by .1
```

**Metadata linkage** in `cadre/tracks/auth_20241226/metadata.json`:
```json
{
  "id": "auth_20241226",
  "beads_epic": "bd-a3f8",
  "beads_tasks": {
    "phase1_task1": "bd-a3f8.1",
    "phase1_task2": "bd-a3f8.2"
  }
}
```

### Phase 3: Implementation (`cadre-implement` + `bd ready`)

When implementing:

```
User: cadre-implement auth_20241226

Combined Workflow:
1. Cadre loads spec.md and plan.md for context
2. Get AI-optimized context:
   bd prime

3. Query Beads for ready tasks:
   bd ready --parent bd-a3f8
   → Shows tasks with no blockers

4. Select task and mark in-progress with context:
   bd update bd-a3f8.1 --status in_progress \
     --notes "Started: Write auth tests
   APPROACH: JWT with RS256 for key rotation"

5. Execute TDD workflow (from Cadre):
   - Write failing tests (Red)
   - Implement to pass (Green)
   - Refactor

6. On completion, add structured notes:
   bd note bd-a3f8.1 "COMPLETED: JWT auth tests
   KEY DECISION: RS256 over HS256 for key rotation
   FILES CHANGED: auth.test.ts, auth.ts
   COMMIT: abc123"

7. Close with auto-advance:
   bd close bd-a3f8.1 --continue --reason "Task completed"
   (The --continue flag auto-advances to next step)

8. Cadre updates plan.md with commit SHA
```

### Phase 4: Status & Progress (`cadre-status` + `bd show`)

```
User: cadre-status

Output combines both sources:

# Project Status

## Active Tracks (from Cadre)
- [~] auth_20241226 - Add user authentication

## Task Progress (from Beads)
bd ready --parent bd-a3f8

Ready to work:
  bd-a3f8.2  P1  Implement JWT middleware

Completed:
  bd-a3f8.1  ✓   Write failing auth tests

## Blocked Tasks
bd show bd-a3f8.3 --deps
  Blocked by: bd-a3f8.2 (in progress)
```

### Phase 5: Blocking & Dependencies (`cadre-flag blocked` + `bd dep`)

```
User: cadre-flag blocked - External API not ready

Actions:
1. Cadre marks task [B] in plan.md
2. Beads records blocker:
   bd update bd-a3f8.2 --status blocked --note "External API not ready"

3. If blocking relationship to another task:
   bd dep add bd-a3f8.2 bd-external-api
```

### Phase 6: Session Resume (Beads shines here)

After context compaction or new session:

```
Agent Session Start:
1. bd ready                    # What can I work on?
2. bd show bd-a3f8.1           # Get full context: notes, design, acceptance
3. Read notes for: COMPLETED, IN PROGRESS, NEXT, KEY DECISIONS
4. Load cadre/tracks/auth_20241226/spec.md for context
5. Resume work
```

Beads' persistent notes survive conversation compaction, while Cadre's markdown provides human-readable context.

### Structured Notes Format

When updating notes for session resume, use this format:

```bash
bd note <epic_id> "COMPLETED: Phase 1 - Auth tests
KEY DECISION: Using RS256 for JWT signing (enables key rotation)
IN PROGRESS: Phase 2 - Middleware implementation
NEXT: Implement token validation
BLOCKER: None
DISCOVERED: Found race condition in token refresh (created bd-xyz)"
```

| Field | Purpose |
|-------|---------|
| `COMPLETED:` | What was finished (past tense, specific) |
| `KEY DECISION:` | Important choices with rationale |
| `IN PROGRESS:` | Current work |
| `NEXT:` | Immediate next step (concrete action) |
| `BLOCKER:` | What's blocking (if any) |
| `DISCOVERED:` | New issues found during work |

### Session End Protocol

**CRITICAL**: Always run at session end or handoff:

```bash
bd note <epic_id> "..."           # Save context
bd dolt push                      # Push changes to remote
```

> **Push cadence** is governed by `config.json` `sync_mode`: mandatory in
> `shared` mode (teammates pull/push the canonical Dolt graph), local-only
> otherwise. See [POLYREPO.md](POLYREPO.md).

## Workflow Mapping

| Cadre Workflow | Beads Equivalent | Integration |
|-------------------|------------------|-------------|
| `cadre-setup` | `bd init` | Run both |
| `cadre-newtrack` | `bd create` (epic + tasks) | Create track + epic with `--design`, `--acceptance` |
| `cadre-implement` | `bd ready`, `bd update`, `bd close` | Query ready, track progress, complete |
| `cadre-status` | `bd ready`, `bd show` | Combine outputs, read notes for context |
| `cadre-flag blocked` | `bd update --status blocked` | Sync both with structured notes |
| `cadre-flag skipped` | `bd close` or `bd update` | Mark in both based on skip reason |
| `cadre-handoff` | `bd note`, `bd dolt push` | Save context + push to remote |
| `cadre-ship` | `bd dolt push` | Flush Dolt before rebase/push (monorepo) |
| `cadre-land` | `bd dolt push` | Flush Dolt before opening the cross-repo PR group (polyrepo) |
| `cadre-revert` | `bd reopen` | Sync status |
| `cadre-archive` | `bd compact --auto` | Archive track + compact |

## Data Synchronization

### Cadre → Beads (Plan Changes)

When `plan.md` is edited:
1. Detect new/removed/reordered tasks
2. Create/close Beads issues accordingly
3. Update dependency graph for new order

### Beads → Cadre (Status Changes)

When `bd close` or `bd update` runs:
1. Update corresponding task in `plan.md`
2. Add commit SHA if available
3. Update the track's `metadata.json` `status` (the single source of truth for
   track status) if the epic is complete — never hand-flip the `tracks.md` marker;
   regenerate the cache via `cadre-status --regen-index`

### Conflict Resolution

Priority: **`metadata.json` `status` is the authoritative source of truth for
track status** (`tracks.md` is a derived cache that mirrors it). Cadre owns
specs and plans. In `sync_mode: "shared"` the Beads Dolt graph is the canonical
store that `metadata.json`, `tracks.md`, and the state JSON all mirror — pull/push
it to reconcile teammates.

```
Conflict: plan.md says [x], metadata.json/Beads says the task is active
Resolution: Reconcile plan.md against metadata.json (agent likely still working),
            then run cadre-status --regen-index — do not silently rewrite plan.md

Conflict: Beads has task not in plan.md
Resolution: Add to plan.md under "Unplanned Tasks" section
```

## Configuration

### cadre/beads.json

This is the canonical schema, written by `cadre-setup` from the bundled
`templates/beads.json`. Cadre setup uses full Beads integration, so `mode`
remains `normal`.

```json
{
  "enabled": true,
  "mode": "normal",
  "memoryStrategy": "beads-primary",
  "epicPrefix": "cadre",
  "autoCreateTasks": true,
  "compactOnPhaseComplete": true,
  "pushOnTaskComplete": false,
  "pushOnPhaseComplete": true,
  "pushOnTrackComplete": true,
  "worktreePerTrack": true,
  "worktreePerWorker": true
}
```

| Key | Meaning |
|-----|---------|
| `enabled` | Beads integration active |
| `mode` | `normal` commits `.beads/` as part of the shared control plane |
| `memoryStrategy` | `beads-primary` — Beads is the source of truth for task status |
| `epicPrefix` | Prefix for Beads epic IDs created per track |
| `autoCreateTasks` | Create Beads tasks automatically from plan.md |
| `compactOnPhaseComplete` | Compact Beads history at each phase boundary |
| `pushOnTaskComplete` / `pushOnPhaseComplete` / `pushOnTrackComplete` | When to push (Cadre never pushes on task complete by default) |
| `worktreePerTrack` / `worktreePerWorker` | Isolate tracks/parallel workers in their own git worktrees |

### Detection Logic

Skill activation checks:
1. Does `cadre/` exist? → Load Cadre
2. Does `.beads/` exist? → Also load Beads integration
3. Both present? → Use combined workflow

## Implementation Phases

> All phases below are shipped (this spec is **Status: Implemented**). Two
> team-scale refinements layer on top: task **assignees use the git committer
> identity** (`user.email` → `user.name`, never a literal `cadre`), and
> `cadre-review` stamps the Beads epic with a `review:ready` or
> `review:changes` label that `cadre-ship` and `cadre-land` gate on.

### Phase 1: Basic Integration (MVP)
- [x] Add `bd init` to `cadre-setup`
- [x] Create epic on `cadre-newtrack`
- [x] Query `bd ready` in `cadre-implement`
- [x] Sync completion status

### Phase 2: Full Sync
- [x] Bidirectional plan.md ↔ Beads sync
- [x] Dependency graph from phase order
- [x] Status aggregation in `cadre-status`

### Phase 3: Advanced Features
- [x] Beads compaction on archive
- [x] Cross-track dependencies via Beads
- [x] Team sync via git + Beads

## Parallel Execution Integration

Beads provides robust coordination for Cadre's parallel task execution feature.

### Why Beads is Ideal for Parallel Execution

| Feature | Benefit for Parallel Execution |
|---------|-------------------------------|
| **Hash-based IDs** | No collision when parallel workers create tasks |
| **Assignee field** | Each worker claims exclusive ownership |
| **Dolt transactions** | Serializes concurrent writes safely |
| **`bd ready --assignee`** | Workers query only their assigned tasks |
| **`bd dolt push`** | Push changes to remote |

### Parallel Workflow with Beads

```
┌─────────────────────────────────────────────────────────────────┐
│                     COORDINATOR                                   │
│  1. Parse parallel phase from plan.md                            │
│  2. For each parallel task:                                      │
│     bd update <task_id> --status in_progress                     │
│       --assignee worker_<N>_<name> --json                        │
│  3. Spawn workers (per-platform; see parallel-execution.md)      │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Worker 1   │   │  Worker 2   │   │  Worker 3   │
    │  assignee:  │   │  assignee:  │   │  assignee:  │
    │  worker_1   │   │  worker_2   │   │  worker_3   │
    │             │   │             │   │             │
    │ bd update   │   │ bd update   │   │ bd update   │
    │ bd close    │   │ bd close    │   │ bd close    │
    │ bd dolt push│   │ bd dolt push│   │ bd dolt push│
    └─────────────┘   └─────────────┘   └─────────────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     COORDINATOR                                   │
│  4. bd dolt push (push all worker changes to remote)             │
│  5. bd ready --parent <id> (verify all complete)                   │
│  6. Aggregate results to plan.md                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Worker Commands

**At Worker Start:**
```bash
# Worker claims its assigned task
bd update <task_id> --status in_progress \
  --assignee <worker_id> \
  --notes "WORKER: <worker_id>
TASK: <task_description>
FILES: <exclusive_files>
STARTED: <timestamp>" \
  --json
```

**During Execution (discovered issues):**
```bash
# Link discovered issues to current task
bd create "Found race condition" \
  -t bug -p 2 \
  --deps discovered-from:<current_task_id> \
  --assignee <worker_id> \
  --json
```

**At Worker Completion:**
```bash
# Complete task with structured notes
bd note <task_id> "WORKER: <worker_id>
STATUS: Completed
COMMIT: <sha>
DURATION: <time>
FILES_MODIFIED: <list>" --json

bd close <task_id> --reason "Task completed" --json
```

### Coordinator Commands

**Before Spawning Workers:**
```bash
# Pre-assign all parallel tasks
for task_id in <parallel_tasks>:
    bd update $task_id --status in_progress \
      --assignee worker_<N>_<name> --json
```

**After All Workers Complete:**
```bash
# Verify completion
bd ready --parent <epic_id> --json
# Should return empty (all tasks done) or only sequential tasks

# Update epic notes for session resume
bd note <epic_id> "PARALLEL PHASE COMPLETE: <phase_name>
WORKERS: <N> workers, all succeeded
COMMITS: <list of commit SHAs>
NEXT: <next_sequential_phase>" --json
```

### Concurrent Safety Guarantees

| Scenario | How Beads Handles It |
|----------|---------------------|
| Multiple workers update simultaneously | Dolt transactions serialize writes |
| Same task updated by two workers | Avoided by unique `--assignee` per task |
| Parallel `bd create` calls | Hash-based IDs guarantee no collision |
| Rapid status changes | Dolt transactions serialize all writes safely |
| Worker crashes mid-update | Coordinator detects timeout, clears assignee for retry |

### Error Recovery

**Worker Timeout/Failure:**
```bash
# Coordinator detects worker hasn't updated in 60 min
bd update <task_id> --status open \
  --notes "Worker <id> timed out. Reassigning." \
  --assignee "" \
  --json
```

**Dependency Conflict (rare):**
```bash
# If parallel worker needs dependency not in its scope
# Worker reports conflict, coordinator resolves
bd update <task_id> --status blocked \
  --notes "BLOCKED: Needs <dependency> not assigned to this worker" \
  --json
```

## Benefits

| Capability | Cadre Only | With Beads |
|------------|----------------|------------|
| Cross-session memory | Git notes | Persistent graph |
| Dependency tracking | Phase order | Full DAG |
| Ready task detection | Manual | `bd ready` |
| Context after compaction | Re-read files | `bd show --long` |
| Multi-agent coordination | File locks | Hash-based IDs |
| Workflow templates | Manual spec copying | `bd mol pour/wisp` |
| Ephemeral exploration | Full track overhead | Wisps (no audit trail) |

## Beads v0.43+ Features

### Molecules (Workflow Templates)

Cadre tracks can be extracted as reusable templates:

| Beads Concept | Cadre Mapping | Beads Command |
|---------------|-------------------|---------|
| **Formula** | Track template source | `bd formula list` |
| **Proto** | Frozen template | `bd cook <formula>` |
| **Mol** | Persistent track | `bd mol pour <proto>` |
| **Wisp** | Ephemeral exploration | `bd mol wisp <proto>` |

**Cadre workflows (all under `cadre-formula`):**
- `cadre-formula list` - List available templates
- `cadre-formula wisp` - Quick ephemeral exploration
- `cadre-formula create` - Extract template from completed track

### Gates (v0.40+)

For human-in-the-loop checkpoints (gates are created automatically via formula steps with a `gate` field):

```bash
# List open gates
bd gate list

# Auto-close gates whose condition is met (timer elapsed, CI passed, etc.)
bd gate eval

# Approve a human-in-the-loop gate after review
bd gate approve <gate-id>
```

### Cross-Project Dependencies

```bash
# Ship capability from project A
bd ship auth-api

# Depend on it from project B
bd dep add <issue> external:project-a:auth-api
```

## Open Questions

1. **Sync frequency** - Real-time vs. on-command sync?

2. **Skill loading** - Load the `cadre` and `beads` skills separately or merge them into a single combined skill?

4. **Fallback behavior** - ~~If `bd` not installed, silent skip or prompt to install?~~ **Resolved**: Beads is required; halt until `bd` is installed and working.

## References

- [Cadre Skill](../plugins/cadre-claude/skills/cadre/SKILL.md)
- [Beads Documentation](https://github.com/steveyegge/beads)
- [Beads Agent Instructions](https://github.com/steveyegge/beads/blob/main/AGENT_INSTRUCTIONS.md)
