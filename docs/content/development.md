---
title: Development
description: Work safely in the Cadre harness and documentation workspace.
section: Contributor Guide
order: 170
---

# Development

This repository builds the Cadre package. It is not itself a Cadre-initialized
target project. Do not create a root `.cadre/` unless a fixture explicitly tests
project creation.

## Install The Workspace

```bash
pnpm install --frozen-lockfile
```

The root workspace contains `harness/` and `docs/`.

## Common Commands

```bash
pnpm check                         # Harness and docs checks
pnpm --filter cadre-ai check       # TypeScript only
pnpm --filter cadre-ai test        # Build and all harness tests
pnpm --filter cadre-ai validate    # Build and package-source validation
pnpm --filter cadre-ai build       # Build the two dist bundles
pnpm --filter cadre-docs check     # Content, lint, types, and static build
pnpm --filter cadre-docs dev       # Local documentation server
```

## Edit Source Files

Primary sources are:

- `harness/skills/*/SKILL.md` and `agents/openai.yaml`;
- `harness/agents/` worker definitions;
- `harness/src/domain/` and `harness/src/mcp/`;
- `harness/scripts/*.ts`;
- `harness/templates/v1/`;
- tracked plugin manifests, MCP configs, and marketplace catalogs;
- `harness/test/`;
- `docs/content/` and the docs application.

`harness/dist/` and `node_modules/` are generated and ignored. The installed
marketplace under `~/.cadre/marketplaces/cadre` is also generated. Never make a
source fix only in those outputs.

## TypeScript Conventions

- Read an existing file and its direct callers/tests/templates before editing.
- Normalize MCP and JSON input at boundaries.
- Prefer explicit interfaces, literal unions, and validation over broad
  business-logic `unknown` values.
- Keep the MCP server focused on registration and boundary schemas; move
  reusable behavior into the relevant capability module.
- Preserve atomic writes, stale-digest rejection, path safety, Git ancestry
  checks, and resumable checkpoints.
- Prefer cohesive modules. Avoid casually growing already-large files; split
  when a real capability boundary can be separated safely.

## Focused Tests

From `harness/`:

```bash
node --import tsx --test --test-name-pattern='<pattern>' test/harness.test.ts
node --import tsx --test test/cli.test.ts
```

Run focused coverage first, then the full harness check appropriate to the
change.

## Documentation Work

Markdown frontmatter, navigation membership, heading IDs, internal links,
workflow coverage, MCP tool coverage, and release version are checked by
`docs/scripts/check-content.mjs`. The site statically exports through Next.js.

When React components are touched, keep static data at module scope, reuse the
existing shadcn components, and avoid adding client-side state for content-only
changes.
