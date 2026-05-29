# Install & Version Guide

Conductor-Beads ships the same 16 commands to five AI coding tools. This guide
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

Current release: **v0.3.0** (multi-platform support).

| Platform | Min. version | Commands directory | Command format | Invoke | Context file | Source of truth |
|----------|--------------|--------------------|----------------|--------|--------------|-----------------|
| **Claude Code** | 1.0+ | `.claude/commands/` | Markdown + frontmatter, `$ARGUMENTS` | `/conductor-setup` | `CLAUDE.md` | ✅ canonical |
| **OpenAI Codex CLI** | custom prompts | `~/.codex/prompts/` | Markdown, `$ARGUMENTS`/`$1`…`$9` | `/conductor-setup` | `AGENTS.md` | generated |
| **Cursor** | 1.6+ | `.cursor/commands/` | Plain Markdown (no frontmatter) | `/conductor-setup` | `.cursor/rules/*.mdc` | generated |
| **Google Antigravity** | workflows support | `.agent/workflows/` | Markdown + YAML frontmatter | `/conductor-setup` | `AGENTS.md` | generated |
| **GitHub Copilot** | prompt files (VS Code / CLI) | `.github/prompts/` | `*.prompt.md` + YAML frontmatter | `/conductor-setup` | `.github/copilot-instructions.md` | generated |

> The **Claude Code** `.claude/commands/*.md` files are the single source of
> truth. Codex, Cursor, Antigravity, and Copilot command sets are generated from
> them by [`scripts/generate-commands.sh`](../scripts/generate-commands.sh).

All five platforms operate on the **same** `conductor/` and `.beads/`
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

Beads integration is always attempted. If `bd` is unavailable, Conductor prompts
you to continue without persistent memory.

Clone the repo once — every install below copies from it:

```bash
git clone https://github.com/vishal-kr-barnwal/Conductor-Beads.git
cd Conductor-Beads
```

---

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

Context lives in `CLAUDE.md`. Invoke with `/conductor-setup`,
`/conductor-newtrack`, etc.

### OpenAI Codex CLI

Codex loads custom prompts from your Codex home directory (they are **global**,
not per-repo). Copy the generated prompt files there:

```bash
mkdir -p ~/.codex/prompts
cp -r .codex/prompts/* ~/.codex/prompts/
```

Add Conductor context to your project so Codex knows the conventions. Copy the
template `AGENTS.md` into the project root (or run `/init` and paste the
relevant sections):

```bash
cp AGENTS.md your-project/AGENTS.md
```

Invoke from the Codex slash menu: type `/` then `conductor-setup` (or
`/prompts:conductor-setup`). Codex expands `$ARGUMENTS` and `$1`…`$9`, so
`/conductor-newtrack Add OAuth login` passes the description through.

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
cp .cursor/rules/conductor.mdc your-project/.cursor/rules/

# Or user-global (all projects)
mkdir -p ~/.cursor/commands
cp -r .cursor/commands/* ~/.cursor/commands/
```

The `.cursor/rules/conductor.mdc` rule loads the Conductor conventions
automatically. In the Agent input, type `/` and pick `conductor-setup`; any text
you type after the command name becomes its input.

### Google Antigravity

Antigravity discovers workflows in `.agent/workflows/` within your project.

```bash
mkdir -p your-project/.agent/workflows
cp -r .agent/workflows/* your-project/.agent/workflows/
cp AGENTS.md your-project/AGENTS.md
```

Invoke a workflow with `/conductor-setup` (Antigravity matches the workflow file
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
`conductor-setup`. The frontmatter sets `agent: agent` so each command runs in
agent mode.

---

## How commands are generated

The Codex, Cursor, Antigravity, and Copilot command sets are **generated** from
the canonical Claude Code commands in `.claude/commands/conductor-*.md` by:

```bash
bash scripts/generate-commands.sh
```

This reads each Claude command's frontmatter and body and emits the
platform-specific variant:

| Transform | Codex | Cursor | Antigravity | Copilot |
|-----------|-------|--------|-------------|---------|
| Frontmatter | none | none | `description` | `description` + `agent: agent` |
| `$ARGUMENTS` | kept (native) | described in prose | described in prose | described in prose |
| `references/beads-error-handler.md` | copied into `references/` | copied into `references/` | copied into `references/` | copied into `references/` |
| File extension | `.md` | `.md` | `.md` | `.prompt.md` |

Generated files carry an `AUTO-GENERATED` marker. **Do not hand-edit them** —
edit the Claude command and regenerate. To verify the committed output is in
sync (e.g. in CI):

```bash
bash scripts/generate-commands.sh --check
```

This exits non-zero if any generated file is stale.

---

## Versioning policy

Conductor-Beads uses [semantic versioning](https://semver.org/). The version is
declared in `README.md` (the `**Version:**` line). Per-release changes are
recorded in the [Changelog](../CHANGELOG.md).

| Bump | When |
|------|------|
| **Major** (`x.0.0`) | Breaking changes to the `conductor/` directory layout, command behavior, or Beads schema that require migration. |
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
