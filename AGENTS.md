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
- `/conductor-status` — show progress (`--export` writes a project summary)
- `/conductor-review` — review a track's diff before shipping (quality gate)
- `/conductor-ship` — rebase a reviewed track onto main, push, prepare the PR (monorepo)
- `/conductor-land` — polyrepo: open + link the cross-repo PR group; merge train lands it
- `/conductor-release` — cut a local release (changelog + version tag)
- `/conductor-revert`, `/conductor-validate`, `/conductor-flag`,
  `/conductor-revise`, `/conductor-archive`,
  `/conductor-handoff`, `/conductor-refresh`
- `/conductor-formula` — manage track templates: `list` / `show` / `create`
  (distill from a track) / `wisp` (ephemeral exploration, no audit trail)

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

## Polyrepo (opt-in)

If `conductor/repos.json` exists with `mode: "polyrepo"`, this is a **control
repo** orchestrating product repos that are registered as **git submodules**.
Tasks carry a `<!-- repo: <name> -->` annotation (absent → `default_repo`);
branches, commits, worktrees, and reverts are per-repo
(`.worktrees/<id>/<repo>/`). `/conductor-land` opens one PR per touched repo plus
a control-repo PR (provider from `conductor/config.json` `pr_provider`:
GitHub/GitLab) and a generated merge train lands them product-repos-first,
control-repo-last. Absent `repos.json` → everything is single-repo as before. See
`docs/POLYREPO.md`.

## Git Policy

**Conductor commits locally but never pushes automatically.** Users decide when
and how to push to remotes. In polyrepo **shared** sync mode the *control plane*
(`conductor/` + Beads graph) is pushed/pulled for collaboration, but **product
code stays local** until `/conductor-land`.
