# Cadre Platform Usage Guide

This guide explains how to use Cadre as a development platform: install it,
initialize a project, create and run tracks, coordinate a team, and operate
monorepo or polyrepo delivery safely.

Use this guide when you want the end-to-end operating model. Use
[Install & Version Guide](INSTALL.md) for installation details, and use
[Manual Workflow Guide](manual-workflow-guide.md) when you need step-by-step
workflow protocol detail.

## What Cadre Is

Cadre is a workflow layer for AI-assisted software development. It turns a repo
into a structured work system with:

- Project context files, such as product goals, tech stack, workflow rules, and
  code style guides.
- Tracks, which are feature or bug units with a spec, plan, metadata, and
  learnings.
- Beads integration for persistent task memory, dependency tracking, notes, and
  resume context.
- Review, ship, land, archive, and release workflows for a complete SDLC.
- Team safety features for ownership, review gates, collision checks, and shared
  control-plane sync.

The short version:

```text
setup -> newtrack -> implement -> review -> ship/land -> archive -> release
```

## Core Concepts

### Project Context

After `cadre-setup`, a project has a `cadre/` directory that records how work
should happen:

| File | Purpose |
|------|---------|
| `cadre/product.md` | What the product is and who it serves. |
| `cadre/product-guidelines.md` | Product behavior, UX, brand, or domain rules. |
| `cadre/tech-stack.json` | Structured languages, frameworks, build/test commands, deployment assumptions. |
| `cadre/workflow.md` | TDD workflow, commit rules, verification, coverage threshold. |
| `cadre/patterns.md` | Reusable learnings promoted from completed tracks. |
| `cadre/tracks.md` | Human-readable track index, derived from each track's metadata. |
| `cadre/beads.json` | Beads integration settings. |
| `cadre/config.json` | Team sync, PR provider, merge-train, and review settings. |
| `cadre/repos.json` | Polyrepo topology, when enabled. |

`cadre/tracks.md` is not the source of truth. Each track's
`metadata.json.status` is authoritative. Regenerate the index with:

```bash
cadre-status --regen-index
```

### Tracks

A track is a scoped unit of work. A track directory looks like this:

```text
cadre/tracks/<track_id>/
├── metadata.json
├── spec.md
├── plan.md
├── learnings.md
├── HANDOFF.md
├── blockers.md
├── skipped.md
└── revisions.md
```

Important fields in `metadata.json`:

| Field | Purpose |
|-------|---------|
| `track_id` | Stable ID, usually `<shortname>_<YYYYMMDD>`. |
| `status` | `new`, `in_progress`, `completed`, `blocked`, or `skipped`. |
| `owner` | Git identity of the active operator. |
| `reviewer` | Assigned reviewer, when any. |
| `review` | Structured review verdict used by ship/land gates. |
| `beads_epic` | Linked Beads epic ID. |
| `repos` | Per-repo branches/worktrees for polyrepo tracks. |
| `merge_order` | Optional repo landing order for polyrepo merge train. |

### Plans

`plan.md` is the execution contract. It contains phases and tasks:

```markdown
## Phase 1: Auth Core
<!-- execution: parallel -->

- [ ] Task 1: Add token validator
  <!-- files: src/auth/token.ts, src/auth/token.test.ts -->

- [ ] Task 2: Add login endpoint
  <!-- files: src/auth/login.ts, src/auth/login.test.ts -->
  <!-- depends: task1 -->
```

`<!-- files: ... -->` annotations are first-class. They drive parallel worker
ownership, cross-track collision scans, and team safety checks. Add or refine
them when the plan changes.

### Beads

Cadre uses Beads as durable task memory. Beads stores dependency relationships,
status, notes, and resume context in `.beads/`.

Common commands:

```bash
bd ready
bd show <id>
bd note <id> "COMPLETED: ..."
bd close <id> --continue --reason "done"
bd dolt push
bd dolt pull
```

Cadre requires Beads. The `bd` CLI and `cadre/beads.json` task graph are part of
the setup contract because ownership, handoffs, review labels, and compaction
survival depend on them.

## Install Cadre

Install Cadre through the plugin marketplaces:

```bash
git clone https://github.com/vishal-kr-barnwal/Cadre.git
cd Cadre
```

Claude Code:

```text
/plugin marketplace add vishal-kr-barnwal/Cadre
/plugin install cadre@cadre
```

OpenAI Codex:

```bash
codex plugin marketplace add vishal-kr-barnwal/Cadre --sparse .agents/plugins --sparse plugins/cadre
codex plugin add cadre@cadre
```

Supported primary surfaces:

| Surface | Cadre form |
|---------|------------|
| Claude Code | Plugin with bundled workflow protocols. |
| OpenAI Codex | Plugin with bundled workflow protocols plus `AGENTS.md` context. |

Install Beads too:

```bash
npm install -g @beads/bd
bd --version
```

## Initialize a Project

Ask the Cadre skill to run setup inside your target project:

```bash
cadre-setup
```

Setup asks about:

- Brownfield or greenfield project.
- Product and technical context.
- Optional LSP/code-intelligence setup based on a codebase scan.
- Beads mode.
- Monorepo or polyrepo topology.
- Shared or local sync mode.
- PR provider and merge-train settings, when polyrepo is enabled.

At the end, review the generated context files. They become the standing
instructions for future AI work.

## Choose Topology

### Monorepo

Use monorepo mode when the code for a product lives in one repo, or when you can
reasonably make cross-cutting changes in one branch.

Monorepo is the default. If there is no `cadre/repos.json`, Cadre treats the
project as a monorepo.

Use `cadre-ship` to prepare the PR.

### Polyrepo

Use polyrepo mode when multiple product repos must remain separate but one
feature may span them.

Polyrepo uses a control repo:

```text
control-repo/
├── cadre/
├── .beads/
├── .gitmodules
├── repos/api/
├── repos/web/
└── .worktrees/<track_id>/<repo>/
```

Use `cadre-land` to open the cross-repo PR group. The merge train lands product
repos first and the control repo last. Product repos must allow merge commits,
because the control repo pins submodule gitlinks to deterministic merge SHAs.

Choose polyrepo only when the repo boundary matters. It is powerful, but it has
more moving parts: submodules, cross-repo tokens, host APIs, branch protection,
and no true atomic cross-repo merge.

## Choose Sync Mode

Cadre separates the control plane from product code.

| Mode | What happens |
|------|--------------|
| `local` | Cadre state and product code stay local until the user pushes. |
| `shared` | The control plane, `cadre/` plus Beads, is pulled/pushed for team coordination. Product code still stays local until ship/land. |

Use shared mode for a 10-20 person team. It lets teammates see owners, leases,
review state, available work, and blockers.

Shared mode requires:

```bash
git config merge.ours.driver true
```

Cadre self-heals this in shared workflow preambles, but registering it explicitly
on every clone is still a good team setup step.

## Create Work

Create a track:

```bash
cadre-newtrack "Add OAuth login"
```

Cadre will:

1. Ask clarifying questions.
2. Draft `spec.md`.
3. Draft `plan.md`.
4. Add `<!-- files: ... -->` annotations.
5. Add repo annotations in polyrepo mode.
6. Create a Beads epic and tasks when Beads is available.
7. Create a track branch/worktree.

Before approving the plan, check:

- The acceptance criteria are testable.
- Each task has clear owned files.
- Parallel tasks have no file overlap.
- Cross-repo tasks are split by repo when possible.
- The plan includes explicit dependencies for tasks that must run in order.

## Implement Work

Start or resume implementation:

```bash
cadre-implement <track_id>
```

The implementation loop is:

1. Claim the track with your git identity.
2. Load spec, plan, workflow, Beads notes, and relevant learnings.
3. Select ready tasks from Beads or `plan.md`.
4. Write failing tests.
5. Implement.
6. Refactor.
7. Run tests, lint, type checks, and coverage.
8. Commit locally.
9. Mark task complete and record learnings.

Cadre does not push product code during implementation.

### Coverage

The workflow's coverage threshold must be measured, not asserted. Configure the
coverage command in `cadre/workflow.md` or `cadre/tech-stack.json`. Cadre records
the measured value in `metadata.last_coverage`, and review copies it into
`metadata.review.coverage`.

### Learnings

After each task, capture what future work should know:

```markdown
key: <track_id>:p<phase>:t<task>:<sha7>
## 2026-06-17 - Phase 1 Task 2: Add token refresh
- Implemented: ...
- Files changed: ...
- Commit: ...
- Learnings:
  - Patterns: ...
  - Gotchas: ...
  - Context: ...
```

At phase or track completion, promote reusable learnings to
`cadre/patterns.md`.

## Use Parallel Work

Parallel execution is useful when tasks are independent and own separate files.

Cadre supports:

- Parallel tasks inside one phase.
- Parallel phases when dependencies allow.
- Repo-scoped parallelism in polyrepo mode.
- Worker worktrees and worker branches.
- Fault isolation for workers that hit merge conflicts.

Use parallelism when:

- Tasks touch distinct files.
- Test surfaces are independent.
- Dependencies are explicit.
- The coordinator can merge worker branches in a predictable order.

Avoid parallelism when:

- Many tasks edit the same file.
- A task discovers or rewrites shared architecture.
- The acceptance criteria are still fluid.
- The cost of reviewing worker output exceeds the time saved.

## Check Status

Common status workflow requests:

```bash
cadre-status
cadre-status --mine
cadre-status --team
cadre-status --available
cadre-status --collisions
cadre-status --repos
cadre-status --export
```

Use these boards this way:

| Flag | Use when |
|---------|----------|
| `--mine` | You want your active work. |
| `--team` | You want owner, lease, review, and WIP distribution. |
| `--available` | You want unblocked work someone can pick up. |
| `--collisions` | You want cross-track file overlap before merges collide. |
| `--repos` | You want polyrepo fleet status. |
| `--export` | You want a shareable project summary. |

Run validation periodically:

```bash
cadre-validate
```

Validation checks index drift, metadata, plans, Beads consistency, stale leases,
merge-driver setup, state-file health, and polyrepo manifest/submodule parity.

## Handle Changes During Work

### Block a Task

```bash
cadre-flag blocked
```

Use this when an external dependency, missing API, access issue, or product
decision prevents progress.

### Skip a Task

```bash
cadre-flag skipped
```

Use this when a task is no longer needed or intentionally deferred.

### Revise Spec or Plan

```bash
cadre-revise <track_id>
```

Use this when implementation reveals that the spec is wrong, the plan is missing
work, or dependencies need to change. Cadre records revisions in
`revisions.md`.

### Handoff Work

```bash
cadre-handoff
cadre-handoff --for-teammate @alice
```

Use handoff before context gets large, before pausing for the day, or before
transferring ownership. Cadre writes a rolling
`cadre/tracks/<track_id>/HANDOFF.md`.

## Review Work

Run review after implementation is complete:

```bash
cadre-review <track_id>
```

Review checks:

- Diff against base branch.
- Acceptance criteria.
- Plan completeness.
- Tests and coverage.
- Typecheck/build output when configured.
- LSP/code-intelligence risk, when configured.

The result is recorded in `metadata.review`:

```json
{
  "verdict": "approved",
  "blocking_count": 0,
  "date": "2026-06-17T12:00:00Z",
  "reviewer": "reviewer@example.com",
  "coverage": 87.5,
  "self_reviewed": false,
  "reviewed_sha": "abc123...",
  "reviewed_shas": {
    ".": "abc123...",
    "api": "def456..."
  },
  "review_seq": 1
}
```

Request a reviewer without reviewing:

```bash
cadre-review --request @alice
```

For teams, consider setting `require_second_reviewer: true` in
`cadre/config.json`. Then a track approved by its owner cannot ship until a
different reviewer approves it.

## Ship or Land

### Monorepo Ship

```bash
cadre-ship <track_id>
```

Ship:

1. Re-reads the review gate.
2. Refuses unresolved review findings.
3. Checks `reviewed_sha` / `reviewed_shas`.
4. Rebases the track branch.
5. Pushes the track branch.
6. Prepares or opens the PR, depending on config.

### Polyrepo Land

```bash
cadre-land <track_id>
```

Land:

1. Runs polyrepo preflight across touched repos.
2. Re-reads the review gate.
3. Pushes per-repo track branches.
4. Opens or reuses one PR per product repo plus one control-repo PR.
5. Labels and cross-links the PR group.
6. Records PR URLs in metadata.
7. Lets merge-train CI land product repos first, then the control repo.

Do not merge polyrepo PRs manually out of order. The control PR is the final
snapshot seal.

## Archive and Release

After a shipped or landed track:

```bash
cadre-archive <track_id>
```

Archive extracts remaining learnings, cleans up worktrees, and moves completed
work out of active track lists.

Cut a release when enough shipped work has accumulated:

```bash
cadre-release patch
cadre-release minor
cadre-release major
```

Cadre creates a changelog entry and local tag. Users decide when to push tags.

## Use MCP

Cadre requires its bundled MCP server:

```bash
node scripts/mcp/cadre-server.js
```

Every project-scoped MCP tool requires a per-call `root` argument. The server
normalizes that path by walking upward to the nearest directory containing
`cadre/`, so callers may pass either the project root or a path inside it. This
keeps one long-running MCP process safe across two sessions in different
projects because no project root is stored globally. Verify MCP availability
with `cadre_project` with `action: "ping"`; if Cadre MCP tools are unavailable,
halt and ask the user to install, enable, or restart the Cadre plugin.

Useful MCP tools:

| Tool | Purpose |
|------|---------|
| `cadre_project` with `action: "ping"` | Verify that the required Cadre MCP runtime is available. |
| `cadre_project` with `action: "root"` | Resolve a supplied `root` to the Cadre project root. |
| `cadre_status` with `action: "live"` | Cheap default status summary. |
| `cadre_status` with `action: "team"` | Structured team board. |
| `cadre_status` with `action: "available"` | Ready unowned work plus stale held work that can be reclaimed. |
| `cadre_mutate` with `action: "set_status"` | Set `metadata.json.status` and regenerate `tracks.md`. |
| `cadre_status` with `action: "collisions"` | Cross-track exact, prefix, and glob file overlaps. |
| `cadre_review` with `action: "gate"` | Whether a track can ship/land. |
| `cadre_project` with `action: "polyrepo_preflight"` | Local polyrepo sanity checks. |
| `cadre_mutate` with `action: "regen_index"` | Regenerate `tracks.md`. |

Workflow routing:

| Workflow checkpoint | MCP tool |
|--------------------|----------|
| Project root resolution | `cadre_project` with `action: "root"` |
| Cheap default status | `cadre_status` with `action: "live"` |
| Track inventory, active/completed selection, owner/reviewer summaries | `cadre_status` with `action: "team"` |
| Next unblocked or reclaimable work | `cadre_status` with `action: "available"` |
| Cross-track exact, prefix, and glob file overlaps | `cadre_status` with `action: "collisions"` |
| Phase/task/annotation parsing | `cadre_track` with `action: "parse_plan"` |
| Track status mutation | `cadre_mutate` with `action: "set_status"` |
| Derived `tracks.md` rebuilds | `cadre_mutate` with `action: "regen_index"` |
| Ship/land review enforcement | `cadre_review` with `action: "gate"` |
| Polyrepo setup/validate/refresh/land sanity checks | `cadre_project` with `action: "polyrepo_preflight"` |

MCP is the required deterministic integration layer for status, collision,
review-gate, and index-regeneration checks. A client can call tools instead of
asking an agent to reread and reinterpret long Markdown workflow protocols.

## Use LSP Review

Configure optional language servers during setup or later:

```bash
cadre-setup
cadre-refresh --lsp
```

Cadre scans the codebase, recommends language servers, checks whether each server
command is installed, and asks whether to append the recommendations to
`cadre/lsp.json`. If a recommended server is missing, Cadre shows the install
command and lets you write the config now or stop and install first.

The resulting `cadre/lsp.json` looks like this:

```json
{
  "servers": [
    {
      "id": "typescript",
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    }
  ]
}
```

Run the helper:

```bash
node <TEMPLATES_DIR>/scripts/cadre-lsp-review.js --base main --head track/<track_id> --json
```

If no config exists, it exits successfully with `available: false`. `cadre-review`
can then record that code intelligence was skipped instead of pretending it ran.

Use LSP review for:

- API signature changes.
- Removed or renamed exported symbols.
- Shared library changes.
- Large refactors.
- Polyrepo tracks where one repo depends on another's surface.

## Operate as a Team

For 10-20 people, use these defaults:

| Area | Recommendation |
|------|----------------|
| Topology | Monorepo unless repo boundaries are essential. |
| Sync mode | `shared`. |
| Beads | Enabled and committed as the shared control plane. |
| Review | Require structured `cadre-review`; consider `require_second_reviewer`. |
| Status | Use `--team`, `--available`, and `--collisions` daily. |
| Parallelism | Use for independent tasks with clear file ownership. |
| CI | Install monorepo drift gate or polyrepo merge train templates. |
| MCP | Required through the Cadre plugin for deterministic status checks. |
| Provider MCP | Use `provider_mode: "github"` or `"gitlab"` only when the matching provider MCP can supply PR/MR/CI evidence; use `"local"` for local-only repos. |
| LSP | Enable for repos with shared APIs or heavy refactors. |

Daily team loop:

```text
1. cadre-status --team
2. cadre-status --available
3. Pick/claim a track with cadre-implement
4. Use cadre-status --collisions before deep edits
5. Handoff before pausing or transferring work
6. Review before ship/land
7. Archive after merge
```

## CI and Drift Gates

Cadre ships CI templates:

```text
templates/ci/cadre-monorepo-check.github.yml
templates/ci/cadre-monorepo-check.gitlab.yml
templates/ci/cadre-merge-train.github.yml
templates/ci/cadre-merge-train.gitlab.yml
```

Use the monorepo check to catch:

- Generated skill protocol drift.
- Shell syntax errors.
- `tracks.md` index drift.
- Missing shared-mode `.gitattributes` lines.
- Missing review gate on track PRs.
- AGENTS/CLAUDE context drift, when `scripts/check-agent-context.sh` exists.

Use the merge-train templates for polyrepo landing.

## Common Troubleshooting

### `tracks.md` Has a Merge Conflict

Do not hand-merge status markers. Resolve either side, then run:

```bash
cadre-status --regen-index
```

### Beads DB Gets Conflict Markers

Register the merge driver:

```bash
git config merge.ours.driver true
```

Then rerun the shared sync or validation command.

### A Track Looks Owned by Someone Who Is Gone

Run:

```bash
cadre-validate
```

Shared mode stale leases older than the canonical 30-minute window can be swept.

### A Review Passed but Ship Refuses

Check:

- `metadata.review.verdict`
- `metadata.review.blocking_count`
- `metadata.review.reviewed_sha`
- `metadata.review.reviewed_shas`
- `metadata.review.self_reviewed`
- `cadre/config.json` `require_second_reviewer`

If code changed after review, rerun:

```bash
cadre-review <track_id>
```

### Polyrepo Land Opens No PRs

Check:

- `cadre/repos.json`
- `.gitmodules`
- submodule initialization
- track branch existence per repo
- `cadre/config.json` `provider_mode` and matching provider MCP availability
- `CADRE_TRAIN_TOKEN`
- branch protection and merge-commit settings

Run:

```bash
cadre-validate
cadre-status --repos
```

## Workflow Reference

| Workflow | Purpose |
|---------|---------|
| `cadre-setup` | Initialize Cadre in a project. |
| `cadre-newtrack` | Create a track with spec, plan, metadata, and Beads tasks. |
| `cadre-implement` | Execute track tasks with TDD and local commits. |
| `cadre-status` | Show status, team boards, available work, collisions, repos, export. |
| `cadre-review` | Review diff and record structured verdict. |
| `cadre-ship` | Monorepo ship flow. |
| `cadre-land` | Polyrepo PR group and merge-train flow. |
| `cadre-archive` | Archive completed work and extract learnings. |
| `cadre-release` | Create changelog and local version tag. |
| `cadre-handoff` | Save rolling per-track handoff. |
| `cadre-revise` | Update spec/plan when reality changes. |
| `cadre-flag` | Mark task blocked or skipped. |
| `cadre-revert` | Revert track, phase, or task work. |
| `cadre-validate` | Check and optionally repair Cadre integrity. |
| `cadre-refresh` | Sync context docs with the current codebase. |
| `cadre-formula` | Manage reusable templates and wisps. |

## Recommended Reading

- [Install & Version Guide](INSTALL.md)
- [Manual Workflow Guide](manual-workflow-guide.md)
- [Polyrepo Guide](POLYREPO.md)
- [Parallel Execution](PARALLEL_EXECUTION.md)
- [Beads Integration](BEADS_INTEGRATION.md)
- [MCP and LSP Integration](MCP_LSP.md)
