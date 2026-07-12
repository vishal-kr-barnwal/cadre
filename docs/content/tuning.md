---
title: Tuning
description: Tune Cadre for solo work, shared teams, polyrepos, strict review, large skill catalogs, and safe parallelism.
section: Operations
order: 100
---

# Tuning

Tune Cadre around repository risk, team topology, and context size. Start from
the generated defaults, measure packet evidence and workflow friction, then
change one control at a time.

## Tuning Profiles

| Profile | Recommended direction | Watch for |
|---|---|---|
| Solo project | Local sync and provider modes; keep automatic local trace commits and notes | Unnecessary hosted evidence or shared-sync overhead. |
| Shared team | Shared sync, explicit control branch, provider evidence, second reviewer where required | Control-plane conflicts, stale identity, and pushed-note policy. |
| Polyrepo | Explicit repo map, provider integration, merge train, repo-scoped ownership | Ambiguous repo selection and cross-repo review drift. |
| Strict review | Require second reviewer; keep unreviewed and unpinned ship overrides disabled | Self-review, stale reviewed SHAs, or missing manual verification. |
| Large skill catalog | Keep workflow/repo selectors narrow; adjust inline budget only after inspecting diagnostics | Optional guidance crowding out task context. |
| Parallel delivery | Annotate dependencies and file scopes; grow worker waves gradually | Overlapping claims, weak finish evidence, and merge-back conflicts. |

## Project-Skill Context Budget

`project_skills.inline_rule_budget` defaults to `2400`. The budget bounds
optional inline rule context across selected project skills. Required rules are
not silently truncated; if required content alone exceeds the available
contract, the packet reports a blocking diagnostic.

Tune the budget when:

- selected optional rules are consistently omitted and materially needed;
- several narrowly targeted skills legitimately apply to the same workflow;
- packet context remains comfortably below the client's usable limit.

Do not raise it to compensate for unscoped skills. First narrow workflows,
repository selectors, rule selectors, and lazy references.

## Review Strictness

Keep these defaults for most repositories:

```json
{
  "require_second_reviewer": false,
  "allow_unreviewed_ship": false,
  "allow_unpinned_review_ship": false
}
```

Enable `require_second_reviewer` for protected or regulated delivery paths.
The two `allow_*` settings are escape valves and should remain false unless the
repository has an explicit alternative evidence policy.

## Provider Evidence

Use `provider_mode:"local"` for work that intentionally does not depend on
hosted pull requests or checks. Use `github` or `gitlab` when ship/land must
reason about hosted review and CI. In hosted modes, missing provider MCP
evidence is a real gate rather than a reason to invent CLI evidence.

## Traceability

Automatic product and control commits reduce unfinished state, but they also
shape commit history. Tune them as a group with Git-note policy:

- keep product commits on when task completion should be durable immediately;
- keep control commits on when Cadre state changes must be traceable;
- keep automation commits on for packet-owned maintenance;
- leave local wisps uncommitted unless the team intentionally shares them;
- push Git notes only when the remote and team workflow support the notes ref.

## Parallel Throughput

Cadre does not expose a single “go faster” switch. Throughput comes from better
plans:

1. Split work into dependency-correct phases.
2. Give each task precise file claims and tests.
3. Keep shared foundation work sequential.
4. Dispatch only independent ready tasks.
5. Require worker finish evidence for owned files and tests.
6. Merge and validate each wave before expanding concurrency.

## Measure The Result

Use status, project-skill diagnostics, worker state, review evidence, provider
readiness, and test impact to decide whether a change helped. Revert tuning that
increases warnings, ambiguity, context omission, or recovery work without a
clear delivery benefit.
