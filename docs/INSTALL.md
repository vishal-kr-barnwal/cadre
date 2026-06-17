# Install & Version Guide

Cadre ships the same 16 workflow protocols to Claude Code and OpenAI Codex.
This guide covers installation for each platform and explains how versioning
and skill-bundle generation work.

- [Version & compatibility matrix](#version--compatibility-matrix)
- [Prerequisite: Beads](#prerequisite-beads)
- [Per-platform installation](#per-platform-installation)
  - [Claude Code](#claude-code)
  - [OpenAI Codex](#openai-codex)
- [How skills are generated](#how-skills-are-generated)
- [MCP and LSP helpers](#mcp-and-lsp-helpers)
- [Versioning policy](#versioning-policy)

---

## Version & compatibility matrix

Current release: **v2.0.0** — team-scale hardening for 10–20 person teams,
Claude/Codex skill surfaces, ownership guards, review sequencing,
machine-recorded coverage, and a derived `tracks.md` index.

| Platform | Min. version | Workflow directory | Format | Invoke | Context file | Source of truth |
|----------|--------------|--------------------|--------|--------|--------------|-----------------|
| **Claude Code** | 1.0+ | `.claude/skills/` | Agent Skill `SKILL.md` + references | `$cadre`, then `cadre-setup` | `CLAUDE.md` | generated bundle |
| **OpenAI Codex** | current skills | `.agents/skills/` | Agent Skill `SKILL.md` + references | `$cadre`, then `cadre-setup` | `AGENTS.md` | generated bundle |

> The master workflow protocols in `skills/cadre/protocols/cadre-*.md` are the single source of
> truth. Claude Code and Codex skill bundles are generated from them by
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

Clone the repo once — every install below copies from it:

```bash
git clone https://github.com/vishal-kr-barnwal/Cadre.git
cd Cadre
```

---

## Automated install

The quickest path is the interactive installer, which detects your CLIs, lets
you choose tools, and installs globally or into a project:

```bash
bash scripts/install.sh              # interactive
bash scripts/install.sh --all --global
bash scripts/install.sh --project=DIR --yes claude codex
bash scripts/install.sh --dry-run    # preview only
```

| Flag | Effect |
|------|--------|
| `--global` | Install into `~/` (home config) |
| `--project[=DIR]` | Install into `DIR` (default: current directory) |
| `--all` | Select every detected tool (implies `--yes`) |
| `-y`, `--yes` | Skip the confirmation prompt |
| `--dry-run` | Print actions without writing |
| positional `claude codex` | Preselect tools |

The manual per-platform steps below do the same copies by hand.

## Per-platform installation

### Claude Code

Copy the skills into your Claude config.

```bash
# Global (every project)
cp -r .claude/skills/*   ~/.claude/skills/

# Or scope to a single project
cp -r .claude/skills   your-project/.claude/skills
```

Context lives in `CLAUDE.md`. Invoke explicitly with `$cadre`, or ask for
`cadre-setup`, `cadre-newtrack`, etc.

### OpenAI Codex

Codex reads repo-scoped skills from `.agents/skills` and user-scoped skills from
`~/.agents/skills`.

```bash
# Project install
mkdir -p your-project/.agents/skills
cp -r .agents/skills/. your-project/.agents/skills/

# Or global install for your user
mkdir -p ~/.agents/skills
cp -r .agents/skills/. ~/.agents/skills/
```

Add Cadre context to your project so Codex knows the conventions. Copy the
template `AGENTS.md` into the project root (or run `/init` and paste the
relevant sections):

```bash
cp AGENTS.md your-project/AGENTS.md
```

Invoke explicitly with `$cadre`, or ask naturally for `cadre-setup`,
`cadre-newtrack Add OAuth login`, and so on. The Cadre skill routes the request
to the master protocol in `skills/cadre/protocols/`.

---

## How skills are generated

Claude Code and Codex skill bundles are **generated** from the
master workflow protocols in `skills/cadre/protocols/cadre-*.md` by:

```bash
bash scripts/generate-skills.sh
```

This reads each master protocol's frontmatter and body, then emits
platform-specific skill bundles:

| Transform | Claude Code | Codex |
|-----------|-------------|-------|
| Protocol bodies | generated into `.claude/skills/cadre/protocols/` | generated into `.agents/skills/cadre/protocols/` |
| Frontmatter | preserved | skill metadata lives in `SKILL.md` |
| Worker-dispatch reference | `Task` tool | `worker` agent type |
| `references/beads-error-handler.md` (agnostic) | skill reference | copied into `.agents/skills/cadre/references/` |
| `references/parallel-execution.md`, `template-locator.md` (sliced) | only Claude's section | only Codex's section |
| `templates/` bundle | copied into `.claude/skills/cadre/templates/` | copied into `.agents/skills/cadre/templates/` |

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
generator bundles a copy into the Codex skill at
`.agents/skills/cadre/templates/` — plus the Claude skill at
`.claude/skills/cadre/templates/`. Because each platform's install command
copies its whole directory, the templates ship with the workflow.

`cadre-setup` then **discovers** the templates directory at runtime by
probing those install locations (including `~/.agents/skills/cadre/templates/`
for global Codex skills), so it works regardless of which tool or install scope you use.
Edit templates only in the canonical `templates/` directory and regenerate.

Generated files carry an `AUTO-GENERATED` marker. **Do not hand-edit them** —
edit the master protocol in `skills/cadre/protocols/` and regenerate. To verify the committed output is in
sync (e.g. in CI):

```bash
bash scripts/generate-skills.sh --check
```

This exits non-zero if any generated file is stale.

A ready-made drift gate ships at
`templates/ci/cadre-monorepo-check.{github,gitlab}.yml` — drop the one for
your CI into place and it runs `generate-skills.sh --check` (plus `bash -n` on
the generator and installer scripts) on every PR. The `templates/` directory now includes a
`ci/` subdirectory carrying both this monorepo-check and the polyrepo
merge-train workflows (`cadre-merge-train.{github,gitlab}.yml`).

---

## MCP and LSP helpers

Cadre also ships optional runtime helpers for teams that want lower-token, more
deterministic agent integrations:

- `node scripts/mcp/cadre-server.js` starts a dependency-free MCP server exposing
  Cadre tools/resources for track status, collision scans, review gates, and
  index regeneration.
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
2. Run `bash scripts/generate-skills.sh` to regenerate skill bundles.
3. Bump the version in `README.md`.
4. Note the change in the README "What's New" section.

Migrations between layout-breaking versions ship as scripts under `scripts/`
(e.g. [`migrate-v2.sh`](../scripts/migrate-v2.sh)).
