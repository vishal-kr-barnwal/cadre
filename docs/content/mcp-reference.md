---
title: MCP Reference
description: All immutable resources and registered Cadre 3.0 MCP tools.
section: Reference
order: 210
---

# MCP Reference

The `cadre` stdio server exposes immutable template resources and 36
purpose-built tools. It does not expose a generic `cadre_workflow` dispatcher or
arbitrary filesystem/shell operations.

## Template Resources

Every bundled template is readable at
`cadre://templates/v1/<relative-template-path>`. Resource metadata includes the
template-set version, media type, and content hash.

## template_catalog

Lists logical template IDs, resource URIs, paths, media types, and SHA-256
hashes. Read-only. Prefer known `template_get_many` bundles in workflow skills.

## template_get

Returns one immutable template by logical `id`. Read-only.

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

## execution_graph_validate

Parses one active track's `plan.md`, validates dependencies/cycles/barriers
against lifecycle state, and returns the derived graph and errors. Read-only.

## execution_graph_validate_draft

Parses an unapproved plan supplied directly as bounded Markdown, validates its
dependencies, cycles, derived manual-verification barriers, and intended target
lifecycle status, and returns the derived graph and errors. It accepts an
optional diagnostic source label but no project root or track path, so it
neither reads nor writes project files. Read-only.

## review_complete_preview

Previews a clean review cycle, completed track state, and exact derived index.
Inputs include reviewed timestamp/HEAD, commit range, approval, and optional
accepted risks. Read-only.

## review_complete_apply

Applies the clean-review completion only when the unchanged proposal digest is
still current.

## archive_batch_preview

Previews ordered selected-track moves, completed→archived states, pattern/seed
updates, operation journal, expected commits, and post-archive index. Read-only.

## archive_batch_apply

Journals and applies the complete approved archive batch behind its unchanged
digest.

## archive_batch_record_preview

Previews the follow-up state that records an existing archive commit across
selected tracks, project history, and batch journal. Read-only.

## archive_batch_record_apply

Records archive commit provenance and completes the batch journal behind a
stale-state digest.

## execution_start_preview

Previews a new execution journal and track operation for an approved plan,
scheduling mode, approval mode, worker bound, base commit, and timestamp.
Approval mode defaults to `phase`. Read-only.

## execution_start_apply

Creates the execution journal and enters `in_progress` only while the preview
digest remains current.

## execution_node_preview

Validates and previews one legal phase/task node transition and its evidence.
For a running phase, it can also preview a worker-lease release or reassignment
without advancing the phase status. Releasing a phase worker requires explicit
clean-checkpoint verification and is rejected while task workers are active.
Read-only.

## execution_node_apply

Applies one approved node transition with an unchanged digest.

## execution_nodes_preview

Validates and previews an ordered atomic batch of 1–128 immediately legal node
transitions. It must not span unavailable approval, commit, verification,
integration, or conflict evidence. Read-only.

## execution_nodes_apply

Applies the ordered transition batch behind one unchanged digest.

## execution_status

Reads an execution journal and derives ready phases, ready tasks within running
phases, active nodes, blockers, and overall execution status. Read-only.

## execution_finish_preview

Verifies completed nodes, current plan evidence, removed worktrees, and final
head before previewing `ready_for_review`. Read-only.

## execution_finish_apply

Finalizes the approved execution and track transition behind its digest.

## worktree_create_preview

Derives one constrained phase/task worktree path, branch, parent, and exact base
commit. Read-only.

## worktree_create_apply

Creates or reconciles the approved derived worktree. Digest-gated and
idempotent for the same state.

## integration_preview

Verifies clean source/target worktrees, protected `.cadre/` state, branch tips,
and changed files before a derived merge. Read-only.

## integration_apply

Performs the approved non-squash merge. Conflicts are reported and left for the
main agent; the MCP does not resolve them.

## worktree_cleanup_preview

Verifies a worker is clean and its branch fully integrated before proposing
worktree/branch removal. It also supports interruption recovery when the node
was already marked `completed`. Read-only.

## worktree_cleanup_apply

Removes only the approved clean, fully integrated worktree and safely deletable
branch when the journal node is `integrated` or already `completed`. This is the
only tool annotated as destructive.

## worktree_status

Lists registered Cadre-managed worktrees and orphaned empty runtime
directories. Read-only.

## project_init_preview

Validates approved rendered project files, project identity/context, Git
disposition, and base commit; returns the proposed `.cadre/` file set and
semantic digest. The `approvedAt` audit timestamp is shown and recorded but
does not affect the digest. Read-only.

## project_init_apply

Atomically creates `.cadre/` only when semantic inputs and preview digest are
unchanged, while recording the supplied `approvedAt` audit timestamp. It never
copies runtime code or templates into the project.

## setup_record_commit

Records the already-created setup commit SHA and completes the pending create
operation.

## setup_record_git_initialized

Idempotently records that the caller verified Git initialization at the exact
approved project root.

## tracks_render_preview

Reads every track-local state record and returns exact generated `tracks.md`
content plus a digest. Read-only.

## tracks_render_apply

Writes `tracks.md` only when current track state still matches the approved
preview digest.

## Common Guarantees

- Project roots must be existing directories and cannot be `/` or the user's
  home directory.
- Track, execution, batch, node, commit, digest, and timestamp formats are
  validated at the MCP boundary.
- Preview output is not approval.
- Apply never accepts a stale digest.
- Tool errors return a structured failure rather than partial success.
