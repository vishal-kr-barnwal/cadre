# Install & Version Guide

Cadre ships the same 16 workflow protocols to Claude Code and OpenAI Codex.
This guide covers plugin installation for each platform and explains how
versioning and generated bundles work.

- [Version & compatibility matrix](#version--compatibility-matrix)
- [Prerequisite: Beads](#prerequisite-beads)
- [Plugin install](#plugin-install)
  - [Claude Code](#claude-code)
  - [OpenAI Codex](#openai-codex)
- [How bundles are generated](#how-bundles-are-generated)
- [MCP runtime and LSP helpers](#mcp-runtime-and-lsp-helpers)
- [Versioning policy](#versioning-policy)

---

## Version & compatibility matrix

Current release: **v2.0.0** — team-scale hardening for 10–20 person teams,
Claude/Codex plugin skill surfaces, ownership guards, review sequencing,
machine-recorded coverage, and a derived `tracks.md` index.

| Platform | Min. version | Plugin path | Marketplace | Invoke | Context file | Source of truth |
|----------|--------------|-------------|-------------|--------|--------------|-----------------|
| **Claude Code** | plugin-capable Claude Code | `plugins/cadre-claude/` | `.claude-plugin/marketplace.json` | `$cadre`, then `cadre-setup` | `CLAUDE.md` | generated bundle |
| **OpenAI Codex** | current plugins | `plugins/cadre/` | `.agents/plugins/marketplace.json` | `$cadre`, then `cadre-setup` | `AGENTS.md` | generated bundle |

> The master workflow protocols in `skills/cadre/protocols/cadre-*.md` are the single source of
> truth. Claude Code and Codex plugin bundles are generated from them by
> [`scripts/generate-skills.sh`](../scripts/generate-skills.sh).

Both platforms operate on the **same** `cadre/` and `.beads/`
directories, so you can mix tools on one repository (e.g. plan in Codex,
implement in Claude Code).

---

## Prerequisite: Beads

Beads provides persistent, structured memory for coding agents. Install it once:

```bash
npm install -g @beads/bd     # npm (recommended)
brew install beads           # Homebrew (macOS/Linux)
go install github.com/steveyegge/beads/cmd/bd@latest   # Go
```

Verify:

```bash
bd --version
```

Beads integration is always attempted. If `bd` is unavailable, Cadre prompts
you to continue without persistent memory.

Clone the repo once if you want to inspect or test the marketplace locally:

```bash
git clone https://github.com/vishal-kr-barnwal/Cadre.git
cd Cadre
```

---

## Plugin install

Plugins are the only supported installation path. They bundle the Cadre skill,
workflow protocols, templates, MCP server config, and helper scripts behind one
install.

### Claude Code

Claude reads the marketplace at `.claude-plugin/marketplace.json`:

```text
/plugin marketplace add vishal-kr-barnwal/Cadre
/plugin install cadre@cadre
```

The plugin source is `plugins/cadre-claude/`. It includes:

- `skills/cadre/` generated for Claude Code
- `mcp-config.json` for the Cadre MCP server
- `scripts/` with the MCP server, core helpers, and LSP setup/review helpers

### OpenAI Codex

Codex reads the marketplace at `.agents/plugins/marketplace.json`:

```bash
codex plugin marketplace add vishal-kr-barnwal/Cadre --sparse .agents/plugins --sparse plugins/cadre
codex plugin add cadre@cadre
```

When you are already working inside a cloned Cadre repo, Codex can also discover
the repo marketplace at `.agents/plugins/marketplace.json` after restart.

The plugin source is `plugins/cadre/`. It includes:

- `.codex-plugin/plugin.json`
- `skills/cadre/` generated for Codex
- `.mcp.json` for the Cadre MCP server
- `scripts/` with the MCP server, core helpers, and LSP setup/review helpers

---

## How bundles are generated

Claude Code and Codex plugin bundles are **generated** from the master workflow
protocols in `skills/cadre/protocols/cadre-*.md` by:

```bash
bash scripts/generate-skills.sh
```

This reads each master protocol's frontmatter and body, then emits
platform-specific plugin packages with bundled skills:

| Transform | Claude Code | Codex |
|-----------|-------------|-------|
| Protocol bodies | generated into `plugins/cadre-claude/skills/cadre/protocols/` | generated into `plugins/cadre/skills/cadre/protocols/` |
| Frontmatter | preserved | skill metadata lives in `SKILL.md` |
| Worker-dispatch reference | `Task` tool | `worker` agent type |
| `references/beads-error-handler.md` (agnostic) | copied into plugin skill references | copied into plugin skill references |
| `references/parallel-execution.md`, `template-locator.md` (sliced) | only Claude's section | only Codex's section |
| `templates/` bundle | copied into `plugins/cadre-claude/skills/cadre/templates/` | copied into `plugins/cadre/skills/cadre/templates/` |
| Plugin package | generated into `plugins/cadre-claude/` | generated into `plugins/cadre/` |
| Marketplace | generated into `.claude-plugin/marketplace.json` | generated into `.agents/plugins/marketplace.json` |

### Per-agent slicing (token optimization)

To avoid shipping every tool's instructions to every tool, the multi-platform
references are **sliced per agent**. Their masters live in `scripts/agent-refs/`
with `<!-- AGENT:<name> -->` blocks; the generator emits a copy to each platform
(Claude included) containing only the shared text plus that platform's block.
The one-line worker-dispatch sentence in `cadre-implement` is likewise
substituted per platform. Edit the masters in `scripts/agent-refs/`
(not the generated `references/` copies) and regenerate.

### Templates bundling

`cadre-setup` copies starter files (`workflow.md`, `code_styleguides/`, …)
into your project. Those live in the canonical `templates/` directory, and the
generator bundles a copy into each plugin skill at
`plugins/<platform>/skills/cadre/templates/`.

`cadre-setup` then **discovers** the templates directory at runtime by
resolving `../templates/` relative to the active `references/template-locator.md`
file, so it works from plugin cache installs without knowing the cache root.
Edit templates only in the canonical `templates/` directory and regenerate.

Generated files carry an `AUTO-GENERATED` marker. **Do not hand-edit them** —
edit the master protocol in `skills/cadre/protocols/` and regenerate. To verify the committed output is in
sync (e.g. in CI):

```bash
bash scripts/generate-skills.sh --check
```

This exits non-zero if any generated build artifact, plugin, or marketplace file is stale.

A ready-made drift gate ships at
`templates/ci/cadre-monorepo-check.{github,gitlab}.yml` — drop the one for
your CI into place and it runs `generate-skills.sh --check` (plus `bash -n` on
the generator and runtime helper scripts) on every PR. The `templates/` directory now includes a
`ci/` subdirectory carrying both this monorepo-check and the polyrepo
merge-train workflows (`cadre-merge-train.{github,gitlab}.yml`).

---

## MCP runtime and LSP helpers

Cadre plugins bundle a required MCP runtime plus optional LSP helpers:

- `node scripts/mcp/cadre-server.js` starts the dependency-free MCP server
  required by Cadre workflows for track status, collision scans, review gates,
  and index regeneration. Project-scoped MCP calls must include a per-call
  `root` argument.
- `<TEMPLATES_DIR>/scripts/cadre-lsp-setup.js` scans a project, recommends
  language servers, detects missing server commands, and appends `cadre/lsp.json`
  entries during `cadre-setup` or `cadre-refresh --lsp`.
- `<TEMPLATES_DIR>/scripts/cadre-lsp-review.js --base main --head track/<id>
  --json` runs a best-effort LSP reference scan when `cadre/lsp.json` configures
  language servers.

See [MCP and LSP Integration](MCP_LSP.md) for setup and rollout guidance.

---

## Versioning policy

Cadre uses [semantic versioning](https://semver.org/). The version is
declared in `README.md` (the `**Version:**` line). Per-release changes are
recorded in the [Changelog](../CHANGELOG.md).

| Bump | When |
|------|------|
| **Major** (`x.0.0`) | Breaking changes to the `cadre/` directory layout, workflow behavior, or Beads schema that require migration. |
| **Minor** (`0.x.0`) | New workflows, new platform support, or new opt-in features. Backward compatible. |
| **Patch** (`0.0.x`) | Bug fixes and documentation. |

When adding or changing a workflow protocol:

1. Edit the master protocol in `skills/cadre/protocols/`.
2. Run `bash scripts/generate-skills.sh` to regenerate plugin bundles.
3. Bump the version in `README.md`.
4. Note the change in the README "What's New" section.

Migrations between layout-breaking versions ship as scripts under `scripts/`
(e.g. [`migrate-v2.sh`](../scripts/migrate-v2.sh)).
