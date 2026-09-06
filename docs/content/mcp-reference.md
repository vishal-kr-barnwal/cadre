---
title: MCP Reference
description: Immutable v3 resources and the 23 Cadre 3.7 MCP tools.
section: Reference
order: 210
---

# MCP Reference

Cadre exposes immutable template resources and 23 narrow tools. Response format
is selected from the MCP initialization client identity. Recognized Codex clients
and Claude Code 2.0.21+ receive only `structuredContent` with `content: []` and
advertised output schemas. Zed, older Claude Code, and unknown clients receive
compact JSON text without `structuredContent` or advertised output schemas.
Successes use this selected format. Errors use one JSON text block with `isError: true` for every client, so native Claude displays the diagnostic. Server-side output validation remains active in both modes. No redundant prose
summary or JSON copy is emitted. Structured template results include each body
in its descriptor; text clients receive each body once in the requested content
mode followed by JSON containing content-free descriptors.

Approval-aware commands use a strict `request` envelope. `request: { mode: "prepare", ... }` accepts only that operation's prepare fields and returns `approval_required` plus a compact token. After human approval, `request: { mode: "apply", proposalToken }` accepts no prepare fields. Deterministic operations apply in one call.
The prepare token is available in the selected JSON representation; applied results omit it.

## Template Resources

The active catalog is readable at `cadre://templates/v3/<logical-id>`. Published v1 and v2 resources remain packaged for compatibility but new projects use v3.

## workflow_elicit

Presents one bounded text, boolean, or single-select clarification form (the message is limited to 2000 characters), or a fixed approval form bound to a digest/checkpoint. It never records approval or requests secrets.

## template_get_many

Returns known immutable templates plus ordered descriptors and hashes.
`contentMode` defaults to `embedded_resource`; pass `text` for clients such as
Zed that do not expose embedded resource bodies to the agent. Use MCP resources
to discover or read one template only when the client supports them.

## styleguide_resolve

Maps technologies to default logical styleguide IDs, resource URIs, paths, and hashes without returning unchanged guide bodies.

## context_read

Read-only, scoped to `projectRoot`, `trackId`, and optional `executionId`/`nodeId`. Returns required project instructions/styleguides, full approved scope/plan, explicit pattern references, declared dependency learning, and persisted handoffs. Ambiguous learning headings or missing applicability metadata expand the read conservatively. Repository instructions and affected code must still be read through the host before edits.

`maxBytes` defaults to 16384 (range 4096–65536) and bounds the serialized domain payload, not the surrounding MCP envelope or billed tokens. Consume `nextCursor` until `complete: true`; every page reports `snapshot`, `totalSources`, `errors`, `staleMemory`, and `excerpts`. Each excerpt contains `path`, full-source `sha256`, `reason`, `section`, `format`, `content`, `offset`, `endOffset`, and `sourceComplete`, selected-section `contentHash`, and `reused`. Offsets are UTF-16 positions within the selected section/representation, not file byte offsets. `format: "source"` is exact source text; `format: "handoff"` is a derived JSON rendering of persisted node evidence and current source-fingerprint findings. Missing handoffs are explicitly not recorded.

Pass optional `knownSources: [{path, sha256, section, contentHash}]` only for complete sections whose text remains available in the current session. An exact match returns `reused: true` and empty content; changed source hashes return the source again. Keep the same inventory for every page of one snapshot. Clear it after a fresh session or lost context. `contextReady` requires complete pagination without errors or stale guidance.

Continuation is bound to the scope, retained-source inventory, and every inspected input hash. On `CONTEXT_SNAPSHOT_CHANGED`, restart without a cursor. `complete` describes pagination only: errors or stale memory still require attention. Findings that cannot fit a page cause `CONTEXT_PAGE_TOO_SMALL` with instructions to increase the budget; no required text is silently dropped. The reader accepts no arbitrary path or shell input.

## project_status

Requires the project root and accepts `view: project | track | implementation` plus `detail: summary | full` (default summary). Summary omits full state history and parsed graph detail, retaining operation/checkpoint, dependencies, scheduler, graph digest/counts, and source hashes. Full project detail adds `projectState` and paged `trackDetails` with complete state, graph, execution, and source references. Full implementation detail adds `executionJournal` alongside the scheduler. `staleMemory` is distinct from structural `errors`. Project listings accept `statuses`, `limit` (default 50, maximum 200), and `cursor`; consume `listing.nextCursor` until complete. Counts and validation remain project-wide, even for filtered pages. Restart pagination on `STATUS_SNAPSHOT_CHANGED`. Project view returns validation, checkpoint, counts, compact track summaries, runtime worktrees, and sorted `stagedTrackCandidates` with canonical-presence, validity, path/hash manifest, errors, and next action. Focused views always return the complete `errors` array when `valid: false` and a `focusedErrors` subset for the selected track and its dependencies. Track view requires `trackId` and returns `kind: "canonical_track"` for canonical state, including any matching shadowed `stagedCandidate`. If only `.cadre/stage/track-<id>` exists, it instead returns `kind: "staged_track_candidate"` and recovery guidance. Implementation view adds graph, scheduler, and focused worktrees, with optional `executionId`; it rejects candidate-only tracks with `TRACK_CANDIDATE_ONLY`. Malformed canonical, malformed stage, candidate-only, shadowed, and unknown states remain distinct. Legacy projects report `upgradeRequired` and target versions.

## state_validate

Returns complete validation diagnostics. Use it for final gates or diagnostics, not repeated command entry.

## candidate_stage_prepare

Creates or resumes `.cadre/stage/<candidate-id>` and ensures `.cadre/.gitignore` contains `/stage/`. Optional `expectedFiles` declares the complete next candidate shape: paths are relative to the stage without a `.cadre/` prefix and are normalized and deduplicated before mutation, the whole existing tree is safety-checked, omitted regular files are pruned, and retained/removed paths are returned. Omitting it preserves the existing tree. Copy bytes that must survive a rename before declaring the new set; omitted files are intentionally pruned. Before initialization, `.cadre` is only a bootstrap shell containing `.gitignore` and `stage`.

## candidate_inspect

Reads an exact staged file list, rejects unexpected/unsafe paths, symlinks, size violations, invalid revision filenames, and orphaned execution bindings in proposed track states, and returns one path/hash manifest plus a digest. `planValidations` must name every staged root or nested `plan.md` exactly once with its intended target status; staged plans and validation entries must correspond exactly. Results contain a sorted `plans` array, and the digest binds both artifact hashes and normalized validation context. Plan-free candidates omit `planValidations`. `learning` contains seed validation results against the proposed overlay; `memoryInputs` fingerprints unchanged canonical inputs and is included in the digest. Changed pattern content requires affected active seeds to be reassessed. For direct promotions, re-inspect immediately before writing and compare the full approved digest. Archive prepare/apply enforces its seed overlay in the runtime. Revert candidates that change persisted node evidence must include the exact original journal under `reverts/revert-<id>-execution-before.json`.

Track status reports an exact staged `track-<id>` as a `staged_track_candidate` only when canonical track state is absent. A present but unreadable canonical track fails with `TRACK_STATE_INVALID` instead of being masked by the staged candidate.

## execution_graph_validate

Validates the approved canonical plan graph. Implementation preflight normally receives this through implementation status view.

## review_complete

Approval-aware clean-review completion. Prepare accepts `projectRoot`, `trackId`, `approval`, and optional `acceptedRisks`; the server derives `<execution.baseCommit>..<lastExecution.headCommit>`, so the first implementation commit is included. The legacy `approval` input stores proposal evidence as `reviewEvidence`; prepare does not record confirmed approval. Apply persists a separate `approvalConfirmation` receipt bound to the proposal digest. There is no caller-supplied range start. Apply returns a compact receipt, recognizes an already-written matching review cycle, and repairs a stale derived index without duplicating history.

## archive_batch_candidate

Approval-aware staged archive batch. Prepare consumes body-free update descriptors and returns the full manifest/moves. Apply re-reads exact bytes and returns changed paths/counts.

## archive_batch_record

Records the existing archive commit and deterministic provenance across the batch, project, and tracks.

## execution_start

Creates one already-authorized execution journal and track operation with persisted scheduling/approval modes. Before starting, the recorded plan commit must contain the approved revision and graph. New journals retain `planSource` for historical provenance checks.

## execution_checkpoint

Task `record_commit` and `block` actions also accept `handoff`: arrays `decisions`, `failedApproaches`, `openQuestions`, a `nextAction` string, and `sources` containing safe repository-relative `path` and exact `sha256`. Serialized handoffs must fit 8 KiB; oversized input is rejected without mutation. Handoffs persist atomically with the existing transition and remain on completed nodes. They never replace commit, verification, authorization, or blocker evidence.

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

Approval-aware initialization. Prepare requires staged `product.md`, `guidelines.md`, and `tech-stack.md`, optional workflow/styleguide overrides, and selected logical styleguide IDs. The server generates unchanged v3 workflow/default guides and digest-binds all outputs. Re-prepare and apply may resume when partial canonical files exactly equal the approved proposal; unexpected or differing bytes remain a hard stop.

## setup_record_commit

Records the already-created setup artifact commit and completes setup.

## setup_record_git_initialized

Records verified Git initialization at the exact approved root.

## tracks_render

Validates and atomically regenerates deterministic `tracks.md`.

## Common Guarantees

- Success payloads are validated against the tool's output schema before delivery.
  Both formats preserve `{ error: { code, message, details? } }` failures and
  elicitation outcomes.
- Project roots, IDs, paths, timestamps, commits, strict adaptive shapes, and event-specific evidence are validated at the boundary.
- Multi-file initialization, execution finish, clean review, and archive operations converge after interruption without duplicate cycles or history; byte, HEAD, hash, or journal drift remains a hard failure.
- `.cadre/stage/` is Git-ignored and never canonical or committed.
- Legacy v1 status, wisp, and approved refresh remain available; other mutations fail with `PROJECT_REFRESH_REQUIRED`.
- Complete proposal manifests remain in structured proposals/journals; apply receipts stay compact.
- Errors return one JSON text block containing `{ error: { code, message, details? } }`.

## Upgrade and recovery

Runtime 3.7.0 uses template set v3. Legacy status/diagnostics and candidate staging remain available, but delivery requires an approved refresh. Quiesce active workers, preserve terminal history, stage workflow and active seed metadata in one envelope, promote the approved context, and record target versions last. Missing historical handoffs must not be invented. Blocking, completion of already committed/integrated nodes, verified cleanup, and validated index rendering remain available for recovery; new delivery and integrations do not bypass the upgrade gate.
