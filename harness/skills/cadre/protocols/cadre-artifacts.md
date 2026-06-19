---
description: Sync canonical Cadre artifacts with generated human projections
---

# Cadre Artifacts

This workflow is packet-only. Cadre MCP is mandatory. If a required packet
returns `ok:false`, halt and report the packet error. Do not recreate Cadre
control-plane, Beads, index, worktree, or provider state with shell commands.

Synchronize canonical Cadre artifacts and their human-readable projections.
Canonical JSON/JSONL is the source of truth; Markdown is a generated review
projection.

## Packet Flow

1. Resolve the project root with `cadre_project` using `action: "root"`.
2. For discovery, call `cadre_artifact` with `action: "catalog"` or
   `action: "schema"` and the requested `scope` or `artifact`.
3. For preview, call `cadre_artifact` with `action: "sync"` and the requested
   `scope`, `artifact`, `includeArchive`, or `importLegacy` options. Treat the
   first call as a dry run unless the user has explicitly approved execution.
4. Review `review_bundle` when present. The bundle contains full proposed
   canonical imports and generated projections on disk; show the manifest/path list
   and packet warnings instead of pasting full artifacts into model context.
5. To apply the reviewed synchronization, call `cadre_artifact` again with
   `action: "sync"`, the confirmed scope, `execute: true`, and
   `humanConfirmed: true`. Pass `force: true` only when the user explicitly
   approved replacing unmarked legacy projections.
6. Summarize changed canonicals, regenerated projections, skipped unmarked
   files, warnings, and the next owning workflow packet for any canonical edits.

Use `cadre_workflow` with `workflow: "artifacts"` or
`workflow: "artifact_sync"` only as an alias to the same artifact packet.

Common scopes:

- `all`: validate/import/render every known artifact.
- `track:<id>`: track spec, plan, learnings, handoff, and index projection for a
  single track.
- `styleguides`: selected style guide catalog and guide projections.
- `project`: product, product guidelines, workflow policy, patterns, repository
  topology, and project-level projections.

Canonical edits should happen through the owning workflow packet or
`cadre_artifact` with `action: "import"`. Artifact sync is primarily for
validation, legacy import, deterministic rendering, review bundles, and
projection synchronization.
