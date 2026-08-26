---
title: MCP Reference
description: All immutable resources and registered Cadre 3.0 MCP tools.
section: Reference
order: 210
---

# MCP Reference

The `cadre` stdio server exposes immutable template resources and 25
purpose-built tools. It does not expose a generic `cadre_workflow` dispatcher or
arbitrary filesystem/shell operations.

Adaptive mutation commands validate and apply in one call when the current
authorization envelope already covers the deterministic consequence. When a
new human decision is required, the command returns `commandStatus:
"approval_required"` plus a compact `proposalToken`; after approval, the same
command accepts only that token. Tokens survive MCP restarts until expiry or
bounded eviction. Tool failures set the MCP error flag and
return structured `{ error: { code, message, details? } }` content; callers do
not need to parse human-readable text to recover transition guidance.

## Template Resources

Every bundled template is readable at
`cadre://templates/v1/<relative-template-path>`. Resource metadata includes the
template-set version, media type, and content hash.

## workflow_elicit

Presents one client-native MCP form for a Cadre clarification or approval.
Clarification forms contain at most three flat text, boolean, number,
single-select, or multi-select fields. Approval forms have a fixed decision and
optional notes, and require a proposal digest or immutable verification
checkpoint binding.

This tool is read-only: it records no approval and mutates no Cadre state. It
normalizes accept, request-changes, decline, and cancel outcomes. Skills inspect
active task policy before calling it: under a non-interactive policy such as
Codex Full Access, they skip the tool and ask the same concise question once in
chat. The tool returns `fallback_required` when the client does not advertise
form elicitation or rejects the request as an error. If Codex instead returns an
immediate protocol decline while task context explicitly reports policy
`never`, the skill treats it as policy rejection rather than human input and
uses the same single chat fallback. Form mode must never request passwords, API
keys, access tokens, payment credentials, or other secrets.

## template_catalog

Lists logical template IDs, resource URIs, eventual artifact paths when fixed,
media types, and SHA-256 hashes. Provider package source paths are intentionally
not exposed. Read-only. Prefer known `template_get_many` bundles in workflow
skills.

## template_get

Returns one immutable template by logical `id`. When the template has a fixed
destination, `artifactPath` is relative to the relevant `.cadre/` project or
track root. Provider package source paths are not returned. Read-only.

## template_get_many

Returns an ordered non-empty array of immutable templates for `ids`. Read-only
and used to avoid repeated template calls.

## styleguide_resolve

Maps an approved non-empty technology list to bundled default styleguide
templates. Read-only and always paired with human selection/amendment during
project creation.

## project_status

Reads a project root, discovers active/archived tracks, performs centralized
validation, and returns both structured state and a human-readable summary.

## state_validate

Returns all project, track, plan, learning, dependency, execution, review,
archive, and derived-index validation errors. Read-only.

## artifact_candidate_manifest

Reads an exact relative file list beneath
`<project-root>/.cadre-stage/<candidate-id>/` and returns only sorted paths,
SHA-256 hashes, and an approval-binding digest. Candidate stages reject path
traversal, symbolic links, non-files, files over 1 MiB, and sets over 8 MiB.
Read-only.

## execution_graph_validate

Parses one active track's `plan.md`, validates dependencies/cycles/barriers
against lifecycle state, and returns the derived graph and errors. Read-only.

## execution_graph_validate_candidate

Reads `plan.md` beneath a project-local candidate stage, validates the same
draft graph and target lifecycle rules, and returns its path and hash with the
graph result. The Markdown is not transported through MCP. Read-only.

## review_complete

With review evidence, prepares a clean review cycle, completed track state, and
derived index and returns `approval_required`. After the human decision, the
same command accepts its token and applies only while the reviewed execution,
HEAD, accepted risks, state, and index remain unchanged.

## archive_batch_candidate

Accepts only a candidate ID, selection, and body-free pattern/index/seed
descriptors. It reads their eventual `.cadre/` relative paths from the
project-local candidate stage, derives the complete archive proposal, and
returns `approval_required` while storing only descriptors and metadata behind
the proposal token. After approval, the same command re-reads every staged
update and applies only when candidate bytes and project state match. Candidate
files remain through the archive commit checkpoint for recovery.

## archive_batch_record

Derives the existing archive commit, validates the deterministic provenance
update, and atomically records it across selected tracks, project history, and
batch journal in one call.

## execution_start

Derives, validates, and atomically creates a new execution journal and track
operation already authorized by the `implement` invocation. Approval mode
defaults to `phase`; resumes inherit the prior mode.

## execution_checkpoint

Accepts one semantic event—`start`, `record_commit`, `record_integration`,
`record_verification`, `complete`, `block`, or `resume`—and expands it into the
complete legal node-transition sequence with required evidence, applies it
atomically, and returns the changed-node receipt plus compact scheduling state
in one call.

## execution_status

Reads an execution journal and returns a compact scheduler view: execution
metadata, status counts, ready phases/tasks, active nodes, blockers, and
guidance for active or blocked nodes. Pass optional `nodeId` for complete detail
and guidance about one node. The complete journal remains canonical on disk and
is not echoed through this tool. Read-only.

## execution_finish

After required manual verification is recorded, verifies completed nodes,
current journal evidence, reachable commits, and removed worktrees; derives
HEAD/time and atomically writes plan commit markers, the completed journal,
`ready_for_review` state, and `tracks.md`.

## worktree_create

Derives one constrained phase/task worktree path, branch, parent, and exact base
commit, then creates or reconciles the derived worktree atomically. Task phase
identity and ancestry are inferred from the node ID and current registered
phase or canonical worktree. Idempotent for the same state.

## integration

Verifies clean source/target worktrees, protected `.cadre/` state, branch tips,
and changed files. In `phase` or `autonomous` mode it performs the non-squash
merge atomically. In `governed` mode it returns `approval_required`, then
accepts its unchanged token after the human decision. Conflicts are reported
and left for the main agent; the MCP does not resolve them.

## worktree_cleanup

Atomically verifies and removes only a clean, fully integrated worktree and
safely deletable branch when its node is `integrated` or already `completed`.
This is the only tool annotated as destructive.

## worktree_status

Lists registered Cadre-managed worktrees and orphaned empty runtime
directories. Read-only.

## project_init_candidate

Reads declared caller-rendered files from
`<project-root>/.cadre-stage/create/`, requires the stage to contain exactly
that supported file set, and returns `approval_required` with the complete
generated initialization manifest and digest. Artifact bodies are not MCP
inputs or proposal-record content. After approval, the same command accepts the
token, re-reads the stage, rejects changed bytes, writes deterministic outputs,
and atomically promotes it to `.cadre`.

## setup_record_commit

Records the already-created setup commit SHA and completes the pending create
operation.

## setup_record_git_initialized

Idempotently records that the caller verified Git initialization at the exact
approved project root.

## tracks_render

Reads every track-local state record, validates the exact deterministic
`tracks.md` output, and writes it atomically in one idempotent call.

## Common Guarantees

- Project roots must be existing directories and cannot be `/` or the user's
  home directory.
- Track, execution, batch, node, commit, digest, and timestamp formats are
  validated at the MCP boundary.
- `approval_required` output is not approval.
- Token-mode commands never accept a stale digest.
- Tool errors return a structured failure rather than partial success.
