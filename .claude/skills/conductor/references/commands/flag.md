# Conductor Flag

Flag a task's status as **blocked** or **skipped**.

Marks the current (or specified) task as **blocked** (waiting on something external)
or **skipped** (intentionally not done now). Both modes share the same flow — only
the resulting status marker and Beads sync differ.

## 1. Determine Mode

Parse the argument for the mode:
- `blocked` → the task cannot proceed until an external condition is met.
- `skipped` → the task is intentionally set aside (later, no longer needed, or blocked-by-external).
- If the mode is missing or unrecognized:
  > "Usage: `/conductor-flag <blocked|skipped> [reason]`
  >  - `blocked` — task is stuck waiting on something; stays in the plan as `[!]`.
  >  - `skipped` — task set aside; reset to `[ ]` or closed as `[x] (SKIPPED)`."
  - HALT.

Any remaining text after the mode is the reason.

## 2. Identify Task
- If a task is named in the arguments, find that task in the active track's `plan.md`.
- Otherwise find the in-progress track in `tracks.md`, then the in-progress (`[~]`) task in its `plan.md`.

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

1. **Check for Beads CLI:**
   - Run `which bd`
   - **If NOT found:**
     > "⚠️ Beads CLI (`bd`) is not installed. Beads provides persistent task memory across sessions."
     > "A) Continue without Beads sync"
     > "B) Stop - I'll install Beads first"
     - If A: Skip to step 6
     - If B: HALT and wait for user

2. **Sync (if task has `beads_task_id` in track metadata):**

   **If `blocked`:**
   ```bash
   bd update <task_id> --status blocked
   bd update <task_id> --notes "BLOCKED: <reason>
   CATEGORY: <External/Technical/Resource>
   WAITING FOR: <what needs to happen to unblock>
   DISCOVERED: <if blocking issue is new, create with discovered-from>"
   ```
   - If the blocker is another task, create a dependency: `bd dep add <blocked_task> <blocker_task>`

   **If `skipped`:**
   - "No longer needed": `bd close <task_id> --reason "Skipped: <reason>"`
   - "Will complete later":
     ```bash
     bd update <task_id> --status open
     bd update <task_id> --notes "SKIPPED: <reason>. Will complete later."
     ```
   - "Blocked": `bd update <task_id> --status blocked --notes "SKIPPED: <reason>"`
   - Then advance: `bd update <next_task_id> --status in_progress --assignee conductor`

   - **If any `bd` command fails:**
     > "⚠️ Beads command failed: <error message>"
     > "A) Continue without Beads sync"
     > "B) Retry the failed command"
     > "C) Stop - I'll fix the issue first"
     - If A: Skip remaining Beads steps
     - If B: Retry the command
     - If C: HALT and wait for user

## 6. Confirm
- `blocked`: announce the task is blocked and on what.
- `skipped`: confirm the skip and show the next task.
