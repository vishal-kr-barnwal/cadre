---
title: Roadmap
navTitle: Roadmap
description: GitHub Integration in Beta, with GitLab integration, a delivery knowledge base and polyrepo support planned.
section: Operations
order: 120
---

# Roadmap

| Capability | Status |
| --- | --- |
| [GitHub Integration](/github-collaboration) | **Beta** — implemented in the opt-in candidate |
| GitLab Integration | **Coming Soon** — planned future support |
| Knowledge Base During Delivery | **Coming Soon** |
| Polyrepo Support | **Coming Soon** |

All capabilities are optional, independently opt-in and disabled by default.
Local-only workflows remain unchanged. GitHub Beta is not part of the published
4.0.0 package; use a candidate containing the integration. No release dates are
committed for future capabilities.

## GitHub Integration — Beta

The [GitHub Integration Beta](/github-collaboration) supports shared PR ownership,
checkpoint pushes, phase synchronization, review and dependency gates, and
GitHub enforcement. CI requires an exact validator version containing the
integration or a digest-pinned candidate archive. Enabling it is an explicit
choice; local-only projects do not need a hosting-provider connection.

## GitLab Integration — Coming Soon

Future GitLab support will extend team coordination to GitLab merge requests,
shared work status, ownership and review handoffs. GitLab integration is planned
and is not implemented in the current Beta. It will also be explicitly opt-in.

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
