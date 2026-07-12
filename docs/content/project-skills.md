---
title: Project Skills
description: Repository-owned Cadre rules, selectors, references, and multi-skill loading.
section: Core Concepts
order: 5
---

# Project Skills

Project skills let a repository supply workflow-specific engineering rules
without installing another global plugin. Cadre discovers them only from the
active project's `cadre/skills/` directory.

Each skill has a canonical JSON manifest and may include human documentation
and detailed references:

```text
cadre/skills/<skill-id>/
├── skill.json        # canonical cadre.project-skill.v1 manifest
├── SKILL.md          # optional human-readable documentation
└── references/       # optional Markdown, JSON, YAML, or text references
```

The manifest `id` must match `<skill-id>`. Its `name` is only a display label
and may be more descriptive.

## Monorepo Example

Consider a monorepo with a web application, API service, and shared packages:

```text
apps/web/
services/api/
packages/shared/
cadre/skills/
├── architecture/skill.json
├── web-ui/skill.json
└── api-contracts/skill.json
```

Monorepos normally use `file_patterns` to target workspace areas. The `repos`
selector is intended for named repositories in a polyrepo control plane.

An always-applicable architecture skill can provide project-wide rules:

```json
{
  "version": 1,
  "schema": "cadre.project-skill.v1",
  "id": "architecture",
  "name": "Architecture boundaries",
  "description": "Rules shared by the entire monorepo",
  "selectors": {
    "workflows": ["implement", "review"]
  },
  "rules": [
    {
      "id": "dependency-direction",
      "text": "Applications may depend on packages; packages must not depend on applications.",
      "priority": 10,
      "required": true
    }
  ],
  "references": []
}
```

The web skill applies only when affected files are under `apps/web/`:

```json
{
  "version": 1,
  "schema": "cadre.project-skill.v1",
  "id": "web-ui",
  "name": "Web UI",
  "description": "Frontend implementation and accessibility rules",
  "selectors": {
    "workflows": ["implement", "review"],
    "file_patterns": ["apps/web/**"]
  },
  "rules": [
    {
      "id": "accessibility",
      "text": "Interactive controls must remain keyboard accessible and expose an accessible name.",
      "priority": 10,
      "required": true,
      "references": ["accessibility-checklist"]
    }
  ],
  "references": [
    {
      "id": "accessibility-checklist",
      "path": "references/accessibility.md",
      "when": {
        "workflows": ["review"],
        "file_patterns": ["apps/web/**"]
      }
    }
  ]
}
```

The API skill follows the same pattern with
`"file_patterns": ["services/api/**"]`. A track changing both
`apps/web/checkout.tsx` and `services/api/checkout.ts` can therefore load the
architecture, web, and API skills together.

## How Multiple Skills Are Loaded

Cadre supports any number of project skills. For each workflow packet it:

1. Discovers directories containing `cadre/skills/<id>/skill.json` and orders
   their IDs alphabetically for deterministic results.
2. Determines target repositories and files from explicit packet input, the
   supplied plan, or the selected track's plan.
3. Selects every skill whose workflow, repo, and file selectors match. Skills
   are additive; Cadre does not stop after the first match.
4. Sorts each selected skill's applicable rules by numeric `priority`, then by
   rule ID, and includes complete atomic rules in the workflow packet.
5. Exposes only rule references whose own `when` selectors also match. Reference
   bodies stay out of the packet and are read through their returned resource
   URI only when needed.

For a web-only implementation, `architecture` and `web-ui` match while
`api-contracts` does not. For a cross-stack change, all three can match.

All selected rule text shares a 2,400-character inline budget. Cadre never cuts
a rule in the middle:

- If required rules exceed the budget, the workflow blocks with a
  `narrow_scope` decision so the caller can specify narrower files or repos.
- Optional rules that do not fit are omitted with a warning and a targeted
  project-skill resource URI.

Invalid automatically discovered manifests produce warnings. Explicitly
requesting a missing or invalid skill through `skillIds` blocks the packet.

## Skill References

References hold detailed guidance that would be wasteful to include in every
workflow packet: checklists, API contracts, architectural notes, examples, or
domain policies. They are declarative context, not executable scripts.

### Declaring And Attaching A Reference

A reference needs two connections in `skill.json`:

1. An entry in the manifest-level `references` catalog defines its ID, file,
   and optional selectors.
2. At least one rule lists that reference ID. Declaring a reference without
   attaching it to an applicable rule does not expose it during selection.

```json
{
  "rules": [
    {
      "id": "public-api-review",
      "text": "Review compatibility before changing public API responses.",
      "priority": 10,
      "required": true,
      "references": ["api-compatibility", "error-format"]
    }
  ],
  "references": [
    {
      "id": "api-compatibility",
      "path": "references/api-compatibility.md",
      "when": {
        "workflows": ["review"],
        "file_patterns": ["services/api/**"]
      }
    },
    {
      "id": "error-format",
      "path": "references/error-format.json"
    }
  ]
}
```

Reference IDs use lowercase kebab case, like skill IDs. Every ID listed by a
rule must exist in the manifest reference catalog or the skill is invalid.

### When A Reference Is Exposed

Cadre exposes a reference descriptor only when all of these conditions hold:

1. The skill is selected.
2. The rule that lists the reference is applicable.
3. The reference's own `when.workflows`, `when.repos`, and
   `when.file_patterns` selectors match the current workflow targets.

Omitting `when` makes the reference eligible whenever an applicable rule lists
it. A reference selector can only narrow rule applicability; it cannot make an
otherwise inapplicable rule or skill match.

The workflow packet contains metadata and a targeted resource URI, not file
content:

```json
{
  "id": "api-compatibility",
  "resource_uri": "cadre://project-skill?root=/repo&id=api-review&reference=api-compatibility"
}
```

This descriptor is nested under the rule that requested it. A rule may expose
multiple matching references, and the same reference may be attached to more
than one rule.

### Loading Reference Content

References are not read automatically merely because they match. The agent
first applies the inline rule and calls `cadre_read` with the returned URI only
when the detailed material is necessary:

```json
{
  "uri": "cadre://project-skill?root=/repo&id=api-review&reference=api-compatibility"
}
```

The resource response contains the selected reference only:

```json
{
  "ok": true,
  "data": {
    "skill_id": "api-review",
    "reference": {
      "id": "api-compatibility",
      "path": "references/api-compatibility.md",
      "bytes": 1840,
      "content": "..."
    }
  }
}
```

Use the targeted `&reference=<id>` form for normal agent work. Reading
`cadre://project-skill?root=/repo&id=api-review` without a reference ID returns
the complete skill detail including every reference body, which is useful for
diagnostics but can consume substantially more context.

Reference bodies do not count against the 2,400-character inline rule budget
because they are not part of the selection packet. Once explicitly loaded,
their content still consumes model context, so references should remain focused
and should be fetched only when needed.

### Supported Files And Safety Checks

Reference paths are resolved relative to the skill directory. Cadre accepts:

- Markdown: `.md`
- Plain text: `.txt`
- JSON: `.json`
- YAML: `.yaml` and `.yml`

Each reference must be a regular, non-binary file no larger than 128 KiB. Cadre
rejects absolute paths, `..` traversal, unsupported extensions, missing files,
oversized files, and symlinks that resolve outside the skill directory. It
returns content as text; JSON and YAML references are not executed or merged
into Cadre state.

An invalid reference makes its containing skill invalid. Automatically
discovered invalid skills produce workflow warnings, while explicitly selecting
one through `skillIds` blocks the workflow. Requesting an unknown reference ID
through `cadre_read` returns an error instead of falling back to another file.

## Workflow Support And Targeting Caveats

Cadre evaluates project skills for every supported workflow:

| Workflow group | Workflows |
|----------------|-----------|
| Creation and planning | `setup`, `newtrack`, `revise`, `refresh`, `formula` |
| Implementation | `implement`, `debug`, `flag`, `revert`, `handoff` |
| Inspection and quality | `status`, `review`, `validate` |
| Publication and maintenance | `ship`, `land`, `archive`, `release`, `artifacts` |

Use `"workflows": ["*"]` when a skill or rule should be eligible in every
workflow. Internal aliases are normalized before selection: `new_track`
becomes `newtrack`, `setup_assist` and `setup_scaffold` become `setup`, and
`artifact_sync` becomes `artifacts`.

### How Target Files Are Resolved

Cadre combines file targets explicitly supplied as `files`, completion evidence
supplied as `filesChanged`, and files declared by a supplied plan. If none are
available, it reads file claims from the selected track's `plan.json`. Without
any of those inputs, the target file list is empty.

This has an important consequence: a non-empty `file_patterns` selector cannot
match an empty target list. Track-oriented workflows such as `implement`,
`review`, `ship`, `land`, `revise`, `handoff`, `flag`, and `revert` commonly
have track plan files available. Project-wide workflows such as `setup`,
`status`, `release`, `formula`, and an unscoped `validate` commonly do not.

For project-wide guidance, omit `file_patterns` and select only by workflow:

```json
{
  "selectors": {
    "workflows": ["setup", "validate"]
  }
}
```

File patterns match the complete project-relative path. `*` matches within one
path segment, while `**` can span directories. Keep paths in plans and packet
input normalized to forward-slash project-relative form.

### How Target Repositories Are Resolved

Cadre combines an explicit `repo`, explicit `repos`, and repo annotations in a
supplied plan. If none are present, it uses repositories claimed by the
selected track. A monorepo defaults to the root repo (`.`); a polyrepo without
a resolved target has an empty repo list.

Only `.` and `root` are valid monorepo repo selectors. Named selectors such as
`api` or `web` must correspond to repositories declared by the polyrepo control
plane. In a monorepo, use `file_patterns` to distinguish workspaces.

### Skill, Rule, And Reference Selectors

Selection happens at three independent levels:

1. Skill selectors decide whether the manifest participates.
2. A selected skill may contain rules with narrower `when` selectors. Rules
   without `when` restrictions apply whenever their skill is selected.
3. A reference is exposed only when an applicable rule lists its ID and the
   reference's own `when` selectors match.

For example, one web skill can provide implementation and review behavior
without duplicating manifests:

```json
{
  "selectors": {
    "workflows": ["implement", "review"],
    "file_patterns": ["apps/web/**"]
  },
  "rules": [
    {
      "id": "implementation",
      "text": "Use components from the shared design system.",
      "when": { "workflows": ["implement"] }
    },
    {
      "id": "review",
      "text": "Verify keyboard and accessible-name behavior.",
      "when": { "workflows": ["review"] }
    }
  ]
}
```

Explicit `skillIds` bypass a skill's top-level selectors, which is useful for a
user-requested specialist skill. The rules inside that skill still apply their
own `when` selectors. Explicitly naming a missing or invalid skill blocks the
workflow instead of silently ignoring it.

### Ordering And Budget Behavior

Skill directories are processed alphabetically by ID. Inside each skill, rules
are ordered by numeric priority and then rule ID. Priority is therefore local
to a skill; it does not reorder rules globally across different skills.

The shared 2,400-character budget is consumed in that deterministic order. A
required rule that does not fit blocks the workflow and returns a
`narrow_scope` decision. A non-required rule that does not fit is skipped with
a warning. Cadre never includes a partial rule and never automatically loads a
reference body to compensate for an omitted rule.

### Configuring The Inline Budget

The 2,400-character value is a portable default, not a claim about a model's
maximum context window. Keeping always-inline guidance small still reduces
latency, token usage, and attention dilution, but projects using larger-context
models can raise the budget.

Set the normal project budget in `cadre/config.json`:

```json
{
  "project_skills": {
    "inline_rule_budget": 6000
  }
}
```

During initial setup, the same value can be supplied through the structured
setup `config` input so it is written with the rest of the reviewed Cadre
configuration.

For one workflow call, `skillRuleBudget` overrides project configuration:

```json
{
  "root": "/path/to/project",
  "workflow": "review",
  "input": {
    "trackId": "checkout",
    "skillRuleBudget": 8000
  }
}
```

Selection-resource reads accept the same temporary override:

```text
cadre://project-skills?root=/path/to/project&workflow=review&trackId=checkout&skillRuleBudget=8000
```

Budget precedence is:

1. Per-call `skillRuleBudget` or `skill_rule_budget`.
2. `cadre/config.json` `project_skills.inline_rule_budget`.
3. The 2,400-character default.

Cadre guards the effective value to the range 1,000–20,000 characters. Values
outside that range are clamped with a warning. A missing value uses the default;
an invalid or non-positive value also falls back to the default with a warning.

The detailed selection resource reports the effective policy. Compact workflow
packets may omit `inline_rule_budget_source: "default"` and a null requested
value because the effective budget is already explicit:

```json
{
  "inline_rule_chars": 4320,
  "inline_rule_budget": 6000,
  "inline_rule_budget_source": "config",
  "inline_rule_budget_requested": 6000
}
```

Increasing the budget changes only how many complete rule texts may be inlined.
It does not bypass workflow, repo, or file selectors; change reference loading;
permit partial rules; or execute anything from a skill directory.

## Inspecting Selection

Use the selection resource to see which skills and rules apply before acting:

```text
cadre://project-skills?root=/path/to/monorepo&workflow=implement&trackId=checkout
```

Load one detailed reference only when its URI is returned:

```text
cadre://project-skill?root=/path/to/monorepo&id=web-ui&reference=accessibility-checklist
```

Project skills are trusted declarative guidance. Cadre does not execute scripts
from a skill directory and does not search a global project-skill catalog.

## Managing Skills with `cadre-skill`

The MCP-first `cadre-skill` workflow manages repository-owned skills without a
separate local editor. Its wire workflow name is `skill`. Read operations run
immediately; every mutation produces review artifacts, waits for explicit
stage-by-stage approval, writes the approved desired state, records a Cadre
event, and creates one traced local commit. It never pushes.

List, inspect, or validate the catalog:

```json
{ "root": "/path/to/project", "workflow": "skill", "input": { "operation": "list" } }
```

Use `operation: "show"` with `skillId` to inspect one manifest, diagnostics,
projection path, and reference descriptors. Use `operation: "validate"` with
an optional `skillId` to validate one skill or the complete catalog. These
operations also work when another skill is invalid because management bypasses
ordinary project-skill selection.

Create a skill with ordered semantic changes:

```json
{
  "root": "/path/to/project",
  "workflow": "skill",
  "input": {
    "operation": "create",
    "skillId": "web-ui",
    "changes": [
      { "type": "metadata.set", "name": "Web UI", "description": "Rules for the web application." },
      { "type": "selectors.set", "workflows": ["implement", "review"], "file_patterns": ["apps/web/**"] },
      { "type": "rule.upsert", "id": "semantic-html", "text": "Use semantic HTML before adding ARIA roles.", "priority": 20, "required": true }
    ]
  }
}
```

`create` must end with a name, description, at least one workflow selector,
and at least one rule. `update` applies the same ordered changes to an existing
parseable manifest. Supported change types are `metadata.set`, `selectors.set`,
`rule.upsert`, `rule.remove`, `reference.upsert`, and `reference.remove`.
Removing a reference that is still named by a rule is rejected.

Selector replacement and rule updates are explicit rather than JSON patches:

```json
{
  "operation": "update",
  "skillId": "web-ui",
  "changes": [
    { "type": "selectors.set", "workflows": ["implement", "review"], "repos": [], "file_patterns": ["apps/web/**", "packages/ui/**"] },
    { "type": "rule.upsert", "id": "semantic-html", "text": "Prefer native semantic elements; add ARIA only when native semantics cannot express the interaction.", "priority": 10, "required": true, "when": { "workflows": ["implement"] }, "references": ["accessibility"] }
  ]
}
```

References accept polished inline content. Cadre normalizes line endings and a
final newline, pretty-prints valid JSON, and rejects invalid JSON, binary data,
unsupported extensions, path escapes, and files over 128 KiB:

```json
{
  "type": "reference.upsert",
  "id": "accessibility",
  "path": "references/accessibility.md",
  "when": { "workflows": ["implement", "review"], "file_patterns": ["apps/web/**"] },
  "content": "# Accessibility\n\nUse the project checklist when changing interactive UI.\n"
}
```

For an unformatted project-local source, send `source_path` without `content`.
Cadre returns `phase: "awaiting_formatting"` and exactly the targeted
`cadre://project-skill-source` read. The agent reads it, formats the material,
and resubmits the same `reference.upsert` with inline `content`; no review files
or target files are created during the formatting pause.

Rename with `operation: "rename"`, `skillId`, and `newSkillId`. Remove with
`operation: "remove"` and `skillId`. Rename collisions are rejected. A malformed
JSON manifest may be listed, shown with diagnostics, validated, or removed, but
must be removed and recreated rather than silently repaired or renamed.

Mutation review stages are dynamic:

- `identity` reviews directory creation, rename, or removal.
- `manifest` reviews canonical `skill.json` and generated `SKILL.md`.
- `references` appears when reference files are added, changed, moved, or removed.

Approve only the packet's current stage using its session ID and returned
approval arguments. After every stage is recorded, call the same semantic
request with `execute: true` and `approvalComplete: true`. If reviewed files or
the source skill change during approval, Cadre rejects the stale session.

`SKILL.md` is regenerated deterministically after every successful create,
update, or rename. It is a human projection of metadata, selectors, rules, and
the reference inventory; reference bodies are never copied into it and runtime
selection continues to use `skill.json`.
