# Cadre Workflow

This is the durable project-level Cadre contract. Installed skills supply command procedure; stop and present any conflict with this file.

## Authority and project boundaries

- The installed Cadre MCP server is the authoritative runtime and immutable template provider.
- `.cadre/` contains approved mutable context, lifecycle state, and history only. Runtime code and template catalogs stay in the installed plugin.
- Read every existing artifact and its relevant repository context before editing it. Never reconstruct state or file content from memory.
- Resolve the exact repository root before mutation. Never create a nested repository or operate outside the approved root.
- A missing required MCP capability blocks stateful work; do not recreate it with shell or filesystem logic.

## Human governance

- Semantic content, scope, selection, and material consequences remain proposals until the human explicitly approves them.
- Combine related decisions into one complete authorization envelope when their exact artifacts, focused diffs, consequences, and verification evidence are available together.
- Named deterministic consequences—validation, indexes, transitions, commits, and provenance—need no additional approval.
- Changed content, scope, selection, digest, or material consequences require a corrected proposal and approval.
- An MCP `approval_required` result is not approval. Call its adaptive command again in `apply` mode only after the human approves the unchanged digest-bound proposal.
- Host security permission is separate from Cadre approval and never approves product content, commits, merges, or lifecycle state.

## Candidate artifacts

- Write unapproved artifact bodies only beneath `<project-root>/.cadre/stage/<candidate-id>/` at their eventual `.cadre/`-relative paths.
- Never place unapproved files in canonical `.cadre/` and never transport candidate bodies through MCP when a candidate command exists.
- Inspect the complete exact candidate set before approval. Approval binds its paths and SHA-256 hashes to one digest.
- Candidate paths must be relative and traversal-free. Stages reject symbolic links, unexpected files, and size-limit violations.
- After approval, journal the digest and manifest, promote only matching bytes, verify hashes, and retain the stage through commit recording.
- `.cadre/stage/` is never committed. A changed candidate requires fresh inspection and approval.

## Resumability and Git safety

- Every multi-step mutation records an operation journal after approval and before canonical writes or Git mutation.
- On resume, reconcile the journal, candidate hashes, canonical files, Git status, expected commit, and recorded checkpoint. Continue only the first incomplete deterministic step.
- If an expected commit already exists with the correct base relationship and content, record it instead of repeating it.
- Stop on any journal, hash, path, worktree, branch, or history mismatch. Never reset, discard, force-delete, rewrite public history, or guess a repair.
- Use additive Git history and focused Conventional Commits. Do not include unrelated files or runtime-only worktrees.
- Reuse passing verification while product files, test inputs, and verification policy are unchanged. Cadre-only bookkeeping does not invalidate product verification.

## Sources of truth

- `spec.md` defines approved scope, requirements, and acceptance criteria.
- `plan.md` defines phase/task identity, dependencies, verification barriers, completion markers, and commit provenance.
- Track `state.json` defines identity, lifecycle status, dependencies, revision, checkpoints, active operation, execution pointer, review cycles, and history.
- Execution journals define live scheduling and provenance; do not duplicate active node state.
- `project.json` defines project identity plus setup and refresh history; it does not duplicate track records.
- `tracks.md` is a generated summary. Never hand-edit it or use it as dependency state.
- Git is implementation history. Completion claims require reachable recorded commits.

## Lifecycle and mutation rules

```text
drafting-spec -> drafting-plan -> planned -> in_progress -> ready_for_review
                     |             |             |              |
                     +-- revise ---+-------------+              +-- revise --> in_progress/planned
                                   |             |              +-- approved bugs --> in_progress
                                   +-------------+              +-- clean review --> completed --> archived
```

- Only `review` may mark a track `completed`; only `archive` may mark it `archived`.
- Completed or archived intent changes create successor work rather than rewriting terminal history.
- Track dependencies are read from track state and must be completed or archived before dependent execution.
- Every delivery phase ends in a derived `User Manual Verification` barrier. The final phase is the track-level manual-verification barrier.
- An `implement` invocation authorizes the approved plan under its persisted approval mode. `phase` is the default; `governed` adds regular-task and integration decisions; `autonomous` still requires track-level manual verification.
- Deterministic MCP operations use one call. Approval-aware operations use `prepare`, pause for the human, then `apply` with the unchanged token.

## Context reuse

- Inspect project status once at command entry using the narrowest applicable view. Use separate full validation only for final mutation gates or diagnostics.
- Read each required file once and reuse unchanged content by path and Git hash. Continue truncated reads from the first unread line.
- Fetch known immutable templates in one bundle and retain them through the decision. Do not rediscover known IDs through the catalog.
- Present concise status and focused diffs. Identify large unchanged defaults by version, path, and hash unless requested.

## Durable memory and context

- Active Pattern Seeds contain one versioned `cadre:memory` JSON block with spec/plan revisions and safe pattern paths plus SHA-256 hashes. Reassess changed guidance within track/revise/refresh/archive authorization; do not silently refresh hashes without reviewing applicability.
- Preserve completed and archived learning as historical evidence. Missing old handoffs mean not recorded; never manufacture them during migration.
- Record bounded decisions, failed approaches, open questions, next action, and source fingerprints alongside task commit/block checkpoints. These handoffs are evidence, never approval or duplicated scheduler state.
- Use `context_read` for a selected node and consume all pages. It returns full approved scope/plan, applicable project instructions, dependency learning, and persisted handoffs. Read code and repository instructions separately before edits. Reuse hashes only when their source content is still available in the current session.
- Required context is never silently truncated. Continue pages, restart after snapshot drift, and expand ambiguous sections. Stop dependent execution on stale memory until reassessed.
- Routine status uses summaries; full history and graph are explicit detail reads. Project pagination filters rows, never validation coverage or counts.
- An approved refresh is required before delivery with a new runtime/template set. Keep staging, diagnostics, blocking, and verified cleanup available for recovery, preserve history, and resume the existing journal after interruption.
