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
- use one atomic command when authorization already exists;
- call token mode only after an `approval_required` result and a human decision;
- inspect `project_status` once at command entry and reserve
  `state_validate` for final mutation gates;
- treat the plan as the implementation source of truth.

Skills contain the full workflow procedure. The MCP does not route generic
workflow packets.

## Template Resources

Every file under active `templates/v2/` is registered as an immutable MCP resource:

```text
cadre://templates/v2/<logical-id>
```

Published `templates/v1/` remains byte-stable for legacy reads. The internal
catalog records provider paths, but public descriptors expose logical ID, URI,
eventual artifact path, media type, and SHA-256 hash. Template content appears
once as an embedded resource, never duplicated in structured content.

Skills normally request known bundles with `template_get_many`; catalog
discovery is unnecessary when the logical IDs are already declared.

## Tool Families

| Family | Tools |
|---|---|
| Templates | `template_get_many`, `styleguide_resolve`, MCP resources |
| Project health | `project_status`, `state_validate` |
| Candidate artifacts | `candidate_stage_prepare`, `candidate_inspect` |
| Plan graph | `execution_graph_validate` |
| Review governance | `review_complete` |
| Archive governance | `archive_batch_candidate`, `archive_batch_record` |
| Execution lifecycle | `execution_start`, `execution_checkpoint`, `execution_status`, `execution_finish` |
| Worktrees | `worktree_create`, `integration`, `worktree_cleanup` |
| Project initialization | `project_init_candidate`, `setup_record_git_initialized`, `setup_record_commit` |
| Derived index | `tracks_render` |

The complete tool-by-tool contract is in [MCP Reference](mcp-reference.md).

## Result Shape

Successful operational tools return concise text and typed structured content.
Template tools return embedded resource bodies plus content-free descriptors.
Adaptive commands return `commandStatus: "applied"` when an existing
authorization permits an atomic mutation. Only a real decision boundary
returns `commandStatus: "approval_required"` plus a compact opaque
`proposalToken`; after approval, the same command accepts that token. Tokens
survive MCP restarts until expiry or bounded oldest-first eviction.
Failures mark the MCP result as an
error and return structured `{ error: { code, message, details? } }` content.
`project_status` also returns its human-readable summary as text.

Inputs are validated with Zod before reaching domain behavior. Track, phase,
task, execution, batch, commit, digest, and timestamp formats are constrained at
the tool boundary.

## Adaptive Command Contract

Each adaptive tool advertises a required `mode: prepare | apply`. Prepare
accepts only its operation fields; apply accepts only `proposalToken`. An
already-authorized command computes its proposal once, validates current
state, and applies atomically in one tool call. When human approval is required,
the command computes without mutation, retains normalized input and digest in
an MCP-owned runtime record, and returns an opaque capability token. After the
human decision, the same command resolves the token, recomputes the proposal,
and refuses stale state. Callers never provide proposal paths or an
`autoApprove` flag.

Artifact bodies use a separate file-backed protocol. Skills write unapproved
files beneath `<project-root>/.cadre/stage/<candidate-id>/`; candidate tools
read those files through path, symlink, and size guards and return only a
path/hash manifest. Proposal records retain the candidate identifier, relative
paths, normalized metadata, and digest—not artifact bodies. Apply re-reads the
stage and rejects changed bytes before promoting or consuming it. The visible
stage remains outside commits and is retained through the artifact commit
checkpoint for recovery.

Execution checkpoints return compact changed-node receipts and scheduler state.
Implementation entry uses one `project_status` implementation view for project,
graph, scheduler, and worktree preflight.

Not every workflow write has a dedicated MCP mutation. Track drafting,
revision, refresh, remediation, and revert use skill-side candidate staging,
digest-bound approval journals, direct promotion, MCP validation, and
derived-index gates. Contributors should not add generic file-write tools to
erase that explicit ownership boundary.

## Git Boundary

MCP Git operations are limited to Cadre-derived worktrees:

- create/reconcile a worker worktree and record node start;
- non-squash merge a clean worker branch and record integration;
- report conflicts without resolving them;
- remove a clean integrated worktree/branch and record completion.

The runtime never commits product changes for a worker, stages arbitrary files,
resets history, force-deletes branches, or decides conflict resolution.

## Adding Or Changing A Tool

1. Put reusable behavior and typed inputs/outputs in the relevant domain
   module.
2. Add boundary validation and narrow annotations in `src/mcp/server.ts`.
3. Add positive, rejection, stale-digest, and recovery coverage.
4. Update the owning skill contract and MCP reference.
5. Run harness check, tests, validation, and package inspection.
