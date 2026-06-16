# Locating the Cadre Templates Directory

Cadre ships starter templates — `workflow.md`, `patterns.md`, `learnings.md`,
`beads.json`, and `code_styleguides/` — bundled with the installed commands.
`cadre-setup` and `cadre-newtrack` copy from them. The same bundle also carries
**helper scripts** under `<TEMPLATES_DIR>/scripts/` that commands run **in place**
(they are not copied into `cadre/`) — currently `cadre-regen-index.sh`, the
deterministic `tracks.md` rebuilder behind `/cadre-status --regen-index`.

## Resolve `<TEMPLATES_DIR>`

Probe with `ls` and use the **FIRST** of these paths that exists:

<!-- AGENT:claude -->
1. `.claude/skills/cadre/templates/` — project install
2. `~/.claude/skills/cadre/templates/` — global install
3. `templates/` — running inside a Cadre clone
<!-- /AGENT:claude -->
<!-- AGENT:codex -->
1. `~/.codex/prompts/templates/` — Codex custom prompts are global
2. `templates/` — running inside a Cadre clone
<!-- /AGENT:codex -->

If none exist, tell the user the templates bundle is missing (point them to the
Install & Version Guide, `docs/INSTALL.md`) and ask whether to continue with
sensible built-in defaults instead of copying files.

## What each template produces

| Template | Copy to | Notes |
|----------|---------|-------|
| `workflow.md` | `cadre/workflow.md` | then customize per setup answers |
| `patterns.md` | `cadre/patterns.md` | project-level institutional knowledge |
| `learnings.md` | `cadre/tracks/<track_id>/learnings.md` | replace `{{track_id}}` with the track id |
| `code_styleguides/<lang>.md` | `cadre/code_styleguides/` | only the selected guides |
| `beads.json` | `cadre/beads.json` | setup sets `mode` (`normal`/`stealth`) |
| `scripts/cadre-regen-index.sh` | *(run in place)* | `bash <TEMPLATES_DIR>/scripts/cadre-regen-index.sh` — rebuilds `tracks.md` |
