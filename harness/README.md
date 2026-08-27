# Cadre

Cadre is a human-governed, Git-aware delivery harness for Codex, Claude Code,
and Zed Agent. Codex and Claude Code support is stable; native Zed Agent support
is beta. Cadre turns project context into resumable feature and bug tracks,
carries learning forward between phases, and records implementation provenance
in Git.

Cadre is installed as a user integration. Codex and Claude use native plugins;
Zed uses global skills and a custom MCP server. The bundled TypeScript MCP
server provides deterministic state operations and immutable, versioned
templates. A project keeps only approved, mutable delivery state under
`.cadre/`; runtime code and template catalogs are not copied into the project.

**Documentation:** [cadre-docs.pages.dev](https://cadre-docs.pages.dev/) ·
[Quickstart](https://cadre-docs.pages.dev/quickstart/) ·
[Release notes](https://cadre-docs.pages.dev/release-notes/)

## Capabilities

- Greenfield and brownfield project onboarding, with an explicit classification gate when the repository is ambiguous.
- Human approval of every generated artifact and lifecycle state transition.
- Resumable create, specification, planning, implementation, review, revision, refresh, revert, and archive flows.
- Parallel-by-default implementation of dependency DAGs, with an explicit sequential mode.
- Isolated phase and task workers in Cadre-managed Git worktrees, coordinated and integrated only by the main agent.
- Feature and bug tracks with functional requirements, non-functional requirements, acceptance criteria, dependencies, phased tasks, and manual-verification gates.
- Dependency enforcement before implementation and cascading-impact analysis after specification, workflow, stack, styleguide, or pattern changes.
- Incremental learning in each track's `learning.md`; every phase reads the previous phase's learning before work starts.
- Review → remediation → implementation cycles until the human accepts a clean review.
- Single-track or multi-track archival with consolidated pattern distillation and relevant reseeding of active tracks.
- Git-aware task, phase, setup, review, revision, refresh, revert, and archive provenance using Conventional Commits.
- Read-before-edit enforcement: existing files and directly relevant context must be inspected before modification.
- Stateless exploration through `wisp`, without mutating Cadre lifecycle state.

Default idiomatic styleguides are included for Go, Java, Kotlin, Maven, Gradle, HTML/CSS, JavaScript, TypeScript, React, Dart, Flutter, Swift, SwiftUI, and Python. During project creation, each applicable guide can be accepted, amended, or replaced.

## Requirements

- Node.js 18 or newer
- Git
- The `codex`, `claude`, or `zed` CLI for each selected client

## Install

Install the published CLI:

```sh
npm install -g cadre-ai
cadre-ai doctor
```

Install for every detected client:

```sh
cadre-ai install
```

Install for only one agent:

```sh
# Codex only
cadre-ai install --target codex

# Claude Code only
cadre-ai install --target claude

# Zed Agent only (beta)
cadre-ai install --target zed
```

The installer:

1. Packages the skills, MCP configuration, self-contained runtime, generated
   Zed adapters, and templates into a shared local payload.
2. Registers and installs `cadre@cadre` for Codex/Claude, or links global
   `cadre-*` skills and configures the custom MCP server for Zed.
3. Verifies each selected client through its available native state.
4. Pre-approves only Cadre MCP tools so normal Cadre commands do not produce an
   extra permission prompt.

The marketplace is stored at `~/.cadre/marketplaces/cadre`. When it is updated, the prior generated payload is retained as a timestamped backup.

### MCP permission behavior

By default, installation applies these narrowly scoped rules:

- Codex: `default_tools_approval_mode = "approve"` under `plugins."cadre@cadre".mcp_servers.cadre` in the user Codex configuration.
- Claude Code: `cadre` in `enabledMcpjsonServers` and `mcp__cadre__*` in the
  user permission allowlist.
- Zed Agent (beta): one exact `mcp:cadre:<tool>` allow entry for each Cadre MCP tool
  under `agent.tool_permissions.tools`.

Existing configuration, comments, and unrelated permission rules are preserved. A Claude deny rule is never removed or overridden. These rules suppress the host application's per-tool prompt; they do not bypass Cadre's requirement to present artifacts and lifecycle mutations to the human for approval.

Implementation may still need host permission for network access, dependency installation, container images, local listeners, or filesystem writes outside the workspace. Cadre preflights those operations before workers start, centralizes shared downloads, reuses existing narrow approvals, and asks only for an exact necessary command when no suitable permission exists. These host prompts are operational security gates, not lifecycle approvals.

To retain per-call MCP permission prompts:

```sh
cadre-ai install --target codex --prompt-mcp-tools
```

### Other installer options

| Option | Effect |
| --- | --- |
| `--target auto\|all\|codex\|claude\|zed` | Select the target client; defaults to `auto`. |
| `--scope user` | Explicitly select the only supported installation scope. |
| `--replace-marketplace` | Replace another configured marketplace named `cadre` after the installer detects the path mismatch. |
| `--prompt-mcp-tools` | Do not add the Cadre MCP pre-approval rule. |
| `--prepare-only` | Build the marketplace without registering, installing, or changing permission configuration. |
| `--marketplace-root PATH` | Override the generated marketplace location; the path must end in `cadre`. |
| `--cachebuster TOKEN` | Supply an explicit package cachebuster instead of the generated timestamp. |
| `--dry-run` | Report the intended marketplace and client operations without applying them. |

Package-only example:

```sh
cadre-ai install \
  --target all \
  --prepare-only \
  --marketplace-root /tmp/cadre
```

### Update an existing installation

Install the desired package version and rerun the installer. It produces a new
cache-busted marketplace payload and updates the installed plugin:

```sh
npm install -g cadre-ai@latest
cadre-ai doctor
cadre-ai install
```

`--replace-marketplace` is needed only when a client already has a marketplace
named `cadre` pointing somewhere else.

After installation or update:

- Start a new Codex conversation so the new skills and MCP tools are loaded.
- In Claude Code, run `/reload-plugins` or start a new session.
- In Zed, open a new Agent thread; global skills reload live and the Cadre MCP
  server should appear active under AI → MCP Servers.

You can inspect installation state with:

```sh
codex plugin list --json
claude plugin list --json
```

## Quick start

Cadre commands are agent skills, not shell commands. Invoke them in a Codex,
Claude Code, or native Zed Agent conversation.

### 1. Initialize a project

From the project repository, invoke:

```text
Codex:      $cadre:create
Claude Code: /cadre:create
Zed Agent:   /cadre-create
```

Cadre will:

1. Inspect the repository and Git state.
2. Classify it as greenfield or brownfield, asking when the evidence is unclear.
3. Propose product, engineering, tech-stack, workflow, and applicable styleguide artifacts.
4. Present the default or amended workflow, styleguides, and exact `.cadre`
   file set in one final initialization approval envelope.
5. Apply only that digest-bound proposal.
6. Initialize Git when the approved project root is not already in a worktree.
7. Validate and commit the approved setup with resumable checkpoints.

### 2. Create a feature or bug track

```text
Codex:      $cadre:track Add passwordless login as a feature
Claude Code: /cadre:track Fix duplicate invoice creation as a bug
Zed Agent:   /cadre-track Add passwordless login as a feature
```

Cadre proposes and approves together:

- `spec.md`, containing functional requirements, non-functional requirements, acceptance criteria, dependencies, additional information, and dependent-track impact;
- `plan.md`, defining an acyclic phase/task dependency graph with derived manual-verification barriers;
- `learning.md`, whose marked Pattern Seed contains only patterns relevant to the approved track.

Every delivery phase ends with `User Manual Verification`. The final phase is always `Track-level User Manual Verification`.

### 3. Implement the approved plan

```text
Codex:      $cadre:implement passwordless-login
Claude Code: /cadre:implement passwordless-login
Zed Agent:   /cadre-implement passwordless-login
```

Parallel mode is the default. Request sequential execution explicitly when needed:

```text
Codex:      $cadre:implement passwordless-login sequentially
Claude Code: /cadre:implement passwordless-login sequentially
Zed Agent:   /cadre-implement passwordless-login sequentially
```

Implementation starts only after declared track dependencies are completed. Phase and task dependencies form a hierarchical DAG: phase dependencies activate phases, task dependencies expose phase-local work, and main allocates one global worker bound across every ready task. The generated workflow defaults to three delegated workers, the execution runtime accepts `maxWorkers` from 1 through 32, and effective concurrency is clamped by safe ready nodes and available host worker slots. Different phases can use direct execution, a sequential phase worker, or task-worker fan-out concurrently. Within one phase, execution can switch between sequential and fan-out modes only at a clean, journaled checkpoint. The main agent remains the only scheduler, operational owner of phase integration worktrees, state owner, merger, conflict resolver, worktree cleaner, and recorder of human approval.

Every delivery phase ends with a derived manual-verification barrier over its tasks. The final track-level manual verification depends on every delivery phase and always runs in the main agent against the canonical worktree. Cadre resumes from its execution journal, reads dependency-phase learning, verifies and presents each change before commit, records task and phase provenance, and advances the track to `ready_for_review` only after all barriers pass.

### 4. Review and complete the track

```text
Codex:      $cadre:review passwordless-login
Claude Code: /cadre:review passwordless-login
Zed Agent:   /cadre-review passwordless-login
```

Findings are presented before they become Cadre state. Approved bugs create a timestamped bug artifact and add remediation phases to the plan. A human-approved clean review marks the track `completed`.

### 5. Archive completed work

```text
Codex:      $cadre:archive passwordless-login account-lockout
Claude Code: /cadre:archive all completed
Zed Agent:   /cadre-archive all completed
```

Archive accepts one or more completed tracks in one resumable batch. It distills their durable learning into the project pattern catalog, updates relevant seeds for active tracks, preserves the full track history, and moves each selected track to its derived archive location.

## Command reference

| Command | Purpose |
| --- | --- |
| `create` | Initialize or resume Cadre, classify project context, initialize Git when needed, and establish approved project artifacts. |
| `track` | Create or resume a feature/bug specification, phased plan, dependency set, and learning seed. |
| `implement` | Execute or resume the approved phase/task DAG in parallel by default or explicitly sequentially, with worktrees, tests, learning, approvals, and commit provenance. |
| `review` | Review a ready track, record approved findings, add remediation phases, or complete an approved clean cycle. |
| `revise` | Route a requested change by lifecycle state, revise an approved active baseline, or propose a successor for completed history. |
| `archive` | Archive one or more completed tracks, distill patterns, and reseed active tracks by relevance. |
| `refresh` | Refresh project context from user input, repository changes, and completed-track outcomes. |
| `revert` | Prepare and execute a human-approved additive Git revert for a task, phase, or track. |
| `status` | Validate and summarize project, operation, track, dependency, review, and archive state without mutation. |
| `wisp` | Explore or investigate without creating or changing Cadre lifecycle state. |

## Lifecycle

```text
drafting-spec → drafting-plan → planned → in_progress → ready_for_review
                     │           │               ├─ revise → in_progress/planned
                     └─ revise ──┴───────────────┼─ approved bugs → in_progress
                                                 └─ approved clean review → completed → archived

completed/archived ── changed intent → successor track
```

Only `review` can mark a track completed. Only `archive` can mark it archived. The `revise` command is callable in every state, but its behavior preserves approved history:

- `drafting-spec` changes continue the track draft without creating a revision.
- In `drafting-plan`, an approved-spec change is a revision while an unapproved-plan change remains drafting.
- `planned`, `in_progress`, and `ready_for_review` tracks can revise their approved baseline. Active work is reconciled first, completed commits are preserved, and changed scope at review time returns the track to implementation and manual verification.
- A revision that adds an incomplete dependency returns the track to `planned` so implementation remains blocked.
- `completed` and `archived` tracks remain immutable; Cadre proposes a successor feature or bug track referencing the original.

Defects found against the already approved specification belong to `review`. Use `revise` when the desired behavior, scope, requirement, or acceptance criterion itself changes.

## Project state

An initialized project has this shape:

```text
.cadre/
├── .gitignore
├── project.json
├── product.md
├── guidelines.md
├── tech-stack.md
├── workflow.md
├── tracks.md
├── styleguides/
├── patterns/
├── operations/
├── refreshes/
├── tracks/
│   └── <track-id>/
│       ├── state.json
│       ├── spec.md
│       ├── plan.md
│       ├── learning.md
│       ├── executions/
│       ├── bugs/
│       └── revisions/
├── archive/
├── stage/                       # ignored, unapproved candidate artifacts
├── .worktrees/                  # ignored, temporary execution worktrees
└── wisps/                       # ignored, disposable exploration output
```

Important sources of truth:

- `spec.md` defines track scope and acceptance.
- `plan.md` defines the phase/task dependency DAG, task state, manual barriers, and commit provenance.
- `executions/execution-<id>.json` is the resumable runtime journal. Ready and active nodes are derived from it; track state does not duplicate an active phase or task.
- Track-local `state.json` defines identity, type, lifecycle status, track dependencies, revision, checkpoints, operation history, and the last completed execution reference.
- `project.json` contains project setup and refresh history; it does not duplicate track records.
- `.cadre/operations/refresh-<id>.json` and archive operation files preserve project-wide mutation checkpoints.
- `tracks.md` is generated from track-local state and is never hand-edited.
- Track directory paths are derived from status and ID. A path is never persisted in track state.

## MCP capabilities

The `cadre` stdio server exposes active immutable resources at `cadre://templates/v2/...` and 22 tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `template_get_many` | No | Read an ordered template bundle in one call; immutable catalog contents are cached for the server lifetime. |
| `styleguide_resolve` | No | Resolve default styleguide descriptors and hashes for an approved technology list. |
| `project_status` | No | Return complete validation plus scoped canonical, staged, shadowed, or implementation status. |
| `state_validate` | No | Validate project, track, plan, learning, dependency, review, and archive invariants. |
| `candidate_stage_prepare` | Atomic | Create/resume a stage and optionally prune files outside its exact `expectedFiles` set. |
| `candidate_inspect` | No | Return one exact manifest and validate every staged root or nested plan against its declared target status. |
| `execution_graph_validate` | No | Parse and validate phase/task dependencies, cycles, and derived manual-verification barriers. |
| `review_complete` | Adaptive | Derive the full execution-base review range, then prepare/apply an idempotent clean completion. |
| `archive_batch_candidate` | Adaptive | Read staged pattern/seed files, return the complete batch for approval, then apply its unchanged token. |
| `archive_batch_record` | Atomic | Record the resulting archive commit in track, project, and batch provenance without a second decision. |
| `execution_start` | Atomic | Create the authorized execution journal and enter `in_progress` in one call. |
| `execution_checkpoint` | Atomic | Apply one strict `scope` + event-specific `action` with required evidence. |
| `execution_status` | No | Return a compact ready/active/blocked scheduler view, with optional focused node detail. |
| `execution_finish` | Atomic | Convergently write completed execution, plan markers, `ready_for_review` state, and index. |
| `worktree_create` | Atomic | Create/reconcile a worktree and record node start. |
| `integration` | Adaptive | Merge and record integration; require a second call only in governed mode. |
| `worktree_cleanup` | Atomic | Remove a verified integrated worktree and record completion. |
| `project_init_candidate` | Adaptive | Generate defaults around staged authored context and apply after approval. |
| `setup_record_git_initialized` | Yes | Record the verified Git-initialization checkpoint. |
| `setup_record_commit` | Yes | Record the already-created setup commit SHA and complete setup state. |
| `tracks_render` | Atomic | Validate and write deterministic `tracks.md` from current track state. |

The four adaptive tools use a strict `request` union: prepare accepts only its
declared fields, while apply accepts only an unchanged `proposalToken`. The MCP
server cannot approve its own proposals or run arbitrary shell commands. Its
Git surface is limited to derived Cadre worktree creation, non-squash
integration, status, and verified cleanup. It never force-deletes a branch,
resolves a conflict, edits product files, or commits on behalf of a worker.
Multi-file state operations use atomic individual writes and converge from
matching partial state; mismatched bytes, hashes, journals, or Git HEAD remain
hard failures.

Review and archive minimize approval fragmentation without weakening governance. A finding disposition and its exact remediation artifacts may share one approval; explicit reject-and-complete records accepted risks in the clean review; and a uniquely eligible archive target is included directly in the full batch proposal. Archive prepare computes the post-move `tracks.md` before approval, including archived rows. Any changed content, selection, digest, or consequence requires a corrected proposal and renewed approval.

### Worktree layout and worker model

Phase and task worktrees are siblings because Git worktrees cannot be physically nested safely:

```text
.cadre/.worktrees/<track-id>/<execution-id>/
├── phases/P1
└── tasks/P1--t1-1
```

Task branches in one dependency wave start from the same clean phase HEAD and merge into the registered phase integration branch one at a time. The next wave starts from the updated phase HEAD. Direct canonical integration is reserved for an explicitly main-coordinated single-task phase; multi-task and phase-verified delivery uses a phase integration branch. Phase branches merge into the canonical branch. Cleanup prunes the worktree and branch only after ancestry proves the integration is present in the derived parent.

Codex uses implementation subagents when parallel nodes are available. Claude Code uses the packaged `cadre-phase-worker` and `cadre-task-worker` definitions. Both follow the same contract: workers stay in their assigned worktree, read before editing, modify product files only, run focused verification, never spawn nested workers, and stop uncommitted until the main agent presents their work and obtains human approval. A phase worker holds only a temporary execution lease: it checkpoints one regular task at a time, creates a distinct approved commit for each task, and must report a clean committed HEAD and remain inactive before task-worker fan-out. The journal retains worker history across later reassignment. Manual-verification evidence does not require an empty commit. Claude agent teams are intentionally not required.

## Resumability and safety

Multi-step state changes—including revisions, refreshes, reverts, archive batches, and implementation executions—write an operation or execution journal before artifact or Git mutation. On the next invocation, Cadre reconciles that journal with files, worker identities, registered worktrees, branches, dirty state, commits, and merges:

- matching dirty work resumes at the first incomplete checkpoint;
- a clean tree with the expected commit records the commit instead of repeating work;
- completed artifact work with pending bookkeeping finishes only the state-record commit;
- refresh and revert resumes reuse the approved artifact set and never repeat a recorded Git commit;
- committed or integrated DAG nodes are not repeated, and newly ready nodes are scheduled immediately after durable transitions;
- any mismatch stops and is presented to the human rather than guessed, discarded, reset, or restarted.

Task conflicts are resolved and reverified in the owning phase worktree. Phase conflicts are resolved and reverified in the canonical worktree. The main agent presents every resolution before recording its merge commit. A revision or refresh that changes execution-governing context first quiesces active workers and reconciles their work; a changed plan graph creates a new execution identity rather than rewriting the old journal.

Archive remains deliberately small: it accepts only tracks that centralized state validation already proves are `completed` with a clean review bound to the current execution, plan revision, graph digest, and reviewed head. It does not rerun implementation barriers or review logic.

Product work uses Conventional Commits. Cadre-only state commits use `cadre(<command>): <description>`. Reverts prefer additive `git revert` commits over destructive history rewriting.

## Development

Useful commands:

```sh
pnpm --filter cadre-ai check      # TypeScript type checking
pnpm --filter cadre-ai test       # Build and run integration tests
pnpm --filter cadre-ai validate   # Build and validate skills, templates, runtime, and manifests
pnpm --filter cadre-ai build      # Build dist/cadre-cli.mjs and dist/cadre-mcp.mjs
```

The test suite exercises state validation, interrupted operations, DAG invariants, execution gating, nested task-to-phase and phase-to-main worktree integration, safe cleanup, marketplace packaging, MCP discovery and initialization, multi-track archival, and permission configuration. Before publishing a change, run:

```sh
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
```
