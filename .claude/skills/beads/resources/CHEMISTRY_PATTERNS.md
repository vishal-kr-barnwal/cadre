# Chemistry Patterns

> Adapted from ACF beads skill

Beads uses a chemistry metaphor for work templates. This guide covers when and how to use each phase.

## Phase Transitions

```
┌─────────────────────────────────────────────────────────────┐
│                    PROTO (Solid)                            │
│              Frozen template, reusable pattern              │
│                    .beads/ with template label              │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               │               ▼
┌─────────────────┐       │       ┌─────────────────┐
│   MOL (Liquid)  │       │       │  WISP (Vapor)   │
│  bd mol pour    │       │       │  bd mol wisp    │
│                 │       │       │                 │
│  Persistent     │       │       │  Ephemeral      │
│  .beads/        │       │       │  Dolt wisps tbl │
│  Git synced     │       │       │  dolt_ignore    │
└────────┬────────┘       │       └────────┬────────┘
         │                │                │
         │                │        ┌───────┴───────┐
         │                │        │               │
         ▼                │        ▼               ▼
   ┌──────────┐           │   ┌─────────┐    ┌─────────┐
   │  CLOSE   │           │   │ SQUASH  │    │  BURN   │
   │ normally │           │   │ → digest│    │ → gone  │
   └──────────┘           │   └─────────┘    └─────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │   DISTILL     │
                  │ Extract proto │
                  │ from ad-hoc   │
                  │ epic          │
                  └───────────────┘
```

## Decision Tree: Mol vs Wisp

```
Will this work be referenced later?
│
├─ YES → Does it need audit trail / git history?
│        │
│        ├─ YES → MOL (bd mol pour)
│        │        Examples: Features, bugs, specs
│        │
│        └─ NO  → Could go either way
│                 Consider: Will someone else see this?
│                 │
│                 ├─ YES → MOL
│                 └─ NO  → WISP (then squash if valuable)
│
└─ NO  → WISP (bd mol wisp)
         Examples: Grooming, health checks, scratch work
         End state: burn (no value) or squash (capture learnings)
```

## Quick Reference

| Scenario | Use | Command | End State |
|----------|-----|---------|-----------|
| New feature work | Mol | `bd mol pour spec` | Close normally |
| Bug fix | Mol | `bd mol pour bug` | Close normally |
| Grooming session | Wisp | `bd mol wisp grooming` | Squash → digest |
| Code review | Wisp | `bd mol wisp pr-review` | Squash findings |
| Research spike | Wisp | `bd mol wisp spike` | Squash or burn |
| Session health check | Wisp | `bd mol wisp health` | Burn |
| Agent coordination | Wisp | `bd mol wisp coordinator` | Burn |

## Common Patterns

### Pattern 1: Grooming Wisp

Use for periodic backlog maintenance.

```bash
# Start grooming
bd mol wisp grooming --var date="2025-01-02"

# Work through checklist (stale, duplicates, verification)
# Track findings in wisp notes

# End: capture summary
bd mol squash <wisp-id>  # Creates digest: "Closed 3, added 5 relationships"
```

**Why wisp?** Grooming is operational—you don't need permanent issues for "reviewed stale items."

### Pattern 2: Code Review Wisp

Use for PR review checklists.

```bash
# Start review
bd mol wisp pr-review --var pr="123" --var repo="myproject"

# Track review findings (security, performance, style)
# Each finding is a child issue in the wisp

# End: promote real issues, discard noise
bd mol squash <wisp-id>  # Creates permanent issues for real findings
```

**Why wisp?** Review checklists are ephemeral. Only actual findings become permanent issues.

### Pattern 3: Research Spike Wisp

Use for time-boxed exploration.

```bash
# Start spike (2 hour timebox)
bd mol wisp spike --var topic="GraphQL pagination"

# Explore, take notes in wisp issues
# Track sources, findings, dead ends

# End: decide outcome
bd mol squash <wisp-id>  # If valuable → creates research summary issue
# OR
bd mol burn <wisp-id>    # If dead end → no trace
```

**Why wisp?** Research might lead nowhere. Don't pollute the database with abandoned explorations.

## Commands Reference

### Creating Work

```bash
# Persistent mol (solid → liquid)
bd mol pour <proto>                # Synced to git
bd mol pour <proto> --var key=value

# Ephemeral wisp (solid → vapor)
bd mol wisp <proto>                # Not synced
bd mol wisp <proto> --var key=value
```

### Ending Work

```bash
# Mol: close normally
bd close <mol-id>

# Wisp: squash (condense to digest)
bd mol squash <wisp-id>            # Creates permanent digest issue

# Wisp: burn (evaporate, no trace)
bd mol burn <wisp-id>              # Deletes with no record
```

### Managing

```bash
# List wisps
bd mol wisp list

# Garbage collect orphaned wisps
bd mol wisp gc
bd mol wisp gc --closed --force      # Purge all closed wisps

# View proto/mol structure
bd mol show <id>

# List available formulas/protos
bd formula list
```

## Storage Locations

| Type | Location | Git Behavior |
|------|----------|--------------|
| Proto | `.beads/` | Synced (template label) |
| Mol | `.beads/` | Synced |
| Wisp | Dolt `wisps` table | `dolt_ignore` (excluded from sync) |

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Create mol for one-time diagnostic | Use wisp, then burn |
| Create wisp for real feature work | Use mol (needs audit trail) |
| Burn wisp with valuable findings | Squash first (captures digest) |
| Let wisps accumulate | Burn or squash at session end |
| Create ad-hoc epics for repeatable patterns | Distill into proto |

## Related Resources

- [MOLECULES.md](MOLECULES.md) — Proto definitions
- [WORKFLOWS.md](WORKFLOWS.md) — General beads workflows
