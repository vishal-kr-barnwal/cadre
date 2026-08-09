---
title: Runtime And MCP
description: The stdio server, immutable resources, tool families, schemas, and mutation guarantees.
section: Contributor Guide
order: 150
---

# Runtime And MCP

`dist/cadre-mcp.mjs` is a self-contained Node.js stdio MCP server built from
`harness/src/mcp/server.ts`. It identifies itself with the package runtime
version and exposes immutable templates plus purpose-built project-state tools.

## Server Instructions

The server tells clients to:

- read existing artifacts before proposing edits;
- present complete proposed artifacts before mutation;
- call preview immediately before its matching apply;
- pass only opaque proposal tokens to apply tools;
- inspect `project_status` once at command entry and reserve
  `state_validate` for final mutation gates;
- treat the plan as the implementation source of truth.

Skills contain the full workflow procedure. The MCP does not route generic
workflow packets.

## Template Resources

Every file under `templates/v1/` is registered as an immutable MCP resource:

```text
cadre://templates/v1/<relative-template-path>
```

The catalog records logical ID, URI, relative path, media type, content, and
SHA-256 hash. The server caches the immutable catalog for its lifetime.

Skills normally request known bundles with `template_get_many`; catalog
discovery is unnecessary when the logical IDs are already declared.

## Tool Families

| Family | Tools |
|---|---|
| Templates | `template_catalog`, `template_get`, `template_get_many`, `styleguide_resolve` |
| Project health | `project_status`, `state_validate` |
| Plan graph | `execution_graph_validate`, `execution_graph_validate_draft` |
| Review governance | `review_complete_preview`, `review_complete_apply` |
| Archive governance | `archive_batch_preview`, `archive_batch_apply`, `archive_batch_record_preview`, `archive_batch_record_apply` |
| Execution lifecycle | `execution_start_*`, `execution_checkpoint_*`, `execution_status`, `execution_finish_*` |
| Worktrees | `worktree_create_*`, `integration_*`, `worktree_cleanup_*`, `worktree_status` |
| Project initialization | `project_init_preview`, `project_init_apply`, `setup_record_git_initialized`, `setup_record_commit` |
| Derived index | `tracks_render_preview`, `tracks_render_apply` |

The complete tool-by-tool contract is in [MCP Reference](mcp-reference.md).

## Result Shape

Successful tools return their typed value as structured content.
Mutation previews expose a compact opaque `proposalToken` that resolves to
normalized input and its SHA-256 digest retained in Cadre's bounded user-local
runtime cache; apply tools accept only that token. Tokens survive MCP restarts
until expiry or bounded oldest-first eviction.
Failures mark the MCP result as an
error and return structured `{ error: { code, message, details? } }` content.
`project_status` also returns its human-readable summary as text.

Inputs are validated with Zod before reaching domain behavior. Track, phase,
task, execution, batch, commit, digest, and timestamp formats are constrained at
the tool boundary.

## Preview/Apply Contract

A preview computes all consequences without mutating project or Git state,
retains the normalized proposal in an MCP-owned runtime record, and returns an
opaque capability token. Apply resolves the bound input and digest, recomputes
the proposal, and refuses stale state. Callers never provide proposal paths.

Execution checkpoints return compact changed-node receipts and scheduler state.
Execution status returns ready/active/blocked summaries by default and accepts
an optional node ID for focused guidance. Skills use that contract to build
ordered batches; previews validate those batches and are not used as
state-machine probes.

Read-only previews are not approval. Skill contracts remain responsible for
presenting the exact proposal and obtaining explicit human acceptance before
apply.

Not every workflow write has a dedicated MCP mutation. Track drafting,
revision, refresh, remediation, and revert use journaled skill-side artifact
writes plus MCP validation and derived-index gates. Contributors should not add
generic file-write tools to erase that explicit ownership boundary.

## Git Boundary

MCP Git operations are limited to Cadre-derived worktrees:

- preview/create a worker worktree at an exact base commit;
- preview/non-squash merge a clean worker branch into its derived parent;
- report conflicts without resolving them;
- preview/remove a clean worktree and safely deletable integrated branch;
- report registered worktrees and orphaned empty runtime directories.

The runtime never commits product changes for a worker, stages arbitrary files,
resets history, force-deletes branches, or decides conflict resolution.

## Adding Or Changing A Tool

1. Put reusable behavior and typed inputs/outputs in the relevant domain
   module.
2. Add boundary validation and narrow annotations in `src/mcp/server.ts`.
3. Add positive, rejection, stale-digest, and recovery coverage.
4. Update the owning skill contract and MCP reference.
5. Run harness check, tests, validation, and package inspection.
