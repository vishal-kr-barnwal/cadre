# Cadre for Claude Code

Context-driven development for AI coding assistants. **Measure twice, code once.**

Cadre helps you plan before you build - creating specs, implementation plans, and tracking progress through "tracks" (features, bugs, improvements).

## Installation

```bash
# Add the marketplace
/plugin marketplace add vishal-kr-barnwal/Cadre

# Install the plugin
/plugin install cadre@cadre

# Verify installation
/help
```

This installs:
- **Cadre skills** that auto-activate for cadre projects
- **16 bundled workflow protocols** inside the Cadre skill
- **Cadre MCP server config** for deterministic status, collision, and review-gate checks
- **LSP setup/review helper scripts** used by Cadre workflows when a project opts into `cadre/lsp.json`

The generated Claude Code plugin lives at `plugins/cadre-claude/`; the marketplace
catalog lives at `.claude-plugin/marketplace.json`.

The same 16 workflow protocols ship for OpenAI Codex through the generated
Codex plugin at `plugins/cadre/`, with a repo marketplace at
`.agents/plugins/marketplace.json`. See the
[Install & Version Guide](../docs/INSTALL.md) for per-platform setup. Plugin
bundles are generated from the master workflow protocols in
`skills/cadre/protocols/` by `scripts/generate-skills.sh`.

## Workflows

Ask the `$cadre` skill for one of these workflow names, or describe the goal in
plain language and let the skill route to the right protocol.

| Workflow | Description |
|---------|-------------|
| `cadre-setup` | Initialize project with product.md, tech-stack.md, workflow.md |
| `cadre-newtrack [desc]` | Create new feature/bug track with spec and plan |
| `cadre-implement [id]` | Execute tasks from track's plan (TDD workflow) |
| `cadre-status [--export]` | Display progress overview (or export a summary) |
| `cadre-revert` | Git-aware revert of tracks, phases, or tasks |
| `cadre-validate` | Validate project integrity |
| `cadre-flag <blocked\|skipped>` | Flag the current task as blocked or skipped |
| `cadre-revise` | Update spec/plan when issues found |
| `cadre-review` | Review a track's diff before shipping (quality gate) |
| `cadre-ship` | Rebase a reviewed track onto main, push, prepare the PR (monorepo) |
| `cadre-land` | Polyrepo: open + link the cross-repo PR group; merge train lands it |
| `cadre-archive` | Archive completed tracks (local cleanup + learnings) |
| `cadre-release` | Cut a local release — changelog + version tag |
| `cadre-handoff` | Create context handoff for session transfer |
| `cadre-refresh` | Sync context docs with codebase state |
| `cadre-formula` | Manage track templates: list, show, create, ephemeral wisp |

## Skill (Auto-Activation)

The cadre skill automatically activates when Claude detects:
- A `cadre/` directory in the project
- References to tracks, specs, plans
- Context-driven development keywords

You can also use natural language:
- "Help me plan the authentication feature"
- "What's the current project status?"
- "Set up this project with Cadre"
- "Create a spec for the dark mode feature"

## How It Works

### 1. Setup
Ask the Cadre skill for `cadre-setup` to initialize your project with:
```
cadre/
├── product.md           # What you're building and for whom
├── tech-stack.md        # Technology choices and constraints
├── workflow.md          # Development standards (TDD, commits)
├── tracks.json          # Generated track index
├── patterns.md          # Consolidated learnings (Ralph-style)
└── beads.json           # Beads integration config
```

### 2. Create Tracks
Ask the Cadre skill for `cadre-newtrack "Add user authentication"` to create:
```
cadre/tracks/auth_20241219/
├── metadata.json        # Track type, status, dates, priority
├── spec.md              # Requirements and acceptance criteria
├── plan.md              # Phased implementation plan
└── learnings.md         # Patterns/gotchas discovered
```

### 3. Implement
Ask the Cadre skill for `cadre-implement` to execute the plan:
- Follows TDD: Write tests → Implement → Refactor
- Commits after each task with conventional messages
- Updates plan.md with progress and commit SHAs
- Captures learnings after each task
- Verifies at phase completion

### 4. Track Progress
Ask the Cadre skill for `cadre-status` to see:
- Overall project progress with priority grouping
- Current active track and task
- Parallel worker status (if active)
- Beads task status (if enabled)
- Next actions needed

## Status Markers

Throughout cadre files:
- `[ ]` - Pending/New
- `[~]` - In Progress
- `[x]` - Completed (with commit SHA)
- `[!]` - Blocked (followed by reason)
- `[-]` - Skipped (followed by reason)

## Cross-platform interoperability

Projects work across every supported tool — Claude Code and OpenAI Codex.
Both use the same workflow names (e.g. `cadre-setup`) and operate on the same
`cadre/` and `.beads/` directories, so you can mix tools on one repo (e.g. plan
in Codex, implement in Claude Code) with full compatibility.

See the [Install & Version Guide](../docs/INSTALL.md) for the compatibility
matrix and per-platform setup.

## Plugin Structure

```
plugins/cadre-claude/
├── .claude-plugin/plugin.json
├── skills/cadre/
│   ├── SKILL.md              # Entry point (overview, intent mapping, workflow routing)
│   ├── protocols/            # Generated workflow protocols (16)
│   ├── references/           # Generated workflow references
│   └── templates/            # Bundled setup templates and helper scripts
├── mcp-config.json
└── scripts/                  # Cadre MCP server and helper scripts
```

## Links

- [GitHub Repository](https://github.com/vishal-kr-barnwal/Cadre)
- [Install & Version Guide](../docs/INSTALL.md)
- [Platform Usage Guide](../docs/PLATFORM_USAGE.md)
- [MCP and LSP Integration](../docs/MCP_LSP.md)
- [Agent Skills Specification](https://agentskills.io)

## License

Apache-2.0
