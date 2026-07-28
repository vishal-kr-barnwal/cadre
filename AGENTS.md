# Harness Context (AGENTS.md)

> Agent context for **OpenAI Codex** when working on this repository.
> Claude Code reads `CLAUDE.md`, which mirrors these root-level conventions.

This repository is the **Cadre 3.x harness/package repository**, not a target
project initialized with Cadre. Do not create or operate on a root `.cadre/`
control plane here unless the user explicitly asks to test setup behavior in a
fixture.

## Current Product Model

- Cadre supports OpenAI Codex and Claude Code as native user plugins.
- The published npm package and executable are both named `cadre-ai`.
- Installation packages a local dual-client marketplace, installs
  `cadre@cadre`, and runs the bundled `dist/cadre-mcp.mjs` stdio server.
- The ten user workflows are `create`, `track`, `implement`, `review`,
  `revise`, `archive`, `refresh`, `revert`, `status`, and `wisp`.
- Initialized projects keep approved mutable state under `.cadre/`. Runtime
  code, skills, worker definitions, and the immutable template catalog remain
  in the installed plugin rather than being copied into the project.

Do not reintroduce the retired packet/workflow model, `cadre/` project root,
generic `skills/cadre/` entrypoint, Copilot or Antigravity installers,
project-skill registry, provider/ship/land workflow family, or the old
three-tool `cadre_workflow` API.

## Repository Shape

```text
harness/
├── skills/<workflow>/       # Ten workflow skills and Codex picker metadata
├── agents/                  # Claude phase/task worker definitions
├── src/domain/              # State, plans, execution, governance, templates
├── src/mcp/                 # Typed stdio MCP server
├── scripts/                 # TypeScript build, CLI, installer, and validation
├── templates/v1/            # Immutable project and track templates
├── test/                    # CLI and integration tests
├── .codex-plugin/           # Codex source manifest
├── .claude-plugin/          # Claude source manifest
└── marketplace/             # Source marketplace catalogs
```

Root `docs/` is the canonical public Next.js/shadcn documentation site, with
Markdown under `docs/content/`. Root `README.md` is the repository overview.
Root `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` define the
workspace for `harness/` and `docs/`.

The tracked plugin manifests, MCP configs, skills, agents, marketplace
catalogs, and templates are source files. `harness/dist/`, `node_modules/`, and
the installed marketplace under `~/.cadre/marketplaces/cadre` are generated;
never edit them as source.

## Development Commands

Run workspace commands from the repository root:

```bash
pnpm install
pnpm check
```

Useful focused commands:

```bash
pnpm --filter cadre-ai check       # TypeScript type checking
pnpm --filter cadre-ai test        # Build and run all harness tests
pnpm --filter cadre-ai validate    # Build and validate package sources
pnpm --filter cadre-ai build       # Build dist/cadre-cli.mjs and dist/cadre-mcp.mjs
pnpm --filter cadre-docs check     # Content, lint, types, and static docs build
```

For a narrow harness change, run the relevant test from `harness/` first:

```bash
node --import tsx --test --test-name-pattern='<pattern>' test/harness.test.ts
```

Then run at least `pnpm --filter cadre-ai check`; use the full harness test and
validation commands when behavior, packaging, templates, skills, MCP, or the
installer changes.

## Source And Architecture Rules

- Read an existing file and its directly relevant callers, tests, templates,
  or schemas before editing it.
- Edit TypeScript sources in `harness/src/` and `harness/scripts/`; regenerate
  `harness/dist/` with the build command.
- Keep `harness/src/mcp/server.ts` as transport and tool registration glue.
  Put reusable state, plan, execution, governance, template, and worktree
  behavior in the corresponding modules under `harness/src/domain/`.
- Normalize untrusted JSON and MCP input at boundaries. Preserve strict types,
  literal unions, explicit interfaces, and exhaustive validation where
  practical.
- Preserve path and Git safety: reject broad roots and traversal, avoid
  following unsafe symlinks, use atomic writes, and never force-delete or
  rewrite user history.
- Preserve human governance. Deterministic state and Git mutations must remain
  previewed, explicitly approved, digest-gated where the API provides a digest,
  and resumable after interruption.
- Keep templates immutable and versioned under `harness/templates/v1/`. Do not
  add project-local runtime or template copies under `.cadre/`.
- Keep the MCP surface purpose-built. It may manage Cadre state and derived
  worktrees, but it must not become an arbitrary shell, file-editing, conflict
  resolution, or commit service.
- Prefer small cohesive modules. Some current source files exceed 500 lines;
  avoid growing them casually and split along real capability boundaries when
  a touched area can be separated safely.

## Installer And Packaging Rules

- `cadre-ai` is the only published executable. Do not add a conflicting
  `cadre` binary alias.
- The installer supports `codex`, `claude`, `all`, and auto-detection at user
  scope. Do not document unsupported clients or project-scoped installation.
- Default installation narrowly approves the Cadre MCP server/tools while
  preserving unrelated client settings. Claude requires both the `cadre`
  server in `enabledMcpjsonServers` and `mcp__cadre__*` in its allowlist.
- Keep the published runtime self-contained with no production dependencies.
  Marketplace cache-buster versions are installation artifacts, not package
  release versions.

## Commit Policy

When the user asks for implementation commits, use small local commits with
clear messages. Do not push unless explicitly requested. Preserve unrelated
worktree changes and never rewrite existing user work without instruction.

## Release Validation

Before creating or publishing a Cadre release, run the complete local checks:

```bash
pnpm install --frozen-lockfile
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
pnpm --filter cadre-ai pack --dry-run
```

Then validate the native installer from the local build against both clients:

```bash
pnpm --filter cadre-ai build
node harness/dist/cadre-cli.mjs doctor
node harness/dist/cadre-cli.mjs install --target all --scope user
codex plugin list --json
claude plugin list --json
```

Both clients must report `cadre@cadre` installed and enabled at the candidate
version. The generated plugin MCP configurations must launch the packaged
`dist/cadre-mcp.mjs`, and the narrow Codex and Claude MCP approval settings
must be present. There is no installer `--check` mode in the current CLI. If
installation or either listing check fails, stop and fix it before release.
