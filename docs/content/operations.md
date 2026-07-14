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

## Maintenance Checklist

- Run `cadre-refresh` when repository context has materially changed.
- Run artifact validation after canonical JSON or templates change.
- Archive completed tracks rather than leaving them active indefinitely.
- Remove stale ownership and leases through packet-owned operations.
- Keep project skills reviewed, narrowly targeted, and within budget.
- Verify native client installation after package upgrades.
