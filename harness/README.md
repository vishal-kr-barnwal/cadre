# Cadre

Cadre is a human-governed, Git-aware delivery harness for Codex and Claude Code. It turns project context into resumable feature and bug tracks, carries learning forward between phases, and records implementation provenance in Git.

Cadre is installed as a user plugin. Its bundled TypeScript MCP server provides deterministic state operations and immutable, versioned templates. A project keeps only approved, mutable delivery state under `.cadre/`; runtime code and template catalogs are not copied into the project.

## Capabilities

- Greenfield and brownfield project onboarding, with an explicit classification gate when the repository is ambiguous.
- Human approval of every generated artifact and lifecycle state transition.
- Resumable create, specification, planning, implementation, review, revision, and archive flows.
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
- The `codex` CLI, the `claude` CLI, or both
- A local checkout of this repository

## Install

Install development dependencies once:

```sh
npm install
```

Install for both Codex and Claude Code:

```sh
node --import tsx scripts/install.ts --agent all
```

Install for only one agent:

```sh
# Codex only
node --import tsx scripts/install.ts --agent codex

# Claude Code only
node --import tsx scripts/install.ts --agent claude
```

The installer:

1. Builds the self-contained `dist/cadre-mcp.mjs` server.
2. Packages the skills, MCP configuration, runtime, and templates into a local marketplace.
3. Registers the marketplace and installs `cadre@cadre` at user scope.
4. Verifies that the selected agent reports the plugin as installed and enabled.
5. Pre-approves only Cadre MCP tools so normal Cadre commands do not produce an extra permission prompt.

The marketplace is stored at `~/.cadre/marketplaces/cadre`. When it is updated, the prior generated payload is retained as a timestamped backup.

### MCP permission behavior

By default, installation applies these narrowly scoped rules:

- Codex: `default_tools_approval_mode = "approve"` under `plugins."cadre@cadre".mcp_servers.cadre` in the user Codex configuration.
- Claude Code: `mcp__cadre__*` in the user permission allowlist.

Existing configuration, comments, and unrelated permission rules are preserved. A Claude deny rule is never removed or overridden. These rules suppress the host application's per-tool prompt; they do not bypass Cadre's requirement to present artifacts and lifecycle mutations to the human for approval.

To retain per-call MCP permission prompts:

```sh
node --import tsx scripts/install.ts --agent codex --prompt-mcp-tools
```

### Other installer options

| Option | Effect |
| --- | --- |
| `--agent all\|codex\|claude` | Select the target agent; defaults to `all`. |
| `--replace-marketplace` | Replace another configured marketplace named `cadre` after the installer detects the path mismatch. |
| `--prompt-mcp-tools` | Do not add the Cadre MCP pre-approval rule. |
| `--prepare-only` | Build the marketplace without registering, installing, or changing permission configuration. |
| `--marketplace-root PATH` | Override the generated marketplace location; the path must end in `cadre`. |
| `--cachebuster TOKEN` | Supply an explicit package cachebuster instead of the generated timestamp. |

Package-only example:

```sh
node --import tsx scripts/install.ts \
  --agent all \
  --prepare-only \
  --marketplace-root /tmp/cadre
```

### Update an existing installation

Pull or check out the desired source version, run `npm install`, and rerun the same install command. The installer produces a new cache-busted package and updates the installed plugin. `--replace-marketplace` is needed only when an agent already has a marketplace named `cadre` pointing somewhere else.

After installation or update:

- Start a new Codex conversation so the new skills and MCP tools are loaded.
- In Claude Code, run `/reload-plugins` or start a new session.

You can inspect installation state with:

```sh
codex plugin list --json
claude plugin list --json
```

## Quick start

Cadre commands are agent skills, not shell commands. Invoke them in the Codex or Claude Code conversation.

### 1. Initialize a project

From the project repository, invoke:

```text
Codex:      $cadre:create
Claude Code: /cadre:create
```

Cadre will:

1. Inspect the repository and Git state.
2. Classify it as greenfield or brownfield, asking when the evidence is unclear.
3. Propose product, engineering, tech-stack, workflow, and applicable styleguide artifacts.
4. Ask for separate approval of the default or amended workflow and styleguides.
5. Preview the exact `.cadre` file set before applying it.
6. Initialize Git when the approved project root is not already in a worktree.
7. Validate and commit the approved setup with resumable checkpoints.

### 2. Create a feature or bug track

```text
Codex:      $cadre:track Add passwordless login as a feature
Claude Code: /cadre:track Fix duplicate invoice creation as a bug
```

Cadre proposes and separately approves:

- `spec.md`, containing functional requirements, non-functional requirements, acceptance criteria, dependencies, additional information, and dependent-track impact;
- `plan.md`, split into ordered phases and tasks;
- `learning.md`, whose marked Pattern Seed contains only patterns relevant to the approved track.

Every delivery phase ends with `User Manual Verification`. The final phase is always `Track-level User Manual Verification`.

### 3. Implement the approved plan

```text
Codex:      $cadre:implement passwordless-login
Claude Code: /cadre:implement passwordless-login
```

Implementation starts only after declared dependencies are completed. Cadre resumes the first unfinished task, reads incremental learning, verifies the work, presents the changes, records task and phase commit SHAs, and advances the track to `ready_for_review` only after final manual verification.

### 4. Review and complete the track

```text
Codex:      $cadre:review passwordless-login
Claude Code: /cadre:review passwordless-login
```

Findings are presented before they become Cadre state. Approved bugs create a timestamped bug artifact and add remediation phases to the plan. A human-approved clean review marks the track `completed`.

### 5. Archive completed work

```text
Codex:      $cadre:archive passwordless-login account-lockout
Claude Code: /cadre:archive all completed
```

Archive accepts one or more completed tracks in one resumable batch. It distills their durable learning into the project pattern catalog, updates relevant seeds for active tracks, preserves the full track history, and moves each selected track to its derived archive location.

## Command reference

| Command | Purpose |
| --- | --- |
| `create` | Initialize or resume Cadre, classify project context, initialize Git when needed, and establish approved project artifacts. |
| `track` | Create or resume a feature/bug specification, phased plan, dependency set, and learning seed. |
| `implement` | Execute the approved plan task by task with dependency gates, tests, learning, verification, and commit provenance. |
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
│       ├── bugs/
│       └── revisions/
├── archive/
└── wisps/
```

Important sources of truth:

- `spec.md` defines track scope and acceptance.
- `plan.md` defines execution order, task state, and commit provenance.
- Track-local `state.json` defines identity, type, lifecycle status, dependencies, revision, checkpoints, and operation history.
- `project.json` contains project setup and refresh history; it does not duplicate track records.
- `tracks.md` is generated from track-local state and is never hand-edited.
- Track directory paths are derived from status and ID. A path is never persisted in track state.

## MCP capabilities

The `cadre` stdio server exposes immutable resources at `cadre://templates/v1/...` and these tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `template_catalog` | No | List template IDs, resource URIs, media types, and content hashes. |
| `template_get` | No | Read one versioned template by logical ID. |
| `styleguide_resolve` | No | Resolve default styleguides for an approved technology list. |
| `project_status` | No | Summarize project and track checkpoints, including resumable operations. |
| `state_validate` | No | Validate project, track, plan, learning, dependency, review, and archive invariants. |
| `project_init_preview` | No | Return the complete proposed initialization file set and digest. |
| `project_init_apply` | Yes | Atomically create `.cadre` only when inputs match the approved preview digest. |
| `setup_record_git_initialized` | Yes | Record the verified Git-initialization checkpoint. |
| `setup_record_commit` | Yes | Record the already-created setup commit SHA and complete setup state. |
| `tracks_render_preview` | No | Preview the derived `tracks.md` content and digest. |
| `tracks_render_apply` | Yes | Write `tracks.md` only when current state matches the approved preview digest. |

The MCP server does not run Git commands and cannot approve its own proposals. Deterministic writes use preview/apply digests to reject stale or changed proposals.

## Resumability and safety

Multi-step state changes—including revisions—write an operation journal before artifact mutation. On the next invocation, Cadre reconciles that journal with the files, working tree, and recent commits:

- matching dirty work resumes at the first incomplete checkpoint;
- a clean tree with the expected commit records the commit instead of repeating work;
- completed artifact work with pending bookkeeping finishes only the state-record commit;
- any mismatch stops and is presented to the human rather than guessed, discarded, reset, or restarted.

Product work uses Conventional Commits. Cadre-only state commits use `cadre(<command>): <description>`. Reverts prefer additive `git revert` commits over destructive history rewriting.

## Development

Useful commands:

```sh
npm run check      # TypeScript type checking
npm test           # Build and run integration tests
npm run validate   # Build and validate skills, templates, runtime, and manifests
npm run build      # Build dist/cadre-mcp.mjs
```

The test suite exercises state validation, interrupted operations, plan and learning invariants, marketplace packaging, MCP discovery and initialization, multi-track archival, and permission configuration. Before publishing a change, run:

```sh
npm run check
npm test
npm run validate
```
