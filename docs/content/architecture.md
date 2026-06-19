---
title: Architecture
description: Harness package layout, generated plugin bundles, source files, and development flow.
section: Internals
order: 5
---

# Architecture

This repository is the Cadre harness/package repository. It builds the runtime,
skills, references, templates, tests, and generated plugin bundles that users
install into Claude Code and OpenAI Codex.

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
│   ├── scripts/agent-refs/       # Master reference docs copied or sliced into plugins
│   ├── templates/                # Target-project templates and CI templates
│   ├── src/                      # TypeScript runtime, MCP, and LSP sources
│   ├── scripts/                  # Built JS runtime, generator, tests, helper scripts
│   ├── plugins/                  # Generated Claude and Codex plugin bundles
│   ├── .agents/                  # Generated Codex local skill/plugin artifacts
│   └── .claude/                  # Generated Claude local skill artifacts
├── .agents/plugins/marketplace.json
├── .claude-plugin/marketplace.json
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

Root `docs/` is the only public documentation source. The plugin bundles do not
depend on the retired harness documentation folder.

## Master Sources

Edit master sources, then regenerate generated output.

| Source | Owns |
|--------|------|
| `harness/skills/cadre/SKILL.md` | Cadre skill activation contract, workflow routing, lazy context, and required references. |
| `harness/skills/cadre/protocols/` | Master workflow protocol bodies for all `cadre-*` workflows. |
| `harness/scripts/agent-refs/` | Reference material bundled with plugin skills. Some files are platform-sliced. |
| `harness/templates/` | Files copied into target projects by `cadre-setup`. |
| `harness/src/` | TypeScript runtime, MCP server, LSP helpers, and core application logic. |
| `docs/` | Public Next.js/shadcn documentation website. |
| `docs/content/` | Markdown source for generated documentation routes. |
| `docs/public/` | Static assets served by the docs app. |

Generated outputs under `harness/.agents/`, `harness/.claude/`, and
`harness/plugins/` carry an `AUTO-GENERATED` marker and should not be edited by
hand.

## Generated Plugin Bundles

`harness/scripts/generate-skills.sh` builds platform-specific bundles from one
source of truth.

| Output | Purpose |
|--------|---------|
| `harness/plugins/cadre/` | OpenAI Codex plugin bundle. |
| `harness/plugins/cadre-claude/` | Claude Code plugin bundle. |
| `harness/.agents/skills/cadre/` | Harness-local Codex skill output. |
| `harness/.claude/skills/cadre/` | Harness-local Claude skill output. |
| `harness/.agents/plugins/marketplace.json` | Harness-local Codex marketplace. |
| `harness/.claude-plugin/marketplace.json` | Harness-local Claude marketplace. |
| root `.agents/plugins/marketplace.json` | Repo-root Codex marketplace shim. |
| root `.claude-plugin/marketplace.json` | Repo-root Claude marketplace shim. |

The generator:

- Copies the master skill into each platform bundle.
- Adds generated protocol preambles that require Cadre MCP.
- Substitutes the platform-specific worker dispatch sentence.
- Slices multi-platform references for Claude and Codex.
- Copies agnostic references such as Beads error handling and Beads integration.
- Copies templates into each plugin skill.
- Copies built JavaScript runtime files into each plugin.
- Rewrites marketplace shims for root and harness development paths.

## Runtime Build

Runtime JavaScript under `harness/scripts/` is built from TypeScript under
`harness/src/`.

```bash
cd harness
pnpm build
```

The default full validation command runs typecheck, runtime build, generated
bundle drift check, tests, and the team-scale simulation:

```bash
cd harness
pnpm check
```

## Development Flow

For harness changes:

1. Edit master source files.
2. Run targeted tests when the change is narrow.
3. Run `pnpm generate` when generated bundles need refresh.
4. Run `pnpm check` before handoff.

Useful commands:

```bash
cd harness
pnpm typecheck
pnpm build
pnpm generate
node --test scripts/protocol-packet-only.test.js
pnpm check
```

## Public Docs Flow

Root `docs/` is a static-export Next.js app. GitHub Pages deployment builds the
app from Markdown content in `docs/content/` and uploads `docs/out` through the
Pages artifact workflow. It intentionally does not require MkDocs, Docusaurus,
or another documentation framework.

When public documentation describes plugin internals, keep it aligned with the
master sources under `harness/`. When plugin instruction references are needed,
place them under `harness/scripts/agent-refs/` so generated bundles are
self-contained and independent from public docs.

## Versioning

Cadre uses semantic versioning:

| Bump | When |
|------|------|
| Major | Breaking changes to `cadre/` layout, workflow behavior, or Beads schema. |
| Minor | New workflows, platform support, or opt-in features. |
| Patch | Bug fixes and documentation. |

Per-release changes are recorded in `harness/CHANGELOG.md`.
