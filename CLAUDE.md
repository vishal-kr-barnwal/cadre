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
- `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` define the root
  workspace for `harness/` and `docs/`.
- `docs/` contains the canonical public Next.js/shadcn docs site, with
  Markdown source under `docs/content/`.
- `.agents/plugins/marketplace.json` points Codex to
  `harness/plugins/cadre`.
- `.claude-plugin/marketplace.json` points Claude Code to
  `harness/plugins/cadre-claude`.
- `AGENTS.md` and `CLAUDE.md` describe harness development behavior.

## Development Rules

Run workspace commands from the repository root:

```bash
pnpm install
pnpm check
```

For harness-only validation, run `pnpm --filter cadre-ai check`.

Edit master sources only:

- `harness/skills/cadre/SKILL.md`
- `harness/skills/cadre/protocols/`
- `harness/scripts/agent-refs/`
- `harness/templates/`
- `harness/src/`
- root `docs/` for public documentation

Regenerate derived bundles with:

```bash
pnpm --filter cadre-ai generate
```

Runtime JavaScript under `harness/scripts/` and `harness/templates/scripts/`
is generated from TypeScript under `harness/src/` by
`pnpm --filter cadre-ai build`.

## TypeScript Architecture Guidelines

For future TypeScript work in `harness/src/`, preserve the current
SOLID/DDD-style module boundaries:

- Keep domain code pure and free of Node.js, MCP, or presentation imports.
- Keep infrastructure concerns such as filesystem, Git, process execution,
  locking, and generated artifact plumbing outside domain modules.
- Keep application modules focused on one bounded capability such as workflows,
  tracks, artifacts, review, parallel execution, status, project setup, or
  workspace intelligence.
- Prefer reusable helpers, ports, and typed contracts over duplicating logic
  across workflow or MCP packet handlers.
- Preserve strict TypeScript safety. Avoid broad `JsonObject`/`unknown` usage
  inside business logic; normalize untrusted data at boundaries and use explicit
  interfaces, literal unions, and exhaustiveness checks where practical.
- Do not introduce large TypeScript source files. Keep `harness/src/**/*.ts`
  files at or below 500 lines and split growing files into smaller cohesive
  modules before they exceed that threshold.

## Commit Policy

When the user asks for implementation commits, create small local commits with
clear messages. Do not push unless explicitly requested. Preserve unrelated
worktree changes and never rewrite existing user work without instruction.
