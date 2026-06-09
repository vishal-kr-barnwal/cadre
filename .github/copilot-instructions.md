# Conductor-Beads — GitHub Copilot Instructions

This repository uses **Conductor-Beads** for Context-Driven Development:
spec-first planning (Conductor) plus a dependency-aware, persistent task graph
(Beads). This file is read automatically by GitHub Copilot (Chat, the coding
agent, and the CLI) as repository custom instructions.

## Reusable prompts

The Conductor commands are available as Copilot **prompt files** in
`.github/prompts/`. Invoke them in Copilot Chat by typing `/` followed by the
command name, e.g. `/conductor-setup`, `/conductor-newtrack`,
`/conductor-implement`, `/conductor-status`. Text typed after the command name
is treated as the command's input.

Full set: `conductor-setup`, `conductor-newtrack`, `conductor-implement`,
`conductor-status` (`--export`), `conductor-revert`, `conductor-validate`,
`conductor-flag`, `conductor-revise`, `conductor-review`, `conductor-ship`,
`conductor-archive`, `conductor-release`, `conductor-handoff`,
`conductor-refresh`, `conductor-formula` (`list`/`show`/`create`/`wisp`).

## Tracks

A **track** is a unit of work (feature or bug) under
`conductor/tracks/<track_id>/` with `spec.md`, `plan.md`, `metadata.json`, and
`learnings.md`. The master list is `conductor/tracks.md`. Status markers:
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
