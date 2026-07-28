---
title: Architecture
description: Package layout, plugin assembly, runtime boundaries, and generated artifacts.
section: Contributor Guide
order: 140
---

# Architecture

Cadre 3.0 is one publishable TypeScript package that installs native user
plugins for Codex and Claude Code. The target repository stores delivery state,
not runtime code.

## Repository Layout

```text
harness/
├── skills/<workflow>/
│   ├── SKILL.md
│   └── agents/openai.yaml
├── agents/
│   ├── cadre-phase-worker.md
│   └── cadre-task-worker.md
├── src/
│   ├── domain/
│   └── mcp/server.ts
├── scripts/
├── templates/v1/
├── test/
├── .codex-plugin/plugin.json
├── .claude-plugin/plugin.json
├── .mcp.codex.json
├── .mcp.json
└── marketplace/
```

Root `docs/` is the public Next.js documentation site. Root workspace files
coordinate the `cadre-ai` and `cadre-docs` packages.

## Source Boundaries

| Path | Responsibility |
|---|---|
| `skills/*/SKILL.md` | Human-facing workflow, approval, recovery, and tool-use contracts. |
| `skills/*/agents/openai.yaml` | Explicit Codex picker metadata. |
| `agents/` | Claude phase/task worker isolation contracts. |
| `src/domain/templates.ts` | Immutable template catalog and styleguide resolution. |
| `src/domain/init.ts` | Digest-gated project initialization and setup checkpoints. |
| `src/domain/state.ts` | Project discovery, validation, status, and derived track index. |
| `src/domain/plan.ts` | Plan parsing and DAG/manual-barrier validation. |
| `src/domain/execution.ts` | Execution journals, node transitions, and finish gating. |
| `src/domain/worktrees.ts` | Constrained worktree creation, integration, status, and cleanup. |
| `src/domain/governance.ts` | Review completion and archive-batch governance. |
| `src/mcp/server.ts` | MCP server instructions, resource registration, schemas, and tool adapters. |
| `scripts/` | Build, CLI, installation, uninstall, permissions, packaging, and source validation. |
| `templates/v1/` | Versioned project, track, operation, and styleguide templates. |

The domain directory currently includes filesystem and Git-aware behavior; it
is not a pure dependency-free DDD layer. Preserve the real capability
boundaries rather than imposing an architecture the source does not have.

## Build Outputs

`pnpm --filter cadre-ai build` uses esbuild to create two ignored bundles:

- `dist/cadre-cli.mjs` — executable installer/doctor/uninstaller;
- `dist/cadre-mcp.mjs` — self-contained stdio MCP server.

Both target Node.js 18 and bundle their runtime dependencies. The published
package declares no production dependencies.

Never edit `dist/` directly.

## Plugin Sources And Installed Marketplace

The tracked `.codex-plugin/`, `.claude-plugin/`, MCP configs, skills, agents,
templates, and marketplace catalogs are package sources.

At installation time, `packagePluginMarketplace` copies those sources plus the
built MCP bundle into `~/.cadre/marketplaces/cadre/plugins/cadre`. It creates
Codex and Claude marketplace roots and adds product-specific SemVer build
metadata as a cache-buster. The package version remains unchanged.

The prior owned marketplace payload is renamed to a timestamped backup before
the replacement is activated.

## Client Differences

Codex discovers skills from the plugin manifest and uses `.mcp.codex.json` to
run `node ./dist/cadre-mcp.mjs` with plugin-root cwd. Claude discovers the same
skills through its plugin namespace, loads worker agent definitions, and uses
`${CLAUDE_PLUGIN_ROOT}/dist/cadre-mcp.mjs` from `.mcp.json`.

Both clients operate the same workflow and state contracts. Client-specific
metadata does not create different lifecycle semantics.

## Safety Architecture

- Every project root is canonicalized and broad roots are rejected.
- Templates are immutable and addressed by versioned logical IDs/resources.
- Deterministic mutations bind their exact proposal to a SHA-256 digest.
- Multi-step workflow mutations journal before artifact or Git changes.
- Worktree Git operations use derived paths/branches and refuse unsafe cleanup.
- The main agent is the sole scheduler, integrator, conflict resolver, Cadre
  state writer, and recorder of human approval.
- The runtime does not expose arbitrary shell execution or general file edits.
