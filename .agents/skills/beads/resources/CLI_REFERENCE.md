# CLI Command Reference

**For:** AI agents and developers using bd command-line interface
**Version:** 1.0.2

## Quick Navigation

- [Health & Status](#health--status)
- [Basic Operations](#basic-operations)
- [Issue Management](#issue-management)
- [Dependencies & Labels](#dependencies--labels)
- [Filtering & Search](#filtering--search)
- [Visualization](#visualization)
- [Advanced Operations](#advanced-operations)
- [Database Management](#database-management)
- [Graph Links](#graph-links)
- [Messaging](#messaging)

## Health & Status

### Doctor (Start Here for Problems)

```bash
# Basic health check
bd doctor                      # Check installation health
bd doctor --json               # Machine-readable output

# Fix issues
bd doctor --fix                # Auto-fix with confirmation
bd doctor --fix --yes          # Auto-fix without confirmation
bd doctor --dry-run            # Preview what --fix would do

# Deep validation
bd doctor --deep               # Full graph integrity validation

# Performance diagnostics
bd doctor --perf               # Run performance diagnostics
bd doctor --output diag.json   # Export diagnostics to file

# Specific checks
bd doctor --check=pollution              # Detect test issues
bd doctor --check=pollution --clean      # Delete test issues

# Recovery modes
bd doctor --fix --source=dolt            # Rebuild from Dolt history
bd doctor --fix --force                  # Force repair on corrupted DB
```

### Status Overview

```bash
# Quick database snapshot (like git status for issues)
bd status                      # Summary with activity
bd status --json               # JSON format
bd status --no-activity        # Skip git activity (faster)
bd status --assigned           # Show issues assigned to you
bd stats                       # Alias for bd status
```

### Prime (AI Context)

```bash
# Output AI-optimized workflow context
bd prime                       # Auto-detects MCP vs CLI mode
bd prime --full                # Force full CLI output
bd prime --mcp                 # Force minimal MCP output
bd prime --stealth             # No git operations mode
bd prime --export              # Dump default content for customization
```

**Customization:** Place `.beads/PRIME.md` to override default output.

## Basic Operations

### Check Status

```bash
# Check database path and server status
bd info --json

# Example output:
# {
#   "database_path": "/path/to/.beads/beads.db",
#   "issue_prefix": "bd",
#   "embedded": true
# }
```

### Find Work

```bash
# Find ready work (no blockers)
bd ready --json
bd list --ready --json                        # Same, integrated into list

# Find blocked work
bd blocked --json                             # Show all blocked issues
bd blocked --parent bd-epic --json            # Blocked descendants of epic

# Find molecules waiting on gates for resume
bd ready --gated --json                       # Gate-resume discovery

# Find stale issues (not updated recently)
bd stale --days 30 --json                    # Default: 30 days
bd stale --days 90 --status in_progress --json  # Filter by status
bd stale --limit 20 --json                   # Limit results
```

## Issue Management

### Create Issues

```bash
# Basic creation
# IMPORTANT: Always quote titles and descriptions with double quotes
bd create "Issue title" -t story|spike|bug|task -p 0-4 -d "Description" --json

# Create with explicit ID (for parallel workers)
bd create "Issue title" --id worker1-100 -p 1 --json

# Create with labels (--labels or --label work)
bd create "Issue title" -t story -p 1 -l bug,critical --json
bd create "Issue title" -t story -p 1 --label bug,critical --json

# Examples with special characters (all require quoting):
bd create "Fix: auth doesn't validate tokens" -t bug -p 1 --json
bd create "Add support for OAuth 2.0" -d "Implement RFC 6749 (OAuth 2.0 spec)" --json

# Create multiple issues from markdown file
bd create -f feature-plan.md --json

# Create epic with hierarchical child tasks
bd create "Auth System" -t epic -p 1 --json         # Returns: bd-a3f8e9
bd create "Phase 1" -t milestone --parent bd-a3f8e9 --json # Returns: bd-a3f8e9.1
bd create "Login UI" -t story --parent bd-a3f8e9.1 --json  # Auto-assigned: bd-a3f8e9.1.1

# Create and link discovered work (one command)
bd create "Found bug" -t bug -p 1 --deps discovered-from:<parent-id> --json

# Create with external reference
bd create "Fix login" -t bug -p 1 --external-ref "gh-123" --json  # Short form
bd create "Fix login" -t bug -p 1 --external-ref "https://github.com/org/repo/issues/123" --json  # Full URL
bd create "Jira task" -t task -p 1 --external-ref "jira-PROJ-456" --json  # Custom prefix

# Preview creation without side effects
bd create "Issue title" -t task -p 1 --dry-run --json  # Shows what would be created
```

### Quick Capture (q)

```bash
# Create issue and output only the ID (for scripting)
bd q "Fix login bug"                          # Outputs: bd-a1b2
bd q "Task" -t task -p 1                      # With type and priority
bd q "Bug" -t bug -l critical                 # With labels

# Scripting examples
ISSUE=$(bd q "New feature")                   # Capture ID in variable
bd q "Task" | xargs bd show                   # Pipe to other commands
```

### Update Issues

```bash
# Update one or more issues
bd update <id> [<id>...] --status in_progress --json
bd update <id> [<id>...] --priority 1 --json

# Update external reference
bd update <id> --external-ref "gh-456" --json           # Short form
bd update <id> --external-ref "jira-PROJ-789" --json    # Custom prefix

# Edit issue fields in $EDITOR (HUMANS ONLY - not for agents)
bd edit <id>                    # Edit description
bd edit <id> --title            # Edit title
bd edit <id> --design           # Edit design notes
bd edit <id> --notes            # Edit notes
bd edit <id> --acceptance       # Edit acceptance criteria
```

### Note Shorthand (v1.0.0+)

```bash
# Add a note to an issue (replaces bd update --notes)
bd note <id> "This is a progress note"
bd note <id> -f notes.txt                      # From file
bd note <id> "Multi-line
note content" --json
```

### Close/Reopen Issues

```bash
# Complete work (supports multiple IDs)
bd close <id> [<id>...] --reason "Done" --json

# Reopen closed issues (supports multiple IDs)
bd reopen <id> [<id>...] --reason "Reopening" --json
```

### View Issues

```bash
# Show dependency tree
bd dep tree <id>

# Get issue details (supports multiple IDs)
bd show <id> [<id>...] --json
```

### Comments

```bash
# List comments on an issue
bd comments bd-123                            # Human-readable
bd comments bd-123 --json                     # JSON format

# Add a comment
bd comments add bd-123 "This is a comment"
bd comments add bd-123 -f notes.txt           # From file
```

## Dependencies & Labels

### Dependencies

```bash
# Link discovered work (old way - two commands)
bd dep add <discovered-id> <parent-id> --type discovered-from

# Create and link in one command (new way - preferred)
bd create "Issue title" -t bug -p 1 --deps discovered-from:<parent-id> --json
```

### Labels

```bash
# Label management (supports multiple IDs)
bd label add <id> [<id>...] <label> --json
bd label remove <id> [<id>...] <label> --json
bd label list <id> --json
bd label list-all --json
```

## Filtering & Search

### Basic Filters

```bash
# Filter by status, priority, type
bd list --status open --priority 1 --json               # Status and priority
bd list --assignee alice --json                         # By assignee
bd list --type bug --json                               # By issue type
bd list --id bd-123,bd-456 --json                       # Specific IDs
```

### Label Filters

```bash
# Labels (AND: must have ALL)
bd list --label bug,critical --json

# Labels (OR: has ANY)
bd list --label-any frontend,backend --json
```

### Search Command

```bash
# Full-text search across title, description, and ID
bd search "authentication bug"                          # Basic search
bd search "login" --status open --json                  # With status filter
bd search "database" --label backend --limit 10         # With label and limit
bd search "bd-5q"                                       # Search by partial ID

# Find beads issue by external reference
bd list --json | jq -r '.[] | select(.external_ref == "gh-123") | .id'

# Filtered search
bd search "security" --priority-min 0 --priority-max 2  # Priority range
bd search "bug" --created-after 2025-01-01              # Date filter
bd search --query "refactor" --assignee alice           # By assignee

# Sorted results
bd search "bug" --sort priority                         # Sort by priority
bd search "task" --sort created --reverse               # Reverse chronological
bd search "feature" --long                              # Detailed multi-line output
```

### Text Search (via list)

```bash
# Title search (substring)
bd list --title "auth" --json

# Pattern matching (case-insensitive substring)
bd list --title-contains "auth" --json                  # Search in title
bd list --desc-contains "implement" --json              # Search in description
bd list --notes-contains "TODO" --json                  # Search in notes
```

### Date Range Filters

```bash
# Date range filters (YYYY-MM-DD or RFC3339)
bd list --created-after 2024-01-01 --json               # Created after date
bd list --created-before 2024-12-31 --json              # Created before date
bd list --updated-after 2024-06-01 --json               # Updated after date
bd list --updated-before 2024-12-31 --json              # Updated before date
bd list --closed-after 2024-01-01 --json                # Closed after date
bd list --closed-before 2024-12-31 --json               # Closed before date
```

### Empty/Null Checks

```bash
# Empty/null checks
bd list --empty-description --json                      # Issues with no description
bd list --no-assignee --json                            # Unassigned issues
bd list --no-labels --json                              # Issues with no labels
```

### Priority Ranges

```bash
# Priority ranges
bd list --priority-min 0 --priority-max 1 --json        # P0 and P1 only
bd list --priority-min 2 --json                         # P2 and below
```

### Combine Filters

```bash
# Combine multiple filters
bd list --status open --priority 1 --label-any urgent,critical --no-assignee --json
```

## Visualization

### Graph (Dependency Visualization)

```bash
# Show dependency graph for an issue
bd graph bd-123                               # ASCII box format (default)
bd graph bd-123 --compact                     # Tree format, one line per issue

# Show graph for epic (includes all children)
bd graph bd-epic

# Show all open issues grouped by component
bd graph --all
```

**Display formats:**
- `--box` (default): ASCII boxes showing layers, more detailed
- `--compact`: Tree format, one line per issue, more scannable

**Graph interpretation:**
- Layer 0 / leftmost = no dependencies (can start immediately)
- Higher layers depend on lower layers
- Nodes in the same layer can run in parallel

**Status icons:** ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

## Global Flags

Global flags work with any bd command and must appear **before** the subcommand.

### Sandbox Mode

**Auto-detection (v1.0.0+):** bd automatically detects sandboxed environments and enables sandbox mode.

When detected, you'll see: `Sandbox detected, using embedded mode`

**Manual override:**

```bash
# Explicitly enable sandbox mode
bd --sandbox <command>
```

**What it does:**
- Uses embedded mode (direct database access)
- Disables auto-sync operations

### Staleness Control

```bash
# Skip staleness check (emergency escape hatch)
bd --allow-stale <command>
```

**⚠️ Caution:** May show stale or incomplete data. Use only when stuck and other options fail.

### Force Import

```bash
# Force metadata update even when DB appears synced
bd import --force -i .beads/issues.jsonl
```

### Other Global Flags

```bash
# JSON output for programmatic use
bd --json <command>

# Force embedded mode
bd --embedded <command>

# Disable auto-sync
bd --no-auto-flush <command>    # Disable auto-flush
bd --no-auto-import <command>   # Disable auto-import

# Custom database path
bd --db /path/to/.beads/beads.db <command>

# Custom actor for audit trail
bd --actor alice <command>
```

## Advanced Operations

### Cleanup

```bash
# Clean up closed issues (bulk deletion)
bd admin cleanup --force --json                                   # Delete ALL closed issues
bd admin cleanup --older-than 30 --force --json                   # Delete closed >30 days ago
bd admin cleanup --dry-run --json                                 # Preview what would be deleted
bd admin cleanup --older-than 90 --cascade --force --json         # Delete old + dependents
```

### Duplicate Detection & Merging

```bash
# Find and merge duplicate issues
bd duplicates                                          # Show all duplicates
bd duplicates --auto-merge                             # Automatically merge all
bd duplicates --dry-run                                # Preview merge operations

# Merge specific duplicate issues
bd merge <source-id...> --into <target-id> --json      # Consolidate duplicates
bd merge bd-42 bd-43 --into bd-41 --dry-run            # Preview merge
```

### Compaction (Memory Decay)

```bash
# Agent-driven compaction
bd admin compact --analyze --json                           # Get candidates for review
bd admin compact --analyze --tier 1 --limit 10 --json       # Limited batch
bd admin compact --apply --id bd-42 --summary summary.txt   # Apply compaction
bd admin compact --apply --id bd-42 --summary - < summary.txt  # From stdin
bd admin compact --stats --json                             # Show statistics

# Rules compaction (v1.0.0+)
bd rules audit                                              # Scan .claude/rules/ for bloat
bd rules compact --auto                                     # Automatically merge rule groups
```

### Rename Prefix

```bash
# Rename issue prefix (e.g., from 'knowledge-work-' to 'kw-')
bd rename-prefix kw- --dry-run  # Preview changes
bd rename-prefix kw- --json     # Apply rename
```

## Database Management

### Import/Export

```bash
# Import issues from JSONL
bd import -i .beads/issues.jsonl --dry-run      # Preview changes
bd import -i .beads/issues.jsonl                # Import and update issues
bd import -i .beads/issues.jsonl --dedupe-after # Import + detect duplicates

# Handle missing parents during import
bd import -i issues.jsonl --orphan-handling allow      # Default: import orphans
bd import -i issues.jsonl --orphan-handling resurrect  # Recreate deleted parents
bd import -i issues.jsonl --orphan-handling skip       # Skip orphans
bd import -i issues.jsonl --orphan-handling strict     # Fail if parent is missing
```

### Migration

```bash
# Migrate databases after version upgrade
bd migrate                                             # Detect and migrate old databases
bd migrate --dry-run                                   # Preview migration
bd migrate --cleanup --yes                             # Migrate and remove old files
```

### Sync Operations

```bash
# Dolt-native sync
bd dolt push                                           # Push to Dolt remote
bd dolt pull                                           # Pull from Dolt remote
bd dolt commit -m "message"                            # Commit pending changes
```

> **v1.0.0:** Legacy `bd sync` is deprecated. Use `bd dolt push/pull`.

## Dolt Server Management

> **v1.0.0:** Native builds use **Embedded Dolt** by default. No external server is required. `bd dolt start` is only needed if you specifically want to expose the DB via SQL port.

```bash
# Optional: Expose via SQL port
bd dolt start                                          # Start Dolt SQL server
bd dolt stop                                           # Stop Dolt SQL server
```

### SQL Access

```bash
# Raw SQL queries against the database
bd sql "SELECT * FROM issues WHERE status = 'open'"    # Direct SQL access
bd sql "SELECT * FROM issues" --format json            # JSON output
```

## Graph Links

```bash
# Relate issues (bidirectional "see also")
bd dep relate <id1> <id2>                              # Link two related issues
bd dep unrelate <id1> <id2>                            # Remove relationship

# Mark duplicates
bd duplicate <dup-id> --of <canonical-id>              # Mark as duplicate
bd duplicates                                          # Show all duplicates
bd duplicates --auto-merge                             # Auto-merge all duplicates

# Supersede (version chains)
bd supersede <old-id> --with <new-id>                  # Old auto-closed
```

## Messaging

```bash
# Send and receive messages
bd mail send <recipient> -s "Subject" -m "Body"        # Send message
bd mail inbox                                          # Check inbox
bd mail read <msg-id>                                  # Read a message
bd mail reply <msg-id> -m "Reply body"                 # Reply to thread
```

## Issue Types

- `bug` - Something broken that needs fixing
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `story` - User story (v1.0.0+)
- `spike` - Exploratory research (v1.0.0+)
- `milestone` - Project phase/milestone (v1.0.0+)
- `epic` - Large feature composed of multiple issues
- `decision` - Architectural or design decision record
- `message` - Inter-agent or human-agent communication

**Hierarchical children:** Epics can have milestones, which can have stories/tasks. Up to 3 levels of nesting supported.

## Priorities

- `0` - Critical
- `1` - High
- `2` - Medium
- `3` - Low
- `4` - Backlog

## Dependency Types

- `blocks` - Hard dependency
- `related` - Soft relationship
- `parent-child` - Hierarchy
- `discovered-from` - Link to discovery context
