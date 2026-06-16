# Install & Version Guide

Cadre ships the same 16 commands to five AI coding tools. This guide
covers installation for each platform and explains how versioning and command
generation work.

- [Version & compatibility matrix](#version--compatibility-matrix)
- [Prerequisite: Beads](#prerequisite-beads)
- [Per-platform installation](#per-platform-installation)
  - [Claude Code](#claude-code)
  - [OpenAI Codex CLI](#openai-codex-cli)
  - [Cursor](#cursor)
  - [Google Antigravity](#google-antigravity)
  - [GitHub Copilot](#github-copilot)
- [How commands are generated](#how-commands-are-generated)
- [Versioning policy](#versioning-policy)

---

## Version & compatibility matrix

Current release: **v0.3.4** (multi-platform support, plus the team-scale SDLC tail — review → ship/land → archive → release with an enforced review gate — and polyrepo cross-repo PRs with a merge-commit merge train).

| Platform | Min. version | Commands directory | Command format | Invoke | Context file | Source of truth |
|----------|--------------|--------------------|----------------|--------|--------------|-----------------|
| **Claude Code** | 1.0+ | `.claude/commands/` | Markdown + frontmatter, `$ARGUMENTS` | `/cadre-setup` | `CLAUDE.md` | ✅ canonical |
| **OpenAI Codex CLI** | custom prompts | `~/.codex/prompts/` | Markdown, `$ARGUMENTS`/`$1`…`$9` | `/cadre-setup` | `AGENTS.md` | generated |
| **Cursor** | 1.6+ | `.cursor/commands/` | Plain Markdown (no frontmatter) | `/cadre-setup` | `.cursor/rules/*.mdc` | generated |
| **Google Antigravity** | workflows support | `.agent/workflows/` | Markdown + YAML frontmatter | `/cadre-setup` | `AGENTS.md` | generated |
| **GitHub Copilot** | prompt files (VS Code / CLI) | `.github/prompts/` | `*.prompt.md` + YAML frontmatter | `/cadre-setup` | `.github/copilot-instructions.md` | generated |

> The **Claude Code** `.claude/commands/*.md` files are the single source of
> truth. Codex, Cursor, Antigravity, and Copilot command sets are generated from
> them by [`scripts/generate-commands.sh`](../scripts/generate-commands.sh).

All five platforms operate on the **same** `cadre/` and `.beads/`
directories, so you can mix tools on one repository (e.g. plan in Cursor,
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
| positional `claude codex cursor antigravity copilot` | Preselect tools |

The manual per-platform steps below do the same copies by hand.

## Per-platform installation

### Claude Code

Copy the commands and skills into your Claude config.

```bash
# Global (every project)
cp -r .claude/commands/* ~/.claude/commands/
cp -r .claude/skills/*   ~/.claude/skills/

# Or scope to a single project
cp -r .claude/commands your-project/.claude/commands
cp -r .claude/skills   your-project/.claude/skills
```

Context lives in `CLAUDE.md`. Invoke with `/cadre-setup`,
`/cadre-newtrack`, etc.

### OpenAI Codex CLI

Codex loads custom prompts from your Codex home directory (they are **global**,
not per-repo). Copy the generated prompt files there:

```bash
mkdir -p ~/.codex/prompts
cp -r .codex/prompts/* ~/.codex/prompts/
```

Add Cadre context to your project so Codex knows the conventions. Copy the
template `AGENTS.md` into the project root (or run `/init` and paste the
relevant sections):

```bash
cp AGENTS.md your-project/AGENTS.md
```

Invoke from the Codex slash menu: type `/` then `cadre-setup` (or
`/prompts:cadre-setup`). Codex expands `$ARGUMENTS` and `$1`…`$9`, so
`/cadre-newtrack Add OAuth login` passes the description through.

> **Note:** OpenAI marks custom prompts as deprecated in favor of Skills, but
> they remain fully supported. If you prefer Skills, the same Markdown bodies
> can be dropped into a Codex skill.

### Cursor

Cursor commands are per-project Markdown files (or user-global in
`~/.cursor/commands/`).

```bash
# Project-scoped
mkdir -p your-project/.cursor/commands your-project/.cursor/rules
cp -r .cursor/commands/* your-project/.cursor/commands/
cp .cursor/rules/cadre.mdc your-project/.cursor/rules/

# Or user-global (all projects)
mkdir -p ~/.cursor/commands
cp -r .cursor/commands/* ~/.cursor/commands/
```

The `.cursor/rules/cadre.mdc` rule loads the Cadre conventions
automatically. In the Agent input, type `/` and pick `cadre-setup`; any text
you type after the command name becomes its input.

### Google Antigravity

Antigravity discovers workflows in `.agent/workflows/` within your project.

```bash
mkdir -p your-project/.agent/workflows
cp -r .agent/workflows/* your-project/.agent/workflows/
cp AGENTS.md your-project/AGENTS.md
```

Invoke a workflow with `/cadre-setup` (Antigravity matches the workflow file
name). `AGENTS.md` supplies the project context/rules.

> To let a workflow auto-run shell steps without confirmation, add a `// turbo`
> comment on the line above a step. The shipped commands omit this so git
> operations always ask first — add it yourself if you trust a given step.

### GitHub Copilot

Copilot reads prompt files from `.github/prompts/` and repository instructions
from `.github/copilot-instructions.md`.

```bash
mkdir -p your-project/.github/prompts
cp -r .github/prompts/* your-project/.github/prompts/
cp .github/copilot-instructions.md your-project/.github/copilot-instructions.md
```

Enable prompt files in VS Code if needed
(`"chat.promptFiles": true` in settings). In Copilot Chat, type `/` then
`cadre-setup`. The frontmatter sets `agent: agent` so each command runs in
agent mode.

---

## How commands are generated

The Codex, Cursor, Antigravity, and Copilot command sets are **generated** from
the canonical Claude Code commands in `.claude/commands/cadre-*.md` by:

```bash
bash scripts/generate-commands.sh
```

This reads each Claude command's frontmatter and body and emits the
platform-specific variant:

| Transform | Codex | Cursor | Antigravity | Copilot |
|-----------|-------|--------|-------------|---------|
| Frontmatter | none | none | `description` | `description` + `agent: agent` |
| `$ARGUMENTS` | kept (native) | described in prose | described in prose | described in prose |
| Worker-dispatch sentence | `worker` agent type | `/multitask` | Agent Manager | `/fleet` |
| `references/beads-error-handler.md` (agnostic) | copied verbatim | copied verbatim | copied verbatim | copied verbatim |
| `references/parallel-execution.md`, `template-locator.md` (sliced) | only Codex's section | only Cursor's | only Antigravity's | only Copilot's |
| `templates/` bundle | copied into `templates/` | copied into `templates/` | copied into `templates/` | copied into `templates/` |
| File extension | `.md` | `.md` | `.md` | `.prompt.md` |

### Per-agent slicing (token optimization)

To avoid shipping every tool's instructions to every tool, the multi-platform
references are **sliced per agent**. Their masters live in `scripts/agent-refs/`
with `<!-- AGENT:<name> -->` blocks; the generator emits a copy to each platform
(Claude included) containing only the shared text plus that platform's block.
The one-line worker-dispatch sentence in `cadre-implement` is likewise
substituted per platform. Net result: a Codex bundle never carries Cursor's or
Copilot's parallel/locator instructions. Edit the masters in `scripts/agent-refs/`
(not the generated `references/` copies) and regenerate.

### Templates bundling

`cadre-setup` copies starter files (`workflow.md`, `code_styleguides/`, …)
into your project. Those live in the canonical `templates/` directory, and the
generator bundles a copy into **every** command set — `.codex/prompts/templates/`,
`.cursor/commands/templates/`, `.agent/workflows/templates/`,
`.github/prompts/templates/` — plus the Claude skill at
`.claude/skills/cadre/templates/`. Because each platform's install command
copies its whole directory, the templates ship with the commands.

`cadre-setup` then **discovers** the templates directory at runtime by
probing those install locations (and `~/.codex/prompts/templates/` for Codex's
global prompts), so it works regardless of which tool or install scope you use.
Edit templates only in the canonical `templates/` directory and regenerate.

Generated files carry an `AUTO-GENERATED` marker. **Do not hand-edit them** —
edit the Claude command and regenerate. To verify the committed output is in
sync (e.g. in CI):

```bash
bash scripts/generate-commands.sh --check
```

This exits non-zero if any generated file is stale.

A ready-made drift gate ships at
`templates/ci/cadre-monorepo-check.{github,gitlab}.yml` — drop the one for
your CI into place and it runs `generate-commands.sh --check` (plus `bash -n` on
the command scripts) on every PR. The `templates/` directory now includes a
`ci/` subdirectory carrying both this monorepo-check and the polyrepo
merge-train workflows (`cadre-merge-train.{github,gitlab}.yml`).

---

## Versioning policy

Cadre uses [semantic versioning](https://semver.org/). The version is
declared in `README.md` (the `**Version:**` line). Per-release changes are
recorded in the [Changelog](../CHANGELOG.md).

| Bump | When |
|------|------|
| **Major** (`x.0.0`) | Breaking changes to the `cadre/` directory layout, command behavior, or Beads schema that require migration. |
| **Minor** (`0.x.0`) | New commands, new platform support, or new opt-in features. Backward compatible. |
| **Patch** (`0.0.x`) | Bug fixes and documentation. |

When adding or changing a command:

1. Edit the canonical Claude command in `.claude/commands/`.
2. Run `bash scripts/generate-commands.sh` to regenerate the Codex, Cursor,
   Antigravity, and Copilot command sets.
3. Bump the version in `README.md`.
4. Note the change in the README "What's New" section.

Migrations between layout-breaking versions ship as scripts under `scripts/`
(e.g. [`migrate-v2.sh`](../scripts/migrate-v2.sh)).
