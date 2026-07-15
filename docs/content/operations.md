---
title: Operating Cadre
description: Run health checks, upgrades, shared sync, provider readiness, traceability, recovery, and routine maintenance.
section: Operations
order: 110
---

# Operating Cadre

Operating Cadre means keeping three layers healthy: the installed client
integration, the packaged MCP runtime, and each target project's control plane.

## Routine Health Loop

Run these workflows at natural boundaries:

```text
cadre-status
cadre-validate
```

Status answers what work is active, blocked, reviewable, owned, or ready next.
Validate checks project structure, configuration, canonical artifacts,
generated projections, integrations, and workspace health.

Before implementation, confirm:

- the active root and track are correct;
- no unexpected ownership or lease conflict exists;
- selected project skills match the workflow and repository;
- workspace diagnostics identify the intended build and test adapters.

Before ship or land, confirm:

- review evidence is pinned to the intended commit or commits;
- automated and manual verification is present;
- required provider evidence is available;
- no worker or merge-back operation remains unfinished.

## Refresh Project Context

Treat refresh as an analysis and selection loop, not as a command that rewrites
all context automatically:

1. Call `cadre-refresh` without a level. Cadre inspects repository metadata,
   workspace and dependency evidence, topology, LSP recommendations, and
   projection health without mutating files.
2. Present its recommended multi-select levels to the user. The available
   levels are product, product guidelines, tech stack, style guides, repository
   topology, LSP, workflow, patterns, projections, and diagnostics.
3. Cadre filters selected review levels into `product`, `product_guidelines`,
   grouped `technical`, `workflow`, then `patterns`. The grouped technical
   stage atomically contains whichever of tech stack, style guides, repository
   topology, and LSP were selected.
4. Inspect the repository and pass complete `proposedContext` evidence for only
   the semantic documents in the active stage. An LSP-only technical stage can
   use Cadre's analyzed configuration directly. Do not submit empty objects or
   template text merely to pass an evidence gate. Review every file in that
   stage as one set; later stages stay pending and unmaterialized.
5. After explicit approval, pass the exact returned stage, stage hash, stage
   revision, and cumulative approved-stage prefix. After all selected stages
   are approved, invoke the exact returned final `next` call.

`diagnostics` is read-only. `projections` needs execution authorization but no
document approval. A selected LSP configuration is reviewed as part of the
grouped technical stage; the other document levels also require
evidence-backed content and staged approval.

## Upgrade The Installed Runtime

After installing a new `cadre-ai` package version, refresh native client
integration files:

```bash
npm install -g cadre-ai@latest
cadre install
cadre install --check
```

Restart clients that cache plugin or MCP configuration. Verify the installed
plugin version and confirm its MCP configuration resolves the expected global
`cadre-mcp` command.

## Shared Sync Hygiene

Shared sync moves Cadre's control-plane files through the configured remote and
branch. Keep product publication separate from control-plane synchronization.

- Pull before executing a shared-state mutation.
- Resolve canonical JSON conflicts deliberately; do not regenerate over them.
- Keep generated projections synchronized through Cadre packets.
- Review identity, ownership, leases, and messages after conflict resolution.
- Do not treat a shared control commit as proof that product code was shipped.

## Provider Readiness

Local provider mode intentionally skips hosted evidence. GitHub and GitLab
modes require supported provider evidence for publication gates. When readiness
is degraded, inspect the returned integration summary and fix authentication or
connector availability rather than changing evidence by hand.

## Traceability Maintenance

Cadre can record product commits, control commits, automation commits, journals,
events, and Git notes. Periodically verify that:

- the configured notes ref exists locally;
- pushing notes is compatible with repository policy;
- automation is not creating empty or unexpected commits;
- archived tracks retain their journal and review evidence;
- local wisps remain local unless explicitly configured otherwise.

## Recovery Order

When a workflow fails, recover from the narrowest authoritative evidence:

1. Read the packet's `decision`, `stage`, warnings, and typed `next` call.
2. Load only a resource URI returned for that failure.
3. Correct configuration, provider readiness, ownership, drift, or validation.
4. Rerun the same workflow as a dry run.
5. Use `cadre-debug` for a reproducible product defect.
6. Use `cadre-revert` only for a Cadre-managed local change that should be
   deliberately reversed.

Do not delete locks, task state, approval sessions, or generated indexes as a
first response. See [Troubleshooting](troubleshooting.md) for symptom-specific
procedures.

## Staged Preview Recovery

When a corrected payload targets files from an untouched, wholly unapproved
preview, rerun the workflow with the corrected payload. Cadre atomically
restores the recorded baseline and removes review-only Git intent-to-add state
before producing the new preview.

If any overlapping stage was approved, resume or explicitly cancel that
approval instead of starting a competing payload. `approval: {session_id}`
resumes that session without approving a stage. Cancellation uses the same
workflow with `approval: {session_id, cancel:true}`. It succeeds only
when preview content, the Git index, and the recorded HEAD baseline are
unchanged. If validation or restoration fails, Cadre keeps the session and
reports the paths that need deliberate recovery; never delete the session or
overwrite those files manually.

## Maintenance Checklist

- Run `cadre-refresh` when repository context has materially changed.
- Run artifact validation after canonical JSON or templates change.
- Archive completed tracks rather than leaving them active indefinitely.
- Remove stale ownership and leases through packet-owned operations.
- Keep project skills reviewed, narrowly targeted, and within budget.
- Verify native client installation after package upgrades.
