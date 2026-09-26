# Cadre

**Current source** uses v6 projects with cohesive task commits, verified operation receipts, approved dependency context, and retained-context tokens. Track remains the default approval mode; Parallel remains the default scheduling mode. Existing projects migrate through one approved refresh at a quiescent boundary. Historical SHA records, execution contracts, and immutable v1–v5 templates remain supported.

Since 3.9.0, the current source adds governed `operation` tracks, evidence and
verification discipline for every track, an approved verification profile in
`.cadre/tech-stack.md`, capability-tiered `cadre-ai doctor` reporting, and a
read-only `cadre-ai guide` fallback. It adds no workflow skill, client, or MCP
tool: the ten workflows, the 25 MCP tools, and the Codex, Claude Code, and Zed
Agent (beta) integrations are unchanged, and the existing `track` skill now
also creates `operation` tracks.

Cadre is a human-governed, Git-aware delivery harness for Codex, Claude Code,
and Zed Agent. Codex and Claude Code support is stable; native Zed Agent support
is beta. Cadre turns project context into resumable feature, bug, and governed
operation tracks, carries learning forward between phases, and records
implementation provenance in Git.

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
- Human approval of scope and approval policy, with explicit author approval for clean track completion.
- Resumable create, specification, planning, implementation, review, revision, refresh, revert, and archive flows.
- Parallel-by-default implementation of dependency DAGs, with an explicit sequential mode.
- Isolated phase and task workers in Cadre-managed Git worktrees, coordinated and integrated only by the main agent.
- Feature, bug, and governed operation tracks with functional requirements, non-functional requirements, acceptance criteria, dependencies, phased tasks, and manual-verification gates.
- Operation tracks for governed rollouts, migrations, maintenance, recovery, and infrastructure or service changes. Humans perform every external action; Cadre validates the structured operation plan and records the evidence supplied, but never executes or attests an external action.
- Dependency enforcement before implementation and cascading-impact analysis after specification, workflow, stack, styleguide, or pattern changes.
- Incremental learning in each track's `learning.md`; each phase reads its declared dependency learning and applicable constraints before work starts.
- Review → remediation → implementation cycles until the human accepts a clean review.
- Single-track or multi-track archival with consolidated pattern distillation and relevant reseeding of active tracks.
- Git-aware task, phase, setup, review, revision, refresh, revert, and archive provenance using Conventional Commits.
- Read-before-edit enforcement: existing files and directly relevant context must be inspected before modification.
- Evidence and verification discipline on every track: grounding before claims, evidence records with explicit time zones, and baseline-and-delta verification against the approved verification profile in `.cadre/tech-stack.md`.
- Reversibility classification of risky changes. Each irreversible or destructive step is its own named task that the plan approval covers; it then runs under the persisted approval mode, and a changed target or consequence goes through `revise` first.
- Change of theory after the same approach fails verification twice, non-inferred approval (silence, a passing check, or a host permission is never approval), feedback classified into `review`, `revise`, or successor-track work, a clarification gate for material ambiguity, and untrusted handling of repository text, tool output, fetched pages, and host web search results.
- Stateless exploration through `wisp`, without mutating Cadre lifecycle state.
- Capability-tiered host reporting: Codex and Claude Code are `full` and Zed Agent is `managed` (beta); the read-only `cadre-ai doctor` reports package health and each client's tier, capability profile, and local setup evidence. Agents without the Cadre MCP get only the read-only `cadre-ai guide` block.
- Canonical workflow skills and generated Zed adapters validated against the Agent Skills specification.

Default idiomatic styleguides are included for Go, Java, Kotlin, Maven, Gradle, HTML/CSS, JavaScript, TypeScript, React, Dart, Flutter, Swift, SwiftUI, and Python. During project creation, each applicable guide can be accepted, amended, or replaced.

## Approval modes and continuous Autonomous delivery

| Approval mode | Human decisions |
|---|---|
| Governed | Task, integration, phase/track verification, and review gates |
| Phase | Phase verification, track verification, and review |
| **Track — default** | Track verification and review |
| Autonomous | One final completion decision after implementation, verification, review, and remediation are clean |

Scheduling is separate: Parallel is the default; request Sequential with any
approval mode. To use the continuous loop, ask your client’s `implement` skill
to implement the track with Autonomous approval mode. Cadre invokes the review
skill through MCP next steps and repeats fixes, verification, and cumulative
review without another command.

`ready_for_review` is an internal handoff during that loop, not an approval
pause. Once clean, Cadre returns verification results, remediation history, and
the exact completion proposal. Approve it to mark the track completed without
running review again, or report additional bugs to continue remediation. Changed
implementation or verification inputs require renewed verification/review.
Autonomous pauses for scope decisions, unavailable checks, external blockers,
or the same unresolved finding after two remediation attempts.

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

`cadre-ai doctor` is read-only. It first checks package health (the packaged
runtime assets and every immutable template set), then reports each client's
capability tier, capability profile, and local setup evidence such as plugin
registration, narrow MCP approval, Zed skill links, and settings. It never
changes settings or repairs configuration, and it exits nonzero only when
package health fails; add `--json` for a structured report. Codex and Claude
Code are `full` integrations and Zed Agent is `managed` (beta). The
`guide-only` and `unverified` tiers exist only for reporting and are never
install targets. For agents without the Cadre MCP, see Other agents
(guide-only) below.

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

### CLI commands

| Command | Effect |
| --- | --- |
| `cadre-ai install` | Package the shared payload and install the selected clients; `--target` defaults to `auto`. Options are listed above. |
| `cadre-ai uninstall` | Remove the selected integrations; `--target` defaults to `all`, which also removes owned marketplace payloads and backups. Accepts `--target codex\|claude\|zed\|all`, `--scope user`, and `--dry-run`. |
| `cadre-ai doctor` | Read-only package health and client capability report. `--json` prints it as JSON. `--home PATH` (marketplace at `PATH/marketplaces/cadre`) or `--marketplace-root PATH` selects a custom marketplace for the Zed checks; pass at most one of the two. |
| `cadre-ai guide` | Print the read-only guide-only block to standard output; takes no options. |
| `cadre-ai --version` | Print the runtime version. |

### Other agents (guide-only)

Other agents are not Cadre integrations. For an agent that cannot call the
Cadre MCP, `cadre-ai guide` prints a read-only, `AGENTS.md`-compatible block
between `<!-- cadre:guide-only:start -->` and `<!-- cadre:guide-only:end -->`
that you can add to a project's `AGENTS.md`:

```sh
cadre-ai guide
```

The block tells the agent to read `.cadre/workflow.md` and the relevant
`.cadre/` artifacts before explaining Cadre scope or status and to label that
explanation unvalidated. It also tells the agent not to change anything under
`.cadre/`, create commits with `Cadre-Operation` or `Cadre-Receipt` trailers,
claim that a track was planned, implemented, reviewed, completed, or archived,
or reconstruct Cadre runtime behavior. The command only writes the block to
standard output; it never reads or writes files, detects clients, or changes
settings. The block is not a Cadre integration. For stateful Cadre work, use
Codex, Claude Code, or Zed Agent with Cadre installed, and run
`cadre-ai doctor` to check the local setup.

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

The proposed `tech-stack.md` includes a verification profile. For format/lint,
static analysis/types, build, test, and other required checks, it records the
approved command, when it is required, and its side effects and prerequisites;
a role that does not apply says `not applicable` with a reason. Cadre proposes
the profile from repository evidence such as scripts, manifests, and CI
configuration and does not run the discovered commands before approval; you
approve the profile with the rest of initialization. `implement` and `review`
verify against it, and `refresh` treats profile drift as execution-governing
context. A legacy project without a profile verifies with repository
instructions and existing scripts and records the exact commands.

### 2. Create a feature, bug, or operation track

```text
Codex:      $cadre:track Add passwordless login as a feature
Claude Code: /cadre:track Fix duplicate invoice creation as a bug
Zed Agent:   /cadre-track Add passwordless login as a feature
```

Cadre proposes and approves together:

- `spec.md`, containing functional requirements, non-functional requirements, acceptance criteria, dependencies, additional information, and dependent-track impact, plus the operation sections below for an operation track;
- `plan.md`, defining an acyclic phase/task dependency graph with derived manual-verification barriers;
- `learning.md`, whose marked Pattern Seed contains only patterns relevant to the approved track.

Every delivery phase ends with `User Manual Verification`. The final phase is always `Track-level User Manual Verification`.

Plans classify the reversibility of risky steps. Each irreversible or destructive step is its own named task that the plan approval covers; it then runs under the persisted approval mode, and a changed target or consequence goes through `revise` first.

For a governed rollout, migration, maintenance, recovery, or infrastructure or service change, create an operation track:

```text
Codex:      $cadre:track Roll out the orders database migration as an operation
Claude Code: /cadre:track Roll out the orders database migration as an operation
Zed Agent:   /cadre-track Roll out the orders database migration as an operation
```

An operation track uses the same track → implement → review → archive lifecycle. Humans perform every external action; Cadre records the structured evidence they supply and never executes or attests an external action. Its `spec.md` also requires these sections, with a meaningful value for every field:

| Section | Required fields |
| --- | --- |
| Operational Readiness | Owner, Target, Change window, Preconditions |
| Human-Controlled Preflight, Rollout, and Postflight Evidence | Planned operator, Evidence to capture, and Timestamp format under each of Preflight, Rollout, and Postflight |
| Monitoring and Success Signals | Signal, Baseline, Success threshold, Observation window |
| Abort, Rollback, and Recovery | Abort threshold, Rollback/recovery owner, Procedure, Reversibility limit |
| Residual Risk | Residual risk, Mitigation, Acceptance owner |

A blank field, an unresolved `{{...}}` placeholder, or a stand-in such as `TBD`, `TODO`, `unknown`, `pending`, `none`, or `n/a` fails validation. During `implement`, the human supplies the operator, RFC 3339 timestamp, evidence location or hash, and observed signal against baseline and threshold, and the matching manual-verification checkpoint records them. An abort-threshold breach blocks the phase until the human records the rollback or recovery decision, and `review` treats missing or contradictory evidence as a finding. The track's `state.json` records `type: "operation"`, which is unrelated to `state.operation`, Cadre's temporary journal for a pending state mutation.

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
| `track` | Create or resume a feature, bug, or operation specification, phased plan, dependency set, and learning seed. |
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
- `completed` and `archived` tracks remain immutable; Cadre proposes a successor feature, bug, or operation track referencing the original.

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
- `tech-stack.md` includes the approved verification profile that implement and review verify against; a changed profile requires renewed verification and review of affected work.
- `executions/execution-<id>.json` is the resumable runtime journal. Ready and active nodes are derived from it; track state does not duplicate an active phase or task.
- Track-local `state.json` defines identity, type (`feature`, `bug`, or `operation`), lifecycle status, track dependencies, revision, checkpoints, operation history, and the last completed execution reference.
- `project.json` contains project setup and refresh history; it does not duplicate track records.
- `.cadre/operations/refresh-<id>.json` and archive operation files preserve project-wide mutation checkpoints.
- `tracks.md` is generated from track-local state and is never hand-edited.
- Track directory paths are derived from status and ID. A path is never persisted in track state.

## MCP capabilities

The `cadre` stdio server exposes active immutable resources at `cadre://templates/v6/...` and 25 tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `workflow_elicit` | No | Present one bounded clarification form or a fixed approval form bound to a digest or checkpoint; never records approval or requests secrets, and returns `fallback_required` when the client cannot show forms. |
| `template_get_many` | No | Read an ordered template bundle in one call; immutable catalog contents are cached for the server lifetime. |
| `styleguide_resolve` | No | Resolve default styleguide descriptors and hashes for an approved technology list. |
| `context_read` | No | Read required track/node context with source hashes, freshness findings, and complete continuation pages. |
| `diagnostic_read` | No | Page through the full process-local diagnostic behind a bounded error until `nextOffset` is null. |
| `project_status` | No | Return complete validation plus scoped canonical, staged, shadowed, or implementation status. |
| `state_validate` | No | Validate project, track, plan, learning, dependency, review, and archive invariants. |
| `candidate_stage_prepare` | Atomic | Create/resume a stage and optionally prune files outside its exact `expectedFiles` set. |
| `candidate_inspect` | No | Return one exact manifest and validate every staged root or nested plan against its declared target status. |
| `candidate_apply` | Yes | Prepare the exact final manifest and digest for a track, revise, refresh, review-remediation, or revert candidate; after approval, promote it with the unchanged token, or reconcile or resume a journaled promotion. Never writes product files or commits. |
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

The four adaptive tools and `candidate_apply` use a strict `request` union:
prepare accepts only its declared fields, while apply accepts only an unchanged
`proposalToken`. The MCP
selects one result representation: structured JSON and output schemas for recognized structured clients, compact text for other clients. Server-side output validation remains strict in both cases. Template bodies appear once. The Node-18-compatible serialized tool catalog is kept below 80 KiB, including the context and handoff contracts. The MCP
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

Codex uses implementation subagents when parallel nodes are available. Claude Code uses the packaged `cadre-phase-worker` and `cadre-task-worker` definitions. Both follow the same contract: workers stay in their assigned worktree, read before editing, modify product files only, run focused verification, never spawn nested workers, and stop uncommitted until the main agent reviews their work and provides the human approval or persisted-mode authorization required by the execution policy. A phase worker holds only a temporary execution lease: it checkpoints one regular task at a time, creates a distinct approved commit for each task, and must report a clean committed HEAD and remain inactive before task-worker fan-out. The journal retains worker history across later reassignment. Manual-verification evidence does not require an empty commit. Claude agent teams are intentionally not required.

## Resumability and safety

Multi-step state changes—including revisions, refreshes, reverts, archive batches, and implementation executions—write an operation or execution journal before artifact or Git mutation. On the next invocation, Cadre reconciles that journal with files, worker identities, registered worktrees, branches, dirty state, commits, and merges:

- matching dirty work resumes at the first incomplete checkpoint;
- a clean tree with the expected commit records the commit instead of repeating work;
- completed artifact work with pending bookkeeping finishes only the state-record commit;
- refresh and revert resumes reuse the approved artifact set and never repeat a recorded Git commit;
- committed or integrated DAG nodes are not repeated, and newly ready nodes are scheduled immediately after durable transitions;
- any mismatch stops and is presented to the human rather than guessed, discarded, reset, or restarted.

Task conflicts are resolved and reverified in the owning phase worktree. Phase conflicts are resolved and reverified in the canonical worktree. The main agent reviews each resolution and records its verification and mode-appropriate authorization before its merge commit. A revision or refresh that changes execution-governing context first quiesces active workers and reconciles their work; a changed plan graph creates a new execution identity rather than rewriting the old journal.

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

### Memory format upgrade

The current source uses template set v6 for new projects and requires one approved refresh of older projects at a quiescent boundary before delivery. It preserves the published v1–v5 templates unchanged and readable, along with terminal learning. Refreshing a v1 or v2 project also requires an explicitly reseeded v6 Pattern Seed in `learning.md` for every nonterminal active track. Active Pattern Seeds record revisions and exact pattern fingerprints; changed guidance requires reassessment. Task handoffs preserve decisions, failed approaches, uncertainty, and next actions alongside existing checkpoints. Use all `context_read` pages before acting, and retain source inspection and approval gates. Routine `project_status` uses summaries; request `detail: "full"` for history/graph diagnostics. Filtered/paged listings never narrow validation coverage.

Release preparation includes regression tests, package inspection, and documentation checks. Publishing still requires native installer/discovery/activation checks for Codex, Claude Code, and Zed. Local model tests and byte benchmarks do not establish universal token savings or semantic correctness of generated learning.


### Implementation approval modes

Track is the default: phase checks run automatically, followed by track verification
and ordinary review approval. Phase retains phase verification gates; Governed retains
task and integration gates. Explicit Autonomous implements, verifies, reviews, and
remediates in-scope findings until clean, then asks for one final completion approval.
Parallel scheduling remains the default and Sequential is available independently.
Legacy Autonomous requires an explicit Track-or-Autonomous choice through approved
refresh. Policy v2 persists loop authority, cumulative review baseline, and stable
findings; a finding unresolved after two remediation attempts pauses for guidance.
