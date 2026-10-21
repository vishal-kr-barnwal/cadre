---
title: Roadmap — Coming Soon
navTitle: Roadmap (Coming Soon)
description: Optional GitHub/GitLab team coordination, a knowledge base built during delivery, and polyrepo support.
section: Operations
order: 120
---

# Roadmap — Coming Soon

Cadre's upcoming roadmap has three capabilities, in this order:

1. **Deeper GitHub / GitLab integration** for work coordination across multiple
   people.
2. **A knowledge base built as work happens**, also used as context for delivery.
3. **Polyrepo support** for coordinated work across multiple repositories.

All three will be optional, independently opt-in and disabled by default. Teams
will be able to use the core single-repository workflow without enabling any of
these capabilities. They are planned beyond 4.0.0; no delivery dates are committed.

## GitHub / GitLab Coordination

The source tree now includes [opt-in GitHub collaboration](/github-collaboration)
with shared PR ownership, checkpoint pushes and enforcement generation. It is
unreleased and requires a published matching validator before CI activation.
GitLab integration remains Coming Soon.

Deeper integration will help multiple people coordinate shared work, ownership,
status and review handoffs through GitHub or GitLab. Enabling this integration
will be an explicit choice; the core workflow will not require a hosting-provider
connection.

## Knowledge Base During Delivery

An optional knowledge base will capture decisions, findings and learning while
work is being done, then make relevant knowledge available as context for later
planning, implementation and review. This extends the existing phase learning and
archive-derived patterns; those remain part of the current core workflow.
The new knowledge-base capability and its use for context will be opt-in.

## Polyrepo Support

Optional polyrepo coordination will connect work and dependencies across multiple
repositories while preserving repository-specific commits, review evidence and
approvals. Cadre 4.0 currently operates on one Git repository and one `.cadre/`
control plane at a time. Cross-repository coordination is not implemented in the
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
supported current contract.

## Polyrepo Design Considerations

Polyrepo mode is intended to preserve Cadre's existing guarantees. Its design
will need to make these boundaries concrete:

- repository identities, roots, remotes, and default branches;
- which repository owns shared product/workflow context;
- repo-qualified phase/task ownership and dependencies;
- per-repository worktree and commit provenance;
- cross-repository readiness and manual-verification barriers;
- partial integration and rollback behavior;
- review evidence for a change spanning several Git histories;
- resumable coordination when only part of a repository group succeeds.

State ownership and integration responsibility must remain explicit for each
operation. Workers must remain bounded to assigned repositories/worktrees, and
every cross-repository mutation must remain reviewable and recoverable.

## Until Polyrepo Ships

Use an independent Cadre project in each repository. Express external
repository prerequisites in the affected track's specification and additional
information, and coordinate their ordering outside Cadre.

Do not claim atomic cross-repository delivery. Review, complete, and archive
each repository's work against its own commits and verification evidence.

Operational setup instructions will be documented as each opt-in capability
becomes available. “Coming Soon” describes planned work, not a hidden or
experimental mode that can be enabled today.
