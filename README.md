<p align="center">
  <img src="docs/public/cadre-logo.png" alt="Cadre" width="360">
</p>

<p align="center"><strong>Measure twice, code once.</strong></p>

<p align="center">
  A human-governed, Git-aware delivery harness for OpenAI Codex, Claude Code, and Zed Agent (beta).
</p>

Cadre turns approved project context into resumable feature, bug, and governed
operation tracks. It combines specification, dependency-aware planning, parallel
implementation, manual verification, review, revision, refresh, revert, archive,
and Git provenance without asking an agent to invent workflow state.

**Documentation:** [cadre-docs.pages.dev](https://cadre-docs.pages.dev/) ·
[Start the quickstart](https://cadre-docs.pages.dev/quickstart/) ·
[Review release notes](https://cadre-docs.pages.dev/release-notes/)

**Current source** uses v6 projects with cohesive task commits, verified operation receipts, approved dependency context, and retained-context tokens. Track remains the default approval mode; Parallel remains the default scheduling mode. Existing projects migrate through one approved refresh at a quiescent boundary. Historical SHA records, execution contracts, and immutable v1–v5 templates remain supported.


## What Cadre Provides

- **Human-governed delivery:** approved scope and approval policy govern execution;
  clean track completion always requires the author’s explicit approval.
- **Resumable state:** setup, track, execution, review, revision, refresh,
  revert, and archive checkpoints survive interrupted sessions.
- **Spec-first tracks:** feature, bug, and governed operation specifications lead to validated
  phase/task dependency graphs with derived manual-verification barriers.
- **Governed operations:** rollouts, migrations, maintenance, recovery, and
  infrastructure or service changes use the ordinary track lifecycle; humans
  perform every external action and Cadre records their evidence.
- **Evidence discipline:** on every track, claims rest on sources that were
  read, evidence records use explicit time zones, and verification records
  baseline and delta against an approved verification profile.
- **Safe parallel execution:** bounded workers operate in isolated Git
  worktrees while the main agent alone schedules, integrates, resolves
  conflicts, updates Cadre state, and records approval.
- **Incremental learning:** phase learning and durable patterns flow forward
  through dependency-aware seeds and archive distillation.
- **Typed runtime:** a bundled MCP server provides immutable templates,
  validation, digest-gated state transitions, and constrained worktree
  operations.
- **Capability reporting:** `cadre-ai doctor` reports each client's capability
  tier, profile, and local setup evidence without changing anything; other
  agents receive only a read-only guide-only block.

## What's new since 3.9.0

The current source adds no workflow skill, client, or MCP tool. The ten
workflows, the 25 MCP tools, and the Codex, Claude Code, and Zed Agent (beta)
integrations are unchanged. The `track` skill now also creates `operation`
tracks, and the `cadre-ai` CLI gains `guide` and a richer `doctor`.

- **Operation tracks** govern rollouts, migrations, maintenance, recovery, and
  infrastructure or service changes through the same track → implement →
  review → archive lifecycle. Humans perform every external action; Cadre
  records structured evidence and never executes or attests an external
  action. The specification needs meaningful values for operational
  readiness, planned preflight/rollout/postflight evidence capture,
  monitoring, abort/rollback/recovery, and residual risk. Blank or placeholder
  values fail validation. See [Workflows](https://cadre-docs.pages.dev/workflows/)
  and [Operations](https://cadre-docs.pages.dev/operations/).
- **Evidence and verification discipline** applies to every track: grounding
  before claims, evidence records with explicit time zones, and
  baseline-and-delta verification against an approved verification profile in
  `.cadre/tech-stack.md`. Plans classify reversibility and keep each
  irreversible or destructive step as its own named task; the plan approval
  covers it, it runs under the persisted approval mode, and a changed target or
  consequence goes through `revise` first. Cadre also changes theory after two
  failed attempts, never infers approval, classifies feedback, applies a
  clarification gate, and treats external content, including host web search
  results, as untrusted. See
  [How Cadre Works](https://cadre-docs.pages.dev/how-cadre-works/).
- **Capability tiers:** Codex and Claude Code are `full`; Zed Agent is
  `managed` (beta). `guide-only` and `unverified` exist only for reporting and
  are never install targets. The read-only `cadre-ai doctor` reports package
  health and each client's tier, capability profile, and local setup evidence.
  See [Installation](https://cadre-docs.pages.dev/getting-started/).
- **Guide-only fallback:** `cadre-ai guide` prints a read-only,
  `AGENTS.md`-compatible block. Added to a project's `AGENTS.md`, it instructs
  an agent without the Cadre MCP to only read and explain `.cadre/` content as
  unvalidated, never to mutate Cadre state, and never to claim lifecycle
  outcomes. It is not a Cadre integration.
- **Template set v6:** new projects use v6, and published v1–v5 templates
  remain readable and unchanged. Existing projects migrate through one approved
  refresh at a quiescent boundary; refreshing a v1 or v2 project with active
  tracks also requires explicitly reseeded Pattern Seed learning.
- **Agent Skills conformance:** canonical skills and generated Zed adapters are
  validated against the Agent Skills specification.

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

`cadre-ai doctor` reports each client's capability tier, capability profile, and
local setup evidence without changing anything. Other agents are not Cadre
integrations: `cadre-ai guide` prints a read-only guide-only block for a
project's `AGENTS.md`, with no stateful Cadre support.

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

Operation tracks start from the same `track` skill and then use the same
`implement`, `review`, and `archive` commands:

```text
# Codex
$cadre:track Roll out the orders database migration as an operation

# Claude Code
/cadre:track Roll out the orders database migration as an operation

# Zed Agent (beta)
/cadre-track Roll out the orders database migration as an operation
```

Humans perform every external action in an operation track; Cadre records the
evidence they supply and never executes or attests it.

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
