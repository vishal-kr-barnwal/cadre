---
description: Flag the current task as blocked or skipped with a reason
argument-hint: <blocked|skipped> [reason]
---

# Cadre Flag

Flag a task's status: $ARGUMENTS

Marks the current (or specified) task as **blocked** (waiting on something external)
or **skipped** (intentionally not done now). Both modes share the same flow — only
the resulting status marker and Beads sync differ.

## 1. Determine Mode

Parse `$ARGUMENTS` for the mode:
- `blocked` → the task cannot proceed until an external condition is met.
- `skipped` → the task is intentionally set aside (later, no longer needed, or blocked-by-external).
- If the mode is missing or unrecognized:
  > "Usage: `/cadre-flag <blocked|skipped> [reason]`
  >  - `blocked` — task is stuck waiting on something; stays in the plan as `[!]`.
  >  - `skipped` — task set aside; reset to `[ ]` or closed as `[x] (SKIPPED)`."
  - HALT.

Any remaining text after the mode is the reason.

## 2. Identify Task
- If a task is named in the arguments, find that task in the active track's `plan.md`.
- Otherwise resolve the active track via its `metadata.json` — the track whose
  `metadata.json.status == "in_progress"` (the source of truth; fall back to the
  `[~]` track in `tracks.md` only if no metadata says so). Then find the in-progress
  (`[~]`) task in that track's `plan.md`.

## 3. Get Reason
If no reason was supplied in the arguments, ask for it.

For `skipped`, also ask the disposition:
- Will complete later
- No longer needed
- Blocked by external factor
- Other

## 4. Update Plan

**If `blocked`:**
- Change `[~]` to `[!]` and append `[BLOCKED: reason]`.

**If `skipped`:**
- "No longer needed": mark as `[x] (SKIPPED: reason)`.
- Otherwise: reset to `[ ]` with a skip comment.
- Mark the next pending task as `[~]`.
- Update `implement_state.json` with the new task index.

## 5. Beads Sync

**PROTOCOL: Sync the flag action with Beads.**

1. **Availability Check:**
   - Run the standard Beads availability check (see `references/beads-error-handler.md`)
   - If `BEADS_AVAILABLE=false`: skip to step 6

2. **Sync (if task has `beads_task_id` in track metadata):**

   **If `blocked`:**
   ```bash
   bd update <task_id> --status blocked
   bd note <task_id> "BLOCKED: <reason>
   CATEGORY: <External/Technical/Resource>
   WAITING FOR: <what needs to happen to unblock>
   DISCOVERED: <if blocking issue is new, create with discovered-from>" --json
   ```
   - If the blocker is another task, create a dependency: `bd dep add <blocked_task> <blocker_task>`

   **If `skipped`:**
   - "No longer needed": `bd close <task_id> --reason "Skipped: <reason>"`
   - "Will complete later":
     ```bash
     bd update <task_id> --status open
     bd note <task_id> "SKIPPED: <reason>. Will complete later." --json
     ```
   - "Blocked": `bd update <task_id> --status blocked --json && bd note <task_id> "SKIPPED: <reason>" --json`
   - Then advance: `bd update <next_task_id> --status in_progress --assignee <git-identity> --json`
     (`<git-identity>` = `git config user.email` → `user.name` → omit `--assignee` if unset; never the literal `cadre`)

   - If any `bd` command fails: Follow Beads Error Handler Protocol (see `references/beads-error-handler.md`)

## 6. Update Track Status

Flagging a task can change the *track's* status. Set the track's
`metadata.json.status` with a key-scoped jq write so the source of truth drives the
`tracks.md` markers (`[!]` / `[-]`) — these were previously unreachable because the
status was only ever set on the task. Use a portable jq update (BSD + GNU):

```bash
META="cadre/tracks/<track_id>/metadata.json"
tmp="$(mktemp)"
jq --arg s "<new_status>" '.status = $s' "$META" > "$tmp" && mv "$tmp" "$META"
```

Choose `<new_status>` (enum: `new`, `in_progress`, `completed`, `blocked`, `skipped`):
- **`blocked`** — the flag leaves the track blocked with no ready task to advance to
  (e.g. `blocked` mode and no other pending task is workable).
- **`skipped`** — the user is abandoning the remaining track (no intent to finish it).
- Otherwise leave **`in_progress`** — the track advanced to a next task (the common
  `skipped` "will complete later" / "no longer needed" path that moved `[~]` forward).

Then regenerate the index per `/cadre-status --regen-index` so `tracks.md`
reflects the new track marker.

## 7. Confirm
- `blocked`: announce the task is blocked and on what.
- `skipped`: confirm the skip and show the next task.
