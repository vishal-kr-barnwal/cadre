---
title: Workflows
description: Detailed guide to the Cadre workflow lifecycle and every cadre-* command.
section: Core Concepts
order: 4
---

# Workflows

Cadre workflows are invoked by asking for the Cadre skill and then a
`cadre-*` workflow. Text after the workflow name is treated as workflow
arguments; there is no separate prompt expansion layer.

Before any workflow, the agent verifies Cadre MCP with `cadre_project`
`{ "action": "ping" }`. Every project-scoped packet receives a `root` argument.

## Lifecycle

```text
setup -> newtrack -> implement -> review -> ship/land -> archive -> release
```

Support workflows can happen along the way:

```text
status, validate, handoff, refresh, revise, revert, flag, formula, artifacts
```

## `cadre-setup`

Initializes the project control plane.

What setup gathers:

- Product goals, users, workflows, and constraints.
- Languages, frameworks, package managers, platforms, and project gate commands.
- Monorepo or polyrepo topology.
- Local or shared sync mode.
- Local, GitHub, or GitLab provider mode.
- Beads integration and optional CI templates.
- Optional LSP recommendations.

What setup writes:

- `cadre/product.json` and generated `cadre/product.md`
- `cadre/product_guidelines.json` and generated `cadre/product_guidelines.md`
- `cadre/tech-stack.json`
- `cadre/workflow.json` and generated `cadre/workflow.md`
- `cadre/patterns.jsonl` and generated `cadre/patterns.md`
- `cadre/tracks.json`
- `cadre/config.json`
- `cadre/beads.json`
- optional `cadre/repos.json`
- optional `cadre/lsp.json`
- selected `cadre/styleguides/*.json` and generated `cadre/code_styleguides/*.md`

Setup requires Beads. If `bd` is missing or not usable, setup stops.

## `cadre-newtrack`

Creates a spec-first unit of work.

The new-track packet previews or creates:

- Track id and directory.
- Canonical `spec.json` plus generated `spec.md` with title, description,
  functional requirements, non-functional requirements, acceptance criteria, and
  out of scope.
- Canonical `plan.json` plus generated `plan.md` with phases, tasks, file
  claims, dependencies, and repo annotations.
- Append-only `learnings.jsonl` plus generated `learnings.md`.
- Beads epic/phase/task tree.
- Worktree plan.
- Planning evidence such as likely tests, semantic impact, and parallel
  candidates.

Dry runs expose full proposed files through a review bundle on disk, so agents
can show the manifest and file paths without pasting generated specs or plans
into chat.

Good tracks have testable acceptance criteria, explicit dependencies, clear file
annotations, and a plan that can be resumed by another session.

## `cadre-implement`

Starts or resumes implementation.

The implementation packet:

- Selects or claims a track.
- Returns bounded context from product, workflow, patterns, style guides, and
  track files.
- Checks owner/lease state and cross-track collisions.
- Parses the plan and computes ready phases.
- Returns worktree and repo routing.
- Dispatches parallel worker waves through `cadre_parallel` when safe.

Sequential phases run one unfinished task at a time. Parallel phases dispatch
only tasks whose phase dependencies, task dependencies, worker state, and file
claims are ready.

Task completion should use `cadre_complete_task` so verification, coverage,
plan progress, metadata, and Beads notes are recorded consistently.

## `cadre-status`

Shows current project and team state.

Common status views include:

- Live summary.
- Team board.
- Current user's next actions.
- Available unowned work.
- Review queue.
- Handoff inbox.
- Fleet board for polyrepo projects.
- Collision scan.
- Quality gate summary.

Status reads packet output and compact resources. It should not treat legacy
Markdown indexes as the live source of truth.

## `cadre-review`

Runs the quality gate for a track.

Review evidence can include:

- Track context and plan completion.
- Machine gate output.
- Coverage evidence.
- TODO/stub findings.
- LSP reference findings.
- Hosted provider evidence requirements.
- Existing review verdict and reviewer assignment.

The reviewer verdict is recorded through Cadre packets. Ship and land packets
re-read the gate immediately before publication.

## `cadre-ship`

Prepares monorepo publication.

Ship is for single-repo projects. It enforces the review gate, computes provider
actions, checks required hosted evidence, and records publication evidence. In
hosted modes, provider actions are executed through official provider MCPs and
then written back to Cadre.

Use `cadre-land` for polyrepo projects.

## `cadre-land`

Prepares polyrepo publication.

Land is for control repos with `cadre/repos.json`. It enforces review, runs
all-or-nothing local preflight across touched repos, plans one PR/MR per product
repo plus a control-repo PR/MR, links them with a shared `cadre-track:<id>`
label, and records provider evidence.

The generated merge train lands product repos first and the control repo last.

## `cadre-handoff`

Writes resumable context for another session or teammate.

Handoff can include:

- Goal and current status.
- Branch and worktree information.
- Completed tasks and remaining tasks.
- Test/coverage evidence.
- Blockers and next actions.
- Review or provider state.

Handoff artifacts are per-track, so two tracks do not clobber each other's
handoff context.

Writing a handoff requires reviewing the packet-generated `HANDOFF.md` bundle
and confirming the packet write.

## `cadre-refresh`

Refreshes derived context and setup recommendations.

Refresh can update:

- Track index and project learning stamps.
- LSP recommendations with `cadre-refresh --lsp`.
- Repo topology and enabled repos with repo-scoped refresh.
- Shared-sync configuration and generated project context.

Refresh is useful after toolchain changes, repo topology changes, or stale
project context.

Document refreshes use review bundles for proposed context files and require
confirmation before writing.

## `cadre-revise`

Changes an existing spec or plan after gathering impact evidence.

Revise should preserve track history and reason about:

- Acceptance criteria changes.
- Plan dependency changes.
- File claim changes.
- Repo annotation changes.
- Beads dependency updates.
- Review or implementation state that may be invalidated.

Revised specs and plans are reviewed from packet-generated bundle files before
the confirmed write.

## `cadre-artifacts`

Synchronizes canonical JSON/JSONL artifacts with deterministic human
projections.

Artifact sync can:

- Catalog known project, style guide, track, release, and external artifacts.
- Return JSON schemas for spec, plan, style guide, release, journal, and
  evidence artifacts.
- Validate canonicals and preview generated projections.
- Return diffs and a review bundle before any confirmed mutation.

Common scopes:

- `all`: validate/render every known artifact.
- `track:<id>`: spec, plan, learnings, handoff, and index projection for one
  track.
- `styleguides`: style guide catalog and selected guide projections.
- `project`: product context, product guidelines, workflow policy, patterns,
  and project-level projections.

Confirmed sync requires the dry-run review bundle first, then `execute:true`
and `humanConfirmed:true`. Unmarked generated projections are skipped unless
the user explicitly approves `force:true`.

## `cadre-revert`

Plans and executes tracked reverts through Cadre packets.

In monorepo mode, reverts apply to the track's recorded commits. In polyrepo
mode, SHAs are grouped per repo and reverted in reverse order inside each repo.
Cadre halts on conflicts and reports recovery steps.

Reverts require reviewing the packet-planned git actions before confirmed
execution.

## `cadre-archive`

Archives completed tracks and refreshes derived indexes.

Archive can clean up completed track worktrees and preserve safety-net branches
or evidence according to workflow policy. It should only archive work that is
complete and no longer active.

Archive mutations require reviewing the packet dry-run scope before confirmed
execution.

## `cadre-release`

Creates release artifacts from completed track metadata.

Release summarizes shipped or landed tracks, review state, version notes, and
changelog-ready entries. It does not replace project-specific release policy;
it provides structured Cadre evidence for it.

Release notes and metadata are reviewed from bundle files before the confirmed
write or optional tag action.

## `cadre-validate`

Checks the project control plane.

Validation can inspect:

- Cadre setup files.
- Generated index drift.
- Plan annotation integrity.
- Beads health.
- Sync mode and merge-driver readiness.
- Polyrepo manifest and submodule parity.
- LSP configuration.
- Provider evidence requirements.

Use validation before important handoffs, after conflict resolution, or when a
workflow returns an unexpected state.

## `cadre-flag`

Records blocked or skipped work through packets.

Flagged work remains visible to status boards and Beads memory. In shared mode,
the control plane sync makes blockers visible to teammates.

Status changes require reviewing the packet dry-run status proposal before
confirmed mutation.

## `cadre-formula`

Handles Cadre formula or template operations.

Formula workflows are packet-owned and should use the bundled template locator
instead of copying generated plugin assets by hand.
