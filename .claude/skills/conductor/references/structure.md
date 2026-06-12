# Conductor Directory Structure

When you see this structure, the project uses Conductor:

```
conductor/
├── product.md              # Product vision, users, goals
├── product-guidelines.md   # Brand/style guidelines (optional)
├── tech-stack.md           # Technology choices
├── workflow.md             # Development standards (TDD, commits, coverage)
├── tracks.md               # Master track list with status markers
├── patterns.md             # Consolidated learnings from all tracks (Ralph-style)
├── setup_state.json        # Setup progress tracking
├── refresh_state.json      # Context refresh tracking (created by /conductor-refresh)
├── beads.json              # Beads integration config (created by setup)
├── code_styleguides/       # Language-specific style guides
├── archive/                # Archived completed tracks
├── exports/                # Exported summaries
└── tracks/
    └── <track_id>/         # Format: shortname_YYYYMMDD
        ├── metadata.json   # Track type, status, dates
        ├── spec.md         # Requirements and acceptance criteria
        ├── plan.md         # Phased task list with status
        ├── learnings.md    # Patterns/gotchas discovered (Ralph-style)
        ├── implement_state.json  # Phase-aware implementation resume state (if in progress)
        ├── handoff_*.md    # Section handoff documents (if any)
        ├── blockers.md     # Block history log (if any)
        ├── skipped.md      # Skipped tasks log (if any)
        └── revisions.md    # Revision history log (if any)
```

## Topology: Monorepo vs Polyrepo

Conductor runs in one of two topologies, decided at `/conductor-setup`:

- **Monorepo (default).** No `conductor/repos.json`. The repo root is the single
  working tree; every track is one `track/<id>` branch; the structure above
  applies as-is. This is fully backward compatible — absent `repos.json`, every
  command behaves exactly as before.
- **Polyrepo.** A `conductor/repos.json` with `"mode": "polyrepo"` exists. The
  current repo is a **control repo** that holds `conductor/`, `.beads/`,
  `.gitmodules`, and the merge-train CI. Product code lives in **git submodules**
  listed in `repos.json`. A single track can span multiple repos; branches,
  commits, worktrees, and reverts become **per-repo**.

```
control-repo/                 # polyrepo control plane
├── conductor/
│   ├── repos.json            # submodule manifest + mode:"polyrepo" + default_repo
│   ├── config.json           # sync_mode + pr_provider (github|gitlab) + merge_train
│   └── ... (tracks.md, tracks/<id>/*, etc. as above)
├── .beads/                   # single shared Dolt task graph for ALL repos
├── .gitmodules               # authoritative path+URL for each product repo
├── .github/workflows/conductor-merge-train.yml   # (github) cross-repo merge train
│   └── (or .gitlab-ci.yml for gitlab)
├── repos/<name>/             # product repo as a submodule
└── .worktrees/<track_id>/<repo>/   # per-repo track worktree
```

### New polyrepo files

| File | Purpose |
|------|---------|
| `conductor/repos.json` | Submodule manifest; `mode:"polyrepo"`, `default_repo`, per-repo `submodule_path`/`url`/`default_branch`/`enabled`. Its presence switches commands onto the polyrepo path. |
| `conductor/config.json` | `sync_mode` (shared\|local), `control_remote`/`control_branch`, `pr_provider` (github\|gitlab), `merge_train` settings. Absent → `local` → today's behavior. |

### The `<!-- repo: <name> -->` annotation

In polyrepo mode, each task in `plan.md` may carry a `<!-- repo: <name> -->`
annotation (parallel to `<!-- files: -->` / `<!-- depends: -->`) naming the
target submodule. Absent → `default_repo`. It must **not** be stripped when a
task completes — it disambiguates branches, worktrees, and commit SHAs for the
life of the track. `metadata.json` gains a `repos` map carrying each repo's
`git_branch` / `worktree_path` / `base_branch`; the flat `git_branch` /
`worktree_path` fields remain for monorepo.

## Status Markers

Throughout conductor files:

| Marker | Meaning |
|--------|---------|
| `[ ]` | Pending/New |
| `[~]` | In Progress |
| `[x]` | Completed (often followed by 7-char commit SHA) |
| `[!]` | Blocked (followed by reason in brackets) |
| `[-]` | Skipped (followed by reason) |

## State Files Reference

| File | Purpose |
|------|---------|
| `conductor/setup_state.json` | Track setup progress for resume |
| `conductor/product.md` | Product vision, users, goals |
| `conductor/tech-stack.md` | Technology choices |
| `conductor/workflow.md` | Development workflow (TDD, commits) |
| `conductor/tracks.md` | Master track list with status |
| `conductor/patterns.md` | Consolidated learnings from all tracks |
| `conductor/tracks/<id>/metadata.json` | Track metadata |
| `conductor/tracks/<id>/spec.md` | Requirements |
| `conductor/tracks/<id>/plan.md` | Phased task list |
| `conductor/tracks/<id>/learnings.md` | Patterns/gotchas discovered during implementation |
| `conductor/tracks/<id>/implement_state.json` | Phase-aware implementation resume state |
| `conductor/tracks/<id>/parallel_state.json` | Parallel worker state (for parallel phases) |
| `conductor/tracks/<id>/handoff_*.md` | Section handoff documents |
| `conductor/tracks/<id>/blockers.md` | Block history log |
| `conductor/tracks/<id>/skipped.md` | Skipped tasks log |
| `conductor/tracks/<id>/revisions.md` | Revision history log |
| `conductor/refresh_state.json` | Context refresh tracking |
| `conductor/beads.json` | Beads integration config |
| `conductor/archive/` | Archived completed tracks |
| `conductor/exports/` | Exported summaries |

## Parallel Execution Annotations

Plan.md can include annotations for parallel task execution:

| Annotation | Location | Purpose |
|------------|----------|---------|
| `<!-- execution: parallel -->` | After phase heading | Enable parallel execution for phase |
| `<!-- files: path1, path2 -->` | After task line | Exclusive file ownership |
| `<!-- depends: task1, task2 -->` | After task line | Task dependencies within phase |
| `<!-- parallel-group: name -->` | After task line | Optional grouping |
| `<!-- repo: name -->` | After task line | Target submodule (polyrepo mode); absent → `default_repo`. Never stripped on completion. |

## Cross-platform compatibility

The same `conductor/` structure is used by every supported tool — Claude Code,
OpenAI Codex CLI, Cursor, Google Antigravity, and GitHub Copilot — and all of
them invoke the same command name (e.g. `/conductor-setup`, `/conductor-newtrack`,
`/conductor-implement`). Files, workflows, and state management are fully
compatible across tools, so you can mix them on one repo.
