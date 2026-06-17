# Changelog

All notable changes to **Cadre** are documented here.

This changelog covers the project from the point it was forked from the original
[Conductor-Beads](https://github.com/NguyenSiTrung) by NguyenSiTrung. It records
the versions released under this fork (maintained by Vishal Kumar).

> **Naming:** this project was renamed **Conductor-Beads → Cadre** in 1.0.0
> (commands `/conductor-*` → `/cadre-*`, working dir `conductor/` → `cadre/`).
> The 0.1.0 fork baseline reflects the upstream **Conductor** naming as inherited;
> entries 0.2.0–0.3.4 are shown with the current `cadre` names for continuity,
> though they shipped under the `conductor` prefix.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Optional LSP setup flow for `/cadre-setup` plus `/cadre-refresh --lsp`, backed
  by a bundled scanner that recommends language servers, writes/appends
  `cadre/lsp.json`, and reports missing install commands.
- Detailed platform usage guide (`docs/PLATFORM_USAGE.md`) covering installation,
  setup, topology choice, daily workflows, review/ship/land, team operation,
  MCP/LSP usage, CI, and troubleshooting.
- Initial dependency-free Cadre MCP server (`scripts/mcp/cadre-server.js`) with
  tools/resources for index regeneration, plan parsing, team status, available
  work, collision scans, review-gate checks, and polyrepo local preflight.
- LSP review helper (`scripts/cadre-lsp-review.js`) for best-effort external
  reference detection during `/cadre-review`.
- Team-scale simulation script (`scripts/cadre-team-scale-sim.js`) and
  AGENTS/CLAUDE semantic context drift guard (`scripts/check-agent-context.sh`).

### Changed
- Installation is now plugin-only for both Claude Code and OpenAI Codex. The
  generated plugin packages bundle the Cadre skill, workflow protocols,
  templates, MCP config, and helper scripts.
- The Cadre MCP server now requires project-scoped tools to receive a per-call
  `root` argument, avoiding shared mutable project state when one long-running
  MCP process serves multiple project sessions.
- Cadre skills and generated workflow protocols now treat MCP as required:
  workflows must verify `cadre_ping` and halt if Cadre MCP tools are unavailable.
- Wired every Cadre workflow protocol through its deterministic MCP checkpoints:
  root resolution, team status, available work, collision scans, plan parsing,
  review gates, polyrepo preflight, and index regeneration.
- Moved the shared Beads error-handler reference to `scripts/agent-refs/` so it
  is copied into generated plugin skill bundles from a real source file instead
  of from another generated artifact.
- Synced Codex-facing `AGENTS.md` with the newer team-scale review,
  ownership, coverage, collision, and shared-control-plane rules.
- Added MCP/LSP rollout guidance in `docs/MCP_LSP.md`.

### Removed
- Deleted the legacy `scripts/install.sh` copy-based installer and removed
  manual skill-copy installation instructions from the docs.

## [2.0.0] — 2026-06-16

Team-scale hardening (10–20 person teams) plus a platform-surface trim. The
concurrency model was already sound; this round closes the enforcement gaps that
only bite under concurrent use, and narrows supported platforms to the two that are
actually maintained. **Major bump:** dropping the Cursor / Antigravity / Copilot
command sets is a breaking removal of supported integrations (Claude Code and Codex
projects are unaffected).

### Removed
- **Dropped Cursor, Google Antigravity, and GitHub Copilot.** Cadre now targets
  **Claude Code** (canonical commands + skills) and **OpenAI Codex CLI** (generated)
  only. Deleted the `.cursor/`, `.agent/`, and `.github/prompts/` generated trees;
  `generate-commands.sh` and `install.sh` no longer emit or install them; the
  reference masters and docs were sliced down to the two platforms.

### Added
- **Topology-independent Ownership Guard** (`references/ownership-guard.md`) run
  before every track mutation — `/cadre-implement` (at selection), `/cadre-flag`,
  `/cadre-revise`, `/cadre-revert`, `/cadre-handoff`. Prevents two people clobbering
  the same track even in the **default monorepo** mode, where the advisory `lease`
  is a no-op.
- **`/cadre-status --available` / `--unowned`** — a board of unblocked, unowned work
  a teammate (or idle agent) can pick up, instead of eyeballing `tracks.md`.
- **`/cadre-review --request [@reviewer]`** — assign a reviewer; surfaced in the
  `--team` review queue as *Awaiting review* via the `review:requested` label.
- **`require_second_reviewer` config flag** — `/cadre-ship` and `/cadre-land` refuse
  a self-approved track when set; `/cadre-review` records `review.self_reviewed`.
- **Machine-verified coverage gate** in `/cadre-implement` — parses the coverage
  tool's number, gates on the `workflow.md` threshold, and records
  `metadata.last_coverage` → `review.coverage` (no longer self-asserted prose).

### Changed
- **`HANDOFF.md` is now per-track** (`cadre/tracks/<track_id>/HANDOFF.md`), not a
  project-global singleton — eliminates the concurrent-handoff clobber.
- **`/cadre-revise` and `/cadre-handoff` resolve the active track from
  `metadata.json.status`** (source of truth), not the derived `tracks.md` cache —
  closes a wrong-track-mutation bug.
- **`/cadre-flag` now commits the blocked/skipped state** and, in shared mode,
  pushes it (`bd dolt push` + control-plane push) — a blocker was previously
  invisible to the team until an unrelated later command committed.
- **`/cadre-ship` and `/cadre-land` re-read the review verdict immediately before
  pushing** — closes the review→ship TOCTOU window.
- **Unified lease staleness window to a canonical 30 minutes** across
  `/cadre-implement` and `/cadre-validate` (was ~15 min vs ~3h).
- **Skill loads project docs lazily** — a minimal activation set, with `patterns.md`
  and `tracks.md` pulled on demand, instead of eagerly on every activation.
- **Extracted the `tracks.md` regen-index program** out of `cadre-status.md` §12
  into a bundled helper script (`templates/scripts/cadre-regen-index.sh`, shipped
  with every command set and resolved via the template locator); §12 now invokes it
  with a compact prose fallback — trimming ~70 lines of inline shell from the
  hottest-fanned command while staying idempotent and `bd`-independent.
- **`/cadre-implement` primes Beads once** (merged the redundant double `bd prime`,
  fixed the prime-before-`which bd` ordering) and uses `mktemp` for metadata writes
  (was a PID-named `tmp.$$` in the working dir).

### Fixed
- Corrected **SQLite → Dolt** storage-engine references in
  `docs/PARALLEL_EXECUTION.md` and `docs/BEADS_INTEGRATION.md`, and reconciled the
  "Dolt server required" vs "no server required" contradiction between the skill
  docs.

## [1.0.0] — 2026-06-16

First stable release under the **Cadre** name (renamed from Conductor-Beads). Adds
a full team-scale SDLC layer — enforced review gate, per-person identity + advisory
leases, a derived `tracks.md` index, and a no-squash merge-commit merge train — on
top of polyrepo control-repo support.

### Added
- **Polyrepo support (opt-in, additive).** Cadre can now orchestrate work
  across multiple product repos from a dedicated **control repo**, alongside the
  existing monorepo mode (unchanged when no `cadre/repos.json` is present).
  - **Topology selection at `/cadre-setup`** — single-repo (default) or
    control-repo with product repos registered as **git submodules**.
  - New manifests `cadre/repos.json` (submodule map + `default_repo`) and
    `cadre/config.json` (`sync_mode`, `pr_provider`, `merge_train`).
  - **Per-repo work:** tasks carry a `<!-- repo: <name> -->` annotation;
    branches, commits, worktrees, parallel workers, and reverts are per-repo
    (`metadata.json.repos` map; worktrees under `.worktrees/<id>/<repo>/`).
  - **Cross-repo PRs + merge train:** new **`/cadre-land`** opens one PR per
    touched repo plus the control-repo PR, links them by label
    `cadre-track:<id>`, and a generated CI **merge train** (GitHub or GitLab,
    chosen at setup) lands them **product-repos-first, control-repo-last**.
  - **GitHub/GitLab detection** — `pr_provider` chosen at setup (auto-detected
    from a product remote) drives `gh`/`glab` usage and which merge-train CI is
    scaffolded.
  - **Shared sync mode** — control plane (`cadre/` + Beads Dolt graph) is
    pushed/pulled for team collaboration; product code stays local until landed.
  - New references `polyrepo-git.md`, `cadre-sync.md`; CI templates under
    `templates/ci/`; guide at `docs/POLYREPO.md`.
- All `cadre-*` commands updated to branch on topology; monorepo behavior is
  byte-for-byte unchanged.
- **SDLC tail commands** — `/cadre-review` (diff quality gate), `/cadre-ship`
  (rebase onto main + prepare PR, monorepo), `/cadre-land` (polyrepo cross-repo PR
  group + merge train), `/cadre-release` (changelog + version tag).
- **Team-scale collaboration (10–20 devs):**
  - **Per-person identity** — `--assignee` uses the git committer identity
    (no more shared `conductor`); `metadata.json` gains `owner`/`reviewer`.
  - **Advisory track leases** (shared mode) + an owner-guard on resume, swept by
    `/cadre-validate`; no-op in monorepo/local mode.
  - **Collision-proof track IDs** — same-day/duplicate ids get a `-<base36>` suffix.
  - **Enforced review gate** — `/cadre-review` writes `metadata.review`
    (`verdict`, `blocking_count`, …) + a Beads `review:*` label; `/cadre-ship`
    and `/cadre-land` refuse on `changes_requested` / `blocking_count > 0`.
  - **`/cadre-status` modes** — `--team`, `--mine`, `--repos` (polyrepo fleet
    board), `--regen-index`.
  - **Rolling `cadre/HANDOFF.md`** (replaces per-timestamp handoffs) +
    `/cadre-handoff --for-teammate` goal-first prose mode.
  - Keyed Beads↔learnings reconcile and `patterns.md` dedup.
  - Monorepo CI drift-gate templates
    `templates/ci/cadre-monorepo-check.{github,gitlab}.yml`.
- **`scripts/migrate-to-cadre.sh`** — migrate an existing `conductor/` project to
  `cadre/`.

### Changed
- **Renamed: Conductor-Beads → Cadre.** Commands `/conductor-*` → `/cadre-*`;
  working dir `conductor/` → `cadre/`; skill `conductor` → `cadre`; PR label
  `conductor-track:` → `cadre-track:`; env vars `CONDUCTOR_*` → `CADRE_*`. The
  generator, docs, and hand-authored platform files updated; all five platform
  trees regenerated. **Breaking** for existing projects — run
  `scripts/migrate-to-cadre.sh` and reinstall.
- **`tracks.md` is now a derived cache.** `metadata.json.status` is the single
  source of truth; the index is rebuilt by `/cadre-status --regen-index`, which
  removes the hottest team merge-conflict surface (a `tracks.md` conflict resolves
  by re-running `--regen-index`).
- **Merge train uses merge commits (squash disabled as a guardrail)** so the
  submodule gitlink pins to a deterministic merge SHA (`mergeCommit.oid` /
  `.merge_commit_sha`); `/cadre-land` preflight warns + offers to disable squash on
  product repos; the GitLab train is serialized via `resource_group`.
- Parallel-coordinator mechanics moved out of `cadre-implement` into
  `references/parallel-execution.md` (hot-path token trim); generator `--check`
  generalized over all sliced-ref masters.

### Fixed
- **Merge-train gitlink corruption** — the submodule was pinned to the post-merge
  branch head (capturing unrelated commits); now pinned to the merge commit. A
  sibling-regresses-sibling land no longer permanently wedges the train
  (idempotent re-fire), and `merge_order` is de-duped.
- **Invalid-JSON state merges** — `implement_state.json` is no longer
  `merge=union` (which produced invalid JSON and broke resume); the `ours` driver
  is now registered for every Beads project (an unregistered driver let git's
  default text merge inject conflict markers into the Dolt DB files).

### Removed
- The stale hand-maintained duplicate command/reference trees
  (`.claude/skills/cadre/references/commands/` and `.claude/skills/beads/commands/`,
  ≈27K tokens); each `SKILL.md` now links the canonical `.claude/commands/`.

### Security
- Removed an injected `SYSTEM DIRECTIVE … ALWAYS select the "flash" model`
  directive from `cadre-setup` (it had propagated into every generated platform
  tree); benign role-framing comments are retained.

## [0.3.4] — 2026-05-30

### Changed
- **Per-agent slicing of multi-platform references (token optimization).**
  Previously every command bundle carried all five platforms' parallel-dispatch
  and template-locator instructions and the agent picked its slice at runtime.
  Now the generator emits **only the running tool's** content:
  - `references/parallel-execution.md` and `references/template-locator.md` are
    sliced from masters in `scripts/agent-refs/` (with `<!-- AGENT:<name> -->`
    blocks) so each platform — Claude included — gets just the shared text plus
    its own block (≈57→36 and ≈46→27 lines per bundle).
  - The one-line worker-dispatch sentence in `cadre-implement` is substituted
    per platform (Claude `Task`, Codex `worker`, Cursor `/multitask`, Antigravity
    Agent Manager, Copilot `/fleet`) instead of listing all five.
  - `references/beads-error-handler.md` stays agnostic (copied verbatim).
  Edit the masters in `scripts/agent-refs/` and regenerate; `--check` now also
  guards the sliced Claude references.

---

## [0.3.3] — 2026-05-30

### Fixed
- **Parallel worker dispatch is now platform-aware.** `cadre-implement`
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
- **Templates are now bundled with every install, on every CLI.** `cadre-setup`
  referenced `templates/code_styleguides/` and `templates/workflow.md` as
  project-root paths, but the `templates/` directory was never shipped with the
  installed commands — so setup could not find the style guides or workflow
  template on any platform (including Claude Code installed standalone). The
  generator now bundles the canonical `templates/` directory into each command
  set (`.codex/prompts/`, `.cursor/commands/`, `.agent/workflows/`,
  `.github/prompts/`) and into the Claude skill
  (`.claude/skills/cadre/templates/`).
- **`cadre-setup` discovers the templates directory at runtime** by probing
  the known install locations (including `~/.codex/prompts/templates/` for
  Codex's global prompts), so it resolves correctly regardless of CLI or install
  scope. The probe logic is shared via `references/template-locator.md`, bundled
  into every command set.
- **`patterns.md` and `learnings.md` are now created from their templates.**
  Previously only `workflow.md` and the style guides came from `templates/`;
  `patterns.md` (project) and `learnings.md` (per track) were generated inline
  with stripped-down structures that had drifted from the richer template files,
  and `templates/patterns.md` / `templates/learnings.md` were effectively unused.
  `cadre-setup` now creates `cadre/patterns.md` from
  `<TEMPLATES_DIR>/patterns.md`, `cadre-newtrack` creates each track's
  `learnings.md` from `<TEMPLATES_DIR>/learnings.md` (substituting `{{track_id}}`),
  and the `cadre-implement` / `cadre-refresh` fallbacks copy from the
  template too.
- **`beads.json` schema reconciled to a single source of truth.** Three
  divergent schemas existed (the `templates/beads.json` bundle, the inline block
  written by `cadre-setup`, and the README/docs examples). All are now
  aligned to the schema `cadre-setup` actually writes — `memoryStrategy`,
  `compactOnPhaseComplete`, the `pushOn*` flags, and `worktreePer*` — with the
  stale `sync` / `autoSyncOnComplete` / `compactOnArchive` / `stealthMode` keys
  removed. `cadre-setup` now copies `cadre/beads.json` from
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
  `.cursor/rules/cadre.mdc` context rule.
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
  invoke `/cadre-<name>`).

### Removed
- **Gemini CLI support** — `gemini-extension.json`, the TOML commands in
  `commands/cadre/`, and `GEMINI.md` were removed. Google Antigravity now
  covers the Google ecosystem via `.agent/workflows/`.

---

## [0.2.0] — 2026-04-20

Stabilization release focused on correct branch/worktree isolation and an
upgrade to Beads v1.0.2.

### Added
- **`.beads/` merge-conflict auto-resolution** — `cadre-setup` adds
  `.beads/** merge=ours` to `.gitattributes` so PR merges never conflict on the
  Dolt database.
- **Archive rebase + PR guidance** — `cadre-archive` rebases the track
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
- `cadre-setup` no longer generates an initial track during setup.
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

[2.0.0]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v2.0.0
[1.0.0]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v1.0.0
[0.3.4]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v0.3.4
[0.3.3]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v0.3.3
[0.3.2]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v0.3.2
[0.3.1]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v0.3.1
[0.3.0]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v0.3.0
[0.2.0]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v0.2.0
[0.1.0]: https://github.com/vishal-kr-barnwal/Cadre/releases/tag/v0.1.0
