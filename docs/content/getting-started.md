---
title: Installation
description: Install, upgrade, verify, and remove Cadre across supported coding clients.
section: Start Here
order: 20
---

# Installation

This guide gets Cadre installed in Claude Code, OpenAI Codex, GitHub Copilot,
or Google Antigravity and initializes the first target project.

## Install Cadre

Cadre ships as the `cadre-ai` npm package. The package installs the global
`cadre` CLI and `cadre-mcp` runtime, then `cadre install` writes thin client
plugins for detected Claude Code, OpenAI Codex, Copilot CLI, and Antigravity
installations.

```bash
npm install -g cadre-ai
cadre install
cadre doctor
```

The installed plugins contain only platform wiring:

- On Codex and Claude Code, generated `skills/<workflow>/SKILL.md` entries for
  the same 19 workflow commands. Codex adds explicit-only `agents/openai.yaml`
  metadata for the `$cadre:` picker; Claude Code exposes the short skill names
  through its `/cadre:` plugin namespace.
- On Copilot and Antigravity, `skills/cadre/SKILL.md` as the agent-facing
  entrypoint.
- `.mcp.json` for Codex and Copilot, `mcp-config.json` for Claude, or
  `mcp_config.json` for Antigravity.

The plugin does not copy Cadre assets, worker agents, or MCP runtime scripts.
The global `cadre-mcp` binary contains the three-tool runtime, resource
registry, jobs, code-intelligence helpers, and the target-project templates
needed by setup. Maintainer skill contracts, protocol sources, and agent
references are not embedded or exposed as MCP resources.
`cadre install` also bootstraps narrow client approval rules for Cadre's own MCP
tools so `cadre-setup` and later packet workflows do not prompt on every Cadre
tool call. It does not bypass approval for shell commands, file edits, other
plugins, or non-Cadre MCP servers. Copilot and Antigravity IDE may still prompt
on first Cadre MCP tool use; Antigravity CLI receives an automatic
`mcp(cadre/*)` allow rule.

To target one client explicitly:

```bash
cadre install --target codex
cadre install --target claude
cadre install --target copilot
cadre install --target antigravity
```

For project-scoped client wiring:

```bash
cadre install --target copilot --scope project
cadre install --target antigravity --scope project
```

Copilot project scope writes `.github/skills/cadre/SKILL.md`. GitHub.com
repository MCP settings are configured in GitHub settings by a repository
admin; Cadre documents the Cadre MCP JSON but does not mutate repository
settings locally. Antigravity project scope writes `.agents/plugins/cadre/`.

For source development, keep using the npm-first install path. Harness
contributors can run `pnpm --filter cadre-ai generate` to create ignored local
plugin fixtures for validation, but those generated files are not checked in.

### Codex And Claude Workflow Pickers

After installing or upgrading, restart Codex or open a new task, then type
`$cadre:`. In Claude Code, run `/reload-plugins` or restart, then type
`/cadre:`. Both clients expose the same workflow set:

```text
# Codex
$cadre:setup
$cadre:status
$cadre:newtrack Add OAuth login
$cadre:implement
$cadre:review
$cadre:ship

# Claude Code
/cadre:setup
/cadre:status
/cadre:newtrack Add OAuth login
/cadre:implement
/cadre:review
/cadre:ship
```

The 19 workflow names are `setup`, `newtrack`, `implement`, `debug`, `status`,
`validate`, `flag`, `revise`, `review`, `ship`, `land`, `handoff`, `archive`,
`release`, `refresh`, `revert`, `formula`, `artifacts`, and `skill`. Cadre
deliberately omits redundant `$cadre:cadre` and `/cadre:cadre` entries. Every
picker entry routes through `cadre_workflow` and adds no tools or aliases to the
MCP contract.

## First Project Setup

Select the setup workflow from the client picker:

```text
# Codex
$cadre:setup

# Claude Code
/cadre:setup
```

In Copilot or Antigravity, activate the Cadre skill and ask for `cadre-setup`.

Setup asks for product context, tech stack, topology, sync mode, provider mode,
quality gate, optional CI templates, and LSP setup. Setup dry-runs can return
native recommendation prompts for Codex, Claude, Copilot, and Antigravity so
you can select one or more recommended options, or type a custom "Other" value.
Discovery packets can inspect the fresh repository before `cadre/` exists.
Cadre staged dry-runs may materialize the complete frozen review diff at its
intended target paths so you can inspect `git diff`; that review output is the
only pre-execution write. Durable state transitions, trace records, indexes,
events, and non-review effects require `execute:true`. Explicit document
approval applies to the current human-facing projection together with its
corresponding canonical JSON or JSONL.
Pass `reviewOutputMode:"bundle"` when you need the older non-mutating
temp-bundle review.
When language-server recommendations are detected, setup writes `cadre/lsp.json`
by default unless you opt out. The workflow is packet-owned: the agent should
call Cadre MCP, and Cadre MCP writes the control plane.
If Cadre MCP tool calls still ask for repeated approval, rerun `cadre install`;
it refreshes the Codex, Claude, and Antigravity CLI Cadre-only MCP approval
bootstrap.

Successful setup creates:

| File | Purpose |
|------|---------|
| `cadre/product.json` and `cadre/product.md` | Canonical product context plus generated human projection. |
| `cadre/product_guidelines.json` and `cadre/product_guidelines.md` | Canonical product principles, trust boundaries, non-goals, decision rules, and review checklist. |
| `cadre/tech-stack.json` and `cadre/tech-stack.md` | Languages, frameworks, package managers, platforms, and test commands plus projection. |
| `cadre/workflow.json` and `cadre/workflow.md` | Canonical development, verification, review, and commit expectations plus projection. |
| `cadre/patterns.jsonl` and `cadre/patterns.md` | Append-only pattern events plus generated pattern summary. |
| `cadre/tracks.json` | Generated project-level track index rebuilt from track metadata. |
| `cadre/config.json` | Sync mode, provider mode, review, and quality settings. |
| `cadre/events.jsonl` | Packet-owned activity log for setup, status, completion, handoff, and operational records. |
| `cadre/messages/*.jsonl` | Native inbox/outbox state for handoff and delegation records. |
| `cadre/formulas/*.json` | Native formula templates when the project adds reusable workflows. |
| `cadre/local/wisps/*.json` | Git-ignored local formula runs. |
| `cadre/local/approval-sessions/*.json` | Git-ignored resumable review snapshots. |
| `cadre/repos.json` and `cadre/repos.md` | Polyrepo topology and projection when enabled. |
| `cadre/lsp.json` | Language-server configuration generated during setup when recommendations exist. |
| `cadre/styleguides/*.json` and `cadre/styleguides/*.md` | Canonical style guidance plus colocated generated guide projections. |
| `cadre/skills/<skill-id>/skill.json` and `SKILL.md` | Structured repository-authored rules plus required human projection. |

Track directories later live under `cadre/tracks/<track_id>/` and contain
`metadata.json`, canonical `spec.json` and `plan.json`, generated `spec.md` and
`plan.md`, append-only `learnings.jsonl`, generated `learnings.md`, and optional
handoff or revision artifacts.

Use `cadre-artifacts sync` to regenerate marked projections from canonical
state. Projection synchronization uses `execute:true` but does not require a
separate content approval.
Markdown-only projects are not supported by this migration path.

## Add Project Skills

Repository maintainers can add workflow guidance without installing another
global plugin. Create `cadre/skills/<skill-id>/skill.json` and commit it normally:

```json
{
  "version": 1,
  "schema": "cadre.project-skill.v1",
  "id": "payments-api",
  "name": "payments-api",
  "description": "Repository rules for payment API work",
  "selectors": {
    "workflows": ["newtrack", "implement", "review"],
    "repos": ["api"],
    "file_patterns": ["src/payments/**"]
  },
  "rules": [
    {
      "id": "idempotency",
      "text": "Preserve idempotency keys and review public response changes.",
      "priority": 10,
      "required": true,
      "references": ["contracts"]
    }
  ],
  "references": [
    { "id": "contracts", "path": "references/contracts.md" }
  ]
}
```

`id` must match the directory name. Selectors may constrain workflow, repo, and
affected file patterns. Rules are prioritized and atomic; required rules are
never truncated. References must remain inside the skill directory.

Cadre loads matching rules before workflow payloads are drafted and returns the
selection in workflow packets. Inline rules share a 2,400-character budget;
an oversized required set blocks and requests narrower repo/file scope. Use
`cadre://project-skills?root=<root>&workflow=<workflow>` to inspect a selection
and `cadre://project-skill?root=<root>&id=<skill-id>&reference=<reference-id>`
to load one targeted reference. Invalid automatically discovered skills produce warnings; an invalid
or missing skill named explicitly through `skillIds` blocks the packet.

Project skills are trusted guidance, not executable automation. Cadre does not
run scripts from skill bundles and does not search a global project-skill
catalog.

## Verify The Runtime

At the beginning of any Cadre workflow, the agent verifies the MCP server:

```json
{ "action": "ping" }
```

For project-scoped operations, every Cadre MCP call includes a per-call `root`
argument pointing at the project root or a path inside it:

```json
{ "root": "/path/to/project" }
```

This is important because one long-running MCP process can serve multiple
projects. Cadre does not depend on remembered server cwd for routing.

## Create And Implement Work

Create a track:

```text
cadre-newtrack "Add OAuth login"
```

Cadre returns planning evidence: likely files, dependency hints, test impact,
parallel candidates, native event records, and a worktree plan. When the track
is created, the spec, plan, metadata, learnings, projections, and index become
normal Cadre state.

Start or resume implementation:

```text
cadre-implement
```

The implementation packet selects or claims a track, returns bounded context,
runs collision checks, chooses style-guide context, and computes the next phase
schedule. If the next work can run in parallel, Cadre returns worker payloads
through returned `cadre_action` `parallel.*` calls; otherwise the agent proceeds sequentially.

## Review And Deliver

Run review:

```text
cadre-review
```

Cadre assembles plan completion, review evidence, machine gate output,
TODO/stub findings, optional LSP findings, and hosted provider requirements.

For a monorepo, publish with:

```text
cadre-ship
```

For a polyrepo control repo, publish with:

```text
cadre-land
```

After delivery, archive completed tracks:

```text
cadre-archive
```

Use `cadre-release` to summarize completed track metadata into release
artifacts.
