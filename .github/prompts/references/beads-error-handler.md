# Beads Error Handler Protocol

Shared error handling for all Conductor commands that use `bd` CLI commands.

## Standard Error Response

When any `bd` command fails, present this to the user:

> "⚠️ Beads command failed: `<error message>`"
> A) Continue without Beads — degrade to file-only mode for this session
> B) Retry command once
> C) Stop — I'll fix the issue first

**If A selected:**
- Set `beads_enabled = false` for the remainder of this session
- All task tracking via `plan.md` markers only (`[ ]`, `[~]`, `[x]`, `[!]`)
- Conductor workflows continue normally — no Beads state updates
- Announce: "Continuing in file-only mode. Beads will not be updated this session."

**If B selected:**
- Retry the exact failed command once
- If it succeeds: resume normal flow
- If it fails again: re-present only options A and C (no more retries)

**If C selected:**
- HALT immediately
- Announce the failed command and error so user can fix
- Wait for user instructions before proceeding

## Degraded Mode Behavior

When `beads_enabled = false` (set by option A or initial unavailability):

| Normal Action | Degraded Fallback |
|---------------|-------------------|
| `bd update --status in_progress` | Mark `[~]` in plan.md only |
| `bd close --continue` | Mark `[x]` in plan.md, manually check next task |
| `bd note <id> "..."` | Append to `learnings.md` only |
| `bd ready --parent <id>` | Read plan.md for next `[ ]` task |
| `bd dolt push` | Skip (no remote sync) |
| `bd compact` | Skip (no compaction) |

## Usage in Commands

Every Conductor command that calls `bd` should reference this protocol instead of inlining the A/B/C options. Example:

```markdown
Run: bd update <task_id> --status in_progress --json
→ If this fails: Follow Beads Error Handler Protocol
  (see references/beads-error-handler.md)
```

## Availability Check (Run First)

Before any `bd` command in any Conductor flow:

```bash
BEADS_AVAILABLE=false
if which bd > /dev/null 2>&1; then
  if [ -f conductor/beads.json ]; then
    if grep -q '"enabled"[[:space:]]*:[[:space:]]*true' conductor/beads.json 2>/dev/null; then
      BEADS_AVAILABLE=true
    fi
  fi
fi
```

If `BEADS_AVAILABLE=false`: skip all `bd` commands silently, use file-only mode from the start.
