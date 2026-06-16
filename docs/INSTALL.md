# Install & Version Guide

Cadre ships the same 16 commands to two AI coding tools. This guide
covers installation for each platform and explains how versioning and command
generation work.

- [Version & compatibility matrix](#version--compatibility-matrix)
- [Prerequisite: Beads](#prerequisite-beads)
- [Per-platform installation](#per-platform-installation)
  - [Claude Code](#claude-code)
  - [OpenAI Codex CLI](#openai-codex-cli)
- [How commands are generated](#how-commands-are-generated)
- [Versioning policy](#versioning-policy)

---

## Version & compatibility matrix

Current release: **v1.0.0** — renamed to **Cadre** (was Conductor-Beads), plus a team-scale SDLC tail (review → ship/land → archive → release with an enforced review gate), polyrepo cross-repo PRs with a no-squash merge-commit merge train, and a derived `tracks.md` index.

| Platform | Min. version | Commands directory | Command format | Invoke | Context file | Source of truth |
|----------|--------------|--------------------|----------------|--------|--------------|-----------------|
| **Claude Code** | 1.0+ | `.claude/commands/` | Markdown + frontmatter, `$ARGUMENTS` | `/cadre-setup` | `CLAUDE.md` | ✅ canonical |
| **OpenAI Codex CLI** | custom prompts | `~/.codex/prompts/` | Markdown, `$ARGUMENTS`/`$1`…`$9` | `/cadre-setup` | `AGENTS.md` | generated |

> The **Claude Code** `.claude/commands/*.md` files are the single source of
> truth. The Codex command set is generated from them by
> [`scripts/generate-commands.sh`](../scripts/generate-commands.sh).

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

---

## How commands are generated

The Codex command set is **generated** from the canonical Claude Code commands
in `.claude/commands/cadre-*.md` by:

```bash
bash scripts/generate-commands.sh
```

This reads each Claude command's frontmatter and body and emits the
Codex-specific variant:

| Transform | Codex |
|-----------|-------|
| Frontmatter | none |
| `$ARGUMENTS` | kept (native) |
| Worker-dispatch sentence | `worker` agent type |
| `references/beads-error-handler.md` (agnostic) | copied verbatim |
| `references/parallel-execution.md`, `template-locator.md` (sliced) | only Codex's section |
| `templates/` bundle | copied into `templates/` |
| File extension | `.md` |

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
generator bundles a copy into the Codex command set at
`.codex/prompts/templates/` — plus the Claude skill at
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
2. Run `bash scripts/generate-commands.sh` to regenerate the Codex command set.
3. Bump the version in `README.md`.
4. Note the change in the README "What's New" section.

Migrations between layout-breaking versions ship as scripts under `scripts/`
(e.g. [`migrate-v2.sh`](../scripts/migrate-v2.sh)).
