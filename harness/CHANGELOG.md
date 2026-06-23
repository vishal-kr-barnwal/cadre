# Changelog

## [1.1.1] - 2026-06-23

Patch release for docs rendering, install-time plugin registration, and native
release validation.

### Added

- Added a repository release gate requiring real Codex and Claude native plugin
  installs before creating or publishing a release.

### Changed

- Changed Mermaid diagrams in the public Next.js docs site to render
  top-to-bottom on mobile while preserving the wider left-to-right layout on
  desktop.

### Fixed

- Fixed Mermaid diagrams in the public Next.js docs site so fenced `mermaid`
  blocks render as diagrams instead of code blocks.
- Fixed `cadre install` marketplace layout so Codex and Claude resolve the
  locally written Cadre plugin from relative `./plugins/cadre` marketplace
  sources.
- Fixed install-time client detection to avoid Node 26 deprecation warnings.

## [1.1.0] - 2026-06-23

Native Cadre state and traceability release.

### Added

- Added packet-owned native event and message state for setup, track creation,
  task completion, handoffs, status views, and team boards.
- Added the `cadre-formula` workflow for reusable Cadre formulas and
  git-ignored local wisp runs.
- Added automatic Cadre commit tracing for task completions, product commits,
  control-plane commits, publication evidence, and git notes under
  `refs/notes/cadre`.
- Added native state defaults and merge attributes to generated setup
  templates.

### Changed

- Changed Cadre task memory from Beads runtime integration to native
  packet-owned JSON and JSONL state.
- Changed task completion and publication flows so product commits,
  control-plane commits, journals, review records, events, and trace notes are
  recorded through one packet-owned path.
- Changed status, team, and fleet outputs to include native events, messages,
  formula state, ownership and lease context, and review evidence.
- Updated docs, workflow protocols, templates, and agent references for native
  memory, formula workflows, local wisps, and commit tracing.

### Fixed

- Fixed generated runtime bundles and tests to align with the native state
  schema and formula workflow.
- Fixed architecture checks and packet tests for the native Cadre state module
  split.

### Removed

- Removed Beads runtime modules, templates, agent references, readiness output,
  and legacy task-memory surfaces.
- Removed the stale migration helper for the pre-native state layout.

## [1.0.0] - 2026-06-22

Stable public `cadre-ai` package release.

### Added

- Added the `cadre-ai` npm package with the `cadre`, `cadre-ai`, `cadre-mcp`, `cadre-lsp-setup`, and `cadre-lsp-review` binaries.
- Added an MCP-first Cadre runtime where `cadre-mcp` serves the skill contract, workflow protocols, agent references, templates, resources, and packet tools from the package.
- Added `cadre install` to generate thin Codex and Claude plugin shells from the npm package instead of requiring checked-in plugin artifacts.
- Added Codex plugin generation with `.codex-plugin/plugin.json`, `.mcp.json`, and `skills/cadre/SKILL.md`.
- Added Claude plugin generation with `.claude-plugin/plugin.json`, `mcp-config.json`, and `skills/cadre/SKILL.md`.
- Added MCP resource and tool access for workflow contracts, protocol details, template inventory, team boards, fleet boards, readiness, LSP status, artifact previews, and parallel state.
- Added agent-aware parallel dispatch contracts through `cadre_parallel`, including platform-specific worker prompts, file scope, evidence requirements, and finish-record guidance.
- Added team-scale workflow support for 10-20 contributors with ownership checks, bounded worker waves, team/fleet health views, provider evidence records, and merge/cleanup recovery state.
- Added workspace intelligence for monorepo and polyrepo projects, including repo maps, dependency graphs, test-impact hints, diagnostics, and LSP-backed review assistance.
- Added LSP setup, review, and daemon support with status reporting, degraded text-scan fallback, idle handling, and bounded review concurrency.
- Added Beads integration support for durable task memory, task trees, completion evidence, prefix selection, and setup validation.
- Added the public Next.js documentation site under `docs/` with getting-started, workflow, architecture, team/polyrepo, parallel execution, and troubleshooting pages.
- Added a release workflow that runs harness validation, performs an npm pack dry-run, publishes `cadre-ai`, and runs the docs pipeline on GitHub release publication.

### Changed

- Changed Cadre to make MCP the canonical workflow contract source for agents and clients.
- Changed generated platform plugins to thin activation and MCP wiring shells; assets, protocols, references, templates, worker prompts, and runtime code are served by `cadre-mcp`.
- Changed the Cadre skill entrypoint to a minimal shim that verifies MCP availability and points agents at MCP resources.
- Changed generated plugin, marketplace, and local skill outputs to ignored install-time or validation fixtures rather than checked-in repository artifacts.
- Changed generator checks so `pnpm generate -- --check` and `pnpm --filter cadre-ai generate` validate reproducible plugin output without requiring committed generated bundles.
- Changed package metadata, repository URLs, license ownership, author metadata, and release display names for the public `cadre-ai` package.
- Changed setup to recommend short Beads epic prefixes and let the user choose a project/product prefix or provide a custom two-word prefix.
- Changed compact workflow responses to favor bounded summaries, resource URIs, review bundle paths, provider summaries, LSP summaries, and next actions over large inline payloads.
- Changed release artifacts and GitHub release run names to use the `Release - <version>` naming convention.
- Changed GitHub release publishing to use npm Trusted Publishing through GitHub Actions OIDC instead of a long-lived npm token.

### Fixed

- Fixed generator check behavior so check mode no longer mutates tracked files.
- Fixed package generation drift by testing generated Codex and Claude plugin shells through temporary fixtures.
- Fixed stale platform artifacts by removing checked-in plugin shells, marketplace shims, generated skill copies, and platform worker overlays from version control.
- Fixed package packlist coverage so npm distribution includes runtime bundles and excludes source files, tests, local plugin fixtures, and generated artifacts.
- Fixed MCP readiness output so provider, code search, issue tracker, CI, observability, and knowledge-base capability evidence can be surfaced without making optional MCPs mandatory.
- Fixed team parallelism validation so worker finish evidence is checked against owned files, related tests, and explicit finish requirements.
- Fixed LSP visibility by surfacing daemon status, coverage, missing server commands, and degraded fallback state in health outputs.
- Fixed package naming and version alignment for the first real release after `cadre-ai@0.0.0` bootstrap.

### Removed

- Removed checked-in root plugin marketplace shims.
- Removed checked-in harness-local `.agents`, `.claude`, `.claude-plugin`, and `plugins` generated artifacts.
- Removed generated Claude `cadre-worker` agent output; worker instructions now come from MCP packets.
- Removed the verbose local-asset warning from the packaged Cadre skill shim.
- Removed dependency on local skill asset files as workflow input for generated platform plugins.
