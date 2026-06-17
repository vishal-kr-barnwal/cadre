# MCP and LSP Integration

Cadre uses two different integration layers for different jobs:

- **MCP** exposes Cadre state and deterministic operations as structured tools
  and resources. Use it when an agent needs to inspect or mutate the work graph
  without rereading long command prompts.
- **LSP** exposes code intelligence. Use it during review to find references,
  callers, diagnostics, and symbol-level breakage that a diff-only review may
  miss.

They are complementary. MCP is the orchestration surface; LSP is the code
understanding surface.

## MCP Server

Cadre ships a dependency-free stdio MCP server:

```bash
node scripts/mcp/cadre-server.js
```

It implements the finalized MCP `2025-11-25` initialize lifecycle over stdio and
offers these tools:

| Tool | Purpose |
|------|---------|
| `cadre_regen_index` | Rebuild `cadre/tracks.md` from `metadata.json.status`. |
| `cadre_parse_plan` | Parse phases, tasks, and annotations from `plan.md`. |
| `cadre_team_status` | Group tracks by owner and status. |
| `cadre_available_work` | List new, unowned tracks whose dependencies are met. |
| `cadre_collision_scan` | Report cross-track `(repo, file)` overlaps from `<!-- files: -->`. |
| `cadre_review_gate` | Evaluate whether `metadata.review` clears ship/land. |
| `cadre_polyrepo_preflight` | Run local polyrepo manifest/submodule checks. |

It also exposes resources:

| Resource | Purpose |
|----------|---------|
| `cadre://tracks` | Raw per-track metadata. |
| `cadre://team-status` | Team board data. |
| `cadre://collisions` | Cross-track collision data. |

Set `CADRE_ROOT=/path/to/project` when launching from outside the project root.

### Plugin packaging

The generated Claude Code and Codex plugins both bundle this MCP server:

| Platform | Plugin path | MCP config |
|----------|-------------|------------|
| Claude Code | `plugins/cadre-claude/` | `mcp-config.json` |
| OpenAI Codex | `plugins/cadre/` | `.mcp.json` |

The server code and `cadre-core.js` are copied into each plugin's `scripts/`
directory so installed plugin cache paths do not depend on the development
checkout.

## LSP Review Helper

Cadre can configure LSP during setup, or later with refresh:

```bash
cadre-setup          # includes an optional LSP recommendation step
cadre-refresh --lsp  # rerun LSP recommendations later
```

Both flows use the bundled setup helper:

```bash
node <TEMPLATES_DIR>/scripts/cadre-lsp-setup.js --json
node <TEMPLATES_DIR>/scripts/cadre-lsp-setup.js --write --json
```

The helper scans source file extensions, recommends language servers, checks
whether each server command is available on PATH, and appends missing entries to
`cadre/lsp.json` without duplicating existing `servers[]` entries. If commands
are missing, Cadre prints install commands and asks whether to write the config
now or stop so the user can install the servers first.

Cadre also ships a best-effort LSP review hook:

```bash
node <TEMPLATES_DIR>/scripts/cadre-lsp-review.js --base main --head track/<track_id> --json
```

If `cadre/lsp.json` is absent, the helper exits successfully with
`available: false`; review records that code intelligence was skipped. This keeps
Cadre usable for all projects while letting teams opt in where language servers
are available.

Example `cadre/lsp.json`:

```json
{
  "servers": [
    {
      "id": "typescript",
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    }
  ]
}
```

The helper:

1. Computes changed files with `git diff --name-only <base>...<head>`.
2. Extracts likely changed or removed symbol names from zero-context diffs.
3. Opens changed files in the matching language server.
4. Requests document symbols and references.
5. Reports references that live outside the track diff as review findings.

The output is advisory unless the reviewer treats a live external caller of a
removed or renamed symbol as blocking.

### Plugin packaging

Claude Code supports plugin-level LSP server declarations, but Cadre does not
ship language-server binaries. Instead, both generated plugins bundle
`cadre-lsp-setup.js` and `cadre-lsp-review.js` under `scripts/`; Cadre workflows
use those helpers to create or read each project's `cadre/lsp.json`. This keeps
LSP opt-in per repo and avoids starting irrelevant language servers globally.

## Recommended Rollout

For a 10-20 person team:

1. Add MCP first. It reduces token use and makes status/collision/review checks
   deterministic for every agent.
2. Add LSP per language, starting with the repos that have frequent shared API
   changes.
3. Keep both integrations graceful: absence of MCP/LSP should degrade to the
   existing file-based workflow protocol, not block ordinary Cadre work.

References:
- MCP specification: https://modelcontextprotocol.io/specification/2025-11-25
- MCP lifecycle: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- Language Server Protocol 3.17: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
