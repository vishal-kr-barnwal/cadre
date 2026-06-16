# Conductor for Claude Code

Context-driven development for AI coding assistants. **Measure twice, code once.**

Conductor helps you plan before you build - creating specs, implementation plans, and tracking progress through "tracks" (features, bugs, improvements).

## Installation

### Option 1: Claude Code Plugin (Recommended)

```bash
# Add the marketplace
/plugin marketplace add vishal-kr-barnwal/Conductor-Beads

# Install the plugin
/plugin install conductor

# Verify installation
/help
```

This installs:
- **16 slash commands** for direct invocation
- **1 skill** that auto-activates for conductor projects

### Option 2: Agent Skills Compatible CLI

If your CLI supports the [Agent Skills specification](https://agentskills.io):

```bash
# Point to the skill directory
skills/conductor/
├── SKILL.md                    # Entry point - overview, intent mapping, command routing
└── references/
    ├── workflows.md            # Workflow overview, state files, Beads & parallel overview
    ├── structure.md            # Directory structure reference
    ├── beads-integration.md    # Beads session protocol, CLI commands, chemistry
    ├── learnings-system.md     # Ralph-style knowledge capture
    ├── patterns-template.md    # Template for conductor/patterns.md
    └── learnings-template.md   # Template for track learnings.md
```

> Command protocols are not duplicated under the skill. Each command's full
> step-by-step protocol lives in the canonical `.claude/commands/conductor-*.md`
> (16 commands); `SKILL.md` links to them directly.

The skill follows the Agent Skills spec with full frontmatter:
- `name`: conductor
- `description`: Context-driven development methodology
- `license`: Apache-2.0
- `compatibility`: Claude Code, OpenAI Codex CLI, Cursor, Google Antigravity, GitHub Copilot, any Agent Skills compatible CLI
- `metadata`: version, author, repository, keywords

### Option 3: Manual Installation

Copy to your project:
```bash
cp -r /path/to/conductor/.claude your-project/
```

Or for global access (all projects):
```bash
cp -r /path/to/conductor/.claude/commands/* ~/.claude/commands/
cp -r /path/to/conductor/.claude/skills/* ~/.claude/skills/
```

### Option 4: Other platforms (Codex, Cursor, Antigravity, Copilot)

The same 16 commands ship for OpenAI Codex CLI, Cursor, Google Antigravity, and
GitHub Copilot. See the [Install & Version Guide](../docs/INSTALL.md) for
per-platform setup. They are generated from these Claude commands by
`scripts/generate-commands.sh`.

## Commands

| Command | Description |
|---------|-------------|
| `/conductor-setup` | Initialize project with product.md, tech-stack.md, workflow.md |
| `/conductor-newtrack [desc]` | Create new feature/bug track with spec and plan |
| `/conductor-implement [id]` | Execute tasks from track's plan (TDD workflow) |
| `/conductor-status [--export]` | Display progress overview (or export a summary) |
| `/conductor-revert` | Git-aware revert of tracks, phases, or tasks |
| `/conductor-validate` | Validate project integrity |
| `/conductor-flag <blocked\|skipped>` | Flag the current task as blocked or skipped |
| `/conductor-revise` | Update spec/plan when issues found |
| `/conductor-review` | Review a track's diff before shipping (quality gate) |
| `/conductor-ship` | Rebase a reviewed track onto main, push, prepare the PR |
| `/conductor-archive` | Archive completed tracks (local cleanup + learnings) |
| `/conductor-release` | Cut a local release — changelog + version tag |
| `/conductor-handoff` | Create context handoff for session transfer |
| `/conductor-refresh` | Sync context docs with codebase state |
| `/conductor-formula` | Manage track templates: list, show, create, ephemeral wisp |

## Skill (Auto-Activation)

The conductor skill automatically activates when Claude detects:
- A `conductor/` directory in the project
- References to tracks, specs, plans
- Context-driven development keywords

You can also use natural language:
- "Help me plan the authentication feature"
- "What's the current project status?"
- "Set up this project with Conductor"
- "Create a spec for the dark mode feature"

## How It Works

### 1. Setup
Run `/conductor-setup` to initialize your project with:
```
conductor/
├── product.md           # What you're building and for whom
├── tech-stack.md        # Technology choices and constraints
├── workflow.md          # Development standards (TDD, commits)
├── tracks.md            # Master list of all work items
├── patterns.md          # Consolidated learnings (Ralph-style)
└── beads.json           # Beads integration config
```

### 2. Create Tracks
Run `/conductor-newtrack "Add user authentication"` to create:
```
conductor/tracks/auth_20241219/
├── metadata.json        # Track type, status, dates, priority
├── spec.md              # Requirements and acceptance criteria
├── plan.md              # Phased implementation plan
└── learnings.md         # Patterns/gotchas discovered
```

### 3. Implement
Run `/conductor-implement` to execute the plan:
- Follows TDD: Write tests → Implement → Refactor
- Commits after each task with conventional messages
- Updates plan.md with progress and commit SHAs
- Captures learnings after each task
- Verifies at phase completion

### 4. Track Progress
Run `/conductor-status` to see:
- Overall project progress with priority grouping
- Current active track and task
- Parallel worker status (if active)
- Beads task status (if enabled)
- Next actions needed

## Status Markers

Throughout conductor files:
- `[ ]` - Pending/New
- `[~]` - In Progress
- `[x]` - Completed (with commit SHA)
- `[!]` - Blocked (followed by reason)
- `[-]` - Skipped (followed by reason)

## Cross-platform interoperability

Projects work across every supported tool — Claude Code, OpenAI Codex CLI,
Cursor, Google Antigravity, and GitHub Copilot. All of them invoke the same
command name (e.g. `/conductor-setup`) and operate on the same `conductor/` and
`.beads/` directories, so you can mix tools on one repo (e.g. plan in Cursor,
implement in Claude Code) with full compatibility.

See the [Install & Version Guide](../docs/INSTALL.md) for the compatibility
matrix and per-platform setup.

## File Structure

```
.claude/
├── commands/                     # Claude Code slash commands (15)
│   ├── conductor-setup.md
│   ├── conductor-newtrack.md
│   ├── conductor-implement.md
│   ├── conductor-status.md
│   ├── conductor-revert.md
│   ├── conductor-validate.md
│   ├── conductor-flag.md
│   ├── conductor-revise.md
│   ├── conductor-review.md
│   ├── conductor-ship.md
│   ├── conductor-archive.md
│   ├── conductor-release.md
│   ├── conductor-handoff.md
│   ├── conductor-refresh.md
│   └── conductor-formula.md
├── skills/
│   ├── conductor/                # Context-driven development skill
│   │   ├── SKILL.md              # Entry point (overview, intent mapping, command routing)
│   │   └── references/
│   │       ├── workflows.md      # Workflow overview, state files, Beads & parallel overview
│   │       ├── structure.md      # Directory structure reference
│   │       ├── beads-integration.md
│   │       ├── learnings-system.md
│   │       ├── patterns-template.md
│   │       └── learnings-template.md
│   │       # Command protocols live in canonical .claude/commands/conductor-*.md (16)
│   ├── beads/                    # Persistent task memory skill
│   └── skill-creator/            # Skill development guide
└── README.md                     # This file
```

## Links

- [GitHub Repository](https://github.com/vishal-kr-barnwal/Conductor-Beads)
- [Install & Version Guide](../docs/INSTALL.md)
- [Agent Skills Specification](https://agentskills.io)

## License

Apache-2.0
