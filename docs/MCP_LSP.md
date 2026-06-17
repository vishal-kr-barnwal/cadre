# MCP and LSP Integration

Cadre uses two different integration layers for different jobs:

- **MCP** exposes Cadre state and deterministic operations as structured tools
  and resources. Use it when an agent needs to inspect or mutate the work graph
  without rereading long command prompts. MCP is required for Cadre workflows.
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
| `cadre_ping` | Verify that the required Cadre MCP runtime is available. |
| `cadre_current_root` | Resolve a caller-provided path to the Cadre project root. |
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
| `cadre://tracks?root=/path/to/project` | Raw per-track metadata. |
| `cadre://team-status?root=/path/to/project` | Team board data. |
| `cadre://collisions?root=/path/to/project` | Cross-track collision data. |

Cadre workflows require MCP. At the start of a Cadre workflow, callers should
verify MCP availability with `cadre_ping`. If Cadre MCP
tools are unavailable, halt and ask the user to install, enable, or restart the
Cadre plugin.

Every project-scoped MCP tool requires a per-call `root` argument. This keeps a
single long-running MCP process safe for two sessions in two different projects:
each call carries its own routing context, and the server stores no mutable
project root. The server normalizes the supplied path by walking upward to the
nearest directory containing `cadre/`, so callers may pass either the project
root or a path inside it. During `cadre-setup`, project-scoped MCP calls begin
after setup has created `cadre/`.

Example tool arguments:

```json
{ "root": "/path/to/project" }
```

Use `cadre_current_root` with a `root` argument to inspect the resolved project
root that subsequent per-call arguments should use.

Workflow routing:

| Workflow checkpoint | MCP tool |
|--------------------|----------|
| Project root resolution | `cadre_current_root` |
| Track inventory, active/completed selection, owner/reviewer summaries | `cadre_team_status` |
| Next unblocked work | `cadre_available_work` |
| Cross-track file overlaps | `cadre_collision_scan` |
| Phase/task/annotation parsing | `cadre_parse_plan` |
| Derived `tracks.md` rebuilds | `cadre_regen_index` |
| Ship/land review enforcement | `cadre_review_gate` |
| Polyrepo setup/validate/refresh/land sanity checks | `cadre_polyrepo_preflight` |

### Plugin packaging

The generated Claude Code and Codex plugins both bundle this MCP server:

| Platform | Plugin path | MCP config |
|----------|-------------|------------|
| Claude Code | `plugins/cadre-claude/` | `mcp-config.json` |
| OpenAI Codex | `plugins/cadre/` | `.mcp.json` |

The server code and `cadre-core.js` are copied into each plugin's `scripts/`
directory so installed plugin cache paths do not depend on the development
checkout. `cadre_regen_index` also resolves the bundled
`cadre-regen-index.sh` helper from the plugin templates, so the user project
does not need its own copy of the helper script.

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

1. Install the Cadre plugin with MCP enabled; Cadre workflows require it for
   deterministic status/collision/review checks.
2. Add LSP per language, starting with the repos that have frequent shared API
   changes.
3. Keep LSP graceful: absence of configured language servers should not block
   ordinary Cadre work unless the review policy explicitly requires it.

References:
- MCP specification: https://modelcontextprotocol.io/specification/2025-11-25
- MCP lifecycle: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- Language Server Protocol 3.17: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
