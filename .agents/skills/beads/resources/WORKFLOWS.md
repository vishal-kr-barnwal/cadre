# Workflows and Checklists

Detailed step-by-step workflows for common bd usage patterns with checklists.

> **v1.0.2:** Beads uses embedded Dolt by default. No external server (`bd dolt start`) is required.

## Contents

- [Session Start Workflow](#session-start) - Check bd ready, establish context
- [Compaction Survival](#compaction-survival) - Recovering after compaction events
- [Discovery and Issue Creation](#discovery) - Proactive issue creation during work
- [Status Maintenance](#status-maintenance) - Keeping bd status current
- [Epic Planning](#epic-planning) - Structuring complex work with dependencies
- [Side Quest Handling](#side-quests) - Discovery during main task, assessing blocker vs deferrable, resuming
- [Multi-Session Resume](#resume) - Returning after days/weeks away
- [Session Handoff Workflow](#session-handoff) - Collaborative handoff between sessions
- [Unblocking Work](#unblocking) - Handling blocked issues
- [Common Workflow Patterns](#common-workflow-patterns)
  - Systematic Exploration, Bug Investigation, Refactoring with Dependencies, Spike Investigation
- [Checklist Templates](#checklist-templates)
  - Starting Any Work Session, Creating Issues During Work, Completing Work, Planning Complex Features
- [Decision Points](#decision-points)
- [Troubleshooting Workflows](#troubleshooting-workflows)

## Session Start Workflow {#session-start}

**bd is available when**:
- Project has `.beads/` directory (project-local), OR
- `~/.beads/` exists (global fallback)

**Automatic checklist at session start:**

```
Session Start (when bd is available):
- [ ] Run bd ready --json
- [ ] Report: "X items ready to work on: [summary]"
- [ ] Suggest next action based on findings
```

**Pattern**: Always run `bd ready` when starting work where bd is available. Report status immediately to establish shared context.

---

## Compaction Survival {#compaction-survival}

**Critical**: After compaction events, conversation history is deleted but bd state persists. Beads are your only memory.

**Post-compaction recovery checklist:**

```
After Compaction:
- [ ] Run bd list --status in_progress to see active work
- [ ] Run bd show <issue-id> for each in_progress issue
- [ ] Read notes field to understand: COMPLETED, IN PROGRESS, BLOCKERS, KEY DECISIONS
- [ ] Check dependencies: bd dep tree <issue-id> for context
- [ ] If notes insufficient, check bd list --status open for related issues
```

**Pattern**: Well-written notes enable full context recovery even with zero conversation history.

**Writing notes for compaction survival:**

**Good note (enables recovery):**
```bash
bd note issue-42 "COMPLETED: User authentication - added JWT token
generation with 1hr expiry, implemented refresh token endpoint using rotating
tokens pattern. IN PROGRESS: Password reset flow. Email service integration
working. NEXT: Need to add rate limiting to reset endpoint (currently unlimited
requests). KEY DECISION: Using bcrypt with 12 rounds after reviewing OWASP
recommendations."
```

**Bad note (insufficient for recovery):**
```bash
bd note issue-42 "Working on auth feature. Made some progress. More to do later."
```

**After compaction**: `bd show issue-42` reconstructs the full context needed to continue work.

---

## Discovery and Issue Creation {#discovery}

**When encountering new work during implementation:**

```
Discovery Workflow:
- [ ] Notice bug, improvement, or follow-up work
- [ ] Assess: Can defer or is blocker?
- [ ] Create issue with bd create "Issue title" -t bug|story
- [ ] Add discovered-from dependency: bd dep add new-id current-id --type discovered-from
- [ ] If blocker: pause and switch; if not: continue current work
```

**Pattern**: Proactively file issues as you discover work. Context captured immediately instead of lost when session ends.

---

## Status Maintenance {#status-maintenance}

**Throughout work on an issue:**

```
Issue Lifecycle:
- [ ] Start: Update status to in_progress
- [ ] During: Add design notes as decisions made
- [ ] During: Update acceptance criteria if requirements clarify
- [ ] During: Add dependencies if blockers discovered
- [ ] Complete: Close with summary of what was done (bd close)
```

---

## Epic Planning {#epic-planning}

**For complex multi-step features, think in Ready Fronts.**

### Epic Planning Workflow

```
Epic Planning with Ready Fronts:
- [ ] Create epic issue for high-level goal
- [ ] Create milestone issues for phases
- [ ] Create story issues named by WHAT, not WHEN
- [ ] Add deps using requirement language: "X needs Y" → bd dep add X Y
- [ ] Verify with bd blocked
- [ ] Use bd ready to work through in dependency order
```

### Example: OAuth Integration

```bash
# Create epic (the goal)
bd create "OAuth integration" -t epic

# Create milestones
bd create "Phase 1: Credentials" -t milestone --parent bd-1
bd create "Phase 2: Flow" -t milestone --parent bd-1

# Create stories
bd create "Generate client secrets" -t story --parent bd-2
bd create "Implement Auth Code Flow" -t story --parent bd-3

# Add deps
bd dep add bd-3 bd-2  # Flow needs credentials
```

---

## Multi-Session Resume {#resume}

**Starting work after days/weeks away:**

```
Resume Workflow:
- [ ] Run bd ready to see available work
- [ ] Run bd stats for project overview
- [ ] Show details on issue to work on: bd show <id>
- [ ] Review notes (bd show <id> --notes)
- [ ] Begin work with full context
```

---

## Session Handoff Workflow {#session-handoff}

**Collaborative handoff between sessions using notes field:**

### At Session Start

```
Session Start with in_progress issues:
- [ ] Run bd list --status in_progress
- [ ] For each in_progress issue: bd show <issue-id>
- [ ] Read notes field to understand: COMPLETED, IN PROGRESS, NEXT
```

### At Session End

When wrapping up work on an issue:

```bash
bd note <issue-id> "COMPLETED: X. IN PROGRESS: Y. NEXT: Z"
bd dolt push
```

**Rules for handoff notes:**
- Current state only (overwrite previous notes, not append)
- Specific accomplishments
- Concrete next step
- Written for someone with zero conversation context

---

## Unblocking Work {#unblocking}

**When ready list is empty:**

```
Unblocking Workflow:
- [ ] Run bd blocked --json to see what's stuck
- [ ] Identify blocker issues
- [ ] Resolve blocker or reassess dependency
- [ ] bd ready automatically shows next step
```

---

## Common Workflow Patterns

### Pattern: Systematic Exploration

Research or investigation work:

```
1. Create spike issue: "Investigate caching options"
2. Document findings via bd note as you go
3. Create new stories for discoveries
4. Close spike with recommendation
```

---

## Checklist Templates

### Starting Any Work Session

```
- [ ] bd ready
- [ ] Report status
- [ ] Update active issue to in_progress
- [ ] Begin work
```

### Completing Work

```
- [ ] Implementation done
- [ ] Tests passing
- [ ] bd note <id> "SUMMARY: ..."
- [ ] bd close <id>
- [ ] bd dolt push
```
