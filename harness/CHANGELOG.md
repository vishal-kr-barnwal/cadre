# Changelog

## [3.4.0] - 2026-08-27

Cadre 3.4.0 is a breaking MCP and template-contract release. Existing v1
projects remain readable but require an explicit approved refresh before
state mutation.

### Breaking Changes

- Adaptive commands now require exclusive `prepare` or `apply` input shapes.
- Direct clients must replace retired template, candidate, and worktree reads
  with MCP resources, `candidate_inspect`, and scoped `project_status`.
- New projects use template set v2. Legacy mutation fails with
  `PROJECT_REFRESH_REQUIRED` until an approved refresh updates workflow and
  runtime/template versions.

### Added

- Added bounded, Git-ignored staging under `.cadre/stage/<candidate-id>/` and
  one `candidate_inspect` call for manifests plus optional plan validation.
- Added scoped project/track/implementation status views, immutable v2
  templates, explicit legacy upgrade reporting, and approved v1→v2 refresh.
- Added honest adaptive schemas requiring `mode`, embedded template resources,
  compact descriptors/receipts, and resumable composite worktree transitions.

### Changed

- New initialization generates unchanged v2 workflow/styleguide defaults in
  MCP and stages only authored context or explicit overrides. `.cadre/init/*`
  remains invalid.
- Removed retired template and candidate tools; resources cover discovery and
  individual reads. The MCP surface is 22 tools.
- Coalesced worktree start, integration, and completion bookkeeping, reducing a
  delegated task to four calls (five for governed integration).
- Legacy projects remain readable but fail closed for mutation until an
  explicit approved refresh upgrades runtime/template versions.

### Compatibility And Upgrade

- Published v1 template files remain byte-for-byte unchanged.
- 3.3.0 proposal tokens must be prepared again after upgrading.
- Reinstall the CLI/native plugins and restart client sessions so the 3.4 tool
  schemas and compact skills replace cached 3.3 definitions.

## [3.3.0] - 2026-08-09

Cadre 3.3.0 makes long-running MCP delivery sessions durable across server
restarts and substantially reduces repeated protocol payloads. It keeps
project-local state and execution journals compatible while changing several
MCP response shapes from complete canonical artifacts to compact receipts and
path/SHA-256 manifests.

### Breaking Changes

- Changed execution checkpoint responses to return a changed-node transition
  receipt instead of the complete execution
  journal. Apply retains compact `derivedStatus` scheduling arrays and focused
  guidance for changed, active, or blocked nodes.
- Changed `execution_status` to return execution metadata, node-status counts,
  ready/active/blocked scheduling state, and minimal actionable-node records.
  It no longer echoes the complete journal or guidance for every completed and
  pending node; pass optional `nodeId` for focused full-node detail.
- Changed initialization, review, archive, execution start/finish, and derived
  track-index responses to return outcome metadata and path/SHA-256 manifests
  instead of full proposed or written artifact contents.
- Changed proposal tokens from self-contained gzip/base64 payloads to 42-byte
  opaque capabilities backed by the local Cadre runtime cache. Outstanding
  3.2.0 tokens must be previewed again after upgrading.

### Added

- Added durable proposal records under
  `${CADRE_HOME:-~/.cadre}/runtime/proposals`, allowing a preview produced by
  one MCP process to be applied safely after Codex or Claude restarts it.
- Added seven-day proposal expiry, a 256-record and 32 MiB retained-cache
  bound, an 8 MiB per-proposal bound, and oldest-first cleanup.
- Added optional focused `nodeId` lookup to `execution_status` without adding a
  separate arbitrary journal-reading tool.
- Added explicit checkpoint receipts recording the semantic event, source
  status, intermediate transition sequence, target status, and checkpoint.

### Changed

- Kept full execution journals as the canonical atomic validation and
  persistence model while projecting only scheduler-relevant state at the MCP
  transport boundary.
- Kept `proposalToken`, preview/apply tool names, semantic digests, stale-state
  recomputation, and compact `derivedStatus` scheduling arrays stable for
  workflow skills.
- Updated implementation guidance to reuse checkpoint apply results, request
  focused node detail only when needed, and avoid re-reading the journal after
  each event.

### Security And Reliability

- Proposal filenames are derived only from validated 192-bit random tokens;
  callers never supply runtime paths.
- Runtime proposal directories and records are permission-restricted, written
  with exclusive creation and fsync, and checked for ownership, file type,
  symlinks, size, kind, expiry, and schema before use.
- Proposal resolution remains digest-gated: every apply recomputes current
  state and rejects a stale proposal even when its runtime record is valid.
- Concurrent cleanup tolerates records already removed by another Codex or
  Claude MCP process, and lost-response retries can reuse retained tokens until
  normal domain idempotency or stale-state checks resolve them.

### Performance

- Reduced the live 46-node `execution_status` result from roughly 19.5 KiB of
  minified domain data to a 3.1 KiB complete MCP response with no embedded
  journal.
- Added response-budget regression checks requiring checkpoint preview/apply
  results below 4 KiB and a 50-node default status view below 8 KiB.
- Removed repeated full workflow, plan, journal, state, pattern, and generated
  index content from mutation responses when an exact digest-bound manifest is
  sufficient.

### Compatibility And Upgrade

- Existing 3.2.0 `.cadre` projects, track states, operation journals, and
  execution journals require no migration.
- Direct MCP consumers that read complete artifacts from preview/apply results
  must adopt the compact receipt and manifest shapes. Canonical artifacts
  remain available at their reported project paths.
- Reinstall the package and native plugins, start a new Codex conversation,
  and run `/reload-plugins` in Claude Code so both clients load the 3.3.0 tool
  schemas. Re-run preview for any proposal token created by 3.2.0.

## [3.2.0] - 2026-08-07

Cadre 3.2.0 simplifies the execution and governance contracts after analysis
of a full production implementation/review/archive session. This is a breaking
MCP release with no compatibility shims for removed tools or apply arguments.

### Breaking Changes

- Replaced `execution_node_*` and `execution_nodes_*` with the semantic
  `execution_checkpoint_*` pair. Events expand into complete legal transition
  sequences and `execution_status` now reports semantic event guidance.
- Changed mutation apply tools to accept only the opaque `proposalToken`
  returned by preview. Repeated semantic inputs, caller-supplied digests, and
  the `proposalDigest` response alias are removed.
- Removed caller-supplied execution IDs, timestamps, Git bases/heads, archive
  batch IDs, archive commits, worktree phase IDs, and worktree base commits
  where the runtime can derive them safely.
- Changed archive content inputs from arbitrary paths to structured pattern,
  pattern-index, and active-track-seed updates. Template IDs are now validated
  from the immutable catalog at the MCP boundary.

### Changed

- Kept `phase` as the default approval mode and preserved recorded mode on
  resume, while eliminating mechanical prompts covered by the active mode.
- Made execution finish atomically derive and write task/phase commit markers,
  the completed journal, `ready_for_review` state, and `tracks.md`.
- Made bare archive selection include all eligible completed tracks in
  dependency order and derive archive metadata from current state.
- Allowed canonical integration with only the exact active execution journal
  dirty; unrelated product or Cadre changes still fail closed.

### Fixed

- Added Git reachability validation for persisted project, track, plan,
  execution, review, revision, and archive provenance.
- Derived clean-review and archive provenance from actual Git history instead
  of accepting guessed SHAs, including ancestry-safe review bookkeeping.
- Added regression coverage for semantic checkpoints, proposal-token binding,
  tracked-journal integration, atomic plan evidence, and unreachable commits.

### Upgrade

- Reinstall the package and native plugins after upgrading. Start a new Codex
  conversation and reload Claude Code plugins so the 3.2.0 MCP schemas replace
  the removed 3.1.x contracts.

## [3.1.0] - 2026-07-30

Compared with 3.0.2, this release adds explicit implementation approval modes,
client-native decision forms, and a more efficient self-describing execution
runtime.

### Added

- Added persisted `governed`, `phase`, and `autonomous` implementation
  approval modes, with `phase` as the default for new executions.
- Added `workflow_elicit` for bounded Codex and Claude clarification and
  digest/checkpoint-bound approval forms.
- Added structured MCP error content, per-node legal transition guidance, and
  a uniform `proposalDigest` alias on mutation previews.
- Added ordered execution-node batches and protocol coverage for supported,
  unsupported, and policy-rejected form elicitation.

### Changed

- Changed workflow governance so one semantic approval covers its named,
  unchanged deterministic journals, indexes, validation, commits, lifecycle
  transitions, and provenance.
- Changed `phase` execution to run regular work autonomously and pause once at
  the final phase verification. `autonomous` pauses only at track verification;
  `governed` retains task-by-task review.
- Changed implementation scheduling to use returned transition guidance and
  derived status instead of global tool discovery, speculative previews, and
  redundant status reads.
- Changed execution bookkeeping to batch already-evidenced transitions, reuse
  unchanged product verification, parallelize independent read-only checks,
  and commit Cadre-only state at phase/final durability boundaries.
- Changed execution finish to update its journal, track state, and generated
  `tracks.md` together under one digest.

### Fixed

- Fixed non-interactive host policy handling so Codex Full Access uses one
  concise text fallback and an automatic policy rejection is not reported as a
  human decline.
- Fixed create-time token waste by summarizing unchanged workflows and default
  artifacts unless the human asks for full content.
- Fixed worktree cleanup recovery when an integrated node was already marked
  complete before cleanup.
- Fixed worktree identity friction by deriving a task's phase from its node ID
  while accepting a matching redundant phase value for compatibility.
- Fixed failed transition previews caused by undiscoverable state-machine
  rules, plain-text-only errors, and inconsistent digest field naming.

### Compatibility

- Existing 3.0.x projects remain compatible. Legacy execution journals without
  `approvalMode` are interpreted as `governed`.
- Run `cadre-ai install --target all --scope user` after upgrading, start a new
  Codex conversation, and run `/reload-plugins` in Claude Code.

Earlier release history is available in the signed `release-3.0.2` and older
Git tags.
