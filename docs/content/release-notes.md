---
title: Release Notes
description: Changes in the latest Cadre release.
section: Reference
order: 240
---

# Release Notes

## Unreleased - Atomic Canonical/Projection Review

Cadre now treats every registered human-facing document as one canonical and
projection pair. The first target-mode review call freezes and writes the
complete deterministic workflow diff at final repository paths, while the
approval prompt points only to the current Markdown document. New files use Git
intent-to-add so their content appears in ordinary `git diff` without staging
that content.

Key changes:

- projection generation is atomic with canonical mutation, and commit and
  validation paths reject missing or stale pairs;
- approval sessions live under ignored `cadre/local/approval-sessions/`, can be
  safely cancelled, and append a compact `approval.completed` event only after
  successful execution;
- `cadre-artifacts` repairs marked drift with `execute:true` and no projection
  approval stage;
- archive, revert, flag, ship, land, debug repair, and other non-document
  mutations use execution authorization rather than synthetic human approval;
- styleguide projections now live beside their canonicals as
  `cadre/styleguides/README.md` and `cadre/styleguides/<id>.md`;
- the old `cadre/code_styleguides/` path is diagnostic-only and is never
  dual-written, moved, or deleted automatically;
- setup now generates `tech-stack.md`, and polyrepo setup generates `repos.md`.

This styleguide path change is intentionally breaking. Regenerate projections
into `cadre/styleguides/`, review the resulting diff, and remove the legacy
directory manually.

## 2.1.0 - 2026-07-12

Cadre 2.1.0 makes the agent-facing runtime smaller while making repository
guidance substantially more capable. Workflows now enter through three
token-efficient public tools, load project-owned skills when relevant, and
return compact decision envelopes with lazy evidence. The public docs have also
been reorganized into complete user/operator and contributor journeys.

### Compared With 2.0.0

| Area | What changed |
|---|---|
| MCP surface | The older broad direct-tool catalog is replaced by `cadre_workflow`, `cadre_action`, and `cadre_read`. |
| Workflow responses | A compact envelope reports the current decision, required evidence, at most one next call, changed artifacts, targeted resources, and bounded workflow data. |
| Skill activation | The packaged `cadre.skill.v1` contract now contains a small activation contract, invariants, workflow IDs, and conditional references instead of eager operating detail. |
| Project skills | Repositories can own workflow- and repo-targeted engineering guidance under `cadre/skills/<id>/`. |
| Skill management | The new `cadre-skill` workflow inspects, creates, updates, formats, validates, enables/disables, and removes project skills through packet-owned review. |
| Context tuning | `project_skills.inline_rule_budget` defaults to `2400` and bounds optional inline rules while required rules remain fail-closed. |
| Lazy resources | New project-skill selection, reference, and source resources keep long context out of the hot workflow response. |
| CI | Monorepo GitHub and GitLab workspace-check aggregation no longer lets the final `jq` operation mask a failed package check. |
| Documentation | The site now has 24 registry-ordered pages with separate operator/contributor guides, complete references, body search, content coverage tests, and responsive navigation/tables/code. |

### Token-Efficient V1 Contract

Installed agents now start or continue every Cadre workflow with
`cadre_workflow`. A packet may return one namespaced `cadre_action` for the next
operation or a targeted URI for `cadre_read`. This reduces tool-schema and
always-on instruction cost while preserving packet ownership of state,
approvals, provider actions, workers, and generated projections.

The workflow envelope is designed for deterministic client behavior:

- `decision` identifies ready, clarification, approval, blocked, or complete
  state;
- `required` lists missing evidence or payload requirements;
- `next` contains at most one exact tool call;
- `artifacts` identifies current review or changed files;
- `resources` points to bounded detail that is relevant now;
- `data` contains only workflow-specific summary fields.

### Repository-Owned Project Skills

Projects can add reviewed engineering rules without publishing another global
plugin. A skill can target specific workflows and, in a polyrepo, specific
declared repositories. Rules can be selected automatically or explicitly with
`skillIds`; longer references remain lazy until a packet exposes them.

The `cadre-skill` workflow provides packet-owned management and validation.
Cadre rejects unsafe paths, schema/version mismatch, duplicate IDs, invalid
selectors, unresolved repo targets, unsupported reference files, and required
rule overflow. Project skills never execute scripts automatically and never
fall back to a global catalog.

### Context Budget And Tuning

New projects receive:

```json
{
  "project_skills": {
    "inline_rule_budget": 2400
  }
}
```

The budget applies to optional inline rules across selected skills. Required
rules are not silently truncated. Packets expose the effective budget, its
source, the requested value, selected skills, and optional omissions so teams
can narrow selectors before increasing context.

### Documentation Overhaul

The documentation is now organized into Start Here, User Guide, Operations,
Contributor Guide, and Reference sections. New material covers capabilities,
quickstart, configuration, tuning, daily operation, runtime/MCP internals,
workflow engine design, canonical state and artifacts, development, testing,
release, and exhaustive public references.

The responsive docs shell provides a persistent three-rail desktop layout,
sheet navigation and inline outlines below desktop widths, body-aware search,
copyable code, labelled mobile table rows, section breadcrumbs, and accessible
previous/next navigation.

### Upgrade Notes

Upgrade the package and refresh every detected native client:

```bash
npm install -g cadre-ai@2.1.0
cadre install
cadre install --check
```

Restart clients that cache plugin or MCP configuration. Verify that the
installed `cadre@cadre` plugin is enabled at 2.1.0 and that its MCP command
resolves the current `cadre-mcp` runtime.

Custom integrations that called older direct Cadre tools must migrate to the
three-tool contract. Start with `cadre_workflow`, execute only the returned
namespaced action, read only relevant resource URIs, and branch on structured
decision fields rather than workflow prose.

Existing target projects do not need to create project skills. When adopting
them, start with narrow workflow/repository selectors, validate selection with
`cadre-skill` or `cadre://project-skills`, and raise the inline budget only when
diagnostics show a real optional-rule omission.

### Operating Cautions

- The new MCP surface is a client contract migration for custom integrations,
  even though normal native users refresh it through `cadre install`.
- Required project-skill rules fail closed rather than disappearing when they
  exceed the safe packet contract.
- Hosted provider evidence still comes from supported provider integrations;
  the compact envelope does not introduce a CLI evidence fallback.
- In 2.1.0, target-path staged review behavior from 2.0.0 remained unchanged: a
  written preview was reviewable worktree output, not approval. The Unreleased
  flow above supersedes its current-stage-only materialization behavior.

The signed `release-2.1.0` tag is the source of the GitHub release. Publishing
that release triggers the repository's Trusted Publishing and documentation
deployment pipeline after its release checks pass.

## 2.0.0 - 2026-06-26

Cadre 2.0.0 makes staged review output land directly at the intended target
paths by default. A dry-run review now writes only the active approval stage to
files such as `cadre/product.md` or `cadre/tracks/<id>/plan.json`, so the review
loop can use normal `git diff`. Bundle output is still available for callers
that need a non-mutating preview.

### Compared With 1.1.2

| Area | What changed |
|------|--------------|
| Target previews | Staged review dry-runs default to `review_bundle.mode:"target"` and write the current stage to its real path for ordinary `git diff` review. |
| Bundle compatibility | Pass `reviewOutputMode:"bundle"` / `review_output_mode:"bundle"` or an explicit `reviewBundleDir` to keep the old temp-bundle behavior. |
| Approval order | Target mode writes only `approval.current_stage`; later stages are materialized only after earlier stages are explicitly approved. |
| Drift protection | Final `execute:true` validates that approved target files still match the regenerated payload and fails closed if a preview was edited after approval. |
| Dirty-file safety | Existing dirty target files are protected unless their content already matches the generated preview or the caller intentionally uses `force:true`. |
| Client installs | `cadre install` supports GitHub Copilot and Google Antigravity alongside Codex and Claude with thin MCP entrypoints. |
| Optional clients | `cadre install --target all` writes Copilot plugin files even when the Copilot CLI is missing, reports skipped native registration, and continues validating installed native clients. |
| Docs templates | Workflow docs now include copyable canonical `cadre.spec.v1` and `cadre.plan.v1` JSON templates for drafting new tracks. |
| Release validation | Harness validation covers target-path preview diffs, staged approval ordering, drift failure, target-preview final execution, and bundle-mode compatibility. |

### Upgrade Notes

Existing installs can update with the normal npm path:

```bash
npm install -g cadre-ai@2.0.0
cadre install
```

Dry-run review can now mutate the worktree by writing reviewed target previews.
This does not approve or execute the workflow; approval remains explicit for the
current stage. Use `git diff -- cadre/...` to inspect the returned paths. For
automation or workflows that require non-mutating review output, pass
`reviewOutputMode:"bundle"` or provide `reviewBundleDir`.

Target-mode responses can have `review_bundle.manifest_path:null`. Read
`review_bundle.files[].target_path` or `review_path` for the reviewed files.

The GitHub release for `release-2.0.0` publishes `cadre-ai@2.0.0` through npm
Trusted Publishing after the release workflow validates the harness package and
native plugin install paths.

## 1.1.2 - 2026-06-23

Cadre 1.1.2 bootstraps Cadre-only MCP tool approvals for Codex and Claude so
`cadre-setup` and later packet workflows can run without repeated Cadre MCP
permission prompts.

### Compared With 1.1.1

| Area | What changed |
|------|--------------|
| Client approvals | `cadre install` configures Codex and Claude to allow Cadre MCP packet tools without repeated prompts. |
| Claude refresh | Existing Claude Code installs now refresh the cached `cadre@cadre` plugin after the local marketplace is rewritten. |
| Install checks | `cadre install --check` validates the approval bootstrap for both native clients. |
| Setup flow | `cadre-setup` guidance now points users back to `cadre install` when Cadre MCP approvals are still noisy. |
| Safety boundary | The bootstrap is Cadre-only and does not approve shell commands, edits, other plugins, or non-Cadre MCP servers. |

### Upgrade Notes

Existing installs can update with the normal npm path:

```bash
npm install -g cadre-ai@1.1.2
cadre install
```

The GitHub release for `release-1.1.2` publishes `cadre-ai@1.1.2` through npm
Trusted Publishing after the release workflow validates the harness package.

## 1.1.1 - 2026-06-23

Cadre 1.1.1 is a patch release for docs rendering, install-time plugin
registration, and native release validation.

### Compared With 1.1.0

| Area | What changed |
|------|--------------|
| Docs rendering | Fenced `mermaid` diagrams in the Next.js docs render as SVG diagrams, with top-to-bottom flow on mobile. |
| Installer | Codex and Claude marketplaces now reference the locally written Cadre plugin with relative `./plugins/cadre` sources. |
| Release validation | Release instructions now require real native installs for both Codex and Claude before publishing. |
| CLI polish | Install-time client detection no longer emits the Node 26 child-process deprecation warning. |

### Upgrade Notes

Existing installs can update with the normal npm path:

```bash
npm install -g cadre-ai@1.1.1
cadre install
```

The GitHub release for `release-1.1.1` publishes `cadre-ai@1.1.1` through npm
Trusted Publishing after the release workflow validates the harness package.

## 1.1.0 - 2026-06-23

Cadre 1.1.0 moves task memory and operational history into Cadre-owned packet
state, adds native formula runs, and records traceability for product and
control-plane commits.

### Compared With 1.0.0

| Area | What changed |
|------|--------------|
| Task memory | The external task-memory runtime was replaced with native Cadre JSON and JSONL files written by Cadre packets. |
| Formula workflows | `cadre-formula` now supports reusable formulas and git-ignored local wisps. |
| Traceability | Task completion, product commits, Cadre control-plane commits, publication records, and git notes are linked through Cadre commit traces. |
| Team status | Status, team, and fleet views now include native events, messages, formula state, ownership, leases, and review evidence. |
| Templates | Setup templates initialize native state directories and merge attributes for packet-owned files. |

### Upgrade Notes

Existing installs can update with the normal npm path:

```bash
npm install -g cadre-ai@1.1.0
cadre install
```

For target projects initialized before native state, rerun `cadre-setup` only
when setup never created native state files. Otherwise use `cadre-refresh` or
`cadre-artifacts sync` when generated projections need to catch up with the
current packet-owned JSON state.

### Release Automation

The GitHub release for `release-1.1.0` publishes `cadre-ai@1.1.0` through npm
Trusted Publishing, then runs the docs lint, typecheck, build, and Cloudflare
Pages deployment pipeline.
