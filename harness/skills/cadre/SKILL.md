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
2. `cadre/tech-stack.json` - Structured technology constraints. Use
   `cadre_project` with `action: "tech_stack_summary"` when a human-readable
   summary is needed.
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
every Cadre workflow, verify the MCP server is available with `cadre_project`
and `{"action":"ping"}`.
If the Cadre MCP tools are unavailable, **HALT** and tell the user to install,
enable, or restart the Cadre plugin. Do not try another route for Cadre
orchestration.

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
`cadre://team-board?root=/absolute/path/to/project`.

Workflow tool routing:

All project-scoped responses use the envelope
`{ "ok": true|false, "data": ..., "warnings": [], "errors": [] }`, with
optional `commands` and `job` fields.

| MCP packet | Required use |
|---------|--------------|
| `cadre_workflow` | Packet-only workflow coordinator for setup, new track, implementation, status, review, validation, archive, handoff, ship, land, release, refresh, flag, revert, revise, and formula flows. Use it as the only entrypoint for workflow orchestration. |
| `cadre_project` | `ping`, `doctor`, `root`, `topology`, `tech_stack_summary`, `sync_control_plane`, and `polyrepo_preflight`. Use for setup/runtime checks, human-readable tech stack summaries, and shared control-plane pre/post sync. |
| `cadre_status` | `live`, `team`, `mine`, `available`, `collisions`, `board`, `fleet`, and `beads_summary`. Use for status, selection, ownership summaries, available work, file-overlap scans, fleet boards, and bounded Beads evidence. |
| `cadre_track` | `context`, `parse_plan`, `integrity`, `phase_schedule`, `prepare_implementation`, `create_beads_tree`, `plan_assist`, and `worktree_plan`. Use for bounded per-track context, plan parsing, planning evidence, scheduling, dry-run worktree planning, and Beads tree initialization. |
| `cadre_parallel` | `plan`, `next_wave`, `setup_workers`, `record_finish`, `merge_back`, and `cleanup`. Use for worker-wave orchestration and dry-run command plans; mutating actions require `execute:true`. |
| `cadre_mutate` | `claim`, `heartbeat`, `set_status`, `metadata_patch`, `record_review`, `record_worker`, `record_task_result`, and `regen_index`. Use for all Cadre control-plane writes except full task completion. |
| `cadre_complete_task` | Preferred task-completion transaction: run coverage/tests first, then lock plan/metadata mutation, then idempotently write Beads note/close with recovery journal support. |
| `cadre_beads` | Packet-backed Beads operations: ready/list/show/update/note/close, labels, deps, create, mail, formula, compact, Dolt, SQL, and worktree wrappers. Agents call this packet for Cadre Beads work. |
| `cadre_job` | `start`, `status`, `result`, `cancel`, and `list` for long-running coverage, machine gate, review assist, LSP review, and completion work. |
| `cadre_review` | `assist`, `machine_gate`, `gate`, `pr_ci_status`, and `provider_evidence`. `assist` warms/reuses LSP by default and `provider_evidence` persists structured PR/CI/review evidence. |
| `cadre_intel` | `repo_map`, `lsp_impact`, `lsp_review`, `lsp_warm_review`, `lsp_daemon_status`, `lsp_daemon_shutdown`, `workspace_diagnostics`, `test_impact`, and `dependency_graph`. Use real LSP evidence and detected build/test adapters instead of prompt-side repo scans. |

Packet-only rule: when a workflow names a composite MCP packet, call that packet
and stop if it returns `ok:false`. Use smaller MCP tools only when the workflow
packet reports that a prompt, repair, or narrower follow-up is needed.

Preferred packet checkpoints:
- Setup/health checks: `cadre_workflow` with `workflow: "setup"` or
  `workflow: "validate"`; use `cadre_project` with `action: "doctor"` for
  narrower diagnostics requested by the workflow packet.
- New track planning: `cadre_workflow` with `workflow: "newtrack"`; the packet
  returns plan assistance, Beads initialization evidence, and worktree planning.
- Implementation start: `cadre_workflow` with `workflow: "implement"`.
- Phase-level execution: use the phase schedule returned by the workflow packet.
  For task-level parallel phases, use `cadre_parallel` with `action: "next_wave"`
  / `action: "setup_workers"` / `action: "record_finish"` /
  `action: "merge_back"`.
- Task completion: `cadre_complete_task` after the code commit, before any plan
  row is marked complete by Cadre.
- Team status: `cadre_workflow` with `workflow: "status"` and the requested
  status mode.
- Review: `cadre_workflow` with `workflow: "review"`; use `cadre_review` with
  `action: "provider_evidence"` only for evidence supplied to or returned by the
  workflow path.
- Revision: `cadre_workflow` with `workflow: "revise"` before plan/spec changes.

## External Provider MCP Evidence

Cadre MCP remains the authoritative orchestration layer: track status,
ownership, review gates, Beads IDs, and index regeneration live in `cadre/` and
`.beads/`. GitHub/GitLab MCP servers are the **only** provider integrations for
hosted PR/MR, review, CI, Actions/job-log, issue, and discussion context. Cadre
does not invoke `gh` or `glab` during workflows. Provider data must be folded
back into Cadre through `cadre_review` with `action: "provider_evidence"`,
`cadre_review` with `action: "pr_ci_status"` and supplied MCP evidence,
`cadre_mutate` with `action: "record_review"`, Beads notes, or track learnings.
Never treat a provider label, issue state, or PR review as the source of truth
for Cadre track status unless a Cadre MCP write records the corresponding
decision.

Setup records `cadre/config.json.provider_mode` as `local`, `github`, or
`gitlab`. In `local` mode no provider MCP is required. In `github` or `gitlab`
mode, if the matching provider MCP is unavailable, provider-dependent packets
fail closed and return `required_provider_mcp` plus `required_evidence`.

Use official provider MCPs for deep PR/CI evidence:
- GitHub MCP for repository, issue, pull request, review, check, and Actions log
  evidence.
- GitLab MCP for merge request, pipeline, job log, issue, and approval evidence.

If required provider MCP evidence is unavailable, halt on the packet result and
ask the user to enable the matching provider MCP or switch the project to
`provider_mode: "local"` through the setup/refresh packet.

## Beads Integration

Beads is a **required Cadre setup prerequisite**. The setup workflow packet
verifies Beads availability and initializes Beads state plus `cadre/beads.json`.
If a Beads packet reports unavailable or failed state, halt for repair.

For full Beads details (availability check, CLI commands, session protocol,
chemistry patterns), see [references/beads-integration.md](references/beads-integration.md).
For shared error handling, see
[references/beads-error-handler.md](references/beads-error-handler.md).

### Quick Detection

Use `cadre_project` with `action: "doctor"`, `cadre_workflow` with
`workflow: "setup"` or `workflow: "validate"`, and `cadre_beads` for Beads
operations. Agents do not run Beads commands directly for Cadre workflows.

## Learnings System

Cadre captures and consolidates learnings across tracks.

Key files:
- `cadre/patterns.md` - Project-level consolidated patterns
- `cadre/tracks/<id>/learnings.md` - Per-track discoveries

Knowledge flywheel:
1. **Capture** - After each task, pass learnings into the completion packet.
2. **Elevate** - At phase/track completion, promote reusable patterns through
   Cadre packets.
3. **Archive** - Extract remaining patterns through the archive workflow packet.
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
9. **On archive:** Use the archive workflow packet to extract remaining patterns.
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
