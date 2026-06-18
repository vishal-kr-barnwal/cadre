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
| `cadre_project` with `action: "ping"` | Verify that the required Cadre MCP runtime is available. |
| `cadre_project` with `action: "doctor"` | Diagnose runtime wiring, project markers, Beads, LSP, provider mode/MCP evidence requirements, merge-driver state, and generated-bundle check availability. |
| `cadre_project` with `action: "root"` | Resolve a caller-provided path to the Cadre project root. |
| `cadre_mutate` with `action: "regen_index"` | Rebuild `cadre/tracks.md` from `metadata.json.status`. |
| `cadre_track` with `action: "parse_plan"` | Parse phases, tasks, annotations, task keys, and recorded commit SHAs from `plan.md`. |
| `cadre_track` with `action: "phase_schedule"` | Compute phase dependencies, current ready phases, and conflict-free phase dispatch groups. |
| `cadre_status` with `action: "team"` | Group tracks by owner and status. |
| `cadre_status` with `action: "board"` | Rich team board: WIP, handoffs, review queue, blockers, and optional Beads label evidence. |
| `cadre_status` with `action: "live"` | Return the compact default status summary without agent-side plan scans. |
| `cadre_status` with `action: "available"` | List ready unowned tracks and stale held tracks that can be reclaimed. |
| `cadre_track` with `action: "prepare_implementation"` | Return a bounded implementation-start packet with selected track, optional claim, context, collisions, available work, and plan integrity. |
| `cadre_mutate` with `action: "set_status"` | Set `metadata.json.status` and regenerate `cadre/tracks.md`. |
| `cadre_status` with `action: "collisions"` | Report cross-track exact, prefix, and glob file overlaps from `<!-- files: -->`. |
| `cadre_track` with `action: "context"` | Return a bounded per-track context payload: metadata, parsed plan, counts, hold state, worktree routing, review state, and Beads IDs. |
| `cadre_track` with `action: "integrity"` | Validate plan annotations, task keys, dependency references, repo routing, and parallel file-claim shape. |
| `cadre_mutate` with `action: "claim"` | Claim ownership, mirror owner/lease metadata, and create `implement_state.json`. |
| `cadre_mutate` with `action: "heartbeat"` | Refresh owner/lease heartbeat during long quiet builds or tests. |
| `cadre_mutate` with `action: "metadata_patch"` | Apply top-level `metadata.json` patches with CAS retry semantics. |
| `cadre_track` with `action: "create_beads_tree"` | Create or dry-run the Beads epic/phase/task/dependency tree for one track and patch metadata with Beads IDs. |
| `cadre_mutate` with `action: "record_task_result"` | Record task marker/SHA/coverage results in `plan.md` and `metadata.json`. |
| `cadre_complete_task` | Run coverage/tests, enforce the threshold, then record plan/metadata/Beads completion as one transaction. |
| `cadre_mutate` with `action: "record_worker"` | Coordinator-owned parallel worker status/evidence update; can complete a task after clean merge. |
| `cadre_mutate` with `action: "record_review"` | Write the structured review verdict with reviewer-race guard and immediate gate evaluation. |
| `cadre_review` with `action: "assist"` | Assemble review evidence: repo-aware diff surface, unfinished plan tasks, TODO/stub scan, coverage, machine gate, and LSP findings. |
| `cadre_review` with `action: "machine_gate"` | Run configured typecheck/build/check/lint evidence inside MCP, per repo for polyrepo tracks. |
| `cadre_project` with `action: "sync_control_plane"` | Run the shared-mode sync preamble or postamble as a structured operation. |
| `cadre_intel` with `action: "lsp_setup"` | Detect language-server recommendations and optionally write `cadre/lsp.json`. |
| `cadre_intel` with `action: "lsp_review"` | Run the Cadre LSP/code-intelligence review helper and return structured findings. |
| `cadre_intel` with `action: "lsp_warm_review"` | Run code-intelligence review through a persistent daemon that reuses initialized language servers. |
| `cadre_intel` with `action: "lsp_daemon_status"` | Inspect warm daemon sessions and open-document counts. |
| `cadre_intel` with `action: "lsp_daemon_shutdown"` | Stop the daemon and all warm language servers. |
| `cadre_intel` with `action: "lsp_impact"` | Return symbol references, file symbols, and optional LSP diff findings for planning/revision impact checks. |
| `cadre_job` with `action: "start", type: "coverage"` | Run configured tests/coverage, parse measured coverage, and optionally record it on a track/task. |
| `cadre_review` with `action: "pr_ci_status"` | Validate caller-supplied GitHub/GitLab MCP PR/MR/CI evidence, or return exact provider MCP evidence requirements; local mode skips provider evidence. |
| `cadre_intel` with `action: "repo_map"` | Return a compact semantic repository map or references for one symbol. |
| `cadre_beads` | Perform structured Beads writes (`update`, `note`, `close`, labels, deps, create) without ad hoc shell snippets. |
| `cadre_review` with `action: "gate"` | Evaluate whether `metadata.review` clears ship/land; optional `headSha`/`headShas` enforce reviewed commit pins. |
| `cadre_project` with `action: "polyrepo_preflight"` | Run local polyrepo manifest/submodule checks. |

It also exposes resources:

| Resource | Purpose |
|----------|---------|
| `cadre://team-board?root=/path/to/project` | Rich team board data with WIP, handoffs, reviews, blockers, and Beads evidence. |
| `cadre://collisions?root=/path/to/project` | Cross-track collision data. |
| `cadre://track-context?root=/path/to/project&trackId=<id>` | Bounded context for one track. |
| `cadre://repo-map?root=/path/to/project` | Compact semantic map; add `&symbol=<name>` for references. |
| `cadre://lsp-status?root=/path/to/project` | Configured LSP servers plus setup recommendations. |
| `cadre://repo-topology?root=/path/to/project` | Mono/polyrepo topology and configured product repos. |
| `cadre://provider-actions?root=/path/to/project&trackId=<id>&workflow=ship|land` | Hosted provider action queue from a ship or land packet. |
| `cadre://ship-plan?root=/path/to/project&trackId=<id>` | Compact ship dry-run plan. |
| `cadre://land-plan?root=/path/to/project&trackId=<id>` | Compact land dry-run plan. |
| `cadre://release-plan?root=/path/to/project` | Compact release dry-run plan. |

Cadre workflows require MCP. At the start of a Cadre workflow, callers should
verify MCP availability with `cadre_project` with `action: "ping"`. If Cadre MCP
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

Use `cadre_project` with `action: "root"` with a `root` argument to inspect the resolved project
root that subsequent per-call arguments should use.

Workflow routing:

| Workflow checkpoint | MCP tool |
|--------------------|----------|
| Runtime/project diagnostics | `cadre_project` with `action: "doctor"` |
| Project root resolution | `cadre_project` with `action: "root"` |
| Track inventory, active/completed selection, owner/reviewer summaries | `cadre_status` with `action: "team"` |
| Rich team board, handoffs, review queue, blockers | `cadre_status` with `action: "board"` |
| Cheap default status | `cadre_status` with `action: "live"` |
| Next unblocked work | `cadre_status` with `action: "available"` |
| Implementation start packet | `cadre_track` with `action: "prepare_implementation"` |
| Cross-track file overlaps | `cadre_status` with `action: "collisions"` |
| Phase/task/annotation parsing | `cadre_track` with `action: "parse_plan"` |
| Phase-level ready-group scheduling | `cadre_track` with `action: "phase_schedule"` |
| Track-specific context packet | `cadre_track` with `action: "context"` |
| Plan annotation validation | `cadre_track` with `action: "integrity"` |
| Ownership claim | `cadre_mutate` with `action: "claim"` |
| Long-running owner/lease heartbeat | `cadre_mutate` with `action: "heartbeat"` |
| Key-scoped metadata updates | `cadre_mutate` with `action: "metadata_patch"` |
| Per-task result write | `cadre_mutate` with `action: "record_task_result"` |
| Safe task completion | `cadre_complete_task` |
| Parallel worker audit/status | `cadre_mutate` with `action: "record_worker"` |
| Track status mutation | `cadre_mutate` with `action: "set_status"` |
| Derived `tracks.md` rebuilds | `cadre_mutate` with `action: "regen_index"` |
| Structured review write | `cadre_mutate` with `action: "record_review"` |
| Ship/land review enforcement | `cadre_review` with `action: "gate"` |
| Shared-mode pre/post sync | `cadre_project` with `action: "sync_control_plane"` |
| LSP configuration | `cadre_intel` with `action: "lsp_setup"` |
| Code-intelligence review | `cadre_intel` with `action: "lsp_warm_review"` preferred; `cadre_intel` with `action: "lsp_review"` fallback |
| Review machine gate | `cadre_review` with `action: "machine_gate"` |
| Coverage measurement and recording | `cadre_job` with `action: "start", type: "coverage"` |
| Ship/land provider actions | `cadre_workflow` with `workflow: "ship"` or `"land"` returns provider action specs; provider MCP executes them; call the workflow packet back with `providerEvidence` |
| PR/MR and CI status | Provider MCP query followed by `cadre_review` with `action: "provider_evidence"` or `action: "pr_ci_status"` with supplied evidence |
| Low-token repo/symbol orientation | `cadre_intel` with `action: "repo_map"` or `cadre://repo-map` |
| Beads task writes | `cadre_beads` |
| Beads tree initialization | `cadre_track` with `action: "create_beads_tree"` |
| Review evidence packet | `cadre_review` with `action: "assist"` |
| Planning/revision semantic impact | `cadre_intel` with `action: "lsp_impact"` |
| Polyrepo setup/validate/refresh/land sanity checks | `cadre_project` with `action: "polyrepo_preflight"` |

Composite packets should be called at the protocol checkpoint they are designed
for rather than recreated with scattered shell probes:

- `cadre_project` with `action: "doctor"`: setup, status `--doctor`, and validate diagnostics.
- `cadre_track` with `action: "prepare_implementation"`: first implementation-start call after root/sync.
- `cadre_track` with `action: "phase_schedule"`: phase-level coordinator loop before dispatching phases.
- `cadre_track` with `action: "create_beads_tree"`: new-track Beads tree dry-run and live creation.
- `cadre_review` with `action: "assist"`: first review evidence packet before `/code-review`.
- `cadre_intel` with `action: "lsp_impact"`: new-track planning and revise impact checks.

Workflow packets include `response_mode` in their result. The default is
`compact`; pass `responseMode: "detail"` or `detail: true` when a caller needs
full packet context for handoff, review, or debugging.

## External Provider MCPs

Cadre's own MCP server is the source of truth for orchestration state. External
provider MCP servers should feed evidence into Cadre; they must not replace
Cadre metadata or Beads as the authority for track state, ownership, review
gates, or release readiness.

Recommended provider MCP usage:

| Provider MCP | Use as evidence for | Cadre write-back |
|--------------|---------------------|------------------|
| GitHub MCP | PR metadata, reviews, checks, Actions logs, issue context, discussion links | `cadre_review` with `action: "provider_evidence"`, `cadre_review` with `action: "pr_ci_status"` and supplied evidence, `cadre_mutate` with `action: "record_review"`, Beads notes |
| GitLab MCP | MR metadata, approvals, pipelines, job logs, issue context | `cadre_review` with `action: "provider_evidence"`, `cadre_review` with `action: "pr_ci_status"` and supplied evidence, `cadre_mutate` with `action: "record_review"`, Beads notes |

Setup records one provider mode in `cadre/config.json`:

```json
{
  "provider_mode": "local",
  "provider_mcp_required": false,
  "remote_host": ""
}
```

`provider_mode` is `local`, `github`, or `gitlab`. Setup detects GitHub/GitLab
remotes when possible, asks the caller to choose when remotes are ambiguous, and
allows explicit local-only mode. Local mode requires no provider MCP evidence.

Operational rule: a green provider check or approved PR/MR is supporting
evidence; the track is cleared only when `cadre_mutate` with
`action: "record_review"` and `cadre_review` with `action: "gate"`
record/verify the Cadre verdict. In `github` or `gitlab` mode, provider
evidence must come from the matching provider MCP and be written back through a
Cadre packet. There is no `gh`/`glab` fallback in workflow packets. If the
matching provider MCP is unavailable, provider-dependent packets fail closed
with `required_provider_mcp`, `required_evidence`, and `next_actions`.

### Plugin packaging

The generated Claude Code and Codex plugins both bundle this MCP server:

| Platform | Plugin path | MCP config |
|----------|-------------|------------|
| Claude Code | `plugins/cadre-claude/` | `mcp-config.json` |
| OpenAI Codex | `plugins/cadre/` | `.mcp.json` |

The server code and `cadre-core.js` are built from TypeScript sources in `src/`
and copied into each plugin's `scripts/` directory so installed plugin cache
paths do not depend on the development checkout. `cadre_mutate` with
`action: "regen_index"` is implemented inside the MCP core and rebuilds the
marked index region directly from per-track metadata.

## LSP Review Helper

Cadre can configure LSP during setup, or later with refresh:

```bash
cadre-setup          # includes an optional LSP recommendation step
cadre-refresh --lsp  # rerun LSP recommendations later
```

Both flows use `cadre_intel` with `action: "lsp_setup"`. Call it without
`execute:true` for recommendations and with `execute:true` to write
`cadre/lsp.json`.

The helper scans source file extensions and well-known filenames, recommends
language servers across the detected languages, checks whether each server
command is available on PATH, and appends missing entries to `cadre/lsp.json`
without duplicating existing `servers[]` entries. If commands are missing,
Cadre prints install commands and asks whether to write the config now or stop
so the user can install the servers first.

Cadre also ships a best-effort LSP review hook through `cadre_intel` with
`action: "lsp_warm_review"`; `action: "lsp_review"` is the cold fallback.

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
    },
    {
      "id": "python",
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "extensions": [".py", ".pyi"]
    },
    {
      "id": "dockerfile",
      "command": "docker-langserver",
      "args": ["--stdio"],
      "extensions": [],
      "filenames": ["Dockerfile", "Containerfile"],
      "languageIds": {
        "Dockerfile": "dockerfile",
        "Containerfile": "dockerfile"
      }
    }
  ]
}
```

Built-in recommendations cover TypeScript/JavaScript, Python, Go, Rust, Java,
Kotlin, Swift, C/C++/Objective-C, C#, PHP, Ruby, Dart, HTML, CSS, JSON, YAML,
Markdown, TOML, Lua, shell, Terraform/HCL, Elixir, Scala, Clojure, Haskell,
OCaml, Zig, Nix, Elm, Vue, Svelte, Dockerfile, XML, GraphQL, Prisma, and
Protocol Buffers. Teams can add custom `servers[]` entries for any other
language server; `extensions`, `filenames`, and `languageIds` control which
files Cadre opens and what LSP language id is sent.

The helper:

1. Computes changed files with `git diff --name-only <base>...<head>`.
2. Extracts likely changed or removed symbol names from zero-context diffs.
3. Opens changed files in the matching language server.
4. Requests document symbols and references.
5. Reports references that live outside the track diff as review findings.

The output is advisory unless the reviewer treats a live external caller of a
removed or renamed symbol as blocking.

### Persistent LSP daemon

The MCP server also owns a persistent LSP daemon:

```text
cadre_intel { "action": "lsp_warm_review" }
cadre_intel { "action": "lsp_daemon_status" }
cadre_intel { "action": "lsp_daemon_shutdown" }
```

`cadre_intel` with `action: "lsp_warm_review"` uses the same review engine as
`cadre-lsp-review.js`, but the daemon keeps initialized language servers alive
between calls. Repeated reviews against the same root/server reuse warm
processes and update already-open documents with `textDocument/didChange`.

Use `cadre_intel` with `action: "lsp_review"` as the compatibility fallback when a client cannot use
the daemon path. Use `cadre_intel` with `action: "lsp_daemon_shutdown"` before plugin shutdown tests or
when changing language-server binaries on disk.

## Coverage, PR/CI, and Beads MCP

`cadre_job` with `action: "start", type: "coverage"` chooses a command in this order:

1. Explicit tool argument `command`.
2. `cadre/config.json` `coverage_command`, `test_coverage_command`, or
   `test_command`.
3. Common package scripts such as `coverage`, `test:coverage`, or `test`.
4. A small language fallback (`pytest --cov --cov-report=term`, `go test ./...`).

It parses common terminal coverage summaries and `coverage/lcov.info` from the
task's resolved repo/worktree, then writes `metadata.last_test_run` and
`metadata.last_coverage` when `trackId` is provided. If `phaseIndex` and
`taskIndex` are also provided, it records the task result through the same path
as `cadre_mutate` with `action: "record_task_result"`.

For normal implementation completion, prefer `cadre_complete_task`: it runs the
coverage command first in the task's resolved repo/worktree, enforces the
threshold, requires mapped Beads tasks to be writable, writes the Beads
completion note/close, and only then records the plan row and metadata result.
`cadre_job` with `action: "start", type: "coverage"` remains useful for diagnostic and preflight checks where no
plan mutation should happen.

`cadre_review` with `action: "pr_ci_status"` is provider-MCP-only. In
`provider_mode: "github"` or `provider_mode: "gitlab"`, it either validates
caller-supplied MCP evidence or returns the exact `required_provider_mcp` and
`required_evidence` contract needed before review/ship/land can proceed. In
`provider_mode: "local"`, it returns a skipped success because no provider
evidence is required.

`cadre_beads` is the preferred write surface for routine task operations:
`ready`, `show`, `update`, `note`, `close`, `label_add`, `label_remove`,
`dep_add`, and `create`. It keeps Beads mutations structured while still
letting Beads own its Dolt database.

### Plugin packaging

Claude Code supports plugin-level LSP server declarations, but Cadre does not
ship language-server binaries. Instead, both generated plugins bundle
TypeScript-built `cadre-lsp-setup.js` and `cadre-lsp-review.js` under `scripts/`;
Cadre workflows use those helpers to create or read each project's
`cadre/lsp.json`. This keeps LSP opt-in per repo and avoids starting irrelevant
language servers globally.

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
