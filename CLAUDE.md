# Harness Context (CLAUDE.md)

This file provides Claude Code guidance for working in this repository. Codex
reads `AGENTS.md`, which mirrors these root-level conventions.

This repository builds and packages the Cadre harness. It is not itself a
Cadre-enabled target project. Do not create or mutate a root `cadre/` directory
unless the user explicitly asks to test setup behavior in a fixture.

## Repository Shape

Cadre implementation lives under `harness/`:

```text
harness/
├── skills/cadre/          # Master skill and workflow protocols
├── src/                   # TypeScript runtime, MCP, and LSP sources
├── scripts/               # Runtime bundles, tests, generators, references
├── templates/             # Project templates and CI templates
├── plugins/               # Generated Codex and Claude plugin bundles
├── .agents/               # Generated Codex skill/plugin artifacts
└── .claude/               # Generated Claude skill artifacts
```

Root files are intentionally thin:

- `README.md` points to `harness/` and the public docs.
- `docs/` contains the canonical public GitHub Pages Markdown docs.
- `.agents/plugins/marketplace.json` points Codex to
  `harness/plugins/cadre`.
- `.claude-plugin/marketplace.json` points Claude Code to
  `harness/plugins/cadre-claude`.
- `AGENTS.md` and `CLAUDE.md` describe harness development behavior.

## Development Rules

Run package commands from `harness/`:

```bash
cd harness
pnpm check
```

Edit master sources only:

- `harness/skills/cadre/SKILL.md`
- `harness/skills/cadre/protocols/`
- `harness/scripts/agent-refs/`
- `harness/templates/`
- `harness/src/`
- root `docs/` for public documentation

Regenerate derived bundles with:

```bash
cd harness
pnpm generate
```

Runtime JavaScript under `harness/scripts/` and `harness/templates/scripts/`
is generated from TypeScript under `harness/src/`.

## Commit Policy

When the user asks for implementation commits, create small local commits with
clear messages. Do not push unless explicitly requested. Preserve unrelated
worktree changes and never rewrite existing user work without instruction.
