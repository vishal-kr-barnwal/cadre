---
title: Polyrepo Mode — Coming Soon
navTitle: Polyrepo (Coming Soon)
description: Current single-repository boundary and the planned direction for coordinated multi-repository delivery.
section: Operations
order: 120
---

# Polyrepo Mode — Coming Soon

Cadre 3.0 operates on one Git repository and one `.cadre/` control plane at a
time. Coordinated polyrepo delivery is planned, but it is not part of the
current runtime or workflow set.

## Current Boundary

Today:

- `create` initializes context for one repository root;
- a track's plan, execution journal, commits, worktrees, review, and archive
  history belong to that repository;
- worktree paths and Git operations are derived inside that repository;
- state validation assumes one canonical Git history;
- no `ship`, `land`, provider-evidence, merge-train, or cross-repository
  workflow is installed.

Do not create an ad hoc multi-repository `repos.json`, copy one `.cadre/`
directory across repositories, or treat old 2.x ship/land documentation as a
supported 3.0 contract.

## Planned Direction

Polyrepo mode is intended to preserve Cadre's existing guarantees while adding
an explicit control-repository model. Any future design needs to make these
boundaries concrete:

- repository identities, roots, remotes, and default branches;
- which repository owns shared product/workflow context;
- repo-qualified phase/task ownership and dependencies;
- per-repository worktree and commit provenance;
- cross-repository readiness and manual-verification barriers;
- partial integration and rollback behavior;
- review evidence for a change spanning several Git histories;
- resumable coordination when only part of a repository group succeeds.

The main agent must remain the sole state owner and integrator. Workers must
remain bounded to assigned repositories/worktrees, and every cross-repository
mutation must remain explicit, reviewable, and recoverable.

## Until Polyrepo Ships

Use an independent Cadre project in each repository. Express external
repository prerequisites in the affected track's specification and additional
information, and coordinate their ordering outside Cadre.

Do not claim atomic cross-repository delivery. Review, complete, and archive
each repository's work against its own commits and verification evidence.

This page will become the operational polyrepo guide when the runtime and skill
contracts exist. Until then, “Coming Soon” is a product boundary, not a hidden
or experimental mode.
