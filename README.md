<p align="center">
  <img src="docs/public/cadre-logo.png" alt="Cadre" width="360">
</p>

<p align="center"><strong>Measure twice, code once.</strong></p>

<p align="center">
  A human-governed, Git-aware delivery harness for OpenAI Codex, Claude Code, and Zed Agent.
</p>

Cadre turns approved project context into resumable feature and bug tracks. It
combines specification, dependency-aware planning, parallel implementation,
manual verification, review, revision, refresh, revert, archive, and Git
provenance without asking an agent to invent workflow state.

**Documentation:** [cadre-docs.pages.dev](https://cadre-docs.pages.dev/) ·
[Start the quickstart](https://cadre-docs.pages.dev/quickstart/) ·
[Review release notes](https://cadre-docs.pages.dev/release-notes/)

**Cadre 4.0.0** simplifies the runtime around one receipt-based mutation path
and the current v6 template catalog. All ten workflows, four approval modes,
both scheduling modes, and stable Codex, Claude Code and Zed integrations remain
available. Install [cadre-ai from npm](https://www.npmjs.com/package/cadre-ai).

## What changes in 4.0.0

- **One recovery contract:** initialization, implementation completion, clean
  review and archive use immutable operation receipts. Commit each operation
  once, then reconcile its receipt; no follow-up commit is needed to record its SHA.
- **Smaller public surface:** 22 MCP tools and only template v6 in the installed
  payload. Direct integrations must stop calling `archive_batch_record`,
  `setup_record_commit` and `setup_record_git_initialized`.
- **Existing projects:** 3.9.0/3.9.1/3.9.2 projects with schema-2 state and v5
  templates continue without a project migration or version-only refresh.
  Historical journals, approval evidence and interrupted receipt recovery remain
  supported.
- **Older formats:** `PROJECT_UPGRADE_REQUIRED` provides the bridge route:
  install Cadre 3.9.0, reconcile interrupted work and run its approved refresh to
  schema-2/v5, then install 4.0.0 and reload the client. Never change version labels
  by hand. See the [release notes](https://cadre-docs.pages.dev/release-notes/).

Verification passed 480 harness tests and a dummy-project lifecycle across 14
fresh Codex sessions: brownfield create, interrupted track drafting, active
revision, review/remediation, manual-edit freshness checks, archive recovery and
refresh. The dummy app passed 26 tests and 200,020 arithmetic comparisons. Native
workflow coverage was Autonomous/sequential; it does not establish exhaustive
coverage of every mode or client. See the [native lifecycle report](docs/development/cadre-4.0.0-native-flow.md).

## Upcoming roadmap

Three optional capabilities are planned beyond 4.0.0:

1. **Deeper GitHub / GitLab integration** for coordinating work across multiple
   people, including shared work status, ownership and review handoffs.
2. **A knowledge base built as work happens**, capturing decisions and learning
   during delivery and using relevant knowledge as context for subsequent work.
3. **Polyrepo support** for coordinating dependencies and delivery across
   multiple repositories while retaining per-repository history and approvals.

Each capability will be independently **opt-in and disabled by default**. The
core single-repository workflow will remain usable without enabling any of them.
These are upcoming roadmap items, not features shipped in 4.0.0; no delivery dates
are committed. See the [roadmap](https://cadre-docs.pages.dev/team-and-polyrepo/).

## What Cadre Provides

- **Human-governed delivery:** approved scope and approval policy govern execution;
  clean track completion always requires the author’s explicit approval.
- **Resumable state:** setup, track, execution, review, revision, refresh,
  revert, and archive checkpoints survive interrupted sessions.
- **Spec-first tracks:** feature and bug specifications lead to validated
  phase/task dependency graphs with derived manual-verification barriers.
- **Safe parallel execution:** bounded workers operate in isolated Git
  worktrees while the main agent alone schedules, integrates, resolves
  conflicts, updates Cadre state, and records approval.
- **Incremental learning:** phase learning and durable patterns flow forward
  through dependency-aware seeds and archive distillation.
- **Typed runtime:** a bundled MCP server provides immutable templates,
  validation, digest-gated state transitions, and constrained worktree
  operations.

## Install

Cadre supports OpenAI Codex, Claude Code, and native Zed Agent as stable
integrations at user scope:

```bash
npm install -g cadre-ai
cadre-ai doctor
cadre-ai install
```

`cadre-ai install` auto-detects installed clients. Use `--target codex`,
`--target claude`, `--target zed`, or `--target all` to choose explicitly.
Start a new client conversation after installation; in Claude Code, run
`/reload-plugins` first. In Zed, run `workspace: reload` from the command palette,
then open a new Agent thread.

## Use Cadre

Cadre commands are agent skills rather than shell subcommands:

```text
# Codex
$cadre:create
$cadre:track Add passwordless login as a feature
$cadre:implement passwordless-login
$cadre:review passwordless-login
$cadre:archive passwordless-login

# Claude Code
/cadre:create
/cadre:track Add passwordless login as a feature
/cadre:implement passwordless-login
/cadre:review passwordless-login
/cadre:archive passwordless-login

# Zed Agent
/cadre-create
/cadre-track Add passwordless login as a feature
/cadre-implement passwordless-login
/cadre-review passwordless-login
/cadre-archive passwordless-login
```

The complete workflow set is `create`, `track`, `implement`, `review`,
`revise`, `archive`, `refresh`, `revert`, `status`, and `wisp`.

An initialized target project keeps approved mutable delivery state under
`.cadre/`. The installed payload retains the runtime, skills, worker
definitions, and immutable templates.

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

## Repository Layout

This is the Cadre harness/package repository, not an initialized target
project:

- [`harness/`](harness/) contains the TypeScript runtime, installer, workflow
  skills, worker definitions, versioned templates, plugin manifests, and tests.
- [`docs/`](docs/) contains the canonical Next.js/shadcn documentation site;
  Markdown source lives in [`docs/content/`](docs/content/).
- [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) define current harness
  development conventions.

The tracked plugin manifests and marketplace catalogs are source files.
`harness/dist/` and the installed marketplace under
`~/.cadre/marketplaces/cadre` are generated.

## Develop

From the repository root:

```bash
pnpm install
pnpm check
```

Focused harness validation:

```bash
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
```

Cadre is licensed under the terms in [`LICENSE`](LICENSE).

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
