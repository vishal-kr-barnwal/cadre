# Cadre Context (AGENTS.md)

> Shared agent context for **OpenAI Codex CLI** and **Google Antigravity**.
> Both tools read an `AGENTS.md` file for persistent project instructions.
> Claude Code reads `CLAUDE.md`, which mirrors this file. Keep the two in sync
> when you change project conventions.

This project uses **Cadre**, a toolkit for Context-Driven Development:
spec-first planning (Cadre) plus a dependency-aware, persistent task graph
(Beads).

## Plans and Tracks

If a user mentions a "plan" or asks about the plan and they have used Cadre
in the current session, they are likely referring to `cadre/tracks.md` or a
track plan at `cadre/tracks/<track_id>/plan.md`.

A **track** is a unit of work (feature or bug). Each lives in
`cadre/tracks/<track_id>/` with `spec.md`, `plan.md`, `metadata.json`, and
`learnings.md`. Status markers: `[ ]` new, `[~]` in progress, `[x]` done,
`[!]` blocked, `[-]` skipped.

`metadata.json`'s `status` field is the **single source of truth** for a track's
status. `cadre/tracks.md` is a **derived index** — a cache rebuilt by
`/cadre-status --regen-index` from the per-track `metadata.json` files.
Never hand-edit the markers in `tracks.md`; change `metadata.json.status` and
regenerate. Marker map: `new` → `[ ]`, `in_progress` → `[~]`, `completed` →
`[x]`, `blocked` → `[!]`, `skipped` → `[-]`.

## Slash Commands / Workflows

The Cadre commands are available as slash commands (Codex custom prompts in
`~/.codex/prompts/`, Antigravity workflows in `.agent/workflows/`):

- `/cadre-setup` — initialize the project (context files + first track)
- `/cadre-newtrack` — create a feature/bug track with spec and plan
- `/cadre-implement` — execute a track's plan with the TDD workflow
- `/cadre-status` — show progress (`--export` writes a project summary;
  `--team` / `--mine` filter by assignee, `--repos` shows the polyrepo fleet
  board, `--regen-index` rebuilds `tracks.md` from each track's `metadata.json`)
- `/cadre-review` — review a track's diff before shipping (quality gate).
  Records a structured verdict in `metadata.review`
  (`verdict`: `approved` / `changes_requested`, `blocking_count`, `date`,
  `reviewer`). `/cadre-ship` and `/cadre-land` refuse to proceed when
  the verdict is `changes_requested` or `blocking_count > 0`.
- `/cadre-ship` — rebase a reviewed track onto main, push, prepare the PR
  (monorepo). PR opening is opt-in via `cadre/config.json` `auto_open`
  (default `false` = prepare only).
- `/cadre-land` — polyrepo: open + link the cross-repo PR group; the merge train
  lands them product-repos-first, control-repo-last using merge commits (squash
  disabled as a guardrail, so each submodule gitlink pins to a deterministic merge
  commit)
- `/cadre-release` — cut a local release (changelog + version tag)
- `/cadre-revert`, `/cadre-validate`, `/cadre-flag`,
  `/cadre-revise`, `/cadre-archive`, `/cadre-refresh`
- `/cadre-handoff` — update the single rolling `cadre/HANDOFF.md` (trimmed
  in place, not a per-timestamp file); `--for-teammate` writes a goal-first prose
  handoff instead of the machine dump
- `/cadre-formula` — manage track templates: `list` / `show` / `create`
  (extract a reusable template from a completed track) / `wisp` (ephemeral
  exploration, no audit trail)

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

If a `.beads/` directory exists alongside `cadre/`, this project uses Beads
for persistent task memory. Check `cadre/beads.json` for config.

- Use `bd ready` to find tasks with no blockers.
- Each Cadre track maps to a Beads epic.
- Beads notes survive context compaction.
- Degrade gracefully if `bd` is unavailable.

## Parallel Execution

Phases annotated with `<!-- execution: parallel -->` spawn sub-agents. Tasks
declare exclusive file ownership with `<!-- files: ... -->` and dependencies
with `<!-- depends: taskN -->`. State is tracked in `parallel_state.json`.

## Polyrepo (opt-in)

If `cadre/repos.json` exists with `mode: "polyrepo"`, this is a **control
repo** orchestrating product repos that are registered as **git submodules**.
Tasks carry a `<!-- repo: <name> -->` annotation (absent → `default_repo`);
branches, commits, worktrees, and reverts are per-repo
(`.worktrees/<id>/<repo>/`). `/cadre-land` opens one PR per touched repo plus
a control-repo PR (provider from `cadre/config.json` `pr_provider`:
GitHub/GitLab) and a generated merge train lands them product-repos-first,
control-repo-last. Absent `repos.json` → everything is single-repo as before. See
`docs/POLYREPO.md`.

## Git Policy

**Cadre commits locally but never pushes automatically.** Users decide when
and how to push to remotes. In polyrepo **shared** sync mode the *control plane*
(`cadre/` + Beads graph) is pushed/pulled for collaboration, but **product
code stays local** until `/cadre-land`.

Agent-local state files (`setup_state.json`, `refresh_state.json`, and the
`implement_state.json` / `parallel_state.json` when not shared) are git-ignored
via `cadre/.gitignore` — don't force-commit them. Shared state files are
merged with the `ours` state merge driver (`.beads/**` and `parallel_state.json`
carry `merge=ours`), so the `ours` driver must be registered for every Beads
project (`git config merge.ours.driver true`); an unregistered driver lets git's
default text merge inject conflict markers into the Dolt DB files.
