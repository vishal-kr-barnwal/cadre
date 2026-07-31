# Changelog

## [3.1.0] - 2026-07-30

Compared with 3.0.2, this release adds explicit implementation approval modes,
client-native decision forms, and a more efficient self-describing execution
runtime.

### Added

- Added persisted `governed`, `phase`, and `autonomous` implementation
  approval modes, with `phase` as the default for new executions.
- Added `workflow_elicit` for bounded Codex and Claude clarification and
  digest/checkpoint-bound approval forms.
- Added structured MCP error content, semantic execution checkpoints, and
  opaque proposal tokens that bind preview input to apply.

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
