# Cadre — GitHub Copilot Instructions

This repository uses **Cadre** for Context-Driven Development:
spec-first planning (Cadre) plus a dependency-aware, persistent task graph
(Beads). This file is read automatically by GitHub Copilot (Chat, the coding
agent, and the CLI) as repository custom instructions.

## Reusable prompts

The Cadre commands are available as Copilot **prompt files** in
`.github/prompts/`. Invoke them in Copilot Chat by typing `/` followed by the
command name, e.g. `/cadre-setup`, `/cadre-newtrack`,
`/cadre-implement`, `/cadre-status`. Text typed after the command name
is treated as the command's input.

Full set: `cadre-setup`, `cadre-newtrack`, `cadre-implement`,
`cadre-status` (`--export`), `cadre-revert`, `cadre-validate`,
`cadre-flag`, `cadre-revise`, `cadre-review`, `cadre-ship`,
`cadre-archive`, `cadre-release`, `cadre-handoff`,
`cadre-refresh`, `cadre-formula` (`list`/`show`/`create`/`wisp`).

## Tracks

A **track** is a unit of work (feature or bug) under
`cadre/tracks/<track_id>/` with `spec.md`, `plan.md`, `metadata.json`, and
`learnings.md`. The master list is `cadre/tracks.md`. Status markers:
`[ ]` new, `[~]` in progress, `[x]` done, `[!]` blocked, `[-]` skipped.

## TDD workflow

When implementing a task: mark it `[~]`, write a failing test, implement to
pass, refactor, keep coverage above 80%, then commit using
`<type>(<scope>): <description>` and record the commit SHA in `plan.md`.

## Beads

If `.beads/` exists, this project uses Beads for persistent memory. Use
`bd ready` to find unblocked tasks; each track maps to a Beads epic; notes
survive context compaction. Degrade gracefully if `bd` is unavailable.

## Git policy

**Commit locally; never push automatically.** The user decides when to push.
