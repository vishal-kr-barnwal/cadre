<p align="center">
  <img src="docs/public/cadre-logo.png" alt="Cadre" width="360">
</p>

<p align="center"><strong>Measure twice, code once.</strong></p>

<p align="center">
  A human-governed, Git-aware delivery harness for OpenAI Codex, Claude Code, and Zed Agent (beta).
</p>

Cadre turns approved project context into resumable feature and bug tracks. It
combines specification, dependency-aware planning, parallel implementation,
manual verification, review, revision, refresh, revert, archive, and Git
provenance without asking an agent to invent workflow state.

**Documentation:** [cadre-docs.pages.dev](https://cadre-docs.pages.dev/) ·
[Start the quickstart](https://cadre-docs.pages.dev/quickstart/) ·
[Review release notes](https://cadre-docs.pages.dev/release-notes/)

**Cadre 3.8.0** makes **Track** the default approval mode and adds continuous **Autonomous** implementation, verification, review, and remediation until clean. Parallel remains the scheduling default; Sequential works with every approval mode. The author makes the final completion decision. Template set **v4** preserves v1–v3; existing projects require an approved refresh, and legacy Autonomous executions require an explicit Track-or-Autonomous migration choice.

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

Cadre supports OpenAI Codex and Claude Code as stable integrations. Native Zed
Agent support is available in beta at user scope:

```bash
npm install -g cadre-ai
cadre-ai doctor
cadre-ai install
```

`cadre-ai install` auto-detects installed clients. Use `--target codex`,
`--target claude`, `--target zed`, or `--target all` to choose explicitly.
Start a new client conversation after installation; in Claude Code, run
`/reload-plugins` first.

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

# Zed Agent (beta)
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
