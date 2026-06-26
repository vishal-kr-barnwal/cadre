---
title: Architecture
description: Harness package layout, thin install-time plugin bundles, source files, and development flow.
section: Internals
order: 5
---

# Architecture

This repository is the Cadre harness/package repository. It builds the runtime,
skill shim, MCP-served contracts, references, templates, tests, and install-time
thin plugin bundles that users install into Claude Code, OpenAI Codex, GitHub
Copilot, and Google Antigravity.

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
│   ├── scripts/agent-refs/       # Master references embedded into cadre-mcp
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
| `harness/skills/cadre/SKILL.md` | Cadre skill activation shim that points agents at MCP contract resources. |
| `harness/skills/cadre/skill.json` | Master `cadre.skill.v1` contract embedded into `cadre-mcp` and served by MCP resources. |
| `harness/skills/cadre/protocols/` | Master workflow protocol bodies embedded into `cadre-mcp` and served by MCP resources. |
| `harness/scripts/agent-refs/` | Reference material embedded into `cadre-mcp` and served by MCP reference resources. |
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
- Embeds the skill contract, workflow protocols, references, and templates into
  `scripts/mcp/cadre-server.js`.
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
place them under `harness/scripts/agent-refs/` so `cadre-mcp` can serve them as
resources independent from public docs.

## Versioning

Cadre uses semantic versioning:

| Bump | When |
|------|------|
| Major | Breaking changes to `cadre/` layout, workflow behavior, or native state schema. |
| Minor | New workflows, platform support, or opt-in features. |
| Patch | Bug fixes and documentation. |

Per-release changes are recorded in `harness/CHANGELOG.md`.
