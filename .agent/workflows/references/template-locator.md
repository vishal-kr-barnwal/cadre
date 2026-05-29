# Locating the Conductor Templates Directory

Conductor ships starter templates — `workflow.md`, `patterns.md`, `learnings.md`,
`beads.json`, and `code_styleguides/` — bundled alongside the installed commands.
Any command that scaffolds a project file from a template (`conductor-setup`,
`conductor-newtrack`, and the patterns fallback in `conductor-implement` /
`conductor-refresh`) must resolve `<TEMPLATES_DIR>` before copying.

## Resolve `<TEMPLATES_DIR>`

Probe these paths with `ls` and use the **FIRST** that exists:

1. `templates/` — running inside a Conductor-Beads clone
2. `.claude/skills/conductor/templates/` — Claude Code (project install)
3. `~/.claude/skills/conductor/templates/` — Claude Code (global install)
4. `.cursor/commands/templates/` — Cursor (project)
5. `~/.cursor/commands/templates/` — Cursor (global)
6. `.agent/workflows/templates/` — Antigravity
7. `.github/prompts/templates/` — GitHub Copilot
8. `~/.codex/prompts/templates/` — Codex CLI (global prompts)

If none exist, tell the user the templates bundle is missing (point them to the
Install & Version Guide, `docs/INSTALL.md`) and ask whether to continue with
sensible built-in defaults instead of copying files.

## What each template produces

| Template | Copy to | Notes |
|----------|---------|-------|
| `workflow.md` | `conductor/workflow.md` | then customize per setup answers |
| `patterns.md` | `conductor/patterns.md` | project-level institutional knowledge |
| `learnings.md` | `conductor/tracks/<track_id>/learnings.md` | replace `{{track_id}}` with the track id |
| `code_styleguides/<lang>.md` | `conductor/code_styleguides/` | only the selected guides |
| `beads.json` | reference for `conductor/beads.json` | setup sets `mode` based on the chosen Beads mode |

Always edit templates only in the canonical `templates/` directory, then run
`scripts/generate-commands.sh` to re-bundle them into every command set.
