# Changelog

## [2.0.0] - 2026-06-26

Major review-output and client-install release.

### Added

- Added target-path staged review output as the default for setup, new-track,
  revise, handoff, release, refresh, and artifact-sync previews. Dry-run review
  now writes the active approval stage to its intended `cadre/` path so users
  can inspect ordinary `git diff` instead of comparing temporary bundle files.
- Added `reviewOutputMode` / `review_output_mode` with `"target"` as the
  default and `"bundle"` for the legacy non-mutating temp-bundle behavior.
  Explicit `reviewBundleDir` continues to select bundle-style output.
- Added target-preview metadata in compact responses:
  `review_bundle.mode:"target"`, `mutates_worktree:true`,
  `manifest_path:null`, and per-file `target_path` / `review_path` values that
  point at the real reviewed file.
- Added staged approval session metadata for target-preview files, including
  per-stage hashes used by final execution.
- Added final-execute validation that regenerated payloads still match the
  approved target previews. If a reviewed preview file drifts after approval,
  the packet fails closed instead of silently accepting edited output.
- Added final-execute reuse of approved matching preview files, including trace
  commit support for those intentionally dirty target-preview paths.
- Added install-time support for GitHub Copilot and Google Antigravity plugin
  shells alongside Codex and Claude. Copilot project scope writes
  `.github/skills/cadre/SKILL.md`, and Antigravity CLI receives the narrow
  `mcp(cadre/*)` allow rule.

### Changed

- Changed staged review dry-runs to write only the current approval stage in
  target mode. Future stages are not materialized until earlier stages are
  explicitly approved.
- Changed target previews to protect existing worktree edits: Cadre refuses to
  overwrite dirty target files whose current content differs from the generated
  preview content unless the caller explicitly uses `force:true`.
- Changed documentation, workflow protocols, agent references, and skill
  guidance to teach target previews, nullable bundle manifests, worktree
  mutation during dry-run review, and bundle-mode opt-in.

### Fixed

- Fixed staged review execution so approved target-preview files that are
  already dirty in the worktree can be reused during final `execute:true`
  without forcing a duplicate temp-bundle comparison.
- Fixed drift detection for approved previews by validating both the
  regenerated payload and on-disk target file content before final mutation.
- Fixed review output compatibility by preserving `reviewBundle:false` /
  `reviewFiles:false` as review-output disable switches and keeping bundle mode
  available for non-mutating preview workflows.
- Fixed `cadre install --target all` on machines without the Copilot CLI: Cadre
  still writes the Copilot plugin files, reports skipped native registration,
  and lets Codex, Claude, and Antigravity release validation continue.

### Migration Notes

- Existing callers that expected dry-run review to be non-mutating should pass
  `reviewOutputMode:"bundle"` or an explicit `reviewBundleDir`.
- Users can now review staged output with `git diff -- cadre/...` after each
  dry-run stage. Approval is still explicit and per-stage; a written preview is
  not treated as approval.
- Automation that reads `review_bundle.manifest_path` must handle `null` in
  target mode and use `review_bundle.files[].target_path` or `review_path`
  instead.

## [1.1.2] - 2026-06-23

### Added

- Added Codex and Claude Cadre-only MCP approval bootstrap during `cadre install`
  so `cadre-setup` and later Cadre packet workflows do not prompt for each Cadre
  tool call.
- Added `cadre install --check` validation for the Codex and Claude approval
  bootstrap so release checks catch noisy Cadre MCP permission prompts before
  publishing.

### Changed

- Updated setup guidance to send users back through `cadre install` when Cadre
  MCP approvals are still being requested.

### Fixed

- Fixed `cadre install` for existing Claude Code installs by refreshing the
  cached native plugin after rewriting the local Cadre marketplace, so Claude
  reports the candidate Cadre version during release validation.

### Security

- Kept the approval bootstrap scoped to Cadre MCP packet tools only; it does not
  approve shell commands, file edits, other plugins, or non-Cadre MCP servers.

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
