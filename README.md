<p align="center">
  <img src="docs/public/cadre-logo.png" alt="Cadre" width="360">
</p>

<p align="center"><strong>Measure twice, code once.</strong></p>

<p align="center">
  A context-driven development harness for AI coding agents.
</p>

Cadre gives OpenAI Codex and Claude Code a shared, packet-owned workflow for
spec-first delivery. It combines durable project context, native task memory,
review gates, repository-owned skills, parallel execution, team coordination,
and mono/polyrepo delivery without asking agents to maintain workflow state by
hand.

[Read the documentation](https://cadre-docs.pages.dev/) ·
[Start the quickstart](https://cadre-docs.pages.dev/quickstart/) ·
[Review the 2.1.0 notes](https://cadre-docs.pages.dev/release-notes/)

## What Cadre Provides

- **Structured delivery:** setup, track planning, implementation, review,
  ship/land, archive, release, handoff, refresh, and recovery workflows.
- **Durable context:** canonical product, workflow, pattern, technology, track,
  event, message, review, and trace state with generated human projections.
- **Repository-owned guidance:** workflow- and repository-targeted project
  skills, selected within explicit context budgets.
- **Safe collaboration:** ownership, advisory leases, collision scans, review
  queues, shared control-plane sync, and compact team/fleet views.
- **Code intelligence:** repository maps, dependency graphs, test impact,
  diagnostics, and optional LSP-assisted review.
- **Scalable execution:** dependency-aware worker waves, file claims,
  merge-back evidence, and monorepo or polyrepo delivery gates.

## What Is New in 2.1.0

Cadre 2.1.0 introduces a smaller, token-efficient public MCP contract centered
on three tools: `cadre_workflow`, `cadre_action`, and `cadre_read`. Workflow
packets now return compact decision envelopes and expose longer evidence through
targeted, lazy-loaded resources.

Repositories can also own project skills under `cadre/skills/<skill-id>/`.
Cadre selects those rules by workflow and optional repository target, keeps
required rules intact, and applies `project_skills.inline_rule_budget` only to
optional inline content. The new `cadre-skill` workflow manages and validates
that catalog.

The release also includes a complete responsive documentation system with
separate user/operator and contributor journeys, exhaustive workflow and
configuration references, full-body search, accessible navigation, and
mobile-friendly code and tables.

See the [detailed 2.1.0 release notes](docs/content/release-notes.md) and
[changelog](harness/CHANGELOG.md).

## Install or Upgrade

```bash
npm install -g cadre-ai@2.1.0
cadre install
cadre install --check
```

Restart clients that cache plugin or MCP configuration. Confirm that
`cadre@cadre` is installed and enabled at 2.1.0.

To remove generated client wiring:

```bash
cadre uninstall --target codex
```

## Use Cadre

In a target repository, activate the Cadre skill and follow the normal
lifecycle:

```text
$cadre
cadre-setup
cadre-newtrack "Add OAuth login"
cadre-implement
cadre-review
cadre-ship
cadre-archive
```

Use `cadre-land` instead of `cadre-ship` for a polyrepo control repository.
Cadre packets own the control plane, approvals, provider evidence, worker state,
and generated projections; agents summarize packet results rather than editing
that state by hand.

## Documentation

The public guide is organized for two audiences:

- **Users and operators:** [getting started](https://cadre-docs.pages.dev/getting-started/),
  [capabilities](https://cadre-docs.pages.dev/capabilities/),
  [configuration](https://cadre-docs.pages.dev/configuration/),
  [tuning](https://cadre-docs.pages.dev/tuning/),
  [operations](https://cadre-docs.pages.dev/operations/), and
  [troubleshooting](https://cadre-docs.pages.dev/troubleshooting/).
- **Contributors:** [architecture](https://cadre-docs.pages.dev/architecture/),
  [runtime and MCP](https://cadre-docs.pages.dev/runtime-and-mcp/),
  [workflow engine](https://cadre-docs.pages.dev/workflow-engine/),
  [state and artifacts](https://cadre-docs.pages.dev/state-and-artifacts/),
  [development](https://cadre-docs.pages.dev/development/), and
  [testing and release](https://cadre-docs.pages.dev/testing-and-release/).

Reference pages cover every public
[workflow](https://cadre-docs.pages.dev/workflow-reference/),
[configuration key](https://cadre-docs.pages.dev/configuration-reference/),
[MCP interface](https://cadre-docs.pages.dev/mcp-reference/), and
[project-skill field](https://cadre-docs.pages.dev/project-skill-reference/).

## Repository Layout

This is the Cadre harness/package repository, not an initialized target
project:

- [`harness/`](harness/) contains the runtime, protocols, skill shim, templates,
  installer, generated-runtime sources, and tests.
- [`docs/`](docs/) contains the canonical Next.js/shadcn documentation site;
  Markdown source lives in [`docs/content/`](docs/content/).
- [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) define harness
  development conventions.

Plugin and marketplace files are install-time artifacts produced by
`cadre install`; ignored harness-local copies are validation fixtures, not
source files.

## Develop

Install dependencies and validate the whole workspace from the repository
root:

```bash
pnpm install
pnpm check
```

For harness-only validation, run:

```bash
pnpm --filter cadre-ai check
```

Cadre is licensed under the terms in [`LICENSE`](LICENSE).
