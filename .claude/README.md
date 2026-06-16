# Cadre for Claude Code

Context-driven development for AI coding assistants. **Measure twice, code once.**

Cadre helps you plan before you build - creating specs, implementation plans, and tracking progress through "tracks" (features, bugs, improvements).

## Installation

### Option 1: Claude Code Plugin (Recommended)

```bash
# Add the marketplace
/plugin marketplace add vishal-kr-barnwal/Cadre

# Install the plugin
/plugin install cadre

# Verify installation
/help
```

This installs:
- **16 slash commands** for direct invocation
- **1 skill** that auto-activates for cadre projects

### Option 2: Agent Skills Compatible CLI

If your CLI supports the [Agent Skills specification](https://agentskills.io):

```bash
# Point to the skill directory
skills/cadre/
├── SKILL.md                    # Entry point - overview, intent mapping, command routing
└── references/
    ├── workflows.md            # Workflow overview, state files, Beads & parallel overview
    ├── structure.md            # Directory structure reference
    ├── beads-integration.md    # Beads session protocol, CLI commands, chemistry
    ├── learnings-system.md     # Ralph-style knowledge capture
    ├── patterns-template.md    # Template for cadre/patterns.md
    └── learnings-template.md   # Template for track learnings.md
```

> Command protocols are not duplicated under the skill. Each command's full
> step-by-step protocol lives in the canonical `.claude/commands/cadre-*.md`
> (16 commands); `SKILL.md` links to them directly.

The skill follows the Agent Skills spec with full frontmatter:
- `name`: cadre
- `description`: Context-driven development methodology
- `license`: Apache-2.0
- `compatibility`: Claude Code, OpenAI Codex CLI, Cursor, Google Antigravity, GitHub Copilot, any Agent Skills compatible CLI
- `metadata`: version, author, repository, keywords

### Option 3: Manual Installation

Copy to your project:
```bash
cp -r /path/to/cadre/.claude your-project/
```

Or for global access (all projects):
```bash
cp -r /path/to/cadre/.claude/commands/* ~/.claude/commands/
cp -r /path/to/cadre/.claude/skills/* ~/.claude/skills/
```

### Option 4: Other platforms (Codex, Cursor, Antigravity, Copilot)

The same 16 commands ship for OpenAI Codex CLI, Cursor, Google Antigravity, and
GitHub Copilot. See the [Install & Version Guide](../docs/INSTALL.md) for
per-platform setup. They are generated from these Claude commands by
`scripts/generate-commands.sh`.

## Commands

| Command | Description |
|---------|-------------|
| `/cadre-setup` | Initialize project with product.md, tech-stack.md, workflow.md |
| `/cadre-newtrack [desc]` | Create new feature/bug track with spec and plan |
| `/cadre-implement [id]` | Execute tasks from track's plan (TDD workflow) |
| `/cadre-status [--export]` | Display progress overview (or export a summary) |
| `/cadre-revert` | Git-aware revert of tracks, phases, or tasks |
| `/cadre-validate` | Validate project integrity |
| `/cadre-flag <blocked\|skipped>` | Flag the current task as blocked or skipped |
| `/cadre-revise` | Update spec/plan when issues found |
| `/cadre-review` | Review a track's diff before shipping (quality gate) |
| `/cadre-ship` | Rebase a reviewed track onto main, push, prepare the PR |
| `/cadre-archive` | Archive completed tracks (local cleanup + learnings) |
| `/cadre-release` | Cut a local release — changelog + version tag |
| `/cadre-handoff` | Create context handoff for session transfer |
| `/cadre-refresh` | Sync context docs with codebase state |
| `/cadre-formula` | Manage track templates: list, show, create, ephemeral wisp |

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
Run `/cadre-setup` to initialize your project with:
```
cadre/
├── product.md           # What you're building and for whom
├── tech-stack.md        # Technology choices and constraints
├── workflow.md          # Development standards (TDD, commits)
├── tracks.md            # Master list of all work items
├── patterns.md          # Consolidated learnings (Ralph-style)
└── beads.json           # Beads integration config
```

### 2. Create Tracks
Run `/cadre-newtrack "Add user authentication"` to create:
```
cadre/tracks/auth_20241219/
├── metadata.json        # Track type, status, dates, priority
├── spec.md              # Requirements and acceptance criteria
├── plan.md              # Phased implementation plan
└── learnings.md         # Patterns/gotchas discovered
```

### 3. Implement
Run `/cadre-implement` to execute the plan:
- Follows TDD: Write tests → Implement → Refactor
- Commits after each task with conventional messages
- Updates plan.md with progress and commit SHAs
- Captures learnings after each task
- Verifies at phase completion

### 4. Track Progress
Run `/cadre-status` to see:
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

Projects work across every supported tool — Claude Code, OpenAI Codex CLI,
Cursor, Google Antigravity, and GitHub Copilot. All of them invoke the same
command name (e.g. `/cadre-setup`) and operate on the same `cadre/` and
`.beads/` directories, so you can mix tools on one repo (e.g. plan in Cursor,
implement in Claude Code) with full compatibility.

See the [Install & Version Guide](../docs/INSTALL.md) for the compatibility
matrix and per-platform setup.

## File Structure

```
.claude/
├── commands/                     # Claude Code slash commands (15)
│   ├── cadre-setup.md
│   ├── cadre-newtrack.md
│   ├── cadre-implement.md
│   ├── cadre-status.md
│   ├── cadre-revert.md
│   ├── cadre-validate.md
│   ├── cadre-flag.md
│   ├── cadre-revise.md
│   ├── cadre-review.md
│   ├── cadre-ship.md
│   ├── cadre-archive.md
│   ├── cadre-release.md
│   ├── cadre-handoff.md
│   ├── cadre-refresh.md
│   └── cadre-formula.md
├── skills/
│   ├── cadre/                # Context-driven development skill
│   │   ├── SKILL.md              # Entry point (overview, intent mapping, command routing)
│   │   └── references/
│   │       ├── workflows.md      # Workflow overview, state files, Beads & parallel overview
│   │       ├── structure.md      # Directory structure reference
│   │       ├── beads-integration.md
│   │       ├── learnings-system.md
│   │       ├── patterns-template.md
│   │       └── learnings-template.md
│   │       # Command protocols live in canonical .claude/commands/cadre-*.md (16)
│   ├── beads/                    # Persistent task memory skill
│   └── skill-creator/            # Skill development guide
└── README.md                     # This file
```

## Links

- [GitHub Repository](https://github.com/vishal-kr-barnwal/Cadre)
- [Install & Version Guide](../docs/INSTALL.md)
- [Agent Skills Specification](https://agentskills.io)

## License

Apache-2.0
