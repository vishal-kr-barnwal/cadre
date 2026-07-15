---
title: Workflows
description: Detailed guide to the Cadre workflow lifecycle and every cadre-* command.
section: User Guide
order: 60
---

# Workflows

Cadre workflows are invoked by asking for the Cadre skill and then a
`cadre-*` workflow. Text after the workflow name is treated as workflow
arguments; there is no separate prompt expansion layer.

The agent calls `cadre_workflow` directly with a root candidate. The call
verifies the runtime and resolves the root, so no separate ping or root lookup
is required.

## Lifecycle

```text
setup -> newtrack -> implement -> review -> ship/land -> archive -> release
```

Support workflows can happen along the way:

```text
status, debug, validate, handoff, refresh, revise, revert, flag, formula, artifacts
```

## Staged Review Output

Reviewable staged workflows write target-path previews by default. A dry-run
returns an approval `decision.stage` plus `artifacts` for only that stage's
frozen file set at intended root-relative paths. Review every returned path,
`target_path`, or `review_path` with normal `git diff`. Files owned by later
stages remain pending and unmaterialized until the current stage is approved.

Every file in the active stage is one atomic review set. A canonical
JSON/JSONL file and its projection therefore share one approval and hash
snapshot, as do grouped technical files or a collective reference change.
After explicit user approval, send `approval: {session_id, stage,
approved_stages}` with the exact returned stage and cumulative approved-stage
prefix. `approval: {session_id}` alone only resumes the session; it does not
approve a stage. If the workflow pauses for clarification or source formatting
after a session exists, keep that session and invoke the exact returned
continuation using the returned `decision.resume` data after collecting the
requested input.

Only after every stage is approved does Cadre return the final `next` call.
Invoke that call unchanged; it carries completion and execution authorization.
Final execution verifies all approved frozen files and fails if any file has
drifted after approval.

Starting a different payload that targets the same files safely supersedes an
untouched preview only when every overlapping stage is still unapproved. Cadre
restores the recorded pre-preview files and Git intent-to-add state before
materializing the replacement. It refuses supersession when a stage was
approved or a target was edited, staged, or committed. Explicit cancellation
uses the same worktree, index, and HEAD-baseline checks and retains the approval
session if restoration cannot complete safely.

Use `reviewOutputMode:"bundle"`, `review_output_mode:"bundle"`, or an explicit
`reviewBundleDir` for the older non-mutating temp-bundle review behavior.
Existing `reviewBundle:false` / `reviewFiles:false` still disables review files.

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
approve the current setup review stage.

Clarification before the first setup review stage does not create an approval
session or materialize review files. Once review has begun, any later
clarification remains in that same session and is resumed through the returned
`decision.resume`; it does not reset setup to product. Target-path review begins
only after product intent and native prompt answers are supplied as structured
setup arguments. An
evidence-backed retry uses the shared staged-preview supersession rules, so an
untouched, unapproved preview can be replaced while changed review targets
remain protected.
Choosing a collection strategy such as `use-readme` or `detect` does not count
as evidence by itself: the agent must still inspect the repository and return
meaningful `product` and `techStack` objects before review begins.

Setup collects and reviews stages in this fixed order:

1. `product`
2. `product_guidelines`
3. `technical`, which atomically groups the tech stack, selected style guides,
   repository topology, and LSP configuration while retaining the selected
   infrastructure choices
4. `workflow`

Cadre materializes only the active stage. It does not prewrite guidelines,
technical files, or workflow policy while product is under review.

What setup writes:

- `cadre/product.json` and generated `cadre/product.md`
- `cadre/product_guidelines.json` and generated `cadre/product_guidelines.md`
- `cadre/tech-stack.json` and generated `cadre/tech-stack.md`
- `cadre/workflow.json` and generated `cadre/workflow.md`
- `cadre/patterns.jsonl` and generated `cadre/patterns.md`
- `cadre/tracks.json`
- `cadre/config.json`
- `cadre/events.jsonl`
- `cadre/messages/*.jsonl`
- `cadre/formulas/*.json` when reusable formulas are added
- git-ignored `cadre/local/wisps/*.json`
- optional `cadre/repos.json` and generated `cadre/repos.md`
- optional `cadre/lsp.json`
- selected `cadre/styleguides/*.json` and colocated generated `cadre/styleguides/*.md`
- matching repository-owned `cadre/skills/*/skill.json` atomic rules when present

Setup has no external task-memory CLI prerequisite.

Every workflow packet reports its `project_skills` selection. Agents load the
selection resource before drafting setup, new-track, revision, handoff, or
release payloads, and apply the returned instructions before implementation,
review, ship, or land actions. Callers can pass `skillIds` for an explicit
selection and `skillMaxChars` to adjust the bounded inline instruction limit.

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

Dry runs write the active stage to the intended track path by default, so agents
can point at the returned target files and normal `git diff` without pasting
generated specs or plans into chat.
New-track always collects and reviews `spec` first. Only after spec approval
does it collect and materialize `plan`; both stages stay in one approval
session, and execution follows only after plan approval.
Generated Markdown projections include readable review sections plus the
canonical JSON detail block, so human review can inspect the same structured
fields Cadre agents use.

When the request is vague, `cadre-newtrack` returns `intent_prompts` and
`phase_state:"awaiting_clarification"` instead of generating a spec or plan.
Agents should ask for goal, outcome, acceptance criteria, and scope before
drafting structured `spec` and `plan` JSON.
Schema-shaped objects are not enough by themselves: the spec must contain
meaningful project-specific intent and the plan must contain substantive
phases and tasks. Empty objects, generic placeholders, and strategy-only
answers do not create track review files or approval sessions.
Agents should load the `spec` and `plan` artifact schemas before drafting.
If a payload uses aliases such as `acceptanceCriteria` or top-level
`plan.tasks`, Cadre returns `stage:"schema_validation"` with schema resources
instead of generating review artifacts.

Good tracks have testable acceptance criteria, explicit dependencies, clear file
annotations, and a plan that can be resumed by another session.

### Spec JSON Template

Use canonical snake_case fields when drafting a new-track spec:

```json
{
  "version": 1,
  "schema": "cadre.spec.v1",
  "kind": "spec",
  "track_id": "track-id-here",
  "title": "Short track title",
  "description": "Describe the goal, user or maintainer value, and problem being solved.",
  "functional_requirements": [
    {
      "heading": "Concrete behavior",
      "body": "What must change and who benefits."
    }
  ],
  "non_functional_requirements": [
    {
      "heading": "Quality or constraint",
      "body": "Performance, security, reliability, accessibility, compatibility, or maintainability expectation."
    }
  ],
  "acceptance_criteria": [
    {
      "heading": "Verifiable outcome",
      "body": "Specific test, command, UI check, or manual verification that proves completion."
    }
  ],
  "out_of_scope": [
    {
      "heading": "Boundary",
      "body": "Related work intentionally excluded from this track."
    }
  ]
}
```

Required fields are `schema`, `track_id`, `title`, `description`,
`functional_requirements`, `acceptance_criteria`, and `out_of_scope`.

### Plan JSON Template

Tasks live under `phases[].tasks`, and task dependencies reference
`task_key` values:

```json
{
  "version": 1,
  "schema": "cadre.plan.v1",
  "track_id": "track-id-here",
  "title": "Plan: Short track title",
  "execution_mode": "sequential",
  "dependencies": [],
  "files": [
    "expected/file.ext"
  ],
  "repo": ".",
  "status": "pending",
  "phases": [
    {
      "phase_index": 1,
      "title": "Phase 1: Implement behavior",
      "execution_mode": "sequential",
      "depends_on": [],
      "annotations": {},
      "tasks": [
        {
          "task_index": 1,
          "task_key": "phase1_task1",
          "title": "Specific implementation task",
          "status": "pending",
          "files": [
            "expected/file.ext"
          ],
          "depends_on": [],
          "repo": ".",
          "annotations": {},
          "commit_shas": [],
          "repo_shas": {}
        }
      ]
    },
    {
      "phase_index": 2,
      "title": "Phase 2: Verify behavior",
      "execution_mode": "sequential",
      "depends_on": [
        "phase1"
      ],
      "annotations": {},
      "tasks": [
        {
          "task_index": 1,
          "task_key": "phase2_task1",
          "title": "Run tests and record verification",
          "status": "pending",
          "files": [],
          "depends_on": [
            "phase1_task1"
          ],
          "repo": ".",
          "annotations": {
            "verification": "Run the relevant test, lint, typecheck, or manual check."
          },
          "commit_shas": [],
          "repo_shas": {}
        }
      ]
    }
  ],
  "commit_shas": [],
  "test_expectations": [
    {
      "command": "npm test",
      "purpose": "Verify changed behavior."
    }
  ],
  "completion_evidence": {}
}
```

Required fields are `schema`, `track_id`, and `phases`.

## `cadre-implement`

Starts or resumes implementation.

The implementation packet:

- Selects or claims a track.
- Returns bounded context from product, workflow, patterns, style guides, and
  track files.
- Checks owner/lease state and cross-track collisions.
- Parses the plan and computes ready phases.
- Returns worktree and repo routing.
- Dispatches namespaced `parallel.*` actions through `cadre_action` when safe.

Sequential phases run one unfinished task at a time. Parallel phases dispatch
only tasks whose phase dependencies, task dependencies, worker state, and file
claims are ready.

Task completion should use the returned `cadre_action` `task.complete` call so verification, coverage,
product commits, plan progress, metadata, journals, events, and git notes are
recorded consistently. When no `commitSha` is supplied, Cadre creates the
task-owned product commit automatically using a Conventional Commit subject,
then writes a separate control-plane commit for the Cadre state update.

## `cadre-debug`

Runs a bounded assisted debugging snapshot through Debug Adapter Protocol.

The debug workflow:

- Reads `cadre/dap.json` for configured debug adapters and launch/attach
  configurations.
- Starts through `cadre_workflow` with `workflow:"debug"` and reports adapter
  status, missing commands, and conservative configuration recommendations.
- Invokes only the exact returned `next` call to configure or run a bounded
  snapshot; callers do not enter through a hardcoded intelligence action.
- Launches or attaches, applies requested breakpoints, captures bounded stack,
  variable, and output evidence, then disconnects.

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

Writing a handoff requires reviewing the packet-generated handoff target
preview and confirming the packet write.

Cadre requires substantive `handoffText` before it creates that preview. If the
content is missing or generic, it returns clarification for current state,
blockers and decisions, and the exact next action; it does not synthesize a
timestamped placeholder handoff.

## `cadre-refresh`

Refreshes project context after first analyzing repository and control-plane
drift. The workflow always follows this order:

1. Cadre performs a read-only analysis of repository metadata, languages,
   dependencies, workspace commands, configured topology, LSP recommendations,
   projection health, and any caller-supplied `detectedChanges`.
2. It returns `refresh_analysis`, recommended levels, and a native multi-select
   `intent_prompts` question. The user chooses the levels; recommendations do
   not execute automatically.
3. Cadre filters the selection into the fixed stage order: `product`,
   `product_guidelines`, grouped `technical`, `workflow`, then `patterns`.
   The technical stage contains whichever of tech stack, style guides,
   repository topology, and LSP were selected.
4. For only the semantic documents in the active stage, the agent gathers
   repository evidence and supplies complete structured candidates under
   `proposedContext`. An LSP-only technical stage uses Cadre's analyzed
   configuration directly. Cadre materializes and obtains approval for the
   active stage's atomic file set; later selected stages stay pending and
   unmaterialized.
5. After every selected review stage is approved, invoke the exact returned
   final `next` call. It validates the approved files, applies selected
   projection maintenance, and records the refresh.

Available levels are:

| Level | Result |
|---|---|
| `product` | Refreshes `cadre/product.json` and `cadre/product.md`. |
| `product-guidelines` | Refreshes the product-guidelines canonical/projection pair. |
| `tech-stack` | Refreshes detected languages, frameworks, dependencies, platforms, and commands. |
| `style-guides` | Refreshes the selected style-guide catalog and generated guide projections. |
| `repository-topology` | Refreshes configured repositories, enabled state, default repository, and polyrepo routing. |
| `lsp` | Reviews detected language-server configuration inside the grouped technical stage. |
| `workflow` | Refreshes development, verification, review, commit, and coordination policy. |
| `patterns` | Refreshes evidence-backed architecture, implementation, testing, and data patterns. |
| `projections` | Repairs missing or stale generated project projections from canonical state. |
| `diagnostics` | Returns analysis only and does not mutate the project. |

Evidence-backed document levels do not fall back to templates. Selecting one
without meaningful corresponding evidence in `proposedContext` returns
`stage:"refresh_evidence"` and does not create its review files. A selected LSP
configuration joins the atomic `technical` review stage. Projection maintenance
is execution-only, while diagnostics is read-only and never opens an approval
stage.

## `cadre-revise`

Changes an existing spec or plan after gathering impact evidence.

Revise should preserve track history and reason about:

- Acceptance criteria changes.
- Plan dependency changes.
- File claim changes.
- Repo annotation changes.
- Native dependency and event updates.
- Review or implementation state that may be invalidated.

Revised specs and plans are reviewed from packet-generated target previews
before the confirmed write. When both are selected, revise always collects and
reviews the scoped spec stage first, then the plan stage in the same session.
It materializes only the active stage and returns execution only after the last
selected stage is approved.

When the revision reason or target is unclear, `cadre-revise` returns
`intent_prompts` instead of generating changes. Agents should ask what changed
and whether the spec, plan, or both should be updated.
An empty or generic `spec`/`plan` object does not satisfy this gate. Cadre waits
for a meaningful changed artifact and rationale without materializing template
revision files.

## `cadre-artifacts`

Synchronizes canonical JSON/JSONL artifacts with deterministic human
projections.

Artifact sync can:

- Catalog known project, style guide, track, release, and external artifacts.
- Return JSON schemas for spec, plan, style guide, release, journal, and
  evidence artifacts.
- Validate canonicals and preview generated projections.
- Return missing, stale, unmarked, and legacy-path diagnostics in dry-run mode.

Common scopes:

- `all`: validate/render every known artifact.
- `track:<id>`: spec, plan, learnings, handoff, and index projection for one
  track.
- `styleguides`: style guide catalog and selected guide projections.
- `project`: product context, product guidelines, workflow policy, patterns,
  and project-level projections.

Confirmed sync requires `execute:true` but no document approval. Cadre repairs
missing or stale marked projections atomically. It refuses to overwrite
unmarked user-owned Markdown and reports the conflict; projection repair never
opens a projection-only approval stage.

## `cadre-revert`

Plans and executes tracked reverts through Cadre packets.

In monorepo mode, reverts apply to the track's recorded commits. In polyrepo
mode, SHAs are grouped per repo and reverted in reverse order inside each repo.
Cadre halts on conflicts and reports recovery steps.

Reverts require execution authorization for the packet-planned git actions;
they do not create a separate Cadre document approval. Any restored registered
canonical regenerates its projection before completion.

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

Release notes and metadata are reviewed from packet-generated target previews
before the confirmed write or optional tag action.

When no completed Cadre track supplies release evidence, the caller must
provide substantive `releaseNotes`. Cadre returns clarification instead of
creating an empty default release; completed tracks remain a valid source for
generated notes.

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

Formula workflows are packet-owned. Call the formula workflow and follow its
returned decision and `next`; do not copy packaged plugin files or assume a
template-locator MCP resource exists.

Formula `pour` is staged as `spec` then `plan`: review and approve the spec
before Cadre materializes the plan. Other formula mutations use the packet's
execution authorization and do not invent document stages. In either case,
invoke only the exact continuation Cadre returns.
