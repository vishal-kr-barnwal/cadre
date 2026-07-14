---
title: Architecture
description: Harness package layout, thin install-time plugin bundles, source files, and development flow.
section: Contributor Guide
order: 140
---

# Architecture

This repository is the Cadre harness/package repository. It builds the runtime,
skill shim, source workflow metadata, setup templates, tests, and install-time
thin plugin bundles that users install into Claude Code, OpenAI Codex, GitHub
Copilot, and Google Antigravity.

The installed Cadre `SKILL.md` is a self-contained activation shim for the MCP
runtime. A target repository may separately own `cadre/skills/<id>/skill.json`
manifests with optional `SKILL.md` human projections. Those project skills are discovered from the active control repo,
selected by workflow and repo context, and returned through MCP packets and
resources; they are not installed or resolved globally.

## Repository Shape

```text
.
├── docs/                         # Public Next.js/shadcn docs website
│   ├── app/                      # App Router routes and homepage
│   ├── components/               # Docs shell, Markdown renderer, shadcn UI
│   ├── content/                  # Markdown documentation source
│   └── public/                   # Static assets such as the Cadre logo
├── harness/
│   ├── skills/cadre/             # Master skill and workflow protocols
│   ├── scripts/agent-refs/       # Maintainer reference sources
│   ├── templates/                # Target-project templates and CI templates
│   ├── src/                      # TypeScript runtime, MCP, and LSP sources
│   └── scripts/                  # Built JS runtime, generator, tests, helper scripts
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

Root `docs/` is the only public documentation source. The plugin bundles do not
depend on the retired harness documentation folder.

## Master Sources

Edit master sources, then run generation or install commands when plugin shells
need to be materialized.

| Source | Owns |
|--------|------|
| `harness/skills/cadre/SKILL.md` | Self-contained packet-led Cadre activation shim. |
| `harness/skills/cadre/skill.json` | Maintainer-facing `cadre.skill.v1` source contract used by source validation. |
| `harness/skills/cadre/protocols/` | Compact maintainer-facing workflow protocol definitions used by source validation and documentation. |
| `harness/scripts/agent-refs/` | Maintainer reference sources for workflow and source-contract validation. |
| `harness/templates/` | Target-project templates embedded into `cadre-mcp` and written by `cadre-setup`. |
| `harness/src/` | TypeScript runtime, MCP server, LSP helpers, and core application logic. |
| `docs/` | Public Next.js/shadcn documentation website. |
| `docs/content/` | Markdown source for generated documentation routes. |
| `docs/public/` | Static assets served by the docs app. |

Generated plugin and marketplace outputs under `harness/.agents/`,
`harness/.claude/`, `harness/.claude-plugin/`, and `harness/plugins/` are
ignored local validation fixtures. User-facing copies are written by
`cadre install`.

## Install-Time Plugin Bundles

`harness/scripts/generate-skills.sh` builds platform-specific bundles from one
source of truth for local validation. The published `cadre-ai` package writes
the same thin plugin shape through `cadre install`.

| Output | Purpose |
|--------|---------|
| `harness/plugins/cadre/` | OpenAI Codex plugin bundle. |
| `harness/plugins/cadre-claude/` | Claude Code plugin bundle. |
| `harness/plugins/cadre-copilot/` | GitHub Copilot CLI plugin bundle. |
| `harness/plugins/cadre-antigravity/` | Google Antigravity plugin bundle. |
| `harness/.agents/skills/cadre/` | Harness-local Codex skill output. |
| `harness/.claude/skills/cadre/` | Harness-local Claude skill output. |
| `harness/.agents/plugins/marketplace.json` | Harness-local Codex marketplace. |
| `harness/.claude-plugin/marketplace.json` | Harness-local Claude marketplace. |
| generated root `.agents/plugins/marketplace.json` | Repo-root Codex marketplace path in local fixtures. |
| generated root `.claude-plugin/marketplace.json` | Repo-root Claude marketplace path in local fixtures. |

The generator:

- Copies the master `SKILL.md` shim into each platform bundle.
- Writes platform MCP configs that point at the global `cadre-mcp` runtime.
- Keeps plugins thin: no copied assets, scripts, or platform worker agents.
- Embeds only runtime setup templates into `scripts/mcp/cadre-server.js`; skill
  contracts, workflow protocols, and maintainer references stay out of the
  published MCP bundle.
- Uses MCP-provided worker prompts for parallel dispatch; Claude uses `Task`,
  Codex uses multi-agent tool discovery, Copilot uses its custom-agent flow, and
  Antigravity uses subagent dispatch from the parallel execution reference.
- Rewrites marketplace files in the selected generated or install location.

## Runtime Build

Runtime JavaScript under `harness/scripts/` is built from TypeScript under
`harness/src/`.

```bash
pnpm --filter cadre-ai build
```

The default full validation command runs typecheck, runtime build, generated
bundle production checks, tests, and the team-scale simulation:

```bash
pnpm --filter cadre-ai check
```

## Development Flow

For harness changes:

1. Edit master source files.
2. Run targeted tests when the change is narrow.
3. Run `pnpm --filter cadre-ai generate` when local plugin fixtures need
   validation.
4. Run `pnpm --filter cadre-ai check` before handoff.

Useful commands:

```bash
pnpm --filter cadre-ai typecheck
pnpm --filter cadre-ai build
pnpm --filter cadre-ai generate
pnpm --filter cadre-ai exec node --test scripts/protocol-packet-only.test.js
pnpm --filter cadre-ai check
```

## Public Docs Flow

Root `docs/` is a static-export Next.js app. The release workflow runs only
when a GitHub release is published; it publishes the `cadre-ai` npm package,
then builds the app from Markdown content in `docs/content/` and deploys the
generated `docs/out` artifact to Cloudflare Pages through Wrangler Direct
Upload. It creates the Pages project on first deploy when needed and
intentionally does not require MkDocs, Docusaurus, or another documentation
framework.

When public documentation describes plugin internals, keep it aligned with the
master sources under `harness/`. When plugin instruction references are needed,
place maintainer-only validation inputs under `harness/scripts/agent-refs/`.
They are source fixtures and are not served by `cadre-mcp` as resources.

## Versioning

Cadre uses semantic versioning:

| Bump | When |
|------|------|
| Major | Breaking changes to `cadre/` layout, workflow behavior, or native state schema. |
| Minor | New workflows, platform support, or opt-in features. |
| Patch | Bug fixes and documentation. |

Per-release changes are recorded in `harness/CHANGELOG.md`.
