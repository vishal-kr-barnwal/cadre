# Conductor Review

Review the work on a track before it ships.

This is the **quality gate** between `/conductor-implement` and `/conductor-ship`.
It reviews the track's full diff against `main`, records findings, and either clears
the track to ship or routes issues back into the plan.

## 1. Verify Setup

If `conductor/tracks.md` doesn't exist, tell the user to run `/conductor-setup` first.

## 2. Select Track

- If a `track_id` is provided, use it.
- Otherwise pick the active (`[~]`) track, or — if none is in progress — list
  completed (`[x]`) tracks not yet archived and ask the user to choose.
- Read `conductor/tracks/<track_id>/metadata.json` for `git_branch`
  (default `track/<track_id>`) and `spec.md` for acceptance criteria.

## 3. Compute the Diff

```bash
git diff main...<git_branch>          # changes the track introduces vs main
git diff main...<git_branch> --stat   # summary for the report
```
If the branch is absent, fall back to the track's commit range from `plan.md` task
SHAs, or `git diff main...HEAD`. If there are no changes, report that and stop.

## 4. Run the Review

**Delegate the actual review to the `/code-review` skill** so findings match the
project's review conventions. Invoke `/code-review` scoped to the track diff. Also
check track-specific concerns:
- Does the diff satisfy the acceptance criteria in `spec.md`?
- Are all plan tasks marked `[x]` actually implemented (no stubs/TODOs)?
- Tests present and passing for new behavior (per `workflow.md`'s coverage bar)?

## 5. Record Findings

Append a review entry to `conductor/tracks/<track_id>/learnings.md`:
```markdown
## Review — <YYYY-MM-DD>
- **Scope:** <files / commit range>
- **Verdict:** Ready to ship | Changes requested
- **Findings:**
  - [severity] <finding> (file:line)
- **Follow-ups:** <linked tasks or revisions, if any>
```

## 6. Route the Outcome

- **Ready to ship:** announce the track is cleared and suggest `/conductor-ship`.
- **Changes requested:**
  - Spec/plan gap → suggest `/conductor-revise`.
  - Unfinished/blocked task → suggest `/conductor-flag` or reopen the task.
  - Do **not** advance to ship until findings are resolved (re-run `/conductor-review`).

## 7. Beads Sync

**PROTOCOL: Record the review against the track epic (optional).**

1. **Check for Beads CLI:** run `which bd`; if not found, offer to continue without sync.
2. If the track has `beads_epic` in metadata:
   ```bash
   bd note <epic_id> "REVIEW <date>: <verdict>. <n> findings (<n> blocking)."
   ```
   - If a `bd` command fails, offer to continue / retry / stop.
