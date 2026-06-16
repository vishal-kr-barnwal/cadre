# Beads Integration Reference

## Overview

Cadre integrates with [Beads](https://github.com/steveyegge/beads) to provide persistent task memory that survives context compaction. This creates a hybrid system:

> **Compatible with Beads v1.0.2+.** Uses embedded Dolt by default — no external server required.

- **Cadre**: Human-readable specs and plans
- **Beads**: Agent-optimized task state with dependency tracking

**IMPORTANT: Beads integration is always attempted.** If `bd` CLI is unavailable or fails, the user is prompted to choose whether to continue without persistent task memory. Cadre still functions fully, just without cross-session state.

## CRITICAL: Availability Check

**You MUST run this check before using ANY `bd` command:**

```bash
# Check if Beads is available and enabled
BEADS_AVAILABLE=false
if which bd > /dev/null 2>&1; then
  if [ -f cadre/beads.json ]; then
    if grep -q '"enabled"[[:space:]]*:[[:space:]]*true' cadre/beads.json 2>/dev/null; then
      BEADS_AVAILABLE=true
    fi
  fi
fi

# ONLY use bd commands if BEADS_AVAILABLE is true
# Otherwise, skip all bd commands and use plan.md markers only
```

**If BEADS_AVAILABLE is false:**
- Do NOT run any `bd` commands
- Use `plan.md` markers for all task tracking
- Cadre workflows work identically without Beads

## How It Works (when Beads is enabled)

### Session Protocol (Enhanced - Based on Beads v1.0.2+ Best Practices)

The recommended session workflow for maximum context preservation:

> **v1.0.2+:** Beads uses embedded Dolt by default — no `bd dolt start` required.

1. `bd prime` — Load AI-optimized workflow context (run first!)
2. `bd ready` — Find unblocked work
3. `bd show <id>` — Get full context and audit trail
4. `bd update <id> --status in_progress` — Start work
5. **Add notes as you work** (critical for compaction survival)
6. `bd close <id> --continue` — Complete and auto-advance to next step
7. `bd dolt push` — Push to Dolt remote (always run at session end)

**Key insight:** `bd close --continue` automatically marks the next step as in_progress, reducing commands from 3 to 1.

### Ownership Model

| Component | Cadre Owns | Beads Owns |
|-----------|----------------|------------|
| Specs | `spec.md` (requirements) | — |
| Plans | `plan.md` (task list) | — |
| Task State | Status markers `[ ]` `[~]` `[x]` | Full state + dependencies |
| Memory | Session-bound | Cross-session persistent |

### Track → Epic Mapping

Each Cadre track becomes a Beads epic:

```
cadre/tracks/auth_20250115/
├── spec.md          # Cadre: requirements
├── plan.md          # Cadre: task breakdown
└── metadata.json    # Links to Beads epic ID + task mapping
```

Beads state is stored in the Dolt database (not as files). Access via `bd show <epic_id>`.

### Task ID Mapping

The `metadata.json` contains a `beads_tasks` mapping that links plan tasks to Beads IDs:

```json
{
  "track_id": "auth_20250115",
  "beads_epic": "bd-a3f8",
  "beads_tasks": {
    "phase1": "bd-a3f8.1",
    "phase1_task1": "bd-a3f8.1.1",
    "phase1_task2": "bd-a3f8.1.2",
    "phase2": "bd-a3f8.2",
    "phase2_task1": "bd-a3f8.2.1"
  }
}
```

**Key naming convention:**
- Phase keys: `phase{N}` (1-indexed)
- Task keys: `phase{N}_task{M}` (both 1-indexed)

**Usage during implementation:**
1. Store `beads_enabled=true` flag when Beads is detected
2. Load `beads_tasks` mapping from metadata.json
3. Generate task key from current phase/task index
4. Look up Beads ID from mapping
5. Use Beads ID for `bd update` and `bd close` commands

### Bidirectional Sync

1. **plan.md → Beads**: Tasks created/updated in plan sync to Beads
2. **Beads → plan.md**: Status changes reflect back to plan markers
3. **Conflict resolution**: Beads state is authoritative for status

## What Cadre READS from Beads

| What | Command | Used For |
|------|---------|----------|
| **Ready tasks** | `bd ready --parent <id>` | Task selection (dependency-aware, no blockers) |
| **Epic notes** | `bd show <epic_id>` | Session resume, context recovery after compaction |
| **Task status** | `bd show <task_id>` | Verify current state, check blockers |
| **Blocked info** | `bd show <task_id>` | Understand what's blocking and why |

### Context Recovery Flow (after compaction)

```bash
# 1. Read epic to get last session context
bd show <epic_id>
# Returns notes: "COMPLETED: Phase 1, IN PROGRESS: auth middleware, NEXT: add rate limiting"

# 2. Get ready tasks
bd ready --parent <epic_id>
# Returns: tasks with no blockers, sorted by priority

# 3. Resume with full context even if conversation history is gone
```

## What Cadre WRITES to Beads

| When | Command | Data Written |
|------|---------|--------------|
| **Task start** | `bd update --status in_progress` | Status change |
| **Task complete** | `bd close --reason` | Completion + commit SHA |
| **Task blocked** | `bd update --status blocked` | Block reason |
| **Phase complete** | `bd update --notes` | COMPLETED/IN PROGRESS/NEXT summary |
| **Handoff** | `bd update --notes` | Full session context for recovery |

## Chemistry Patterns (Molecules)

Beads supports workflow templates called "molecules" for multi-step work:

### When to Use Molecules vs Direct Tasks

| Use Case | Approach | Command |
|----------|----------|---------|
| Single task | Direct Beads task | `bd create` + `bd close` |
| Multi-step workflow | Persistent molecule | `bd mol pour <proto>` |
| Ephemeral/patrol work | Wisp (vapor) | `bd mol wisp <proto>` |
| Reusable template | Formula → Proto | `bd cook <formula>` |

### Molecule Navigation

```bash
# Where am I in the molecule?
bd mol current

# Close step and auto-advance to next
bd close <step-id> --continue

# Squash completed molecule to digest
bd mol squash <molecule-id>
```

### Mol vs Wisp Decision Tree

```
Is this work permanent/auditable?
├─ YES → Use `bd mol pour` (persistent, synced to git)
│   └─ Examples: Feature tracks, bug fixes, releases
│
└─ NO → Use `bd mol wisp` (ephemeral, never synced)
    └─ Examples: Patrol cycles, health checks, temp exploration
```

### Molecule Lifecycle

```
Formula (source TOML) ─── "Ice-9"
    │
    ▼ bd cook
Protomolecule (frozen template) ─── Solid
    │
    ├─▶ bd mol pour ──▶ Mol (persistent) ──▶ bd squash ──▶ Digest
    │
    └─▶ bd mol wisp ──▶ Wisp (ephemeral) ──┬▶ bd squash ──▶ Digest
                                           └▶ bd burn ──▶ (gone)
```

## Graph Links Integration

Cadre can leverage Beads graph links for richer track relationships:

| Link Type | Cadre Use Case | Command |
|-----------|-------------------|---------|
| `relates_to` | Link related tracks/tasks | `bd dep relate <id1> <id2>` |
| `supersedes` | Spec revisions (v1 → v2) | `bd supersede <old> --with <new>` |
| `duplicate_of` | Deduplicate similar tasks | `bd duplicate <dup> --of <canonical>` |
| `discovered_from` | Work discovered during implementation | `bd create --deps discovered-from:<parent>` |

### Track Relationship Example

```bash
# Two tracks are related
bd dep relate cadre_auth cadre_security

# Spec revision supersedes old version
bd supersede bd-spec-v1 --with bd-spec-v2

# During implementation, find duplicate task
bd duplicate bd-task-dup --of bd-task-canonical
```

## Messaging Integration

When using parallel workers, Beads messaging can coordinate between agents:

```bash
# Coordinator notifies worker
bd mail send worker_1/ -s "Task assigned" -m "Work on bd-task-123"

# Worker reports completion
bd mail reply msg-123 -m "Task completed, commit abc1234"

# Check for worker updates
bd mail inbox
```

> **Note:** Messaging requires a mail delegate (e.g., `gt mail`). If not configured, use `bd update --notes` for coordination instead.

> **Tip:** Use the `decision` issue type (`bd create -t decision`) for architectural decisions made during `/cadre-revise`.

## Configuration

Enable integration via `cadre/beads.json`:

```json
{
  "enabled": true,
  "auto_sync": true,
  "epic_prefix": "cadre",
  "sync_on_implement": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable/disable Beads integration |
| `auto_sync` | boolean | Sync on every task completion |
| `epic_prefix` | string | Prefix for Beads epic IDs |
| `sync_on_implement` | boolean | Sync before `/cadre-implement` |

## Command Mapping

| Cadre Command | Beads Operations | Description |
|-------------------|------------------|-------------|
| `/cadre-setup` | `bd init` | Initialize Beads in project |
| `/cadre-newtrack` | `bd create` (epic + tasks) | Create epic with linked tasks |
| `/cadre-implement` | `bd ready` → `bd update` → `bd done` | Get next task, track progress, complete |
| `/cadre-status` | `bd ready`, `bd show` | Show available tasks, epic status |
| `/cadre-flag blocked` | `bd update --status blocked` | Mark task blocked with reason |
| `/cadre-flag skipped` | `bd update --status skipped` / `bd close` | Skip task with justification |
| `/cadre-ship` | `bd dolt push` | Flush Dolt state before rebase/push |
| `/cadre-archive` | `bd admin compact --auto` | Archive completed epics |

### Example Flow

```bash
# User runs /cadre-implement

# 1. Cadre checks Beads for ready tasks
bd ready --parent auth_20250115

# 2. Agent works on task, updates status
bd update TASK-001 --status in_progress

# 3. On completion
bd close TASK-001 --reason "Implemented JWT validation"

# 4. Cadre updates plan.md markers
[x] Task 1: Implement JWT validation <!-- SHA: abc123 -->
```

## Benefits

### Cross-Session Memory
- Task state persists across context compaction
- Agent resumes exactly where it left off
- No re-reading of entire plan.md needed

### Compaction Survival Notes

When updating task status, use structured notes for recovery after compaction:

```bash
bd update TASK-001 --notes "COMPLETED: JWT validation with RS256
KEY DECISION: RS256 over HS256 for key rotation
IN PROGRESS: Password reset flow
NEXT: Implement rate limiting
BLOCKER: None
DISCOVERED: Found race condition in token refresh (created bd-xyz)"
```

**Notes format (use ALL relevant fields):**
- `COMPLETED:` - What was finished (past tense, specific)
- `KEY DECISION:` - Important choices made (with rationale)
- `IN PROGRESS:` - Current work
- `NEXT:` - Immediate next step (concrete action)
- `BLOCKER:` - What's blocking (if any)
- `DISCOVERED:` - New issues found during work (with beads ID)

**Best practices:**
- Write notes as if explaining to someone with zero context
- Include technical specifics, not vague progress
- Update notes BEFORE session end or handoff
- Use `bd dolt push` after updating notes to ensure persistence

This enables full context recovery after compaction with zero conversation history.

### Discovered-From Tracking

When discovering new work during implementation, link it:

```bash
# Create discovered issue with automatic linking
bd create "Found race condition in token refresh" \
  -t bug -p 2 \
  --deps discovered-from:<current_task_id> \
  --json
```

**Benefits:**
- Builds graph of agent thinking and discovery
- Reconstructs context: "Why was this created?"
- Tracks work trail: "What else was found?"

### Dependency-Aware Selection
- `bd ready` returns only unblocked tasks
- Respects task dependencies defined in plan
- Prevents out-of-order execution

### Audit Trail
- Every status change logged in Beads
- Notes attached to task completions
- Full history survives compaction

## Fallback Behavior (IMPORTANT)

### Decision Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Is `bd` command installed?                          │
│   Run: which bd > /dev/null 2>&1                            │
│   NO  → STOP. Do not use any bd commands.                   │
│   YES → Continue to Step 2                                  │
├─────────────────────────────────────────────────────────────┤
│ Step 2: Does cadre/beads.json exist?                    │
│   NO  → STOP. Do not use any bd commands.                   │
│   YES → Continue to Step 3                                  │
├─────────────────────────────────────────────────────────────┤
│ Step 3: Is "enabled": true in cadre/beads.json?         │
│   NO  → STOP. Do not use any bd commands.                   │
│   YES → Use Beads integration                               │
└─────────────────────────────────────────────────────────────┘
```

### Failure Handling

| Scenario | Behavior |
|----------|----------|
| `bd` not installed | Cadre operates normally without Beads |
| `bd` command fails | Log warning, continue with plan.md only |
| Sync conflict | Beads state wins, plan.md updated |
| `.beads/` missing | Auto-initialize on next command |

### Detection Logic

```python
# Pseudo-code for integration check
def should_use_beads():
    if not shutil.which("bd"):
        return False
    if not Path("cadre/beads.json").exists():
        return False
    config = load_json("cadre/beads.json")
    return config.get("enabled", False)
```

## Parallel Execution Integration

When Cadre executes tasks in parallel, Beads provides coordination:

### Worktree Architecture

Each parallel worker runs in a dedicated git worktree with a Beads redirect file. All workers share the same Dolt database — coordination happens through Beads, not through a shared state file.

```
repo/
├── .beads/                          ← Single Dolt DB (source of truth)
└── .worktrees/
    ├── auth_20240101/               ← Track worktree (branch: track/auth_20240101)
    │   └── .beads                   ← Redirect → ../../.beads/
    └── payments_20240101/           ← Another track (concurrent)
        └── .beads                   ← Redirect → ../../.beads/
        └── .worktrees/
            ├── worker_0_schema/     ← Parallel worker
            │   └── .beads           ← Redirect → shared .beads/
            └── worker_1_api/        ← Parallel worker
                └── .beads           ← Redirect → shared .beads/
```

### Wave-Model Worker Protocol

**Coordinator before spawning each wave:**
```bash
# Pre-assign tasks to workers
bd update <task_id> --status in_progress \
  --assignee worker_<N>_<name> --json

# Create isolated worktree per worker
bd worktree create .worktrees/<track_id>_worker_<N>_<name> \
  --branch track_<track_id>_worker_<N>_<name>
```

**Each worker's completion sequence (in worker prompt):**
```bash
# 1. Commit code (inside worktree)
git commit -m "feat(scope): description"

# 2. Note to Beads (structured for compaction survival)
bd note <task_id> "COMPLETED: <description>
COMMIT: <sha>
FILES: <list>
PATTERNS: <any reusable patterns found>" --json

# 3. Close and auto-advance dependency graph
bd close <task_id> --continue --reason "Task completed" --json
# (--continue marks dependent tasks as ready — drives next wave)

# Do NOT run bd dolt push — coordinator handles this once
```

**Coordinator after all waves complete:**
```bash
# Merge each worker branch
for worker in completed_workers:
    git merge --no-ff track_<track_id>_worker_<N>_<name> \
      -m "cadre(parallel): merge worker_<N>: <task>"
    bd worktree remove .worktrees/<track_id>_worker_<N>_<name>

# One push for all workers combined
bd dolt push
bd ready --parent <epic_id> --json  # Verify empty (all done)
```

**Wave scheduling via Beads (replaces 30s polling):**
```bash
# After each wave completes, find next wave
bd ready --parent <epic_id> --json
# Returns tasks whose dependencies were auto-advanced by --continue
# Spawn those as the next wave
```

### Concurrent Safety

Beads handles concurrent updates safely:

| Scenario | Beads Behavior |
|----------|----------------|
| **Multiple `bd update` simultaneously** | Dolt transactions serialize writes |
| **Same task updated by two workers** | Last writer wins (avoid via assignee) |
| **Parallel `bd create`** | Hash IDs prevent collisions |
| **Rapid status changes** | Batch auto-commit mode reduces commit bloat |

### Notes Format for Parallel Context

Workers should include worker context in notes:

```bash
bd update <task_id> --notes "WORKER: worker_1_auth
TASK: Create auth module
FILES: src/auth/index.ts, src/auth/index.test.ts
STATUS: Completed
COMMIT: abc1234
DURATION: 5 min"
```

### Error Recovery

If a worker fails mid-execution:

```bash
# Coordinator detects worker timeout/failure
bd update <task_id> --status open \
  --notes "Worker failed/timed out. Reassigning." \
  --json

# Clear assignee for retry
bd update <task_id> --assignee "" --json
```

## Quick Reference

```bash
# Check if Beads is available
which bd

# Start Dolt server (legacy only — NOT needed on v1.0.0+, which uses embedded Dolt)
# bd dolt start

# Initialize integration
bd init
echo '{"enabled": true}' > cadre/beads.json

# View current state
bd show --epic cadre_<track_id>

# See what's ready to work on
bd ready

# Push changes to remote
bd dolt push
```
