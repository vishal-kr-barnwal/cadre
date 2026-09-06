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
- treat the plan as the implementation source of truth;
- read `structuredContent` when present, otherwise parse the final JSON text block.

Skills contain the full workflow procedure. The MCP does not route generic
workflow packets.

## Template Resources

Every file under active `templates/v3/` is registered as an immutable MCP resource:

```text
cadre://templates/v3/<logical-id>
```

Published `templates/v1/` and `templates/v2/` remain byte-stable for legacy reads. The internal
catalog records provider paths, but public descriptors expose logical ID, URI,
eventual artifact path, media type, and SHA-256 hash. Template content appears once: inside structured template descriptors for
recognized structured clients, or as embedded resources/text blocks for text
clients. `contentMode` selects body encoding only for text clients.

Skills normally request known bundles with `template_get_many`; catalog
discovery is unnecessary when the logical IDs are already declared.

Candidate inspection binds an exact path/hash manifest and explicit validation
context for every staged root or nested `plan.md`. A staged track proposal is
reported separately from canonical track state until its approved files and
operation journal are promoted.

## Tool Families

| Family | Tools |
|---|---|
| Templates | `template_get_many`, `styleguide_resolve`, MCP resources |
| Project health | `project_status`, `state_validate` |
| Required context | `context_read` |
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

The server selects a single result representation from the MCP initialization
client name and version. Recognized Codex names (`codex`, `codex_cli_rs`,
`codex-mcp-client`, `codex_desktop`) and `claude-code` version 2.0.21+ receive
`structuredContent` with `content: []`. Zed, older Claude Code, and unidentified
clients receive compact JSON text without a structured duplicate. Unknown or
proxy client identities deliberately use the text fallback; MCP has no standard
client capability for structured result consumption.

All 23 tools advertise output schemas to structured clients. Text clients do not
receive output schemas, since MCP requires structured content when a schema is
advertised. Server-side success-payload validation remains active in both modes.
Errors retain `isError` and use one JSON text block for every client. This keeps native Claude diagnostics visible without duplicating the payload. No extra prose summary is emitted.

Template bodies occur once: inside structured descriptors, or in the requested
text/embedded-resource mode followed by content-free descriptor JSON for text
clients. Candidate inspection still returns manifests rather than file bodies.
Adaptive commands return `commandStatus: "applied"` when an existing
authorization permits an atomic mutation. Only a real decision boundary
returns `commandStatus: "approval_required"` plus a compact opaque
`proposalToken`; after approval, the same command accepts that token. Tokens
survive MCP restarts until expiry or bounded oldest-first eviction.
Failures contain `{ error: { code, message, details? } }` JSON. Successes have no extra prose summary.

Inputs are validated with Zod before reaching domain behavior. Track, phase,
task, execution, batch, commit, digest, and timestamp formats are constrained at
the tool boundary. Output schemas use Node-18-compatible object roots that
advertise the complete stable field superset; server-side refinements still
require each emitted value to match one exact success or structured-error
variant. The serialized catalog is capped at 80 KiB.

## Adaptive Command Contract

Each adaptive tool advertises a required `request` object whose schema is a
strict `prepare | apply` discriminated union. Prepare accepts only its exact
operation fields; apply accepts only `proposalToken`. Mixed-mode input is
rejected by schema validation. An
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
Their wire shape separates stable `scope` from an event-specific `action`, so
required commit, verification, authorization, or blocker evidence is visible
in the published schema. Completion evidence remains state-dependent.
Implementation entry uses one `project_status` implementation view for project,
graph, scheduler, and worktree preflight.

Candidate producers pass the complete `expectedFiles` set on every prepare.
This makes clarification-driven scope contraction convergent: obsolete regular
files are removed only inside the owned ignored candidate stage after a full
symlink/non-file preflight.

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

## Memory and inspection cost

Template v3 adds a marked JSON memory block inside Pattern Seed: schema version 1, spec/plan revisions, and safe pattern paths with SHA-256 fingerprints. Structural corruption is invalid state; stale active guidance is reported separately and blocks dependent execution until reassessed. Terminal history remains evidence of its original context. Semantic reassessment stays within existing human-governed workflows.

Task handoffs persist within execution checkpoints, with an 8 KiB cap and no new approval or mutation call. Context reads use dependency/section selection with conservative fallback, source hashes, and drift-sensitive pagination. Summaries never replace original scope, affected code inspection, or authorization.

Validation reuses file contents and parsed journals within one read-only inspection. Parsed plans are reused by status, and Git reachability resolves recorded commits in a single `cat-file --batch-check` process after history enumeration. No cache survives the validation operation. Full mutation gates remain in force.

`node --import tsx --test test/memory.test.ts` from `harness/` runs recovery, freshness, client-format, and context-size scenarios. Diagnostics report bytes, file reads/reuse, Git process counts, and timings. The 100-task fixture compares the former full-read behavior with scoped reads on the same evidence corpus; it is not a claim about billed tokens or live-agent task success. Small-project overhead is reported separately, and client schema catalog growth is measured rather than hidden.

Retained-source inventories are session-scoped declarations, not a server cache. The runtime rechecks hashes on each read and explicitly marks reused sections; fresh sessions must reacquire their text. Markdown fences do not define learning sections, and ambiguous structure expands the read.
