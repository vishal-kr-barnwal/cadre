---
title: Project Skill Reference
description: Manifest schema, selectors, budgets, references, targeting, validation, resources, and management actions.
section: Reference
order: 230
---

# Project Skill Reference

Project skills are repository-owned rule sets under
`cadre/skills/<skill-id>/`. They are discovered only from the resolved control
repository and do not fall back to a global catalog.

## File Layout

```text
cadre/skills/<skill-id>/
├── skill.json
├── SKILL.md
└── references/
    └── <reference files>
```

`skill.json` is canonical and is the source used for discovery and selection.
`SKILL.md` is a deterministic human-readable projection for Cadre-managed
create, update, and rename operations. A pre-existing hand-authored skill may
omit the projection, but Cadre never treats `SKILL.md` as canonical. References
are loaded lazily through Cadre resources.

## Manifest Identity

Every manifest uses:

```json
{
  "schema": "cadre.project-skill.v1",
  "version": 1,
  "id": "review-policy",
  "name": "Review Policy"
}
```

The directory ID, manifest ID, and requested selector must agree. IDs are
validated before a skill can enter workflow context.

## Selection

Selection combines:

- workflow selectors;
- optional polyrepo repository selectors;
- explicit `skillIds` requested by supported workflow input;
- rule-level selectors;
- enabled/disabled management state;
- deterministic ordering.

Explicit selection does not bypass validation or repository targeting.

## Rules And Budgets

Rules can be required or optional. Required applicable rules remain intact.
Optional rules share the effective `project_skills.inline_rule_budget`, which
defaults to 2400. Packets report selected IDs, omitted optional content, budget
source, and blocking diagnostics.

Use small actionable rules. Move long background material into a reference and
load it only when the packet returns its URI.

## References

A reference declaration identifies a safe repository-relative source, purpose,
and exposure conditions. Cadre validates supported file types, size, path
containment, and selector applicability. References never execute scripts.

Use:

```text
cadre://project-skill?root=/path&id=<skill-id>&reference=<reference-id>
```

only when a packet exposes the reference as relevant. Source formatting helpers
use the dedicated project-skill-source resource. Its returned URI contains a
short-lived opaque capability bound to one canonical root and file; a bare path,
an invented token, a token retargeted to another file, changed content, or a
symlinked source path is rejected.

## Polyrepo Targeting

Repository selectors apply to declared product repositories from
`cadre/repos.json`. Cadre resolves the workflow's current repo context before
selecting skills. An ambiguous or missing target produces diagnostics rather
than applying a possibly wrong repository rule.

## cadre-skill Management

The `cadre-skill` workflow manages repository skills through staged packet
operations. Supported behavior includes inspecting catalog/selection, creating
or updating skill sources, formatting projections, enabling/disabling skills,
and validating manifests. The workflow returns exact actions and review output;
do not mutate management state through ad hoc JSON edits.

Create and update always review `skill` before `references`. The `skill` stage
atomically contains `skill.json` and generated `SKILL.md`; only after its
approval can the collective references stage be formatted and materialized.
For a `source_path`, Cadre returns one capability-bound source read at a time
while the references stage is active. Supply incremental
`formattedReferences` or `formatted_references` values keyed by reference ID
through the exact `decision.resume` call, preserving the same approval session.
Future reference targets remain unmaterialized during formatting.

Rename and remove use one staged `mutation` review over the exact source,
destination, and deletion set. For every workflow, `approval: {session_id}`
alone resumes without approval. Only explicit approval may add the exact
returned `stage` and cumulative `approved_stages` prefix, and only the exact
returned final `next` call executes after all stages are approved.

## Resources

| Resource | Purpose |
|---|---|
| `cadre://project-skills` | Selection and diagnostics for a root and workflow. |
| `cadre://project-skill` | One manifest or one exposed reference. |
| `cadre://project-skill-source` | A capability-bound local text source requested for formatting. |

## Validation Failures

Validation fails for schema/version mismatch, unsafe paths, unsupported files,
duplicate IDs, selector errors, unresolved repository targets, missing required
sources, and required-rule contract overflow. Warnings cover optional omission
or non-blocking projection drift.

## Authoring Checklist

1. Give the skill one engineering responsibility.
2. Target only workflows and repositories that need it.
3. Mark only truly mandatory rules as required.
4. Keep inline rules concise and references lazy.
5. Validate selection for every intended workflow and repo.
6. Review the manifest and projection in Git.
7. Add repository tests or fixtures when the rule encodes executable policy.
