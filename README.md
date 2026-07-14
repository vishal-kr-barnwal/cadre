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
[Review the 2.2.0 notes](https://cadre-docs.pages.dev/release-notes/)

## What Cadre Provides

- **Structured delivery:** setup, track planning, implementation, review,
  ship/land, archive, release, handoff, refresh, and recovery workflows.
- **Codex command discovery:** explicit picker entries expose every workflow as
  `$cadre:*` without expanding Cadre's three-tool MCP surface.
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

## What Is New in 2.2.0

Cadre 2.2.0 makes reviewed documents atomic. Canonical JSON or JSONL and its
human-facing Markdown projection are frozen as one pair, the first target-mode
review writes the complete deterministic workflow diff, and approval sessions
detect drift before execution. Setup also generates the missing technology and
polyrepo topology projections.

The MCP runtime now enforces the three-tool v1 contract end to end. Legacy
aliases are gone, lifecycle and resource discovery follow typed protocol
contracts, continuations are exact, and parallel workers, persisted jobs, and
capability-bound project-skill reads fail closed when state is stale or unsafe.
LSP and DAP configuration paths are also confined to project-owned files before
any external command can start.

The published package is leaner: obsolete standalone worker/daemon bundles,
flat compatibility shims, embedded maintainer-only contracts, and dead scripts
have been removed while regression coverage now exercises lifecycle, packet,
resource, approval, parallel, job, and path-security boundaries.

Codex installs also expose explicit workflow entries in the command picker.
Type `$cadre:` to choose setup, status, implementation, review, release, or any
other Cadre workflow directly; these entries are thin activation shims, not
additional MCP tools.

See the [detailed 2.2.0 release notes](docs/content/release-notes.md) and
[changelog](harness/CHANGELOG.md).

## Install or Upgrade

```bash
npm install -g cadre-ai@2.2.0
cadre install
cadre install --check
```

Restart clients that cache plugin or MCP configuration. Confirm that
`cadre@cadre` is installed and enabled at 2.2.0.

To remove generated client wiring:

```bash
cadre uninstall --target codex
```

## Use Cadre

In Codex, type `$cadre:` and choose a workflow entry directly:

```text
$cadre:setup
$cadre:newtrack Add OAuth login
$cadre:implement
$cadre:review
$cadre:ship
$cadre:archive
```

Codex exposes only the workflow entries, avoiding a redundant
`$cadre:cadre` option. In Claude Code, Copilot, and Antigravity, activate the
single Cadre skill and ask for the same workflow by its `cadre-*` name.

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
