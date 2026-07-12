---
title: Development
description: Set up the workspace, choose the right module boundary, build generated runtime files, and contribute safely.
section: Contributor Guide
order: 180
---

# Development

This repository is the Cadre harness/package repository. Do not initialize a
root `cadre/` control plane here unless a fixture explicitly tests setup
behavior.

## Workspace Setup

From the repository root:

```bash
pnpm install
pnpm check
```

Use `pnpm --filter cadre-ai check` for harness-only validation and
`pnpm --filter cadre-docs dev` for local documentation work.

## Source Boundaries

| Area | Owns | Must not own |
|---|---|---|
| Domain | Pure policy, value types, parsing, and decisions | Node.js, filesystem, Git, MCP, UI, or process execution |
| Application | One bounded capability and orchestration through ports | Direct platform effects or broad unnormalized JSON |
| Infrastructure | Filesystem, Git, processes, locks, stores, generated assets | Business policy |
| MCP | Boundary normalization, tool/resource routing, compact envelopes | Duplicate workflow engines |
| CLI | Installation, client wiring, and presentation | Canonical project workflow state |
| Docs | Public explanations derived from current master sources | A second runtime contract |

Keep every `harness/src/**/*.ts` file at or below 500 lines. Split by cohesive
responsibility before a file crosses the limit.

## Master And Generated Sources

Edit these master sources:

- `harness/src/` for runtime, MCP, LSP, DAP, and CLI TypeScript;
- `harness/skills/cadre/` for the skill contract and protocols;
- `harness/scripts/agent-refs/` for MCP-served references;
- `harness/templates/` for target-project and CI templates;
- `docs/` for the public site and Markdown content.

Build runtime JavaScript with:

```bash
pnpm --filter cadre-ai build
```

Ignored plugin fixtures can be regenerated for validation:

```bash
pnpm --filter cadre-ai generate
```

Never implement a fix only in `harness/scripts/cadre-core.js` or
`harness/scripts/mcp/cadre-server.js`; the next build will overwrite it.

## Add A Configuration Key

1. Decide which bounded capability owns the behavior.
2. Add an explicit type and normalize the value when loading project config.
3. Add the default to `harness/templates/config.json` only when setup should
   generate it for every project.
4. Thread behavior through application/domain policy rather than key lookups in
   unrelated workflows.
5. Add default, override, invalid-input, and compatibility tests.
6. Update configuration, tuning, and reference documentation.

## Add A Tool, Action, Or Resource

Prefer an action or resource over another public MCP tool. Keep the public
three-tool contract small. Define boundary schemas, normalize input, use typed
application contracts, compact the response, and add routing plus packet-only
tests.

## Change A Project Skill

Project-skill behavior spans domain policy, repository storage, selection,
workflow envelopes, resources, protocols, and docs. Test required-rule safety,
optional budget behavior, explicit selectors, repo targeting, references, and
malformed manifests together.

## Commit Discipline

Preserve unrelated worktree changes. Use small local commits with clear intent.
Do not rewrite user work or push unless explicitly requested. Source and
generated runtime changes that represent one implementation should remain
reviewable together.
