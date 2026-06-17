---
name: cadre
description: |
  Context-driven development methodology for organized, spec-first coding. Use when:
  - Project has a `cadre/` directory
  - User mentions specs, plans, tracks, or context-driven development
  - Files like `cadre/tracks.md`, `cadre/product.md`, `cadre/workflow.md` exist
  - User asks about project status, implementation progress, or track management
  - User wants to organize development work with TDD practices
  - User asks for a `cadre-*` workflow (setup, newtrack, implement, status, revert, validate, flag, revise, review, ship, land, archive, release, handoff, refresh, formula)
  - User mentions documentation is outdated or wants to sync context with codebase changes
  - Project is a polyrepo control repo (`cadre/repos.json` with mode "polyrepo") spanning git-submodule product repos

  Interoperable across Claude Code and OpenAI Codex.
  Integrates with Beads for persistent task memory across sessions.
---

# Cadre: Context-Driven Development

Measure twice, code once.

## Overview

Cadre enables context-driven development by:
1. Establishing project context (product vision, tech stack, workflow)
2. Organizing work into "tracks" (features, bugs, improvements)
3. Creating specs and phased implementation plans
4. Executing with TDD practices and progress tracking
5. **Parallel execution** of independent tasks using sub-agents

For parallel execution details (annotations, state schema, when to use), see
[references/parallel-execution.md](references/parallel-execution.md).

## Context Loading

Load **lazily**: pull each file only when a workflow actually needs it, and only
once per session. Do **not** eagerly read everything on activation. Project files
grow with project age, and long `tracks.md` / `patterns.md` histories should not
be a fixed tax on simple commands.

**Minimal activation set** (read only when useful for the requested workflow):
1. `cadre/product.md` - Product vision and goals
2. `cadre/tech-stack.md` - Technology constraints
3. `cadre/workflow.md` - Development methodology (TDD, commits)

**Load on demand** (only from workflows that use them):
- `cadre/tracks.md` - human-readable derived index. Read the marked index region
  only, not the whole file. Status-aware workflows resolve status from each
  track's `metadata.json.status` through MCP rather than treating this cache as
  authoritative.
- `cadre/patterns.md` - codebase patterns; read before starting implementation
  or creating a track. Workflows that never use it (`cadre-release`,
  `cadre-flag`, bare `cadre-status`) should not load it.
- Active track files (`spec.md`, `plan.md`, `learnings.md`, `HANDOFF.md`) - load
  only after the track is selected.

**Important:** Cadre commits locally but never pushes product code except in the
explicit ship/land flows. Users decide when product code goes remote.

## MCP Tool Contract

Cadre MCP is a required runtime for deterministic status, collision,
review-gate, index-regeneration, and common mutation checks. At the start of
every Cadre workflow, verify the MCP server is available with `cadre_ping`.
If the Cadre MCP tools are unavailable, **HALT** and tell the user to install,
enable, or restart the Cadre plugin; do not silently continue with a file-only
fallback for MCP-backed checks.

Every project-scoped Cadre MCP call **MUST** include a per-call `root` argument
pointing at the current project root, or any path inside that project. The MCP
server normalizes the path upward to the nearest directory containing `cadre/`.
For `cadre-setup`, verify MCP availability first; project-scoped MCP calls begin
after setup has created `cadre/`.

Do not rely on MCP server cwd, `CADRE_ROOT`, or remembered server state for
project routing. This keeps one long-running MCP process safe across multiple
projects.

Examples:

```json
{ "root": "/absolute/path/to/project" }
```

For resource reads, include `root` in the URI query, e.g.
`cadre://team-status?root=/absolute/path/to/project`.

Workflow tool routing:

| MCP tool | Required use |
|---------|--------------|
| `cadre_doctor` | Diagnose Cadre runtime wiring, project markers, Beads, LSP, provider CLIs, and generated-bundle check availability. Use when setup/tool availability is unclear. |
| `cadre_current_root` | Resolve the per-call project root at the start of every project-scoped workflow. |
| `cadre_live_status` | Cheap bare `cadre-status` summary. |
| `cadre_team_status` | Track inventory, active/completed track selection, owner/reviewer/status summaries. |
| `cadre_team_board` | Rich low-token team board for WIP, handoffs, review queue, blockers, and optional Beads label evidence. |
| `cadre_available_work` | `cadre-status --available` and default `cadre-implement` candidate selection, including stale reclaimable work. |
| `cadre_prepare_implementation` | Preferred `cadre-implement` start packet: selected track, optional ownership claim, context, collisions, available work, and plan integrity in one bounded call. |
| `cadre_collision_scan` | Cross-track file overlap checks, including exact, prefix, and glob overlaps. |
| `cadre_parse_plan` | Phase/task/annotation/commit parsing for implement, validate, review, revert, handoff, formula, release. |
| `cadre_phase_schedule` | Concrete phase-level scheduler: dependencies, ready phases, conflict-free ready groups, and scheduler errors. |
| `cadre_track_context` | Bounded per-track context: metadata, parsed plan, task counts, worktree routing, hold state, review state, and Beads IDs. |
| `cadre_plan_integrity` | Plan annotation, dependency, repo-routing, task-key, and parallel file-claim validation. |
| `cadre_claim_track` | Track ownership claim, Beads assignment check, metadata owner/lease mirror, and `implement_state.json` creation. |
| `cadre_heartbeat_track` | Long-running build/test heartbeat for owner/lease metadata and Beads assignment freshness. |
| `cadre_metadata_patch` | Key-scoped metadata mutation with CAS retry semantics. |
| `cadre_create_beads_tree` | Preferred Beads initialization for `cadre-newtrack`: create/plan epic, phases, tasks, dependencies, notes, and metadata Beads IDs. |
| `cadre_record_task_result` | Task marker/SHA/coverage result recording in `plan.md` and `metadata.json`. |
| `cadre_complete_task` | Preferred task-completion transaction: run coverage/tests, enforce threshold, then record plan/metadata/Beads together. |
| `cadre_record_parallel_worker` | Coordinator-owned parallel worker audit/status update; after clean merge it may invoke `cadre_complete_task`. |
| `cadre_set_track_status` | Track status mutations plus `cadre/tracks.md` regeneration. |
| `cadre_record_review` | Structured review verdict write with reviewer race guard, `review_seq`, self-review flag, coverage, and gate check. |
| `cadre_regen_index` | Manual rebuilds of `cadre/tracks.md`; never hand-edit or reimplement index splicing. |
| `cadre_review_gate` | Review verification after review writes and before ship/land pushes; pass `headSha`/`headShas` to enforce reviewed commit pins. |
| `cadre_sync_control_plane` | Shared-mode control-plane sync pre/postamble (`git`, Beads Dolt, merge driver) as one structured operation. |
| `cadre_lsp_review` | Code-intelligence review wrapper around the configured LSP helper with structured findings. |
| `cadre_lsp_warm_review` | Preferred code-intelligence review path when available; reuses the persistent LSP daemon and warm language servers. |
| `cadre_lsp_daemon_status` | Inspect warm LSP server sessions before/after repeated review work. |
| `cadre_lsp_impact` | Low-token semantic impact for planning/revision: symbol references, file symbols, and optional LSP diff review. |
| `cadre_test_coverage` | Run the configured test/coverage command, parse measured coverage, and record it on the track/task. |
| `cadre_pr_ci_status` | Read GitHub/GitLab PR/MR and CI status for a track branch or explicit PR/MR. |
| `cadre_repo_map` | Compact semantic repo map and symbol reference lookup for low-token orientation. |
| `cadre_beads_write` | Structured Beads operations (`ready`, `show`, `update`, `note`, `close`, labels, deps, create) instead of raw `bd` shell snippets. |
| `cadre_review_assist` | Review evidence packet: repo-aware diff, incomplete plan tasks, TODO/stub scan, coverage, machine gate, and LSP findings; required before `/code-review` and sufficient fallback when `/code-review` is unavailable. |
| `cadre_review_machine_gate` | Run typecheck/build/check/lint inside MCP, per repo for polyrepo review evidence. |
| `cadre_polyrepo_preflight` | Polyrepo setup, validate, refresh, and land preflight checks. |

Packet-first rule: when a protocol names a composite MCP packet, call that
packet before doing the equivalent manual scan. Use smaller MCP tools only when
the packet reports that a prompt, repair, or narrower follow-up is needed.

Preferred packet checkpoints:
- Setup/health checks: `cadre_doctor`.
- New track planning: `cadre_lsp_impact` before plan confirmation, then
  `cadre_create_beads_tree` dry-run before writing track files and live
  immediately after scaffold files exist.
- Implementation start: `cadre_prepare_implementation`.
- Phase-level execution: `cadre_phase_schedule` before dispatching ready phases.
- Task completion: `cadre_complete_task` after the code commit, before any plan
  row is marked complete.
- Team status: `cadre_team_board` for `--team` / `--mine` rich boards.
- Review: `cadre_review_assist` to frame the evidence, plus
  `cadre_lsp_warm_review` / `cadre_lsp_review` for semantic regressions.
- Revision: `cadre_lsp_impact` before rewriting plans that touch existing code.

## External Provider MCP Evidence

Cadre MCP remains the authoritative orchestration layer: track status,
ownership, review gates, Beads IDs, and index regeneration live in `cadre/` and
`.beads/`. GitHub/GitLab MCP servers may be used as **evidence providers** for
PRs, reviews, CI, Actions/job logs, issues, and discussion context, but their
data must be folded back into Cadre through `cadre_review_assist`,
`cadre_pr_ci_status`, `cadre_record_review`, Beads notes, or track learnings.
Never treat a provider label, issue state, or PR review as the source of truth
for Cadre track status unless a Cadre MCP write records the corresponding
decision.

When available, prefer official provider MCPs for deep PR/CI evidence:
- GitHub MCP for repository, issue, pull request, review, check, and Actions log
  evidence.
- GitLab MCP for merge request, pipeline, job log, issue, and approval evidence.

If provider MCP tools are unavailable, degrade to `gh`/`glab` through
`cadre_pr_ci_status` and record the limitation in the review or ship report.

## Beads Integration

Beads is a **required Cadre setup prerequisite**. `cadre-setup` must verify the
`bd` CLI before project mutation and must initialize `.beads/` plus
`cadre/beads.json`. If `bd` is unavailable or a Beads command fails, retry once
when appropriate or halt for repair; do not continue in file-only mode.

For full Beads details (availability check, CLI commands, session protocol,
chemistry patterns), see [references/beads-integration.md](references/beads-integration.md).
For shared error handling, see
[references/beads-error-handler.md](references/beads-error-handler.md).

### Quick Detection (MUST check before using bd commands)

```bash
if ! which bd > /dev/null 2>&1; then
  echo "Beads CLI (bd) is required for Cadre. Install or restore it, then retry."
  exit 1
fi
if [ ! -f cadre/beads.json ] || ! grep -q '"enabled"[[:space:]]*:[[:space:]]*true' cadre/beads.json 2>/dev/null; then
  echo "cadre/beads.json is missing or disabled. Run or repair cadre-setup."
  exit 1
fi
```

## Learnings System

Cadre captures and consolidates learnings across tracks.

Key files:
- `cadre/patterns.md` - Project-level consolidated patterns
- `cadre/tracks/<id>/learnings.md` - Per-track discoveries

Knowledge flywheel:
1. **Capture** - After each task, append to track `learnings.md` and Beads notes.
2. **Elevate** - At phase/track completion, promote reusable patterns to `patterns.md`.
3. **Archive** - Extract remaining patterns before archiving.
4. **Inherit** - New tracks read `patterns.md` to prime context.

## Proactive Behaviors

1. **On new session:** Check for in-progress tracks, offer to resume.
2. **On task completion:** Suggest next task or phase verification.
3. **On blocked detection:** Alert user and suggest alternatives.
4. **On all tasks complete:** Walk the ship pipeline: `cadre-review`, then
   `cadre-ship` / `cadre-land`, then `cadre-archive` (and `cadre-release` once
   enough tracks have shipped).
5. **On stale context detected:** If setup is old or significant codebase changes
   are detected, suggest `cadre-refresh`.
6. **On implement start:** Read `patterns.md` and announce pattern count.
7. **On task complete:** Prompt for learnings capture.
8. **On phase complete:** Offer pattern elevation to `patterns.md`.
9. **On archive:** Extract remaining patterns before archiving.
10. **On refresh:** Consolidate learnings across all tracks.

## Intent Mapping

| User Intent | Workflow |
|-------------|---------|
| "Set up this project" | `cadre-setup` |
| "Create a new feature" | `cadre-newtrack [desc]` |
| "Start working" / "Implement" | `cadre-implement [id]` |
| "What's the status?" | `cadre-status` |
| "Undo that" / "Revert" | `cadre-revert` |
| "Check for issues" | `cadre-validate` |
| "This is blocked" / "Skip this task" | `cadre-flag <blocked\|skipped>` |
| "This needs revision" / "Spec is wrong" | `cadre-revise` |
| "Review this" / "Check the diff before merge" | `cadre-review [track_id]` |
| "Ship it" / "Open the PR" / "Push the branch" | `cadre-ship [track_id]` |
| "Save context" / "Handoff" / "Transfer to next section" | `cadre-handoff` |
| "Archive completed" | `cadre-archive` |
| "Cut a release" / "Update the changelog" / "Tag a version" | `cadre-release [bump]` |
| "Export summary" | `cadre-status --export` |
| "Docs are outdated" / "Sync with codebase" | `cadre-refresh` |
| "List templates" / "Show formulas" | `cadre-formula` |
| "Quick exploration" / "Ephemeral track" | `cadre-formula wisp [formula]` |
| "Extract template" / "Create reusable pattern" | `cadre-formula create [track_id]` |

## Workflow Execution

When a user asks for a `cadre-*` workflow, treat text after the workflow name as
workflow arguments. Read the corresponding workflow protocol, but stay
section-aware: use the protocol's mode/argument routing to load the sections and
references needed for that invocation. Read the full protocol when the command is
ambiguous, when editing the protocol itself, or when a later section may affect a
mutation you are about to perform.

| Workflow | Protocol |
|---------|----------|
| `cadre-setup` | [protocols/cadre-setup.md](protocols/cadre-setup.md) |
| `cadre-newtrack` | [protocols/cadre-newtrack.md](protocols/cadre-newtrack.md) |
| `cadre-implement` | [protocols/cadre-implement.md](protocols/cadre-implement.md) |
| `cadre-status` | [protocols/cadre-status.md](protocols/cadre-status.md) |
| `cadre-revert` | [protocols/cadre-revert.md](protocols/cadre-revert.md) |
| `cadre-validate` | [protocols/cadre-validate.md](protocols/cadre-validate.md) |
| `cadre-flag` | [protocols/cadre-flag.md](protocols/cadre-flag.md) |
| `cadre-revise` | [protocols/cadre-revise.md](protocols/cadre-revise.md) |
| `cadre-review` | [protocols/cadre-review.md](protocols/cadre-review.md) |
| `cadre-ship` | [protocols/cadre-ship.md](protocols/cadre-ship.md) |
| `cadre-land` | [protocols/cadre-land.md](protocols/cadre-land.md) |
| `cadre-archive` | [protocols/cadre-archive.md](protocols/cadre-archive.md) |
| `cadre-release` | [protocols/cadre-release.md](protocols/cadre-release.md) |
| `cadre-handoff` | [protocols/cadre-handoff.md](protocols/cadre-handoff.md) |
| `cadre-refresh` | [protocols/cadre-refresh.md](protocols/cadre-refresh.md) |
| `cadre-formula` | [protocols/cadre-formula.md](protocols/cadre-formula.md) |

When a protocol references `references/...`, resolve it against the active skill
directory. Generated bundles contain platform-sliced references; edit the masters
in `scripts/agent-refs/` and regenerate.

## References

- **Workflow protocols:** [protocols/](protocols/) - Step-by-step command flows.
- **Beads integration:** [references/beads-integration.md](references/beads-integration.md)
- **Beads error handling:** [references/beads-error-handler.md](references/beads-error-handler.md)
- **Shared sync:** [references/cadre-sync.md](references/cadre-sync.md)
- **Ownership guard:** [references/ownership-guard.md](references/ownership-guard.md)
- **Parallel execution:** [references/parallel-execution.md](references/parallel-execution.md)
- **Polyrepo git:** [references/polyrepo-git.md](references/polyrepo-git.md)
- **Template locator:** [references/template-locator.md](references/template-locator.md)
