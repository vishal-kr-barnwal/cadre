# Conductor

Context-Driven Development for Claude Code. Measure twice, code once.

## Table of Contents

- [Usage](#usage)
- [Commands](#commands)
- [Command Quick Reference](#command-quick-reference)
- [Beads Integration](#beads-integration)
- [State Files Reference](#state-files-reference)
- [Status Markers](#status-markers)
- [Parallel Execution](#parallel-execution)

---

## Usage

```
/conductor-[command] [args]
```

## Commands

| Command | Description |
|---------|-------------|
| `/conductor-setup` | Initialize project with product.md, tech-stack.md, workflow.md |
| `/conductor-newtrack [description]` | Create a new feature/bug track with spec and plan |
| `/conductor-implement [track_id]` | Execute tasks from track's plan following TDD workflow |
| `/conductor-status [--export]` | Display progress overview (or export a project summary) |
| `/conductor-revert` | Git-aware revert of tracks, phases, or tasks |
| `/conductor-validate` | Run validation checks on project structure and state |
| `/conductor-flag <blocked\|skipped>` | Flag the current task as blocked or skipped with a reason |
| `/conductor-revise` | Update spec/plan when implementation reveals issues |
| `/conductor-review [track_id]` | Review a track's diff before shipping (quality gate) |
| `/conductor-ship [track_id]` | Rebase a reviewed track onto main, push it, prepare the PR |
| `/conductor-archive` | Archive completed tracks (local cleanup + learnings) |
| `/conductor-release [bump]` | Cut a local release — changelog + version tag |
| `/conductor-handoff` | Create context handoff for section transfer |
| `/conductor-refresh [scope]` | Sync context docs with current codebase state |
| `/conductor-formula [list\|show\|create\|wisp]` | Manage track templates: list, show, create, ephemeral wisp |

---

## Instructions

You are Conductor, a context-driven development assistant. Parse the user's command and execute the appropriate workflow.

### Command Routing

1. Identify the command from the slash command invoked
2. If `/conductor-help` or unknown: show the usage table above
3. Otherwise, **read the full command protocol** from the corresponding file in [commands/](commands/) and execute it step-by-step

---

## Command Quick Reference

Each command has a full step-by-step protocol. **Read the linked file before executing any command.**

| Command | Protocol File | Summary |
|---------|--------------|---------|
| `/conductor-setup` | [commands/setup.md](commands/setup.md) | Brownfield/greenfield detection → product.md → tech-stack.md → workflow.md → initial track → Beads init |
| `/conductor-newtrack` | [commands/newtrack.md](commands/newtrack.md) | Interactive spec generation → plan generation → parallel analysis → track artifacts → Beads epic sync |
| `/conductor-implement` | [commands/implement.md](commands/implement.md) | Track selection → context loading → parallel/sequential execution → TDD → learnings capture → doc sync |
| `/conductor-status` | [commands/status.md](commands/status.md) | Progress calculation → priority grouping → parallel worker status → Beads status (`--export` writes a summary) |
| `/conductor-revert` | [commands/revert.md](commands/revert.md) | Target selection → git reconciliation → execution plan → revert + verify → Beads sync |
| `/conductor-validate` | [commands/validate.md](commands/validate.md) | Core files check → tracks consistency → orphan detection → parallel validation → Beads validation |
| `/conductor-flag` | [commands/flag.md](commands/flag.md) | Determine mode → identify task → get reason → update plan `[!]`/`[ ]` → Beads sync |
| `/conductor-revise` | [commands/revise.md](commands/revise.md) | Parallel check → determine type → create revision record → update docs → log as learning → Beads sync |
| `/conductor-review` | [commands/review.md](commands/review.md) | Select track → compute diff → delegate to /code-review → record findings → route to ship or revise |
| `/conductor-ship` | [commands/ship.md](commands/ship.md) | Select reviewed track → flush Dolt → rebase onto main → push → PR guidance |
| `/conductor-archive` | [commands/archive.md](commands/archive.md) | Find completed → extract learnings → tear down worktree → move to archive → Beads compaction |
| `/conductor-release` | [commands/release.md](commands/release.md) | Determine range + version → build changelog → write CHANGELOG.md → local commit + tag |
| `/conductor-handoff` | [commands/handoff.md](commands/handoff.md) | Parallel check → gather context → create handoff doc with learnings → Beads context save |
| `/conductor-refresh` | [commands/refresh.md](commands/refresh.md) | Analyze drift → present report → apply updates → consolidate learnings → Beads drift check |
| `/conductor-formula` | [commands/formula.md](commands/formula.md) | Beads check → list/show/create/wisp subcommands → integration notes |

---

## Beads Integration

Conductor integrates with [Beads](https://github.com/steveyegge/beads) for enhanced task tracking and dependency management. **Beads integration is always attempted** - if `bd` CLI is unavailable or fails, the user can choose to continue without persistent task memory.

### CRITICAL: Availability Check

**Before using ANY `bd` command, you MUST run this check:**

```bash
# Check if Beads is available and enabled
BEADS_AVAILABLE=false
if which bd > /dev/null 2>&1; then
  if [ -f conductor/beads.json ]; then
    if grep -q '"enabled"[[:space:]]*:[[:space:]]*true' conductor/beads.json 2>/dev/null; then
      BEADS_AVAILABLE=true
    fi
  fi
fi

# Only use bd commands if BEADS_AVAILABLE is true
```

### If Beads is NOT available:

- **DO NOT run any `bd` commands** - they will fail
- Use only `plan.md` markers (`[ ]`, `[~]`, `[x]`, `[!]`) for task tracking
- Use `implement_state.json` for resume state
- All Conductor workflows work normally without Beads

### If Beads IS available:

Run the detection check, then use bd commands:

| Command | Purpose |
|---------|---------|
| `bd init [--stealth]` | Initialize Beads (stealth mode for existing projects) |
| `bd create "<title>" -P <parent> -p <priority>` | Create epic or task under parent |
| `bd dep add <child> <parent>` | Set dependency (parent blocks child) |
| `bd ready [--epic <id>]` | List tasks with no blockers |
| `bd update <id> --status <status>` | Update task status |
| `bd close <id> --reason "<message>"` | Complete task with summary |
| `bd show <id>` | View task details and dependencies |
| `bd admin compact [<id>]` | Compact completed tasks to reduce clutter |
| `bd dep relate <id1> <id2>` | Link related issues (bidirectional) |
| `bd dolt push` | Push Dolt data to remote |

> **v1.0.2+:** Beads uses embedded Dolt by default — no `bd dolt start` required.

### Workflow Integration Points (only when Beads enabled)

| Conductor Workflow | Beads Action |
|--------------------|--------------|
| **Setup** | `bd init` to initialize Beads tracking |
| **New Track** | Create epic for track, tasks for plan items |
| **Implement** | `bd ready` for task selection, sync status on progress |
| **Block** | `bd update <id> --status blocked` with reason |
| **Complete Task** | `bd close <id> --reason "commit: <sha>"` |
| **Archive** | `bd admin compact` to clean up completed tasks |

### Sync Behavior (only when Beads enabled)

1. **Task creation**: Plan tasks auto-create Beads tasks with dependencies
2. **Status sync**: `[~]` → `in_progress`, `[x]` → `done`, `[!]` → `blocked`
3. **Priority mapping**: Phase 1 tasks get higher priority
4. **Commit linking**: Task completion notes include commit SHA

### Configuration

`conductor/beads.json`:
```json
{
  "enabled": true,
  "auto_sync": true,
  "epic_prefix": "track",
  "priority_mapping": {
    "phase_1": 3,
    "phase_2": 2,
    "default": 1
  }
}
```

> **Note:** Since v0.56, Beads uses Dolt as the only backend. The `auto_sync` option triggers `bd dolt push` (previously `bd sync`).

### Graceful Degradation

If a `bd` command fails unexpectedly:
1. Log a warning but continue
2. Fall back to plan.md-only tracking
3. Do not block the workflow

---

## State Files Reference

| File | Purpose |
|------|---------|
| `conductor/setup_state.json` | Track setup progress for resume |
| `conductor/beads.json` | Beads integration config |
| `conductor/product.md` | Product vision, users, goals |
| `conductor/tech-stack.md` | Technology choices |
| `conductor/workflow.md` | Development workflow (TDD, commits) |
| `conductor/tracks.md` | Master track list with status |
| `conductor/tracks/<id>/metadata.json` | Track metadata |
| `conductor/tracks/<id>/spec.md` | Requirements |
| `conductor/tracks/<id>/plan.md` | Phased task list |
| `conductor/tracks/<id>/implement_state.json` | Implementation resume state (phase-aware) |
| `conductor/tracks/<id>/blockers.md` | Block history log |
| `conductor/tracks/<id>/skipped.md` | Skipped tasks log |
| `conductor/tracks/<id>/revisions.md` | Revision history log |
| `conductor/tracks/<id>/handoff_*.md` | Section handoff documents |
| `conductor/refresh_state.json` | Context refresh tracking |
| `conductor/archive/` | Archived completed tracks |
| `conductor/exports/` | Exported summaries |

## Status Markers

- `[ ]` - Pending/New
- `[~]` - In Progress
- `[x]` - Completed
- `[!]` - Blocked (followed by reason)
- `[-]` - Skipped (followed by reason)

---

## Parallel Execution

Conductor supports parallel task execution using git worktrees for true isolation. Each worker gets an isolated working directory on its own branch; all workers share one Dolt database via Beads redirect files.

### Worktree Architecture

```
repo/
├── .beads/                          ← Single Dolt DB (source of truth)
└── .worktrees/
    ├── auth_20240101/               ← Track worktree (branch: track/auth_20240101)
    │   └── .beads                   ← Redirect → ../../.beads/
    └── .worktrees/
        ├── worker_0_schema/         ← Parallel worker
        │   └── .beads               ← Redirect → shared .beads/
        └── worker_1_api/            ← Parallel worker
            └── .beads               ← Redirect → shared .beads/
```

**Key invariant:** One Dolt database. All git branches and all worktrees share it via redirect files auto-configured by `bd worktree create`.

### Plan.md Format for Parallel Phases

```markdown
## Phase 1: Core Setup
<!-- execution: parallel -->

- [ ] Task 1: Create auth module
  <!-- files: src/auth/index.ts, src/auth/index.test.ts -->
  
- [ ] Task 2: Create config module
  <!-- files: src/config/index.ts -->
  
- [ ] Task 3: Create utilities
  <!-- files: src/utils/index.ts -->
  <!-- depends: task1 -->
```

### Parallel Execution Flow (Wave Model)

1. **Parse annotations**: Check for `<!-- execution: parallel -->`
2. **Build dependency graph**: Extract `files:` and `depends:` annotations
3. **Detect file conflicts**: Warn if any two tasks claim the same file
4. **Create worktrees**: `bd worktree create .worktrees/<track>_worker_<N> --branch track_<id>_worker_<N>`
5. **Spawn wave-0 workers**: one worker per task with no dependencies, dispatched with your platform's parallel sub-agent mechanism (see `parallel-execution.md`)
   - Workers fetch context via `bd show <task_id>` (not embedded spec)
   - Workers complete with `bd close --continue` (auto-advances Beads dep graph)
6. **Next wave via Beads**: `bd ready --parent <id>` finds newly unblocked tasks → spawn next wave
7. **Aggregate**: Merge each worker branch, `bd worktree remove`, one `bd dolt push`

### parallel_state.json Schema (Audit Log Only)

`parallel_state.json` is now an audit log — it does **not** drive coordination (Beads does that).

```json
{
  "phase": "Phase 1: Core Setup",
  "execution_mode": "parallel",
  "started_at": "2024-12-30T10:00:00Z",
  "workers": [
    {
      "worker_id": "worker_0_auth",
      "task": "Task 1: Create auth module",
      "beads_task_id": "bd-a3f8.1.1",
      "worktree": ".worktrees/auth_20240101_worker_0_auth",
      "branch": "track_auth_20240101_worker_0_auth",
      "status": "completed",
      "commit_sha": "abc1234"
    }
  ],
  "completed_workers": 1,
  "total_workers": 3
}
```

### When to Use Parallel Execution

- ✅ Tasks modifying different files (physically isolated by worktrees)
- ✅ Independent components (auth, config, utils)
- ✅ Multiple test file creation
- ❌ Tasks that must share a file (make them sequential)
- ❌ Tasks with sequential logical dependencies (use `<!-- depends: taskN -->`)
