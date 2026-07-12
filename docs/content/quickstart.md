---
title: Quickstart
description: Take one Cadre-managed change from project setup through delivery and archive.
section: Start Here
order: 30
---

# Quickstart

This walkthrough shows the shortest complete Cadre lifecycle. It assumes Cadre
is [installed and verified](getting-started.md) and that you are working in a
target project, not in the Cadre harness repository.

## 1. Initialize The Project

Activate Cadre in your coding client, then ask for setup:

```text
$cadre
cadre-setup
```

Setup detects repository topology, provider remotes, build tools, and optional
language services. It returns one review stage at a time. Inspect each generated
target-path preview with normal Git tools and explicitly approve it before Cadre
continues. A preview written into `cadre/` is not approval by itself.

When setup finishes, verify the runtime:

```text
cadre-status
cadre-validate
```

Check the returned workspace health, provider mode, sync mode, and any degraded
LSP or integration evidence before starting work.

## 2. Create A Track

Describe one outcome rather than a list of implementation instructions:

```text
cadre-newtrack "Add organization-scoped API keys with revocation"
```

Cadre may ask bounded clarification questions. It then stages the canonical
spec and plan separately. Review acceptance criteria first, then tasks,
dependencies, file annotations, tests, and manual verification.

A useful track has:

- a user-visible or operator-visible outcome;
- explicit non-goals;
- testable acceptance criteria;
- tasks with dependencies and likely file scopes;
- required automated and manual verification.

## 3. Implement The Plan

Start implementation without manually choosing an internal task:

```text
cadre-implement
```

The workflow packet selects applicable project skills, resolves the next safe
task, returns bounded context, and may offer a parallel dispatch action when
the plan has independent phases and non-overlapping file claims. Follow only
the packet's returned next action.

As work completes, Cadre records task evidence, product commits when enabled,
events, notes, and trace information. Do not edit canonical task or event state
by hand.

## 4. Review The Result

```text
cadre-review
```

Review evaluates the current track against its spec, plan, tests, diagnostics,
reviewed commit identity, provider evidence, and configured policy. Address
blocking findings and rerun review until the gate is ready.

Use `cadre-debug` for a concrete failure with reproduction evidence. Use
`cadre-revise` when the accepted scope or plan genuinely needs to change.

## 5. Deliver

For a monorepo or ordinary single repository:

```text
cadre-ship
```

For a polyrepo control repository:

```text
cadre-land
```

Ship and land are publication workflows. They validate review state and return
provider actions; they do not authorize an agent to invent provider evidence or
bypass a review gate.

## 6. Archive And Inspect

After delivery:

```text
cadre-archive
cadre-status
```

Archive closes the active work while preserving its spec, plan, review,
journal, events, and traceability. Status should show no unexpected blockers,
leases, unfinished workers, or publication work.

## What To Learn Next

- Read [Capabilities](capabilities.md) to understand the whole product surface.
- Read [Core Concepts](how-cadre-works.md) for the packet and state model.
- Use [Configuration](configuration.md) and [Tuning](tuning.md) before enabling
  shared sync, strict provider evidence, or broader parallel execution.
- Keep [Troubleshooting](troubleshooting.md) nearby when a packet stops at a
  validation, approval, provider, or ownership boundary.
