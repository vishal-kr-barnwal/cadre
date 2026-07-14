# Changelog

## [Unreleased]

### Added

- Added an analysis-first refresh lifecycle. Cadre now inspects repository and
  control-plane drift before asking for a multi-select refresh level, with
  recommendations across product context, product guidelines, tech stack,
  workflow policy, patterns, repository topology, LSP, generated projections,
  and read-only diagnostics.

### Changed

- Changed refresh from a patterns-focused operation into an evidence-backed,
  level-specific workflow. Selected semantic documents require structured
  candidates, receive staged canonical/projection review, and execute only
  after their approvals; LSP and projection maintenance remain explicit
  non-document operations.
- Generalized safe preview supersession across staged workflows. A new payload
  may replace untouched, wholly unapproved overlapping previews, while Cadre
  refuses to replace reviewed, edited, staged, or committed targets.
- Changed approval cancellation to validate workflow ownership, worktree
  content, Git index state, and the recorded HEAD baseline before restoring
  target files. Failed cancellation keeps the session available for recovery.

### Fixed

- Fixed setup clarification so unanswered product or native prompts no longer
  create approval sessions or materialize template setup files. Evidence-backed
  retries safely supersede untouched unapproved setup previews while preserving
  and reporting user-edited, staged, or newly committed review targets.
- Fixed setup prompt contracts so empty objects and strategy selections do not
  masquerade as product or tech-stack evidence, snake-case tech-stack and style
  guide arguments are consumed consistently, and multi-select integration ids
  persist in structured configuration.
- Fixed new-track and revision clarification so schema-shaped empty objects,
  generic text, or strategy-only answers cannot materialize template review
  artifacts. Handoff now requires substantive handoff text, and release
  requires completed-track evidence or substantive release notes instead of
  creating empty default documents.
- Fixed failed target-preview materialization so it does not leave an orphaned
  approval session that blocks the next evidence-backed attempt.
- Fixed refresh retries so partial candidates derive from the recorded
  pre-preview canonical baseline, and template-equal candidates are rejected as
  missing evidence instead of preserving or reintroducing placeholder content.

## [2.2.0] - 2026-07-14

Atomic document review, hardened MCP runtime, and native workflow discovery
release.

### Added

- Added a registry for canonical JSON/JSONL artifacts and their generated
  Markdown projections, with atomic pair writes, pair-aware validation, and
  repair planning for marked projection drift.
- Added durable, ignored approval sessions under
  `cadre/local/approval-sessions/`. Sessions freeze the complete deterministic
  workflow diff, bind approvals to reviewed content hashes, support explicit
  cancellation, and reject drift before execution.
- Added compact v1 workflow packet shaping, typed nested MCP request parsing,
  typed resource URI/query contracts, and dedicated lifecycle, packet-contract,
  and resource-registry regression suites.
- Added capability-bound project-skill source reads. Tokens are short-lived and
  bound to one canonical root, source path, and content digest; unsafe links,
  binary or oversized files, and changed content are rejected.
- Added secure project-control config handling for LSP and DAP, including
  namespace confinement, no-follow reads and atomic writes, polyrepo owner-root
  handling, and contained breakpoint paths.
- Added exact parallel worker completion/recovery callbacks, auditable cleanup
  state, and restart-safe job interruption and recovery coverage.
- Added generated `cadre/tech-stack.md` and, for polyrepo control repositories,
  `cadre/repos.md` projections during setup.
- Added Codex and Claude Code command-picker discovery for the same 19
  registered workflows through generated, explicit-only `$cadre:*` and
  `/cadre:*` skill shims. The shims bind one workflow to the existing packet
  contract and do not add MCP tools or aliases. Neither client installs the
  redundant generic `$cadre:cadre` or `/cadre:cadre` entry; Copilot and
  Antigravity retain their single Cadre skill.

### Changed

- Changed target-mode review to materialize the complete deterministic workflow
  diff on the first review call. New files use Git intent-to-add so ordinary
  `git diff` shows the review without staging file content.
- Changed approval semantics so a canonical artifact and its human projection
  are one immutable review pair. The user approves the current human-facing
  document; execution authorization remains separate.
- Changed styleguide projections to live beside their canonical files as
  `cadre/styleguides/README.md` and `cadre/styleguides/<id>.md`.
- Enforced the three-tool MCP contract end to end: `cadre_workflow`,
  `cadre_action`, and `cadre_read` are the only public tool names, inputs remain
  nested, and retired flat packet names are no longer internal aliases.
- Made `next.tool` plus `next.arguments` the sole immediate single-agent
  continuation. Provider evidence write-back and explicit parallel worker
  callbacks are the only typed callbacks outside `next`.
- Separated fixed resources from parameterized resource templates and made one
  typed registry authoritative for discovery, validation, and routing.
- Changed parallel merge and cleanup to advance only from observed canonical
  task, worktree, branch, and merge state. Successful cleanup retains audit
  fields and is idempotent across later waves.
- Embedded job-runner and LSP-daemon modes in the MCP bundle instead of
  publishing duplicate standalone executables.
- Enabled TypeScript unused-local and unused-parameter checks, removed split-era
  import boilerplate, and converted runtime-free contract dependencies to
  type-only imports.

### Fixed

- Fixed approval completion so projection mutation, canonical mutation, commit
  tracing, and the compact `approval.completed` event succeed or fail as one
  operation. Cancellation restores intent-to-add state without approving work.
- Fixed artifact synchronization to repair generated projection drift with
  execution authorization instead of inventing a second projection approval.
- Fixed MCP initialization and JSON-RPC framing: supported protocol revisions
  negotiate correctly, normal operations wait for `notifications/initialized`,
  notifications receive no response, and parse/invalid-request errors use
  standard codes.
- Fixed resource discovery and reads so parameterized URIs cannot appear as
  fixed resources, query requirements are validated consistently, track plans
  return the actual parsed plan, and ship/land resources use stable identifiers.
- Fixed persisted jobs to fail closed after interrupted restarts, remain bound
  to their canonical project root, reject unsafe job storage, and advertise an
  artifact path only after persistence succeeds.
- Fixed parallel recovery so unmerged or conflicting workers cannot be marked
  complete or cleaned, canonical tasks complete before cleanup, and worktree
  identity follows Git common-directory state.
- Fixed unconfigured monorepo worktree planning to resolve an existing local or
  remote default branch instead of assuming that every repository uses `main`.
- Fixed DAP and LSP setup/review paths so absolute, traversing, cross-purpose,
  or symlink-selected configs are rejected before process creation. DAP callers
  can no longer inject inline adapter commands or escape project breakpoint
  paths.
- Fixed MCP action/workflow parsing so reserved approval, provider, worker,
  merge, async, and source-capability controls cannot be smuggled through nested
  input objects.

### Removed

- Removed obsolete standalone `cadre-job-runner.js` and
  `cadre-lsp-daemon.js` package bundles; their private modes remain available
  through `cadre-mcp`.
- Removed flat MCP forwarding shims, unused source barrels and adapters, the
  retired plan parser, obsolete migration/context shell scripts, and dead
  package-layout fallbacks.
- Removed maintainer-only skill protocols and agent references from embedded MCP
  assets and generated plugin payloads. Runtime setup templates remain packaged.

### Security

- Project-skill source capabilities now reject symlink components, retargeting,
  post-authorization content changes, path escapes, binary content, and
  oversized reads.
- Job persistence rejects traversal, symlinked storage, oversized snapshots,
  and cross-project job access.
- LSP/DAP configs are limited to `cadre/lsp.json|lsp-*.json` and
  `cadre/dap.json|dap-*.json`; secure reads verify the opened inode before JSON
  parsing, and setup uses atomic no-follow writes.
- Execution, approval, provider evidence, and parallel worker state remain
  distinct typed controls rather than caller-injectable JSON fields.

### Migration Notes

- Re-run `cadre install` after upgrading so every native client receives the
  2.2.0 manifest, skill shim, and MCP configuration. Codex and Claude Code also
  receive the explicit workflow-picker entries. Restart Codex or open a new
  task before typing `$cadre:`; run `/reload-plugins` in Claude Code or restart
  it before typing `/cadre:`.
- Replace saved Codex `$cadre` or `$cadre:cadre` prompts with
  `$cadre:<workflow>`, and replace Claude Code `/cadre:cadre` prompts with
  `/cadre:<workflow>`. The generic umbrella entries are intentionally absent.
- Regenerate styleguide projections under `cadre/styleguides/`, review the
  resulting diff, and remove the legacy `cadre/code_styleguides/` directory
  manually. Cadre diagnoses that legacy path but does not move or delete it.
- Target-mode automation must expect the first review call to expose the full
  deterministic diff rather than only the current stage. Approval is still
  explicit and applies to the current human-facing document and its canonical
  pair.
- Custom MCP callers that depended on accidental retired aliases must migrate
  fully to the nested three-tool contract and invoke only exact returned
  continuations or documented typed callbacks.

## [2.1.0] - 2026-07-12

Project-skill, token-efficiency, and documentation release.

### Added

- Added repository-owned project skills under `cadre/skills/<id>/SKILL.md` with
  workflow and optional polyrepo targeting, bounded inline instructions, lazy
  reference resources, explicit `skillIds` selection, validation diagnostics,
  and workflow-packet integration.
- Added `cadre://project-skills`, `cadre://project-skill`, and
  `cadre://project-skill-source` MCP resources for selection diagnostics,
  validated lazy references, and source-formatting requests.
- Added the `cadre-skill` workflow for packet-owned project-skill inspection,
  creation, update, formatting, enable/disable, validation, and removal.
- Added `project_skills.inline_rule_budget` with a default of `2400`, compact
  budget-source diagnostics, deterministic optional-rule allocation, and a
  fail-closed contract for required rules that cannot fit safely.
- Added project-skill and token-efficiency regression suites, including bounded
  baseline fixtures for tools, resources, workflows, packets, and references.
- Added a complete public user/operator and contributor documentation system:
  24 registry-ordered pages, exhaustive workflow/configuration/MCP references,
  content coverage checks, body-aware search, responsive tables and code
  blocks, and desktop/tablet/mobile navigation.

### Changed

- Replaced the older broad MCP tool catalog with token-efficient v1 public
  contracts centered on `cadre_workflow`, `cadre_action`, and `cadre_read`.
- Added compact workflow envelopes with an explicit decision, bounded required
  evidence, at most one deterministic next call, changed artifacts, targeted
  resources, and workflow-specific data.
- Reduced the packaged `cadre.skill.v1` contract to activation, invariants,
  workflow IDs, and conditional references. Normal workflow calls no longer
  require eager protocol or reference reads.
- Updated workflow protocols and agent references for packet-led activation,
  lazy evidence, namespaced actions, targeted resource reads, and compact
  project-skill summaries.
- Updated Cadre workflow protocols to load applicable project skills before
  drafting workflow payloads and to apply returned guidance during
  implementation, review, and publication.

### Fixed

- Fixed monorepo GitHub and GitLab CI aggregation so failed workspace package
  checks are combined correctly instead of being masked by the final `jq`
  expression.

### Migration Notes

- Re-run `cadre install` after upgrading so Codex, Claude Code, Copilot, and
  Antigravity use the new three-tool activation contract and current MCP
  configuration.
- Custom MCP callers must start workflows through `cadre_workflow`, run only the
  namespaced `cadre_action` returned by a packet, and read only relevant
  `cadre_read` resource URIs. Older direct Cadre tool names are no longer the
  public client contract.
- Custom callers should branch on structured workflow `decision`, `required`,
  `next`, `artifacts`, and `resources` fields rather than parsing legacy packet
  prose or assuming a workflow-specific direct tool.
- Project skills are repository-local and opt-in by selection. Existing target
  projects continue without a `cadre/skills/` directory; teams that add skills
  should validate workflow/repo selectors and inspect budget diagnostics before
  widening `inline_rule_budget`.

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
- Added copyable public workflow docs templates for canonical
  `cadre.spec.v1` and `cadre.plan.v1` new-track payloads.

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
