# Locating the Conductor Templates Directory

Conductor ships starter templates — `workflow.md`, `patterns.md`, `learnings.md`,
`beads.json`, and `code_styleguides/` — bundled with the installed commands.
`conductor-setup` and `conductor-newtrack` copy from them.

## Resolve `<TEMPLATES_DIR>`

Probe with `ls` and use the **FIRST** of these paths that exists:

<!-- AGENT:claude -->
1. `.claude/skills/conductor/templates/` — project install
2. `~/.claude/skills/conductor/templates/` — global install
3. `templates/` — running inside a Conductor-Beads clone
<!-- /AGENT:claude -->
<!-- AGENT:codex -->
1. `~/.codex/prompts/templates/` — Codex custom prompts are global
2. `templates/` — running inside a Conductor-Beads clone
<!-- /AGENT:codex -->
<!-- AGENT:cursor -->
1. `.cursor/commands/templates/` — project install
2. `~/.cursor/commands/templates/` — global install
3. `templates/` — running inside a Conductor-Beads clone
<!-- /AGENT:cursor -->
<!-- AGENT:antigravity -->
1. `.agent/workflows/templates/` — project install
2. `templates/` — running inside a Conductor-Beads clone
<!-- /AGENT:antigravity -->
<!-- AGENT:copilot -->
1. `.github/prompts/templates/` — project install
2. `templates/` — running inside a Conductor-Beads clone
<!-- /AGENT:copilot -->

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
| `beads.json` | `conductor/beads.json` | setup sets `mode` (`normal`/`stealth`) |
