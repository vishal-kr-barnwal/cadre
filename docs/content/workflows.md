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
status, debug, validate, handoff, refresh, revise, revert, flag, formula, artifacts
```

## `cadre-setup`

Initializes the project control plane.

What setup gathers:

- Product goals, users, workflows, and constraints.
- Languages, frameworks, package managers, platforms, and project gate commands.
- Monorepo or polyrepo topology.
- Local or shared sync mode.
- Local, GitHub, or GitLab provider mode.
- Native event/message/formula state and optional CI templates.
- Optional LSP recommendations.

Setup dry-runs may include `native_prompts` with schema
`cadre.native_prompt.v1`. Agents should present those through the host client's
native selection UI when available, then pass the selected ids or custom "Other"
text back as structured setup arguments such as `providerMode`, `syncMode`,
`styleGuideIds`, `writeLsp`, and `integrations`. Prompt answers are not stored
as standalone Cadre state. Answer setup prompts before asking the user to
approve the setup review bundle.

What setup writes:

- `cadre/product.json` and generated `cadre/product.md`
- `cadre/product_guidelines.json` and generated `cadre/product_guidelines.md`
- `cadre/tech-stack.json`
- `cadre/workflow.json` and generated `cadre/workflow.md`
- `cadre/patterns.jsonl` and generated `cadre/patterns.md`
- `cadre/tracks.json`
- `cadre/config.json`
- `cadre/events.jsonl`
- `cadre/messages/*.jsonl`
- `cadre/formulas/*.json` when reusable formulas are added
- git-ignored `cadre/local/wisps/*.json`
- optional `cadre/repos.json`
- optional `cadre/lsp.json`
- selected `cadre/styleguides/*.json` and generated `cadre/code_styleguides/*.md`

Setup has no external task-memory CLI prerequisite.

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
- Native track event record.
- Worktree plan.
- Planning evidence such as likely tests, semantic impact, and parallel
  candidates.

Dry runs expose full proposed files through a review bundle on disk, so agents
can show the manifest and file paths without pasting generated specs or plans
into chat.
Generated Markdown projections include readable review sections plus the
canonical JSON detail block, so human review can inspect the same structured
fields Cadre agents use.

When the request is vague, `cadre-newtrack` returns `intent_prompts` and
`phase_state:"awaiting_clarification"` instead of generating a spec or plan.
Agents should ask for goal, outcome, acceptance criteria, and scope before
drafting structured `spec` and `plan` JSON.
Agents should load the `spec` and `plan` artifact schemas before drafting.
If a payload uses aliases such as `acceptanceCriteria` or top-level
`plan.tasks`, Cadre returns `stage:"schema_validation"` with schema resources
instead of generating review artifacts.

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
product commits, plan progress, metadata, journals, events, and git notes are
recorded consistently. When no `commitSha` is supplied, Cadre creates the
task-owned product commit automatically using a Conventional Commit subject,
then writes a separate control-plane commit for the Cadre state update.

## `cadre-debug`

Runs a bounded assisted debugging snapshot through Debug Adapter Protocol.

The debug workflow:

- Reads `cadre/dap.json` for configured debug adapters and launch/attach
  configurations.
- Uses `cadre_intel action: "dap_status"` to report configured adapters,
  missing commands, and detected languages that need manual adapter setup.
- Uses `cadre_intel action: "dap_setup"` to recommend conservative adapter
  entries and optionally write `cadre/dap.json`.
- Uses `cadre_intel action: "dap_snapshot"` or `cadre_workflow` with
  `workflow: "debug"` and `execute:true` to launch or attach, set breakpoints,
  capture stack frames, variables, and output, then disconnect.

DAP support is adapter-driven. Cadre can speak the protocol for any configured
adapter, but language support depends on the debugger command installed in the
project. V1 snapshots are evidence for implementation and review; they are not
an interactive stepping session.

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

Successful ship execution writes `cadre/operations/publication.jsonl`, commits
that ledger as `cadre(ship): publish <trackId>`, and pushes `refs/notes/cadre`
when note pushing is enabled.

Use `cadre-land` for polyrepo projects.

## `cadre-land`

Prepares polyrepo publication.

Land is for control repos with `cadre/repos.json`. It enforces review, runs
all-or-nothing local preflight across touched repos, plans one PR/MR per product
repo plus a control-repo PR/MR, links them with a shared `cadre-track:<id>`
label, and records provider evidence.

The generated merge train lands product repos first and the control repo last.
Land records the same publication ledger as ship, commits it as
`cadre(land): publish <trackId>`, and pushes Cadre git notes for affected repos.

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

When refresh scope is unclear, Cadre asks first with an `intent_prompts`
selection for patterns, LSP, docs/projections, diagnostics, or all supported
refreshes.

Document refreshes use review bundles for proposed context files and require
confirmation before writing.

## `cadre-revise`

Changes an existing spec or plan after gathering impact evidence.

Revise should preserve track history and reason about:

- Acceptance criteria changes.
- Plan dependency changes.
- File claim changes.
- Repo annotation changes.
- Native dependency and event updates.
- Review or implementation state that may be invalidated.

Revised specs and plans are reviewed from packet-generated bundle files before
the confirmed write.

When the revision reason or target is unclear, `cadre-revise` returns
`intent_prompts` instead of generating changes. Agents should ask what changed
and whether the spec, plan, or both should be updated.

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
- Native event/message state health.
- Sync mode and merge-driver readiness.
- Polyrepo manifest and submodule parity.
- LSP configuration.
- Provider evidence requirements.

Use validation before important handoffs, after conflict resolution, or when a
workflow returns an unexpected state.

## `cadre-flag`

Records blocked or skipped work through packets.

Flagged work remains visible to status boards and native Cadre memory. In shared mode,
the control plane sync makes blockers visible to teammates.

Status changes require reviewing the packet dry-run status proposal before
confirmed mutation.

## `cadre-formula`

Handles Cadre formula or template operations.

Formula workflows are packet-owned and should use MCP-served template locator
resources instead of copying plugin files by hand.
