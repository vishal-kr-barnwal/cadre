# Conductor Ship

Rebase a reviewed track onto main, push it, and prepare the PR.

Runs **after `/conductor-review` clears the track** and **before `/conductor-archive`**.
It syncs the track branch with `main`, pushes it, and hands off to the team's PR
process. Shipping is the only Conductor step that pushes to a remote — archive stays
local.

## 1. Verify Setup & Select Track

- If `conductor/tracks.md` doesn't exist, tell the user to run `/conductor-setup` first.
- If a `track_id` is provided, use it; otherwise list completed (`[x]`) tracks not yet
  archived and ask the user to choose.
- Read `conductor/tracks/<track_id>/metadata.json` for `git_branch`
  (default `track/<track_id>`).
- **Gate:** confirm the track has been reviewed (a `## Review` entry in `learnings.md`
  with a "Ready to ship" verdict). If not, suggest `/conductor-review <track_id>` first
  and ask whether to proceed anyway.

## 2. Flush Dolt + Rebase + Prepare PR

For the selected track:

1. **Flush pending Dolt state:** `bd dolt push`
   - If a `bd` command fails, offer to continue / retry / stop.

2. **Commit flushed Dolt state** (if `.beads/` has changes):
   ```bash
   git diff --quiet .beads/ || (git add .beads/ && git commit -m "conductor(beads): sync dolt state before ship <track_id>")
   ```

3. **Rebase track branch onto main:**
   ```bash
   git rebase main track/<track_id>
   ```
   - On `.beads/` conflict: `git checkout --ours .beads/ && git add .beads/ && git rebase --continue`

4. **Push rebased branch:**
   ```bash
   git push origin track/<track_id> --force-with-lease
   ```

5. **Announce PR guidance:** branch is rebased + pushed; create the PR via the team's
   process; after merge, delete the branch locally and on the remote.

## 3. Next Step

Once the PR is open (or merged), run `/conductor-archive <track_id>` to extract
learnings, tear down the worktree, and move the track to `conductor/archive/`.
