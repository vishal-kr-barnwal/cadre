# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Conductor-Beads is a unified toolkit for **Context-Driven Development** that combines:

- **Conductor**: Spec-first planning, human-readable context, TDD workflow
- **Beads**: Dependency-aware task graph, cross-session memory, agent-optimized output

It works with Claude Code (commands + skills) and four other AI coding tools — OpenAI Codex CLI, Cursor, Google Antigravity, and GitHub Copilot — via generated command sets.

## Architecture

### Repository Structure
```
Conductor-Beads/
├── .claude/
│   ├── commands/           # Claude Code slash commands (16 commands) — CANONICAL SOURCE
│   └── skills/             # Claude Code skills
│       ├── conductor/      # Context-driven development skill
│       ├── beads/          # Persistent task memory skill
│       └── skill-creator/  # Skill creation guide
├── .codex/prompts/         # OpenAI Codex CLI commands (generated)
├── .cursor/                # Cursor commands + rule (generated)
├── .agent/workflows/       # Google Antigravity workflows (generated)
├── .github/prompts/        # GitHub Copilot prompt files (generated)
├── scripts/
│   ├── install.sh          # Interactive installer (detect CLIs, global/project)
│   ├── generate-commands.sh # Generates the 4 platforms above from .claude/commands/
│   └── migrate-v2.sh       # v0.1.0 -> v0.2.0 layout migration
├── templates/              # Workflow and styleguide templates
├── docs/                   # Documentation (see docs/INSTALL.md)
├── CLAUDE.md               # This file (Claude Code context)
└── AGENTS.md               # Codex + Antigravity context
```

> **Generated command sets** (`.codex/`, `.cursor/commands/`, `.agent/`,
> `.github/prompts/`) are derived from `.claude/commands/` by
> `scripts/generate-commands.sh`. Edit the canonical Claude command and
> regenerate — do not hand-edit generated files. CI can run
> `bash scripts/generate-commands.sh --check` to detect drift.

### Commands

All platforms (Claude Code, Codex CLI, Cursor, Antigravity, Copilot) invoke the same command name.

| Command | Purpose |
|---------|---------|
| `/conductor-setup` | Initialize project with context files and first track |
| `/conductor-newtrack` | Create feature/bug track with spec and plan |
| `/conductor-implement` | Execute tasks from track's plan (TDD workflow) |
| `/conductor-status` | Display progress overview |
| `/conductor-revert` | Git-aware revert of tracks, phases, or tasks |
| `/conductor-validate` | Validate project integrity and fix issues |
| `/conductor-block` | Mark task as blocked with reason |
| `/conductor-skip` | Skip current task with justification |
| `/conductor-revise` | Update spec/plan when implementation reveals issues |
| `/conductor-archive` | Archive completed tracks |
| `/conductor-export` | Generate project summary export |
| `/conductor-handoff` | Create context handoff for section transfer |
| `/conductor-refresh` | Sync context docs with current codebase state |
| `/conductor-formula` | List and manage track templates (Beads formulas) |
| `/conductor-wisp` | Create ephemeral exploration track (no audit trail) |
| `/conductor-distill` | Extract reusable template from completed track |

### Skills

| Skill | Location | Purpose |
|-------|----------|---------|
| **conductor** | `.claude/skills/conductor/` | Auto-activates when `conductor/` exists. Provides intent mapping and proactive behaviors. |
| **beads** | `.claude/skills/beads/` | Auto-activates when `.beads/` exists. Provides persistent memory across sessions. |
| **skill-creator** | `.claude/skills/skill-creator/` | Guide for creating new AI agent skills. |

### Generated Artifacts (in user projects)

When users run Conductor-Beads, it creates:
```
project/
├── conductor/
│   ├── product.md           # Product vision and goals
│   ├── product-guidelines.md # Brand/style guidelines
│   ├── tech-stack.md        # Technology choices
│   ├── workflow.md          # Development workflow (TDD, commits)
│   ├── tracks.md            # Master track list with status
│   ├── patterns.md          # Consolidated learnings (Ralph-style)
│   ├── beads.json           # Beads integration config
│   ├── setup_state.json     # Resume state for setup
│   ├── refresh_state.json   # Context refresh tracking
│   ├── code_styleguides/    # Language-specific style guides
│   └── tracks/
│       └── <track_id>/
│           ├── metadata.json     # Track config + Beads epic ID
│           ├── spec.md           # Requirements
│           ├── plan.md           # Phased task list
│           ├── learnings.md      # Patterns/gotchas discovered (Ralph-style)
│           ├── implement_state.json # Resume state (if in progress)
│           ├── handoff_*.md      # Section handoff documents
│           ├── blockers.md       # Block history log
│           ├── skipped.md        # Skipped tasks log
│           └── revisions.md      # Revision history log
└── .beads/                  # Beads data (created by bd init)
```

## Key Concepts

### Tracks
A track is a logical unit of work (feature or bug fix). Each track has:
- Unique ID format: `shortname_YYYYMMDD` (e.g., `auth_20241226`)
- Status markers: `[ ]` new, `[~]` in progress, `[x]` completed, `[!]` blocked, `[-]` skipped
- Own directory with spec, plan, metadata, and state files

### Parallel Execution (New!)
Phases can execute tasks in parallel using sub-agents:
- Annotate phases with `<!-- execution: parallel -->`
- Tasks have `<!-- files: ... -->` for exclusive file ownership
- Use `<!-- depends: taskN -->` for task dependencies
- Coordinator spawns workers via Task() tool
- State tracked in `parallel_state.json`

### Task Workflow (TDD)
1. Select task from plan.md (or use `bd ready` if Beads enabled)
2. Mark `[~]` in progress (sync to Beads: `bd update <id> --status in_progress`)
3. Write failing tests (Red)
4. Implement to pass (Green)
5. Refactor
6. Verify >80% coverage
7. Commit with message format: `<type>(<scope>): <description>`
8. Update plan.md with commit SHA
9. If Beads: `bd done <id> --note "commit: <sha>"`

**Important:** All commits stay local. Conductor never pushes automatically - users decide when to push.

### Beads Integration
When Beads is enabled (`conductor/beads.json` with `enabled: true`):
- Each track becomes a Beads epic
- Tasks sync to Beads for persistent memory
- `bd ready` finds tasks with no blockers
- Notes survive context compaction
- Graceful degradation if `bd` command fails

### Learnings System (Ralph-style)
Conductor captures and consolidates learnings across tracks:

**Per-Track (`learnings.md`):**
- Append-only log of patterns, gotchas, context discovered during implementation
- Each entry includes: timestamp, thread URL, files changed, commit, learnings
- Survives across sessions via handoffs

**Project-Level (`patterns.md`):**
- Consolidated patterns extracted from completed/archived tracks
- Organized by category: Code Conventions, Architecture, Gotchas, Testing, Context
- Read before starting new work to prime context

**Knowledge Flywheel:**
1. Implement → discover patterns
2. Log in track `learnings.md`
3. At phase/track completion → elevate to `patterns.md`
4. Archive → extract remaining patterns
5. New tracks → inherit patterns from `patterns.md`

### Phase Checkpoints
At phase completion:
- Run full test suite
- Manual verification with user
- Create checkpoint commit

## Development Notes

- Canonical commands are Markdown in `.claude/commands/`; the Codex, Cursor, Antigravity, and Copilot sets are generated from them by `scripts/generate-commands.sh`
- Skills use SKILL.md format with references/ subdirectory
- State is tracked in JSON files (setup_state.json, implement_state.json, metadata.json)
- Git notes used for audit trails
- Commands validate setup before executing
- All supported platforms operate on the same `conductor/` directory structure (interoperable)

## Documentation

- [Install & Version Guide](docs/INSTALL.md) - Per-platform install + compatibility matrix + versioning policy
- [Manual Workflow Guide](docs/manual-workflow-guide.md) - Step-by-step command reference
- [Beads Integration](docs/BEADS_INTEGRATION.md) - How Conductor and Beads work together
- [Parallel Execution](docs/PARALLEL_EXECUTION.md) - Parallel task execution design
