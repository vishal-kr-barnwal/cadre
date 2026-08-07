# Changelog

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
