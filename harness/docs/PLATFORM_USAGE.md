# Cadre Platform Usage Guide

Cadre is a packet-owned workflow layer for AI-assisted development. It records
project context, tracks, task plans, Beads memory, review evidence, and team
coordination state in a repo-local control plane.

Use this guide for the operating model. Use `INSTALL.md` for plugin
installation, `POLYREPO.md` for cross-repo topology, and `MCP_LSP.md` for code
intelligence details.

## Operating Model

The normal lifecycle is:

```text
setup -> newtrack -> implement -> review -> ship/land -> archive -> release
```

Agents run these as Cadre workflow packets through the installed MCP server.
Every project-scoped packet includes `root`, and compact responses are preferred
unless a workflow needs `responseMode: "detail"`.

## Project Files

Setup creates the durable project context:

| File | Purpose |
|------|---------|
| `cadre/product.md` | Product goals, users, workflows, and constraints. |
| `cadre/tech-stack.json` | Structured languages, frameworks, package managers, build/test commands, and platforms. |
| `cadre/workflow.md` | Development, verification, review, and commit expectations. |
| `cadre/patterns.md` | Reusable learnings promoted from completed tracks. |
| `cadre/learnings.md` | Project-level learning journal. |
| `cadre/tracks.md` | Derived human index rebuilt by Cadre packets. |
| `cadre/beads.json` | Beads integration settings. |
| `cadre/config.json` | Sync mode, provider mode, review, and quality settings. |
| `cadre/repos.json` | Polyrepo topology when enabled. |
| `cadre/lsp.json` | Optional LSP server recommendations and workspace folders. |

Track directories contain `metadata.json`, `spec.md`, `plan.md`,
`learnings.md`, and optional handoff/revision artifacts. Track metadata is the
source of truth for status and ownership.

## Beads

Beads is required for executing setup. Cadre initializes and configures Beads
state, then agents use Cadre packets for Beads-backed work. Day-to-day workflows
do not require agents to operate the Beads CLI directly.

## Team Scale

For teams of 10-20 people, choose shared sync during setup. Shared mode lets
teammates see owners, leases, review queues, blockers, and available work while
keeping product-code publication inside ship/land workflows.

Useful compact resources:

- `cadre://team-board`
- `cadre://my-next-actions`
- `cadre://review-queue`
- `cadre://handoff-inbox`
- `cadre://quality-gate`
- `cadre://parallel-state`
- `cadre://repo-topology`

## Monorepo And Polyrepo

Monorepo mode is the default when no `cadre/repos.json` exists. Use `cadre-ship`
for provider publication planning and evidence write-back.

Polyrepo mode uses a control repo with product repos listed in
`cadre/repos.json`. Use `cadre-land` for cross-repo provider action planning,
repo-scoped quality evidence, and merge-train coordination.

## Parallel Work

Plans can mark phases as parallel with task file annotations. Cadre dispatches
only tasks whose phase dependencies, task dependencies, worker state, and file
claims are ready. Sequential phases dispatch one unfinished task at a time.

Workers move through `in_progress`, `awaiting_merge`, `merged`, `failed`, or
`conflict`. Cleanup only removes merged workers unless force is explicit.

## Code Intelligence

Use `cadre_intel` and compact resources for repo-aware evidence:

- repo map and symbol search
- dependency graph
- workspace diagnostics
- test impact
- LSP setup, impact, review, warm daemon status, and async job results

Polyrepo results are repo-qualified so control-plane files and product-repo
files remain distinguishable.

## Provider Evidence

Hosted provider state is evidence, not Cadre state. GitHub/GitLab evidence comes
through official provider MCPs and is written back to Cadre review, ship, or
land packets. Local review may return `pending_provider`; ship/land remain
closed until required hosted evidence is present.
