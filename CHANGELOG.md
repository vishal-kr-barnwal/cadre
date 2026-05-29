# Changelog

All notable changes to **Conductor-Beads** are documented here.

This changelog covers the project from the point it was forked from the original
[Conductor-Beads](https://github.com/NguyenSiTrung) by NguyenSiTrung. It records
the versions released under this fork (maintained by Vishal Kumar).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.3] — 2026-05-30

### Fixed
- **Parallel worker dispatch is now platform-aware.** `conductor-implement`
  hardcoded Claude Code's `Task({…})` sub-agent call for spawning parallel
  workers, so the generated Codex, Cursor, Antigravity, and Copilot commands told
  the agent to call a primitive that doesn't exist on those tools. The spawn step
  now points to a new bundled reference, `references/parallel-execution.md`, which
  maps the worker-dispatch step to each tool's real mechanism — Claude Code `Task`
  tool, OpenAI Codex `worker` agent type, Cursor `/multitask`, Antigravity Agent
  Manager, GitHub Copilot `/fleet` (Copilot CLI) or VS Code subagents — with a
  **sequential fallback** for platforms that have no parallel primitive. The
  worker prompt itself is unchanged and platform-agnostic.
- Updated `docs/PARALLEL_EXECUTION.md` and `docs/BEADS_INTEGRATION.md` to describe
  per-platform dispatch instead of `Task()` only.

---

## [0.3.2] — 2026-05-30

### Added
- **Interactive installer, `scripts/install.sh`.** Detects which supported CLIs
  are present (Claude Code, Codex, Cursor, Antigravity, Copilot), lets you pick
  which to set up, and installs either **globally** (`~/`) or into a **project**
  directory. Supports `--all`, `--global`, `--project[=DIR]`, `-y/--yes`,
  `--dry-run`, and positional tool names for non-interactive use. Bundled
  `templates/` and `references/` ride along, and existing context files
  (`AGENTS.md`, `copilot-instructions.md`) are never overwritten.

---

## [0.3.1] — 2026-05-30

### Fixed
- **Templates are now bundled with every install, on every CLI.** `conductor-setup`
  referenced `templates/code_styleguides/` and `templates/workflow.md` as
  project-root paths, but the `templates/` directory was never shipped with the
  installed commands — so setup could not find the style guides or workflow
  template on any platform (including Claude Code installed standalone). The
  generator now bundles the canonical `templates/` directory into each command
  set (`.codex/prompts/`, `.cursor/commands/`, `.agent/workflows/`,
  `.github/prompts/`) and into the Claude skill
  (`.claude/skills/conductor/templates/`).
- **`conductor-setup` discovers the templates directory at runtime** by probing
  the known install locations (including `~/.codex/prompts/templates/` for
  Codex's global prompts), so it resolves correctly regardless of CLI or install
  scope. The probe logic is shared via `references/template-locator.md`, bundled
  into every command set.
- **`patterns.md` and `learnings.md` are now created from their templates.**
  Previously only `workflow.md` and the style guides came from `templates/`;
  `patterns.md` (project) and `learnings.md` (per track) were generated inline
  with stripped-down structures that had drifted from the richer template files,
  and `templates/patterns.md` / `templates/learnings.md` were effectively unused.
  `conductor-setup` now creates `conductor/patterns.md` from
  `<TEMPLATES_DIR>/patterns.md`, `conductor-newtrack` creates each track's
  `learnings.md` from `<TEMPLATES_DIR>/learnings.md` (substituting `{{track_id}}`),
  and the `conductor-implement` / `conductor-refresh` fallbacks copy from the
  template too.
- **`beads.json` schema reconciled to a single source of truth.** Three
  divergent schemas existed (the `templates/beads.json` bundle, the inline block
  written by `conductor-setup`, and the README/docs examples). All are now
  aligned to the schema `conductor-setup` actually writes — `memoryStrategy`,
  `compactOnPhaseComplete`, the `pushOn*` flags, and `worktreePer*` — with the
  stale `sync` / `autoSyncOnComplete` / `compactOnArchive` / `stealthMode` keys
  removed. `conductor-setup` now copies `conductor/beads.json` from
  `templates/beads.json` and only sets `mode` (`normal`/`stealth`).

---

## [0.3.0] — 2026-05-30

Multi-platform release. The full 16-command suite now ships for four additional
AI coding tools, and Gemini CLI support is retired in favor of Google
Antigravity.

### Added
- **OpenAI Codex CLI** support — commands in `.codex/prompts/` (native
  `$ARGUMENTS` expansion preserved).
- **Cursor** support — commands in `.cursor/commands/` plus a
  `.cursor/rules/conductor.mdc` context rule.
- **Google Antigravity** support — workflows in `.agent/workflows/` with YAML
  frontmatter.
- **GitHub Copilot** support — prompt files in `.github/prompts/*.prompt.md`
  plus `.github/copilot-instructions.md`.
- **`scripts/generate-commands.sh`** — generates the Codex, Cursor, Antigravity,
  and Copilot command sets from the canonical Claude Code commands
  (`.claude/commands/`), the single source of truth. A `--check` mode fails if
  the committed output is stale (for CI).
- **`AGENTS.md`** — shared agent context for Codex and Antigravity.
- **[`docs/INSTALL.md`](docs/INSTALL.md)** — install & version guide with a
  cross-platform compatibility matrix, per-platform setup steps, and the
  versioning policy.

### Changed
- The `references/beads-error-handler.md` helper is now copied into each
  platform's command directory so every command set is self-contained.
- README, `CLAUDE.md`, and the skill docs reworked around the five supported
  platforms; command tables collapsed to a single command name (all platforms
  invoke `/conductor-<name>`).

### Removed
- **Gemini CLI support** — `gemini-extension.json`, the TOML commands in
  `commands/conductor/`, and `GEMINI.md` were removed. Google Antigravity now
  covers the Google ecosystem via `.agent/workflows/`.

---

## [0.2.0] — 2026-04-20

Stabilization release focused on correct branch/worktree isolation and an
upgrade to Beads v1.0.2.

### Added
- **`.beads/` merge-conflict auto-resolution** — `conductor-setup` adds
  `.beads/** merge=ours` to `.gitattributes` so PR merges never conflict on the
  Dolt database.
- **Archive rebase + PR guidance** — `conductor-archive` rebases the track
  branch onto `main`, auto-resolves `.beads/` conflicts, and guides PR creation
  instead of auto-merging.
- **Dolt state flush in archive** — `bd dolt push` runs before rebasing so no
  pending Dolt changes are lost.
- New code style guides, including Compose Multiplatform.
- **`scripts/migrate-v2.sh`** — migrates v0.1.0 projects (flattens nested worker
  worktrees, adds the `.beads/` merge strategy, fixes stale
  `parallel_state.json` paths).

### Changed
- **Upgraded to Beads v1.0.2.**
- Commands optimized for worktree isolation, wave-model parallelism, and
  Beads-first persistent memory.
- `conductor-setup` no longer generates an initial track during setup.
- Archive commits explicitly stage deleted track files (`git rm -r`) to avoid
  ghost entries.

### Fixed
- **`implement` now runs on the track branch** — previously all work happened on
  `main`; it now switches to the track worktree before any file ops or commits.
- **`newtrack` creates the worktree after the scaffold commit** — the track
  branch is cut from a commit that already includes `spec.md`, `plan.md`, and
  `metadata.json`.
- **Flat worker worktree paths** — parallel worker worktrees are now siblings
  (`.worktrees/<track_id>_worker_<N>_<name>`) rather than nested children, which
  git requires.
- Parallel execution uses flat branch names to avoid `bd worktree create`
  rejection.
- `bd ready --parent` flag corrected (was `--epic`, which does not exist).
- Replaced removed `bd relate` with `bd dep relate`.
- Removed references to removed `bd` commands (`sync`, `agent`,
  `gate create/wait`); corrected the Homebrew install command for Beads.

---

## [0.1.0] — 2026-04-16 (fork baseline)

Forked from the original Conductor-Beads by NguyenSiTrung. This baseline is the
inherited state that `scripts/migrate-v2.sh` migrates *from*. Notable inherited
capabilities:

### Added (inherited from upstream)
- Conductor methodology: spec-first planning, tracks, TDD workflow, and the
  16-command suite for Claude Code (`.claude/commands/`) and Gemini CLI
  (`commands/conductor/`).
- Conductor, Beads, and skill-creator skills under `.claude/skills/`.
- Bidirectional Beads integration with persistent task memory, molecule support,
  and Beads v0.47→v0.56 compatibility.
- Parallel phase execution via sub-agents (`parallel_state.json`).
- Ralph-style learnings system (`learnings.md` → `patterns.md`).
- Explicit no-push git policy across all commands.

[0.3.3]: https://github.com/vishal-kr-barnwal/Conductor-Beads/releases/tag/v0.3.3
[0.3.2]: https://github.com/vishal-kr-barnwal/Conductor-Beads/releases/tag/v0.3.2
[0.3.1]: https://github.com/vishal-kr-barnwal/Conductor-Beads/releases/tag/v0.3.1
[0.3.0]: https://github.com/vishal-kr-barnwal/Conductor-Beads/releases/tag/v0.3.0
[0.2.0]: https://github.com/vishal-kr-barnwal/Conductor-Beads/releases/tag/v0.2.0
[0.1.0]: https://github.com/vishal-kr-barnwal/Conductor-Beads/releases/tag/v0.1.0
