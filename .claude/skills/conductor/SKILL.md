---
name: conductor
description: |
  Context-driven development methodology for organized, spec-first coding. Use when:
  - Project has a `conductor/` directory
  - User mentions specs, plans, tracks, or context-driven development
  - Files like `conductor/tracks.md`, `conductor/product.md`, `conductor/workflow.md` exist
  - User asks about project status, implementation progress, or track management
  - User wants to organize development work with TDD practices
  - User invokes `/conductor-*` commands (setup, newtrack, implement, status, revert, validate, flag, revise, review, ship, land, archive, release, handoff, refresh, formula)
  - User mentions documentation is outdated or wants to sync context with codebase changes
  - Project is a polyrepo control repo (`conductor/repos.json` with mode "polyrepo") spanning git-submodule product repos
  
  Interoperable across Claude Code, OpenAI Codex CLI, Cursor, Google Antigravity, and GitHub Copilot.
  Integrates with Beads for persistent task memory across sessions.
---

# Conductor: Context-Driven Development

Measure twice, code once.

## Overview

Conductor enables context-driven development by:
1. Establishing project context (product vision, tech stack, workflow)
2. Organizing work into "tracks" (features, bugs, improvements)
3. Creating specs and phased implementation plans
4. Executing with TDD practices and progress tracking
5. **Parallel execution** of independent tasks using sub-agents

For parallel execution details (annotations, state schema, when to use), see [references/workflows.md](references/workflows.md#parallel-execution).

## Context Loading

When this skill activates, load these files to understand the project:
1. `conductor/product.md` - Product vision and goals
2. `conductor/tech-stack.md` - Technology constraints
3. `conductor/workflow.md` - Development methodology (TDD, commits)
4. `conductor/tracks.md` - Current work status
5. `conductor/patterns.md` - **Codebase patterns (read before starting work)**

**Important**: Conductor commits locally but never pushes. Users decide when to push to remote.

For active tracks, also load:
- `conductor/tracks/<track_id>/spec.md`
- `conductor/tracks/<track_id>/plan.md`
- `conductor/tracks/<track_id>/learnings.md` - **Patterns/gotchas from this track**

## Learnings System (Ralph-style)

Conductor captures and consolidates learnings across tracks. For full details, see [references/learnings-system.md](references/learnings-system.md).

### Key Files
- `conductor/patterns.md` - Project-level consolidated patterns
- `conductor/tracks/<id>/learnings.md` - Per-track discoveries

### Templates
- [references/patterns-template.md](references/patterns-template.md) - Full patterns.md template
- [references/learnings-template.md](references/learnings-template.md) - Full learnings.md template

### Knowledge Flywheel
1. **Capture** - After each task, append to track's `learnings.md`
2. **Elevate** - At phase/track completion, promote reusable patterns to `patterns.md`
3. **Archive** - Extract remaining patterns before archiving
4. **Inherit** - New tracks read `patterns.md` to prime context

## Beads Integration

Beads integration is **always attempted** for persistent task memory. If `bd` CLI is unavailable or fails, the user can choose to continue without it. All conductor commands work normally without Beads.

For full Beads details (availability check, CLI commands, session protocol, chemistry patterns), see [references/beads-integration.md](references/beads-integration.md).

For Beads overview within workflow context (sync behavior, configuration, graceful degradation), see [references/workflows.md](references/workflows.md#beads-integration).

### Quick Detection (MUST check before using bd commands)

```bash
if which bd > /dev/null 2>&1 && [ -f conductor/beads.json ]; then
  BEADS_ENABLED=$(cat conductor/beads.json | grep -o '"enabled"[[:space:]]*:[[:space:]]*true' || echo "")
  if [ -n "$BEADS_ENABLED" ]; then
    # Beads is available and enabled - use bd commands (requires Dolt server: bd dolt start)
  fi
fi
```

## Proactive Behaviors

1. **On new session**: Check for in-progress tracks, offer to resume
2. **On task completion**: Suggest next task or phase verification
3. **On blocked detection**: Alert user and suggest alternatives
4. **On all tasks complete**: Congratulate and walk the ship pipeline — suggest `/conductor-review`, then `/conductor-ship`, then `/conductor-archive` (and `/conductor-release` once enough tracks have shipped)
5. **On stale context detected**: If setup >2 days old or significant codebase changes detected, suggest `/conductor-refresh`
6. **On Beads available**: If `bd` CLI detected during setup, offer integration
7. **On implement start**: Read `patterns.md` and announce pattern count
8. **On task complete**: Prompt for learnings capture
9. **On phase complete**: Offer pattern elevation to `patterns.md`
10. **On archive**: Extract remaining patterns before archiving
11. **On refresh**: Consolidate learnings across all tracks

## Intent Mapping

| User Intent | Command |
|-------------|---------|
| "Set up this project" | `/conductor-setup` |
| "Create a new feature" | `/conductor-newtrack [desc]` |
| "Start working" / "Implement" | `/conductor-implement [id]` |
| "What's the status?" | `/conductor-status` |
| "Undo that" / "Revert" | `/conductor-revert` |
| "Check for issues" | `/conductor-validate` |
| "This is blocked" / "Skip this task" | `/conductor-flag <blocked\|skipped>` |
| "This needs revision" / "Spec is wrong" | `/conductor-revise` |
| "Review this" / "Check the diff before merge" | `/conductor-review [track_id]` |
| "Ship it" / "Open the PR" / "Push the branch" | `/conductor-ship [track_id]` |
| "Save context" / "Handoff" / "Transfer to next section" | `/conductor-handoff` |
| "Archive completed" | `/conductor-archive` |
| "Cut a release" / "Update the changelog" / "Tag a version" | `/conductor-release [bump]` |
| "Export summary" | `/conductor-status --export` |
| "Docs are outdated" / "Sync with codebase" | `/conductor-refresh` |
| "List templates" / "Show formulas" | `/conductor-formula` |
| "Quick exploration" / "Ephemeral track" | `/conductor-formula wisp [formula]` |
| "Extract template" / "Create reusable pattern" | `/conductor-formula create [track_id]` |

## Command Execution

When a user invokes any `/conductor-*` command, **read the corresponding canonical command** for the full step-by-step protocol:

| Command | Full Protocol |
|---------|---------------|
| `/conductor-setup` | [../../commands/conductor-setup.md](../../commands/conductor-setup.md) |
| `/conductor-newtrack` | [../../commands/conductor-newtrack.md](../../commands/conductor-newtrack.md) |
| `/conductor-implement` | [../../commands/conductor-implement.md](../../commands/conductor-implement.md) |
| `/conductor-status` | [../../commands/conductor-status.md](../../commands/conductor-status.md) |
| `/conductor-revert` | [../../commands/conductor-revert.md](../../commands/conductor-revert.md) |
| `/conductor-validate` | [../../commands/conductor-validate.md](../../commands/conductor-validate.md) |
| `/conductor-flag` | [../../commands/conductor-flag.md](../../commands/conductor-flag.md) |
| `/conductor-revise` | [../../commands/conductor-revise.md](../../commands/conductor-revise.md) |
| `/conductor-review` | [../../commands/conductor-review.md](../../commands/conductor-review.md) |
| `/conductor-ship` | [../../commands/conductor-ship.md](../../commands/conductor-ship.md) |
| `/conductor-land` | [../../commands/conductor-land.md](../../commands/conductor-land.md) |
| `/conductor-archive` | [../../commands/conductor-archive.md](../../commands/conductor-archive.md) |
| `/conductor-release` | [../../commands/conductor-release.md](../../commands/conductor-release.md) |
| `/conductor-handoff` | [../../commands/conductor-handoff.md](../../commands/conductor-handoff.md) |
| `/conductor-refresh` | [../../commands/conductor-refresh.md](../../commands/conductor-refresh.md) |
| `/conductor-formula` | [../../commands/conductor-formula.md](../../commands/conductor-formula.md) |

**Important:** Always read the full canonical command before executing. Each file contains the complete protocol with error handling, Beads integration, and user interaction flows.

## References

- **Workflow overview**: [references/workflows.md](references/workflows.md) - Commands table, Beads overview, state files, status markers, parallel execution
- **Command protocols**: [../../commands/](../../commands/) - Full step-by-step execution details for all 16 commands
- **Directory structure**: [references/structure.md](references/structure.md) - File layout and status markers
- **Beads integration**: [references/beads-integration.md](references/beads-integration.md) - Session protocol, CLI commands, chemistry patterns
- **Learnings system**: [references/learnings-system.md](references/learnings-system.md) - Ralph-style knowledge capture details
- **Patterns template**: [references/patterns-template.md](references/patterns-template.md) - Template for conductor/patterns.md
- **Learnings template**: [references/learnings-template.md](references/learnings-template.md) - Template for track learnings.md
