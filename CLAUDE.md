# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cadre is a unified toolkit for **Context-Driven Development** that combines two halves:

- **Spec-first planning** (the Cadre methodology): human-readable context, tracks, TDD workflow
- **Beads**: Dependency-aware task graph, cross-session memory, agent-optimized output

It works through skill-first workflow protocols on Claude Code and OpenAI Codex.

## Architecture

### Repository Structure
```
Cadre/
├── skills/cadre/protocols/ # Master workflow protocols (edit these)
├── .claude/
│   └── skills/             # Generated Claude skill bundle used for packaging
│       └── cadre/
├── .agents/skills/         # Generated Codex skill bundle used for packaging
├── .claude-plugin/         # Claude Code plugin marketplace
├── .agents/plugins/        # OpenAI Codex plugin marketplace
├── plugins/
│   ├── cadre-claude/       # Generated Claude Code plugin
│   └── cadre/              # Generated OpenAI Codex plugin
├── scripts/
│   ├── generate-skills.sh  # Generates Claude/Codex plugin bundles
│   ├── agent-refs/         # Masters for per-agent-sliced references (AGENT blocks)
│   ├── migrate-to-cadre.sh # Migrate an existing conductor/ project to cadre/
│   └── migrate-v2.sh       # v0.1.0 -> v0.2.0 layout migration (legacy)
├── templates/              # Workflow/styleguide templates + ci/ (merge-train + drift-check) + scripts/ (cadre-regen-index.sh, bundled & run in place)
├── docs/                   # Documentation (see docs/INSTALL.md)
├── CLAUDE.md               # This file (Claude Code context)
└── AGENTS.md               # Codex context
```

> **Generated outputs** under `.claude/skills/cadre/`,
> `.agents/skills/cadre/`, `plugins/cadre-claude/`, `plugins/cadre/`,
> `.claude-plugin/marketplace.json`, and `.agents/plugins/marketplace.json`
> are derived from `skills/cadre/protocols/`, `scripts/agent-refs/`, and `templates/` by
> `scripts/generate-skills.sh`. Edit the master sources and regenerate — do not
> hand-edit generated files. CI can run
> `bash scripts/generate-skills.sh --check` to detect drift. Ready-made
> drift-gate workflows ship at
> `templates/ci/cadre-monorepo-check.{github,gitlab}.yml` (they run
> `generate-skills.sh --check` + `bash -n` on PRs).

### Workflows

All platforms use the same workflow names through the `$cadre` skill.

| Workflow | Purpose |
|---------|---------|
| `cadre-setup` | Initialize project with context files and first track |
| `cadre-newtrack` | Create feature/bug track with spec and plan |
| `cadre-implement` | Execute tasks from track's plan (TDD workflow) |
| `cadre-status` | Display progress overview (`--export` writes a project summary; `--team`/`--mine` filter by assignee; `--repos` shows the polyrepo fleet board; `--available`/`--unowned` shows unblocked work to pick up; `--regen-index` rebuilds `tracks.md` from `metadata.json.status`) |
| `cadre-revert` | Git-aware revert of tracks, phases, or tasks (ownership-guarded) |
| `cadre-validate` | Validate project integrity and fix issues |
| `cadre-flag` | Flag the current task as blocked or skipped with a reason (commits + propagates in shared mode) |
| `cadre-revise` | Update spec/plan when implementation reveals issues (ownership-guarded) |
| `cadre-review` | Review a track's diff before shipping (quality gate); `--request [@reviewer]` assigns a reviewer |
| `cadre-ship` | Rebase a reviewed track onto main, push it, prepare the PR (monorepo) |
| `cadre-land` | Polyrepo: open + link the cross-repo PR group; merge train lands it |
| `cadre-archive` | Archive completed tracks (local cleanup + learnings) |
| `cadre-release` | Cut a local release — changelog + version tag |
| `cadre-handoff` | Create context handoff for section transfer |
| `cadre-refresh` | Sync context docs with current codebase state |
| `cadre-formula` | Manage track templates: list, show, create, ephemeral wisp |

### Skills

| Skill | Location | Purpose |
|-------|----------|---------|
| **cadre** | `plugins/cadre-claude/skills/cadre/` and `plugins/cadre/skills/cadre/` | Plugin-bundled workflow skill. Auto-activates when `cadre/` exists. Provides intent mapping and proactive behaviors. |

### Generated Artifacts (in user projects)

When users run Cadre, it creates:
```
project/
├── cadre/
│   ├── product.md           # Product vision and goals
│   ├── product-guidelines.md # Brand/style guidelines
│   ├── tech-stack.md        # Technology choices
│   ├── workflow.md          # Development workflow (TDD, commits)
│   ├── tracks.md            # DERIVED human-readable index (regenerated from metadata.json.status via cadre-status --regen-index)
│   ├── patterns.md          # Consolidated learnings (Ralph-style)
│   ├── beads.json           # Beads integration config
│   ├── config.json          # Project config (PR provider, sync mode, "auto_open", "require_second_reviewer")
│   ├── repos.json           # Polyrepo topology + submodule manifest (polyrepo only)
│   ├── .gitignore           # Git-ignores agent-local state (setup/refresh/non-shared state)
│   ├── setup_state.json     # Resume state for setup (agent-local, git-ignored)
│   ├── refresh_state.json   # Context refresh tracking (agent-local, git-ignored)
│   ├── code_styleguides/    # Language-specific style guides
│   └── tracks/
│       └── <track_id>/
│           ├── metadata.json     # Track config + Beads epic ID + status (source of truth), owner, reviewer, review, lease, merge_order
│           ├── spec.md           # Requirements
│           ├── plan.md           # Phased task list
│           ├── learnings.md      # Patterns/gotchas discovered (Ralph-style)
│           ├── HANDOFF.md        # Per-track rolling handoff (trimmed; --for-teammate prose mode)
│           ├── implement_state.json # Resume state (if in progress)
│           ├── blockers.md       # Block history log
│           ├── skipped.md        # Skipped tasks log
│           └── revisions.md      # Revision history log
└── .beads/                  # Beads data (created by bd init)
```

## Key Concepts

### Tracks
A track is a logical unit of work (feature or bug fix). Each track has:
- Unique ID format: `shortname_YYYYMMDD` (e.g., `auth_20241226`). Same-day duplicate IDs get a `-<2char base36>` suffix; on a push/Dolt conflict the track is re-suffixed (dir + `metadata.track_id` + branch + Beads epic/label) and `tracks.md` is rebuilt via `--regen-index`.
- Status markers: `[ ]` new, `[~]` in progress, `[x]` completed, `[!]` blocked, `[-]` skipped
- **`metadata.json.status` is the single source of truth for track status.** `tracks.md` is a derived human-readable cache rebuilt by `cadre-status --regen-index` — never hand-edit its markers.
- Own directory with spec, plan, metadata, and state files

### Review Gate (New!)
A track must pass review before it ships. `cadre-review` writes
`metadata.review` (`verdict` ∈ `approved` | `changes_requested`, `blocking_count`,
`date`, `reviewer`, `coverage`, `self_reviewed`, `reviewed_sha`, `review_seq`) and
sets the Beads label
`review:ready` or `review:changes` (`cadre-review --request` assigns a reviewer and
sets `review:requested`). `coverage` carries the machine-measured number from
`cadre-implement`'s coverage gate (no longer self-asserted prose). `review_seq` is a
monotonic per-write counter; review runs **no owner ownership-guard** (a reviewer is
not the owner), so that counter plus an **anti-downgrade guard** (an `approved` may
not silently bury another reviewer's open `changes_requested` without a logged
override) are what make concurrent reviews safe. `cadre-ship`
and `cadre-land` then **refuse** to proceed on `changes_requested`,
`blocking_count > 0`, or (when `config.json` `require_second_reviewer` is set) a
`self_reviewed` approval; they also run the shared-mode sync preamble and **re-read
the verdict immediately before pushing** to close the review→ship TOCTOU window. An
absent `review` block yields a soft prompt, and a clean approval proceeds.

### Identity, Ownership & Leases (New!)
Assignees use the git committer identity (`user.email` → `user.name`), never a
literal `cadre`. `metadata.json` records `owner` and `reviewer`. A **topology-
independent ownership guard** (`references/ownership-guard.md`) runs before any
track mutation — `cadre-implement` (at selection), `cadre-flag`, `cadre-revise`,
`cadre-revert`, `cadre-handoff` — so two people can't clobber the same track even
in the **default monorepo** mode where the advisory `lease` is a no-op. In
**shared** sync mode a track can additionally hold a `lease`; stale leases (older
than the canonical **30-minute** window shared by implement and validate) are swept
by `cadre-validate`. Resolution of the active track is always from
`metadata.json.status` (source of truth), never the derived `tracks.md` cache.

### Topology: Monorepo vs Polyrepo (New!)
Cadre runs in one of two topologies, chosen at `cadre-setup`:
- **Monorepo (default):** no `cadre/repos.json`; all Cadre workflows behave as they
  always have. Fully backward compatible.
- **Polyrepo:** a `cadre/repos.json` with `mode: "polyrepo"` makes the current
  repo a **control repo** holding `cadre/` + `.beads/` + `.gitmodules`; product
  code lives in **git submodules**. A track spans multiple repos via per-task
  `<!-- repo: <name> -->` annotations; branches/commits/worktrees/reverts are
  per-repo. `cadre-land` opens one PR per touched repo + a control-repo PR,
  linked by label `cadre-track:<id>`, and a generated **merge train** lands
  them product-repos-first, control-repo-last (order from `metadata.merge_order`).
  The train uses **merge commits with squash disabled as a guardrail** — a squashed
  merge has no deterministic, immediately-available commit to pin the submodule
  gitlink to, so the gitlink pins to the merge commit (`mergeCommit.oid` on GitHub,
  `.merge_commit_sha` on GitLab). PR provider (GitHub/GitLab), sync mode
  (shared/local), and `"auto_open"` (default `false`) live in `cadre/config.json`.
  See [docs/POLYREPO.md](docs/POLYREPO.md).

### Parallel Execution (New!)
Phases can execute tasks in parallel using sub-agents:
- Annotate phases with `<!-- execution: parallel -->`
- Tasks have `<!-- files: ... -->` for exclusive file ownership
- Use `<!-- depends: taskN -->` for task dependencies
- Coordinator spawns workers via Task() tool
- `<!-- files: ... -->` is emitted for every task, not only parallel phases, so
  status/collision/validate flows can catch cross-track file overlap
- State tracked in `parallel_state.json` as an audit log; Beads dependencies drive
  coordination

### Task Workflow (TDD)
1. Select task from plan.md (or use `bd ready` if Beads enabled)
2. Mark `[~]` in progress (sync to Beads: `bd update <id> --status in_progress`)
3. Write failing tests (Red)
4. Implement to pass (Green)
5. Refactor
6. Verify >80% coverage with the configured coverage tool; record the measured
   percentage in `metadata.last_coverage` so review can copy it into
   `metadata.review.coverage`
7. Commit with message format: `<type>(<scope>): <description>`
8. Update plan.md with commit SHA
9. If Beads: `bd close <id> --reason "commit: <sha>"`

**Important:** Product code stays local until `cadre-ship` (monorepo) or
`cadre-land` (polyrepo). In shared sync mode, only the control plane
(`cadre/` + Beads) is pushed/pulled for collaboration.

Agent-local state files (`setup_state.json`, `refresh_state.json`, and
non-shared `implement_state.json` / `parallel_state.json`) are git-ignored via
`cadre/.gitignore`. Shared state files rely on the `ours` merge driver
(`.beads/**` and `parallel_state.json` carry `merge=ours`), so every Beads
project must register it with `git config merge.ours.driver true`; otherwise git
can inject text conflict markers into Dolt DB files.

### Beads Integration
When Beads is enabled (`cadre/beads.json` with `enabled: true`):
- Each track becomes a Beads epic
- Tasks sync to Beads for persistent memory
- `bd ready` finds tasks with no blockers
- Notes survive context compaction
- Graceful degradation if `bd` command fails

### Learnings System (Ralph-style)
Cadre captures and consolidates learnings across tracks:

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

- Master workflow protocols are Markdown in `skills/cadre/protocols/`; Claude and Codex plugin bundles are generated from them by `scripts/generate-skills.sh`
- Skills use SKILL.md format with references/ subdirectory
- Skills bundle generated workflow-protocol copies under `protocols/`; edit only the top-level master `skills/cadre/protocols/cadre-*.md` files and regenerate
- State is tracked in JSON files (setup_state.json, implement_state.json, metadata.json)
- Git notes used for audit trails
- Cadre workflows validate setup before executing
- All supported platforms operate on the same `cadre/` directory structure (interoperable)

## Documentation

- [Polyrepo Guide](docs/POLYREPO.md) - Control-repo model, submodules, cross-repo PRs + merge train, sync modes
- [Install & Version Guide](docs/INSTALL.md) - Per-platform install + compatibility matrix + versioning policy
- [Platform Usage Guide](docs/PLATFORM_USAGE.md) - End-to-end operating model for using Cadre
- [Manual Workflow Guide](docs/manual-workflow-guide.md) - Step-by-step workflow protocol reference
- [Beads Integration](docs/BEADS_INTEGRATION.md) - How Cadre and Beads work together
- [Parallel Execution](docs/PARALLEL_EXECUTION.md) - Parallel task execution design
- [MCP and LSP Integration](docs/MCP_LSP.md) - Cadre MCP tools/resources and LSP review helper rollout
