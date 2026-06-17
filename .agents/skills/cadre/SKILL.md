---
name: cadre
description: |
  Context-driven development methodology for organized, spec-first coding. Use when:
  - Project has a `cadre/` directory
  - User mentions specs, plans, tracks, or context-driven development
  - Files like `cadre/tracks.md`, `cadre/product.md`, `cadre/workflow.md` exist
  - User asks about project status, implementation progress, or track management
  - User wants to organize development work with TDD practices
  - User asks for a `cadre-*` workflow (setup, newtrack, implement, status, revert, validate, flag, revise, review, ship, land, archive, release, handoff, refresh, formula)
  - User mentions documentation is outdated or wants to sync context with codebase changes
  - Project is a polyrepo control repo (`cadre/repos.json` with mode "polyrepo") spanning git-submodule product repos
  
  Interoperable across OpenAI Codex and Claude Code.
  Integrates with Beads for persistent task memory across sessions.
---

# Cadre: Context-Driven Development

Measure twice, code once.

## Overview

Cadre enables context-driven development by:
1. Establishing project context (product vision, tech stack, workflow)
2. Organizing work into "tracks" (features, bugs, improvements)
3. Creating specs and phased implementation plans
4. Executing with TDD practices and progress tracking
5. **Parallel execution** of independent tasks using sub-agents

For parallel execution details (annotations, state schema, when to use), see [references/workflows.md](references/workflows.md#parallel-execution).

## Context Loading

Load **lazily**: pull each file only when a workflow actually needs it, and only
once per session. Do **not** eagerly read everything on activation — that scales the
fixed per-session cost with project age (`patterns.md` in particular grows with team
history, and a long `tracks.md` is rarely needed in full).

**Minimal activation set** (cheap, read once to understand the project):
1. `cadre/product.md` - Product vision and goals
2. `cadre/tech-stack.md` - Technology constraints
3. `cadre/workflow.md` - Development methodology (TDD, commits)

**Load on demand** (only from the workflows that use them):
- `cadre/tracks.md` — current work status; read the **marked index region only**,
  not the whole file. Status-aware workflows (`cadre-status`, `cadre-implement`)
  resolve status from each track's `metadata.json.status` (the source of truth)
  rather than this derived cache.
- `cadre/patterns.md` — **codebase patterns; read before starting work**
  (`cadre-implement`, `cadre-newtrack`). Workflows that never use it (e.g.
  `cadre-release`, `cadre-flag`, `cadre-status`) should not load it.

**Important**: Cadre commits locally but never pushes. Users decide when to push to remote.

For active tracks, load when working that track:
- `cadre/tracks/<track_id>/spec.md`
- `cadre/tracks/<track_id>/plan.md`
- `cadre/tracks/<track_id>/learnings.md` - **Patterns/gotchas from this track**

## Learnings System (Ralph-style)

Cadre captures and consolidates learnings across tracks. For full details, see [references/learnings-system.md](references/learnings-system.md).

### Key Files
- `cadre/patterns.md` - Project-level consolidated patterns
- `cadre/tracks/<id>/learnings.md` - Per-track discoveries

### Templates
- [references/patterns-template.md](references/patterns-template.md) - Full patterns.md template
- [references/learnings-template.md](references/learnings-template.md) - Full learnings.md template

### Knowledge Flywheel
1. **Capture** - After each task, append to track's `learnings.md`
2. **Elevate** - At phase/track completion, promote reusable patterns to `patterns.md`
3. **Archive** - Extract remaining patterns before archiving
4. **Inherit** - New tracks read `patterns.md` to prime context

## Beads Integration

Beads integration is **always attempted** for persistent task memory. If `bd` CLI is unavailable or fails, the user can choose to continue without it. All Cadre workflows work normally without Beads.

For full Beads details (availability check, CLI commands, session protocol, chemistry patterns), see [references/beads-integration.md](references/beads-integration.md).

For Beads overview within workflow context (sync behavior, configuration, graceful degradation), see [references/workflows.md](references/workflows.md#beads-integration).

### Quick Detection (MUST check before using bd commands)

```bash
if which bd > /dev/null 2>&1 && [ -f cadre/beads.json ]; then
  BEADS_ENABLED=$(cat cadre/beads.json | grep -o '"enabled"[[:space:]]*:[[:space:]]*true' || echo "")
  if [ -n "$BEADS_ENABLED" ]; then
    # Beads is available and enabled - use bd commands (embedded Dolt by default; no Dolt SQL server required)
  fi
fi
```

## Proactive Behaviors

1. **On new session**: Check for in-progress tracks, offer to resume
2. **On task completion**: Suggest next task or phase verification
3. **On blocked detection**: Alert user and suggest alternatives
4. **On all tasks complete**: Congratulate and walk the ship pipeline — suggest `cadre-review`, then `cadre-ship`, then `cadre-archive` (and `cadre-release` once enough tracks have shipped)
5. **On stale context detected**: If setup >2 days old or significant codebase changes detected, suggest `cadre-refresh`
6. **On Beads available**: If `bd` CLI detected during setup, offer integration
7. **On implement start**: Read `patterns.md` and announce pattern count
8. **On task complete**: Prompt for learnings capture
9. **On phase complete**: Offer pattern elevation to `patterns.md`
10. **On archive**: Extract remaining patterns before archiving
11. **On refresh**: Consolidate learnings across all tracks

## Intent Mapping

| User Intent | Workflow |
|-------------|---------|
| "Set up this project" | `cadre-setup` |
| "Create a new feature" | `cadre-newtrack [desc]` |
| "Start working" / "Implement" | `cadre-implement [id]` |
| "What's the status?" | `cadre-status` |
| "Undo that" / "Revert" | `cadre-revert` |
| "Check for issues" | `cadre-validate` |
| "This is blocked" / "Skip this task" | `cadre-flag <blocked\|skipped>` |
| "This needs revision" / "Spec is wrong" | `cadre-revise` |
| "Review this" / "Check the diff before merge" | `cadre-review [track_id]` |
| "Ship it" / "Open the PR" / "Push the branch" | `cadre-ship [track_id]` |
| "Save context" / "Handoff" / "Transfer to next section" | `cadre-handoff` |
| "Archive completed" | `cadre-archive` |
| "Cut a release" / "Update the changelog" / "Tag a version" | `cadre-release [bump]` |
| "Export summary" | `cadre-status --export` |
| "Docs are outdated" / "Sync with codebase" | `cadre-refresh` |
| "List templates" / "Show formulas" | `cadre-formula` |
| "Quick exploration" / "Ephemeral track" | `cadre-formula wisp [formula]` |
| "Extract template" / "Create reusable pattern" | `cadre-formula create [track_id]` |

## Workflow Execution

When a user asks for any `cadre-*` workflow, **read the corresponding workflow protocol** for the full step-by-step protocol:
Treat text after the workflow name as workflow arguments.

| Workflow | Full Protocol |
|---------|---------------|
| `cadre-setup` | [protocols/cadre-setup.md](protocols/cadre-setup.md) |
| `cadre-newtrack` | [protocols/cadre-newtrack.md](protocols/cadre-newtrack.md) |
| `cadre-implement` | [protocols/cadre-implement.md](protocols/cadre-implement.md) |
| `cadre-status` | [protocols/cadre-status.md](protocols/cadre-status.md) |
| `cadre-revert` | [protocols/cadre-revert.md](protocols/cadre-revert.md) |
| `cadre-validate` | [protocols/cadre-validate.md](protocols/cadre-validate.md) |
| `cadre-flag` | [protocols/cadre-flag.md](protocols/cadre-flag.md) |
| `cadre-revise` | [protocols/cadre-revise.md](protocols/cadre-revise.md) |
| `cadre-review` | [protocols/cadre-review.md](protocols/cadre-review.md) |
| `cadre-ship` | [protocols/cadre-ship.md](protocols/cadre-ship.md) |
| `cadre-land` | [protocols/cadre-land.md](protocols/cadre-land.md) |
| `cadre-archive` | [protocols/cadre-archive.md](protocols/cadre-archive.md) |
| `cadre-release` | [protocols/cadre-release.md](protocols/cadre-release.md) |
| `cadre-handoff` | [protocols/cadre-handoff.md](protocols/cadre-handoff.md) |
| `cadre-refresh` | [protocols/cadre-refresh.md](protocols/cadre-refresh.md) |
| `cadre-formula` | [protocols/cadre-formula.md](protocols/cadre-formula.md) |

**Important:** Always read the full workflow protocol before executing. Each file contains the complete protocol with error handling, Beads integration, and user interaction flows. When a protocol references `references/...`, resolve it against this skill's `references/` directory.

## References

- **Workflow overview**: [references/workflows.md](references/workflows.md) - Workflow table, Beads overview, state files, status markers, parallel execution
- **Workflow protocols**: [protocols/](protocols/) - Full step-by-step execution details for all 16 workflows
- **Directory structure**: [references/structure.md](references/structure.md) - File layout and status markers
- **Beads integration**: [references/beads-integration.md](references/beads-integration.md) - Session protocol, CLI commands, chemistry patterns
- **Learnings system**: [references/learnings-system.md](references/learnings-system.md) - Ralph-style knowledge capture details
- **Patterns template**: [references/patterns-template.md](references/patterns-template.md) - Template for cadre/patterns.md
- **Learnings template**: [references/learnings-template.md](references/learnings-template.md) - Template for track learnings.md
