# Cadre Context (AGENTS.md)

> Agent context for **OpenAI Codex**, which reads an `AGENTS.md` file for
> persistent project instructions. Claude Code reads `CLAUDE.md`, which mirrors
> this file. Keep the two in sync when you change project conventions.

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
`cadre-status --regen-index` from the per-track `metadata.json` files.
Never hand-edit the markers in `tracks.md`; change `metadata.json.status` and
regenerate. Marker map: `new` → `[ ]`, `in_progress` → `[~]`, `completed` →
`[x]`, `blocked` → `[!]`, `skipped` → `[-]`.

## Cadre Workflows

Cadre workflow protocols live in `skills/cadre/protocols/cadre-*.md` and are
exposed to Codex through the repo skill at `.agents/skills/cadre`. Invoke the
skill explicitly with `$cadre`, or ask for one of these workflow names in plain
text:

- `cadre-setup` — initialize the project (context files + first track)
- `cadre-newtrack` — create a feature/bug track with spec and plan
- `cadre-implement` — execute a track's plan with the TDD workflow
- `cadre-status` — show progress (`--export` writes a project summary;
  `--team` / `--mine` filter by assignee, `--repos` shows the polyrepo fleet
  board, `--available` / `--unowned` shows unblocked work to pick up,
  `--collisions` shows cross-track file claims, and `--regen-index` rebuilds
  `tracks.md` from each track's `metadata.json`)
- `cadre-review` — review a track's diff before shipping (quality gate).
  Records a structured verdict in `metadata.review`
  (`verdict`: `approved` / `changes_requested`, `blocking_count`, `date`,
  `reviewer`, `coverage`, `self_reviewed`, `reviewed_sha`, `review_seq`).
  `cadre-ship` and `cadre-land` refuse to proceed when the verdict is
  `changes_requested`, `blocking_count > 0`, or `require_second_reviewer` is set
  and the approval is a self-review.
- `cadre-ship` — rebase a reviewed track onto main, push, prepare the PR
  (monorepo). PR opening is opt-in via `cadre/config.json` `auto_open`
  (default `false` = prepare only).
- `cadre-land` — polyrepo: open + link the cross-repo PR group; the merge train
  lands them product-repos-first, control-repo-last using merge commits (squash
  disabled as a guardrail, so each submodule gitlink pins to a deterministic merge
  commit)
- `cadre-release` — cut a local release (changelog + version tag)
- `cadre-revert`, `cadre-validate`, `cadre-flag`,
  `cadre-revise`, `cadre-archive`, `cadre-refresh`
- `cadre-handoff` — update the per-track rolling `cadre/tracks/<track_id>/HANDOFF.md`
  (trimmed in place, not a per-timestamp file); `--for-teammate` writes a goal-first prose
  handoff instead of the machine dump
- `cadre-formula` — manage track templates: `list` / `show` / `create`
  (extract a reusable template from a completed track) / `wisp` (ephemeral
  exploration, no audit trail)

Codex uses the skill text directly, not generated prompt files. Treat text after
the workflow name as workflow arguments, e.g. `cadre-newtrack Add OAuth login`.

## TDD Task Workflow

1. Select a task from `plan.md` (or `bd ready` when Beads is enabled).
2. Mark `[~]` in progress (`bd update <id> --status in_progress`).
3. Write a failing test (Red) → implement (Green) → refactor.
4. Verify >80% coverage with the project's configured coverage tool; record the
   measured percentage in `metadata.last_coverage` so review can copy it into
   `metadata.review.coverage`.
5. Commit: `<type>(<scope>): <description>`.
6. Update `plan.md` with the commit SHA; `bd close <id> --reason "commit: <sha>"`.

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
with `<!-- depends: taskN -->`. `<!-- files: ... -->` is required for every task,
not only parallel phases, because `cadre-status --collisions`,
`cadre-implement`, and `cadre-validate` use it to detect cross-owner overlap.
`parallel_state.json` is an audit log; Beads dependencies are the coordination
source of truth.

## Ownership and Reviews

Assignees use the git committer identity (`user.email` → `user.name`), never a
literal `"cadre"`. `metadata.json` records `owner` and `reviewer`. A
topology-independent **Ownership Guard** (`references/ownership-guard.md`) runs
before every track mutation, including default monorepo mode where advisory
leases are a no-op. In shared sync mode a `lease` may also be present; stale
leases use the canonical 30-minute window and are swept by `cadre-validate`.

`cadre-review` records `reviewed_sha` to pin the verdict to the reviewed code
and increments `review_seq` for audit. Review runs no owner guard because a
reviewer is intentionally not the owner; an approval may not silently bury a
different reviewer's open `changes_requested` verdict without a logged override.

## Polyrepo (opt-in)

If `cadre/repos.json` exists with `mode: "polyrepo"`, this is a **control
repo** orchestrating product repos that are registered as **git submodules**.
Tasks carry a `<!-- repo: <name> -->` annotation (absent → `default_repo`);
branches, commits, worktrees, and reverts are per-repo
(`.worktrees/<id>/<repo>/`). `cadre-land` opens one PR per touched repo plus
a control-repo PR (provider from `cadre/config.json` `pr_provider`:
GitHub/GitLab) and a generated merge train lands them product-repos-first,
control-repo-last. Absent `repos.json` → everything is single-repo as before. See
`docs/POLYREPO.md`.

## Git Policy

**Cadre commits locally but never pushes automatically.** Users decide when
and how to push product code to remotes. In **shared** sync mode the *control
plane* (`cadre/` + Beads graph) is pushed/pulled for collaboration in both
monorepo and polyrepo setups, but **product code stays local** until
`cadre-ship` (monorepo) or `cadre-land` (polyrepo).

Agent-local state files (`setup_state.json`, `refresh_state.json`, and the
`implement_state.json` / `parallel_state.json` when not shared) are git-ignored
via `cadre/.gitignore` — don't force-commit them. Shared state files are
merged with the `ours` state merge driver (`.beads/**` and `parallel_state.json`
carry `merge=ours`), so the `ours` driver must be registered for every Beads
project (`git config merge.ours.driver true`); an unregistered driver lets git's
default text merge inject conflict markers into the Dolt DB files.
