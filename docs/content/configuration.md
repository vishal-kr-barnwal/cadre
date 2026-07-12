---
title: Configuration
description: Choose safe defaults for project sync, provider evidence, review policy, traceability, and project-skill context.
section: Operations
order: 90
---

# Configuration

Cadre stores project operating policy in `cadre/config.json`. Setup creates a
conservative baseline; maintainers review changes through normal Git history.
Use the [Configuration Reference](configuration-reference.md) for every key.

## A Practical Baseline

For a solo project that does not require hosted pull-request evidence:

```json
{
  "sync_mode": "local",
  "provider_mode": "local",
  "project_skills": {
    "inline_rule_budget": 2400
  },
  "traceability": {
    "auto_product_commits": true,
    "auto_control_commits": true,
    "git_notes": true,
    "push_notes": true
  }
}
```

This is a subset, not a replacement template. Keep setup-generated keys unless
you have verified their effect and default in the reference.

## Configuration Model

Cadre reads the active control repository's configuration after resolving the
project root. Workflow inputs can provide supported per-call values, such as
provider or sync selections during setup, but persistent project policy belongs
in `cadre/config.json`.

Configuration affects four distinct concerns:

| Concern | Important keys | Typical decision |
|---|---|---|
| State movement | `sync_mode`, `control_remote`, `control_branch` | Keep local or share the Cadre control plane. |
| Review and publication | `require_second_reviewer`, `allow_unreviewed_ship`, `allow_unpinned_review_ship` | Decide how strictly ship/land gates evidence. |
| Hosted provider | `provider_mode`, `provider_mcp_required`, `remote_host` | Use local evidence or require GitHub/GitLab integration evidence. |
| Context and trace | `project_skills`, `coverage_command`, `traceability`, `merge_train` | Bound context, tests, commits, notes, and publication grouping. |

## Configuration Precedence

For behavior that supports a workflow override, an explicit packet input wins
for that call. Otherwise Cadre uses project configuration, detected repository
information, and finally the runtime default. Detection is evidence, not a
license to silently replace an explicit project policy.

Provider selection follows this shape:

```text
explicit workflow input -> configured provider_mode -> unambiguous remote detection -> local
```

## Safe Change Procedure

1. Change one policy group at a time.
2. Run `cadre-validate` and inspect workspace health.
3. Run `cadre-status` and confirm the reported provider and sync modes.
4. Exercise the affected workflow as a dry run before publication.
5. Review control-plane and Git-note behavior with another contributor when
   enabling shared automation.
6. Record the rationale in the configuration change.

## Operational Checks

After configuration changes, verify:

- provider mode matches the repository host and integration availability;
- shared sync points at the intended remote and branch;
- review policy cannot accidentally bypass commit pinning;
- coverage commands run from the expected repository root;
- project-skill diagnostics show the intended budget and selected skills;
- trace commits and Git notes match the team's repository policy;
- merge-train automation is enabled only for teams that use it.

> Conservative settings are intentionally easier to relax than permissive
> publication settings are to audit after the fact.
