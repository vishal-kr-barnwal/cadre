---
title: MCP Reference
description: Immutable v2 resources and the 22 Cadre 3.5 MCP tools.
section: Reference
order: 210
---

# MCP Reference

Cadre exposes immutable template resources and 22 narrow tools. Successful
operational tools return concise text plus typed structured data; unchanged
template bodies occur once in the requested content mode, while structured
content contains content-free descriptors.

Approval-aware commands use a strict `request` envelope. `request: { mode: "prepare", ... }` accepts only that operation's prepare fields and returns `approval_required` plus a compact token. After human approval, `request: { mode: "apply", proposalToken }` accepts no prepare fields. Deterministic operations apply in one call.

## Template Resources

The active catalog is readable at `cadre://templates/v2/<logical-id>`. Published v1 resources remain packaged for compatibility but new projects use v2.

## workflow_elicit

Presents one bounded text, boolean, or single-select clarification form, or a fixed approval form bound to a digest/checkpoint. It never records approval or requests secrets.

## template_get_many

Returns known immutable templates plus ordered descriptors and hashes.
`contentMode` defaults to `embedded_resource`; pass `text` for clients such as
Zed that do not expose embedded resource bodies to the agent. Use MCP resources
to discover or read one template only when the client supports them.

## styleguide_resolve

Maps technologies to default logical styleguide IDs, resource URIs, paths, and hashes without returning unchanged guide bodies.

## project_status

Requires the project root and accepts `view: project | track | implementation`. Project view returns validation, checkpoint, counts, compact track summaries, runtime worktrees, and sorted `stagedTrackCandidates` with canonical-presence, validity, path/hash manifest, errors, and next action. Focused views always return the complete `errors` array when `valid: false` and a `focusedErrors` subset for the selected track and its dependencies. Track view requires `trackId` and returns `kind: "canonical_track"` for canonical state, including any matching shadowed `stagedCandidate`. If only `.cadre/stage/track-<id>` exists, it instead returns `kind: "staged_track_candidate"` and recovery guidance. Implementation view adds graph, scheduler, and focused worktrees, with optional `executionId`; it rejects candidate-only tracks with `TRACK_CANDIDATE_ONLY`. Malformed canonical, malformed stage, candidate-only, shadowed, and unknown states remain distinct. Legacy projects report `upgradeRequired` and target versions.

## state_validate

Returns complete validation diagnostics. Use it for final gates or diagnostics, not repeated command entry.

## candidate_stage_prepare

Creates or resumes `.cadre/stage/<candidate-id>` and ensures `.cadre/.gitignore` contains `/stage/`. Optional `expectedFiles` declares the complete next candidate shape: paths are normalized and deduplicated before mutation, the whole existing tree is safety-checked, omitted regular files are pruned, and retained/removed paths are returned. Omitting it preserves the existing tree. Before initialization, `.cadre` is only a bootstrap shell containing `.gitignore` and `stage`.

## candidate_inspect

Reads an exact staged file list, rejects unexpected/unsafe paths, symlinks and size violations, and returns one path/hash manifest plus a digest. `planValidations` must name every staged root or nested `plan.md` exactly once with its intended target status; staged plans and validation entries must correspond exactly. Results contain a sorted `plans` array, and the digest binds both artifact hashes and normalized validation context. Plan-free candidates omit `planValidations`.

Track status reports an exact staged `track-<id>` as a `staged_track_candidate` only when canonical track state is absent. A present but unreadable canonical track fails with `TRACK_STATE_INVALID` instead of being masked by the staged candidate.

## execution_graph_validate

Validates the approved canonical plan graph. Implementation preflight normally receives this through implementation status view.

## review_complete

Approval-aware clean-review completion. Prepare accepts `projectRoot`, `trackId`, `approval`, and optional `acceptedRisks`; the server derives `<execution.baseCommit>..<lastExecution.headCommit>`, so the first implementation commit is included. There is no caller-supplied range start. Apply returns a compact receipt, recognizes an already-written matching review cycle, and repairs a stale derived index without duplicating history.

## archive_batch_candidate

Approval-aware staged archive batch. Prepare consumes body-free update descriptors and returns the full manifest/moves. Apply re-reads exact bytes and returns changed paths/counts.

## archive_batch_record

Records the existing archive commit and deterministic provenance across the batch, project, and tracks.

## execution_start

Creates one already-authorized execution journal and track operation with persisted scheduling/approval modes.

## execution_checkpoint

Applies one semantic transition using `{ scope: { projectRoot, trackId, executionId, nodeId }, action }`. `record_commit` requires commit, verification, and authorization; `record_integration` requires commit and verification; `record_verification` requires commit, verification, and authorization; `block` requires a blocker. `start` and `resume` accept only their declared assignment fields. `complete` has state-dependent evidence requirements and returns a compact scheduler receipt.

## execution_status

Returns compact scheduler state. It remains available for focused follow-up, but implementation entry uses implementation status view.

## execution_finish

Verifies completed nodes, commits, final manual approval, and removed worktrees, then writes plan markers, completed execution, `ready_for_review` state, and index with atomic per-file replacement. If interrupted, it reuses persisted completion time/HEAD and accepts each artifact in its exact source or target form while completing the remaining writes.

## worktree_create

Creates or reconciles the derived worktree and records the node's `start` transition with path and branch. Retry completes whichever Git or journal half is missing.

## integration

Validates and non-squash merges a worker branch, then records integration and returns scheduler state. Phase/autonomous mode completes in prepare; governed mode pauses and requires apply after approval.

## worktree_cleanup

Removes a verified integrated worktree/branch and records node completion. Retry handles an already-removed worktree with a missing journal transition.

## project_init_candidate

Approval-aware initialization. Prepare requires staged `product.md`, `guidelines.md`, and `tech-stack.md`, optional workflow/styleguide overrides, and selected logical styleguide IDs. The server generates unchanged v2 workflow/default guides and digest-binds all outputs. Re-prepare and apply may resume when partial canonical files exactly equal the approved proposal; unexpected or differing bytes remain a hard stop.

## setup_record_commit

Records the already-created setup artifact commit and completes setup.

## setup_record_git_initialized

Records verified Git initialization at the exact approved root.

## tracks_render

Validates and atomically regenerates deterministic `tracks.md`.

## Common Guarantees

- Project roots, IDs, paths, timestamps, commits, strict adaptive shapes, and event-specific evidence are validated at the boundary.
- Multi-file initialization, execution finish, clean review, and archive operations converge after interruption without duplicate cycles or history; byte, HEAD, hash, or journal drift remains a hard failure.
- `.cadre/stage/` is Git-ignored and never canonical or committed.
- Legacy v1 status, wisp, and approved refresh remain available; other mutations fail with `PROJECT_REFRESH_REQUIRED`.
- Complete proposal manifests remain in structured proposals/journals; apply receipts stay compact.
- Errors return structured `{ error: { code, message, details? } }` data.
