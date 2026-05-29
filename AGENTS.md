# Conductor Context (AGENTS.md)

> Shared agent context for **OpenAI Codex CLI** and **Google Antigravity**.
> Both tools read an `AGENTS.md` file for persistent project instructions.
> Claude Code reads `CLAUDE.md`, which mirrors this file. Keep the two in sync
> when you change project conventions.

This project uses **Conductor-Beads**, a toolkit for Context-Driven Development:
spec-first planning (Conductor) plus a dependency-aware, persistent task graph
(Beads).

## Plans and Tracks

If a user mentions a "plan" or asks about the plan and they have used Conductor
in the current session, they are likely referring to `conductor/tracks.md` or a
track plan at `conductor/tracks/<track_id>/plan.md`.

A **track** is a unit of work (feature or bug). Each lives in
`conductor/tracks/<track_id>/` with `spec.md`, `plan.md`, `metadata.json`, and
`learnings.md`. Status markers: `[ ]` new, `[~]` in progress, `[x]` done,
`[!]` blocked, `[-]` skipped.

## Slash Commands / Workflows

The Conductor commands are available as slash commands (Codex custom prompts in
`~/.codex/prompts/`, Antigravity workflows in `.agent/workflows/`):

- `/conductor-setup` — initialize the project (context files + first track)
- `/conductor-newtrack` — create a feature/bug track with spec and plan
- `/conductor-implement` — execute a track's plan with the TDD workflow
- `/conductor-status` — show progress
- `/conductor-revert`, `/conductor-validate`, `/conductor-block`,
  `/conductor-skip`, `/conductor-revise`, `/conductor-archive`,
  `/conductor-export`, `/conductor-handoff`, `/conductor-refresh`
- `/conductor-formula` — manage track templates (Beads formulas)
- `/conductor-wisp` — ephemeral exploration track (no audit trail)
- `/conductor-distill` — extract a reusable template from a completed track

> **Codex** expands `$ARGUMENTS` / `$1`…`$9` in custom prompts. **Antigravity**
> appends any text typed after the workflow name. Both behaviors are handled by
> the generated command files.

## TDD Task Workflow

1. Select a task from `plan.md` (or `bd ready` when Beads is enabled).
2. Mark `[~]` in progress (`bd update <id> --status in_progress`).
3. Write a failing test (Red) → implement (Green) → refactor.
4. Verify >80% coverage.
5. Commit: `<type>(<scope>): <description>`.
6. Update `plan.md` with the commit SHA; `bd done <id> --note "commit: <sha>"`.

## Beads Integration

If a `.beads/` directory exists alongside `conductor/`, this project uses Beads
for persistent task memory. Check `conductor/beads.json` for config.

- Use `bd ready` to find tasks with no blockers.
- Each Conductor track maps to a Beads epic.
- Beads notes survive context compaction.
- Degrade gracefully if `bd` is unavailable.

## Parallel Execution

Phases annotated with `<!-- execution: parallel -->` spawn sub-agents. Tasks
declare exclusive file ownership with `<!-- files: ... -->` and dependencies
with `<!-- depends: taskN -->`. State is tracked in `parallel_state.json`.

## Git Policy

**Conductor commits locally but never pushes automatically.** Users decide when
and how to push to remotes.
