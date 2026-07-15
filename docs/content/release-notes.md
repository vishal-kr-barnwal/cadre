---
title: Release Notes
description: Changes in the latest Cadre release.
section: Reference
order: 240
---

# Release Notes

## Unreleased

The next Cadre update makes every approval workflow lazy by stage, makes
refresh analysis-first, and extends placeholder-safe clarification and
target-preview recovery across staged workflows.

- `cadre-refresh` now analyzes repository and control-plane drift before asking
  the user to choose one or more recommended levels: product, product
  guidelines, tech stack, style guides, workflow, patterns, repository
  topology, LSP, projections, or diagnostics. It then reviews selected stages
  in filtered order. Tech stack, style guides, repository topology, and LSP are
  one grouped technical stage; projections remain execution-authorized and
  diagnostics remain read-only.
- New-track, revise, handoff, and release wait for meaningful workflow evidence
  instead of materializing empty or generic default artifacts.
- Setup reviews product, product guidelines, grouped technical context, and
  workflow in that order. New-track, revisions that touch both documents, and
  formula pour review spec before plan. Project-skill create/update reviews the
  skill before formatting and reviewing references; rename/remove reviews one
  exact mutation set.
- Only the active stage's review files are generated and materialized.
  Clarification returns a complete `decision.resume`, active-stage edits return
  `decision.amend`, and only their declared `writable_paths` may change. Their
  session-only approval state is never approval; stage approval requires the exact returned stage, hash,
  revision, and cumulative prefix, and final execution invokes the exact
  returned `next`.
- Formula pour now retains its formula identity, resolved variables, and
  metadata through session-only resume, spec approval, plan approval, and the
  exact final execution continuation.
- Corrected staged payloads can safely supersede untouched, wholly unapproved
  overlapping previews. Cancellation validates the worktree, Git index, and
  recorded HEAD baseline atomically, preserving both user work and the session
  whenever safe restoration is not possible.

## 2.2.0 - 2026-07-14

Cadre 2.2.0 makes canonical state and its human-facing projection one atomic
review unit, then completes the token-efficient MCP v1 migration with strict
protocol, resource, continuation, job, parallel, and process-execution
boundaries. The result is a more deterministic review loop, a smaller published
package, first-class Codex and Claude Code workflow discovery, and substantially
stronger failure behavior at every untrusted input boundary.

### Compared With 2.1.0

| Area | What changed |
|---|---|
| Target review | The first target-mode call now freezes and writes the complete deterministic workflow diff instead of materializing only the active stage. |
| Canonical documents | Registered JSON/JSONL artifacts and their Markdown projections are validated, written, committed, and rolled back as atomic pairs. |
| Approval state | Ignored, resumable approval sessions bind every stage to reviewed hashes, support cancellation, and emit compact completion evidence. |
| Styleguides | Human projections move from `cadre/code_styleguides/` to `cadre/styleguides/`, beside their canonical files. |
| MCP boundary | The three public v1 tools are now enforced internally; retired aliases, flat inputs, reserved control injection, and undocumented continuations are rejected. |
| Command discovery | The same 19 registered workflows appear as explicit `$cadre:*` entries in Codex and `/cadre:*` entries in Claude Code; neither redundant umbrella entry is installed. |
| Protocol lifecycle | MCP `2025-11-25` and `2025-06-18` negotiate through initialize/initialized, with standard JSON-RPC error and notification behavior. |
| Resources | One typed registry separates the only fixed resource from parameterized templates and validates every URI/query contract. |
| Parallel and jobs | Workers receive exact completion or recovery callbacks; merge, cleanup, restart, persistence, and job continuation all fail closed from observed state. |
| LSP and DAP | Project-owned config namespaces, secure reads/writes, contained breakpoints, and configured adapter selection prevent path and command injection. |
| Package | The npm publish set drops from 10 to 8 files, removes duplicate worker/daemon executables, and reduces the uncompressed payload by 20,456 bytes. |
| Verification | Harness test cases increase from 114 to 148, with new lifecycle, resource, packet, approval, command-picker, source-capability, job, parallel, and config-security coverage. |

### Atomic Canonical And Projection Review

Every registered human-facing document is now represented by one canonical and
projection pair. The registry covers product context, product guidelines,
technology stack, workflow, polyrepo topology, patterns, styleguide index and
guides, track spec/plan/learnings/handoff, release artifacts, and project
skills.

On the first target-mode review call, Cadre freezes the full deterministic
artifact set and writes it to final repository paths. New files receive Git
intent-to-add, which makes their complete content visible in ordinary
`git diff` without staging that content. The approval prompt remains focused on
the current human-facing Markdown document, but SHA-256 hashes bind its
approval to the exact canonical/projection pair.

Final execution regenerates and verifies both sides of every approved pair.
Missing, stale, or modified content fails closed, and multi-file writes roll
back if the complete set cannot be committed safely. Setup now produces the
previously missing `cadre/tech-stack.md` and, for polyrepo control repositories,
`cadre/repos.md` projections.

### Approval Sessions And Projection Repair

Target-mode approvals now persist under the ignored
`cadre/local/approval-sessions/` directory. A session records bounded hashes and
stage state rather than copying full document content. It can resume across
calls, rejects mismatched or drifted approvals, closes only after successful
execution, and supports explicit cancellation that restores pre-review
intent-to-add state.

A successful operation appends one compact `approval.completed` event after the
canonical mutation, projection mutation, validation, and commit trace have all
succeeded. Non-document operations such as archive, revert, flag, ship, land,
debug repair, and skill rename/removal use `execute:true` authorization instead
of synthetic document approvals.

`cadre-artifacts` now reports missing, stale, unmarked, and legacy projections.
With `execute:true`, it repairs marked generated projections atomically without
inventing a projection-only approval stage. User-authored or unmarked Markdown
is never overwritten automatically.

### Strict MCP V1 Contract

The public catalog remains intentionally small:

- `cadre_workflow` starts or continues one workflow;
- `cadre_action` invokes the exact namespaced action selected by a packet;
- `cadre_read` reads one targeted resource URI.

Cadre 2.2.0 removes the internal routing compatibility that still accepted 11
retired direct tool names. Those identifiers are deliberately omitted from
production guidance so agents cannot mistake them for live interfaces.
Workflow data must be nested under `input`, action data must be nested under
`input`, and only documented outer fields are accepted. Reserved approval,
provider, worker, merge, async, execution, and source-capability fields cannot
be smuggled through nested input.

The compact workflow response exposes `ok`, `workflow`, `phase`, `decision`,
`required`, `next`, `artifacts`, `resources`, bounded `data`, `warnings`, and
structured `errors`. `next.tool` plus `next.arguments` is the sole immediate
single-agent continuation. The only typed callbacks outside `next` are provider
evidence write-back after external collection and exact parallel worker finish
callbacks returned by Cadre.

Codex and Claude Code now install a thin, explicit skill shim for each
registered workflow. Typing `$cadre:` in Codex exposes entries such as
`$cadre:setup`, `$cadre:status`, `$cadre:implement`, and `$cadre:review`;
typing `/cadre:` in Claude Code exposes `/cadre:setup`, `/cadre:status`,
`/cadre:implement`, and `/cadre:review`.

Both clients use the same 19 workflow names: `setup`, `newtrack`, `implement`,
`debug`, `status`, `validate`, `flag`, `revise`, `review`, `ship`, `land`,
`handoff`, `archive`, `release`, `refresh`, `revert`, `formula`, `artifacts`,
and `skill`. Neither installs a redundant `$cadre:cadre` or `/cadre:cadre`
umbrella. Each shim fixes one workflow name and enters through
`cadre_workflow`; none expands the three-tool MCP catalog or aliases retired
tools. Copilot and Antigravity retain the single generic Cadre skill.

### Protocol And Resource Correctness

The stdio server now negotiates MCP `2025-11-25` and `2025-06-18`, reports the
installed package version, waits for `notifications/initialized` before normal
operations, never replies to notifications, and uses standard parse and
invalid-request errors. Request-only operations cannot execute through a
notification.

Resource discovery now has one typed source of truth. `resources/list` contains
only the fixed `cadre://template-inventory`; project resources appear in
`resources/templates/list` and validate required groups, duplicates, unknown
parameters, and value formats before routing. Track-plan reads return the actual
parsed plan, ship/land resources use stable identifiers, and resource reads do
not mutate Git state.

Maintainer-only skill contracts, workflow protocols, agent references, and the
retired release-plan resource are no longer exposed as MCP resources or
embedded runtime payloads. Setup templates remain packaged.

### Parallel Execution And Async Jobs

Parallel packets now issue a complete, exact chain: wave selection, worker
setup, per-worker finish callbacks, recovery when needed, merge, cleanup, and
return to implementation. Completion callbacks remain self-contained when
reissued. Cadre completes canonical tasks before cleanup, refuses to advance
unmerged or conflicting work, derives repository identity from Git's common
directory, and retains `cleaned_*` audit fields after idempotently clearing live
worktree/ref state. Unconfigured monorepos now resolve an existing local or
remote default branch for integration worktrees instead of assuming `main`.

Async job results remain pollable and return an exact continuation after task
completion. Persisted jobs are bound to one canonical project root, use atomic
non-symlink storage, advertise an artifact path only after persistence succeeds,
and become an explicit interrupted failure after a server restart rather than
appearing indefinitely live.

### Path And Process Security

Project-skill source reads now require a short-lived opaque capability bound to
the canonical project root, canonical source path, and SHA-256 content digest.
Cadre rejects invented, retargeted, expired, or post-authorization-changed
capabilities; traversal; every symlink component, including in-project links;
binary or unsupported files; and sources larger than 128 KiB.

Job snapshots reject traversal, symlinked storage, cross-project access, and
reads larger than 2 MiB. LSP and DAP configs are restricted to
`cadre/lsp.json|lsp-*.json` and `cadre/dap.json|dap-*.json`, with secure
no-follow reads, atomic writes, and an outer-owner config for polyrepo reviews.
DAP callers must select a configured adapter and configuration: inline adapter
commands are rejected, caller test commands cannot replace executable fields,
and breakpoint paths must remain inside the project.

### Package And Architecture Cleanup

The runtime build now emits five bundles instead of seven. Private job-runner
and LSP-daemon modes remain embedded in `cadre-mcp`, while the duplicate
standalone executables are removed from the package. The npm publish set drops
from 10 files to 8 and its tracked uncompressed payload decreases from
1,936,959 to 1,916,503 bytes despite the additional validation and generated
Codex and Claude Code workflow discovery.

Flat MCP forwarding shims, obsolete source barrels and adapters, dead package
fallbacks, retired migration/context scripts, and unused agent references have
been removed. TypeScript now enforces unused-local and unused-parameter checks,
type-only dependencies no longer create an LSP runtime cycle, and architecture
tests keep source files below 500 lines and prevent retired boundaries from
returning.

### Upgrade Notes

Upgrade the package and refresh every detected client:

```bash
npm install -g cadre-ai@2.2.0
cadre install
cadre install --check
```

Restart clients that cache plugin or MCP configuration. Verify that
`cadre@cadre` is installed and enabled at 2.2.0 and that its MCP command points
to the current installed `cadre-mcp` runtime. In a new Codex task, type
`$cadre:` and confirm the explicit workflow entries are listed without a
generic `cadre` entry. In Claude Code, run `/reload-plugins` or restart, type
`/cadre:`, and confirm the same 19 entries are listed without `/cadre:cadre`.

Regenerate styleguide projections into `cadre/styleguides/`, review the
resulting diff, and remove `cadre/code_styleguides/` manually. Cadre reports the
legacy path but deliberately does not move, dual-write, or delete it.

Custom MCP integrations must use the nested three-tool contract, complete the
initialize/initialized lifecycle, read project resources through templates,
and invoke only exact returned continuations or documented typed callbacks.
The removed runner and daemon files were private implementation paths. Any
internal tooling that still depended on them must use
`cadre-mcp --cadre-job-runner` or `cadre-mcp --cadre-lsp-daemon`, respectively.
Custom LSP/DAP configuration paths outside
`cadre/lsp.json|lsp-*.json` and `cadre/dap.json|dap-*.json` now fail, as do
inline DAP adapter commands; move those definitions into the project-owned
configuration namespaces before upgrading.

### Operating Cautions

- Target-mode review now materializes the full frozen diff on its first call,
  not only the active approval stage. A written diff is still review output,
  not approval.
- Canonical and projection files are one approval unit. Do not approve or edit
  them independently between review and execution.
- The styleguide projection path change is intentionally breaking and requires
  the manual cleanup described above.
- Removed MCP aliases, flat inputs, resource names, and standalone helper paths
  are not compatibility surfaces in 2.2.0.
- Codex and Claude Code no longer expose generic Cadre umbrella commands. Use
  `$cadre:<workflow>` in Codex or `/cadre:<workflow>` in Claude Code, including
  `$cadre:setup` and `/cadre:setup` for first-time setup.
- Hosted provider evidence still comes from supported provider integrations;
  this release does not introduce a CLI evidence fallback.

The signed `release-2.2.0` tag is the source of the GitHub release. Publishing
that release triggers npm Trusted Publishing and the documentation deployment
pipeline after release validation passes.

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
- `next` contains at most one exact immediate single-agent tool call;
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
  written preview was reviewable worktree output, not approval. The 2.2.0 flow
  above supersedes its current-stage-only materialization behavior.

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
