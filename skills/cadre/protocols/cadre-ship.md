---
description: Rebase a reviewed track onto main, push it, and prepare the PR
---

# Cadre Ship

Ship the reviewed track named in the workflow arguments.

Runs **after `cadre-review` clears the track** and **before `cadre-archive`**.
It syncs the track branch with `main`, pushes it, and hands off to the team's PR
process. Shipping is the only Cadre step that pushes to a remote — archive stays
local.

> **Polyrepo:** this workflow handles the **single-repo (monorepo)** case only. If
> `cadre/repos.json` exists with `mode: "polyrepo"`, stop and use
> `cadre-land <track_id>` instead — it pushes each repo's branch, opens one
> PR per touched repo plus the control-repo PR, links them as a group, and lets
> the merge train land them (product repos first, control repo last).

## 1. Verify Setup & Select Track

- If `cadre/tracks.md` doesn't exist, tell the user to run `cadre-setup` first.
- **Sync preamble (shared mode).** If `cadre/config.json` has `sync_mode == "shared"`
  (in **both** monorepo and polyrepo — never gate on topology), run the **sync
  preamble** from `references/cadre-sync.md` now — `git pull --rebase` the control
  plane + `bd dolt pull` — **before** the ownership guard and review gate below. Ship
  otherwise reads `metadata.review` from local disk only, so without this a teammate's
  cross-machine `changes_requested` (or an advanced `reviewed_sha`) is invisible and
  the gate clears on a stale local approval. In `local` mode (or when `config.json` is
  absent) skip the preamble — today's single-machine behavior is unchanged.
- If a `track_id` is provided, use it; otherwise list completed (`[x]`) tracks not yet
  archived and ask the user to choose.
- Read `cadre/tracks/<track_id>/metadata.json` for `git_branch`
  (default `track/<track_id>`).
- **Ownership guard.** Before touching the track, run the Ownership Guard
  (`references/ownership-guard.md`) for the resolved track — it stops two operators
  from concurrently shipping the same track in **any** topology (in default monorepo
  mode the advisory `lease` is a no-op, so this guard is the only serialization).
  If it halts, stop.
- **Review gate.** Read the `review` object from
  `cadre/tracks/<track_id>/metadata.json` (written by `cadre-review`).
  Extract two fields:
  ```bash
  META="cadre/tracks/<track_id>/metadata.json"
  verdict=$(jq -r '.review.verdict // "absent"' "$META")
  blocking=$(jq -r '.review.blocking_count // 0' "$META")
  self_reviewed=$(jq -r '.review.self_reviewed // false' "$META")
  require_second=$(jq -r '.require_second_reviewer // false' cadre/config.json 2>/dev/null)
  ```
  - **Absent** (`$verdict == "absent"` — no `review` key, or `null`) → no structured
    gate recorded. Keep the existing soft behavior: confirm the track has been
    reviewed (a `## Review` entry in `learnings.md` with a "Ready to ship" verdict).
    If not, suggest `cadre-review <track_id>` first and ask whether to proceed
    anyway. **If the user proceeds without a recorded review, log the override** so a
    deliberate bypass is distinguishable from drift: append an audit line to
    `learnings.md` (`OVERRIDE: shipped without a recorded review — operator
    <git-identity>, <YYYY-MM-DDThh:mm:ssZ>`) and, if Beads is available, mirror it to
    the epic (`bd note <epic_id> "OVERRIDE: shipped without recorded review (<git-identity>)" --json`).
  - **`$verdict == "changes_requested"` OR `$blocking > 0`** → **REFUSE**:
    > "🚫 Track `<track_id>` has not cleared review (verdict:
    > `$verdict`, blocking findings: `$blocking`). Resolve the findings
    > and re-run `cadre-review <track_id>` before shipping."
    Then halt — do **not** rebase or push.
  - **Self-approved while a second reviewer is required** (`$require_second == true`
    AND `$self_reviewed == true`) → **REFUSE**:
    > "🚫 Track `<track_id>` was approved by its own owner and
    > `require_second_reviewer` is set. Have a different reviewer run
    > `cadre-review <track_id>` before shipping."
    Then halt.
  - **Clean** (otherwise — `$verdict` is approved/non-blocking and `$blocking == 0`)
    → the gate is satisfied; proceed without further confirmation.

## 2. Flush Dolt + Rebase + Prepare PR

For the selected track:

1. **Flush pending Dolt state:**
   ```bash
   bd dolt push
   ```
   - Ensures any uncommitted Dolt working-set changes are persisted before git operations.
   - **If `bd` command fails:** → Follow Beads Error Handler Protocol (references/beads-error-handler.md)

2. **Commit flushed Dolt state** (if `.beads/` has changes):
   ```bash
   git diff --quiet .beads/ || (git add .beads/ && git commit -m "cadre(beads): sync dolt state before ship <track_id>")
   ```

3. **Rebase track branch onto main:**
   ```bash
   # Capture the PRE-REBASE track-branch tip for the reviewed_sha check in step 4.
   # Must be read BEFORE the rebase so rebasing onto main does not false-positive.
   prerebase_head=$(git rev-parse track/<track_id>)
   git rebase main track/<track_id>
   ```
   - If conflict arises in `.beads/` during rebase:
     ```bash
     git checkout --ours .beads/
     git add .beads/
     git rebase --continue
     ```
   - This syncs the track branch with main's latest Beads state before the PR.

4. **Re-read the review gate, then push (TOCTOU close):** the verdict read in
   §1 is a point-in-time snapshot; a reviewer may have flipped it to
   `changes_requested` during the (slow) Dolt-flush + rebase above. **Re-read it
   from disk immediately before pushing** and abort if it now blocks. The same
   re-read also enforces **`reviewed_sha`** — the track-branch HEAD captured at
   review time (`metadata.review.reviewed_sha`, written by `cadre-review`). If the
   branch advanced past the reviewed commit (new work landed after the review), the
   approval no longer covers what you are about to ship, so re-review is needed.
   Compare against the **pre-rebase** tip (`$prerebase_head` from step 3) — the
   rebase-onto-main in step 3 rewrites the tip, so comparing the post-rebase HEAD
   would false-positive on a clean track:
   ```bash
   META="cadre/tracks/<track_id>/metadata.json"
   verdict=$(jq -r '.review.verdict // "absent"' "$META")
   blocking=$(jq -r '.review.blocking_count // 0' "$META")
   if [ "$verdict" = "changes_requested" ] || [ "$blocking" -gt 0 ]; then
     echo "🚫 Review flipped to a blocking state (verdict: $verdict, blocking: $blocking) during ship. Aborting push — re-run cadre-review."
     exit 1
   fi
   # reviewed_sha guard: did the branch advance past the reviewed commit?
   reviewed_sha=$(jq -r '.review.reviewed_sha // ""' "$META")
   if [ -n "$reviewed_sha" ] && [ "$reviewed_sha" != "$prerebase_head" ]; then
     echo "🚫 Branch advanced past reviewed commit $reviewed_sha (pre-rebase tip $prerebase_head). Re-review needed — re-run cadre-review <track_id> before shipping."
     exit 1
   fi
   git push origin track/<track_id> --force-with-lease
   ```
   When `reviewed_sha` is absent (older tracks reviewed before the field existed),
   skip the guard — only the verdict/blocking check applies.

5. **Announce / open the PR:**

   Read `cadre/config.json` (if present) for `pr_provider`
   (`github`|`gitlab`, default `github`) and the opt-in flag `auto_open`
   (default **false**). The flag is **off by default** so the default behavior is
   unchanged.

   - **`auto_open` is false or `config.json` is absent (default):** print PR
     guidance only — do not create the PR:
     > "Branch `track/<track_id>` is rebased on main and pushed.
     > Create a PR from `track/<track_id>` into main via your team's PR process.
     > After the PR is merged, delete the branch:
     >   `git branch -d track/<track_id>`
     >   `git push origin --delete track/<track_id>`"

   - **`auto_open` is true:** attempt to open the PR with the host CLI (same
     pattern as `cadre-land`). First verify the CLI is authenticated
     (GitHub: `gh auth status`; GitLab: `glab auth status`). If it is missing or
     unauthenticated, fall back to printing the exact create command for the user
     to run (the manual-fallback message), then continue.

     **Idempotent creation (avoid duplicate PRs).** Before creating, check whether
     an open PR/MR already exists for this branch; if so, reuse its URL and treat
     this as success (a re-run after a partial ship must not open a second PR):

     **GitHub:**
     ```bash
     existing=$(gh pr list --head track/<track_id> --base main --state open \
       --json url --jq '.[0].url // ""')
     if [ -n "$existing" ]; then
       echo "PR already open for track/<track_id>: $existing"
     else
       gh pr create \
         --head track/<track_id> --base main \
         --title "<track_id>: <description>" \
         --body "Cadre track <track_id>. See cadre/tracks/<track_id>/spec.md."
     fi
     ```
     **GitLab:**
     ```bash
     existing=$(glab mr list --source-branch track/<track_id> \
       --output json --jq '.[0].web_url // ""' 2>/dev/null)
     if [ -n "$existing" ]; then
       echo "MR already open for track/<track_id>: $existing"
     else
       glab mr create \
         --source-branch track/<track_id> --target-branch main \
         --title "<track_id>: <description>" \
         --description "Cadre track <track_id>. See cadre/tracks/<track_id>/spec.md."
     fi
     ```
     On success (whether reused or newly created), report the PR/MR URL and the
     branch-cleanup commands above. On any CLI failure, do **not** error out — print
     the create command as a manual fallback and tell the user to open the PR
     themselves.

## 3. Publish the Control Plane (shared mode)

The §1 ownership guard mirrored `owner` into `metadata.json` and §2 committed the
flushed Dolt state, but `cadre-ship` otherwise pushes **product code only**
(`git push origin track/<id>`). In shared mode that owner-claim and any control-plane
state must also reach teammates, or the team never learns the track shipped. If
`cadre/config.json` has `sync_mode == "shared"` (in **both** monorepo and polyrepo —
never gate on topology), run the **sync postamble** from `references/cadre-sync.md`:

1. Commit the `cadre/` changes (the owner mirror from the §1 guard, plus any
   key-scoped `metadata.json` writes). Key-scoped jq only, never a full-file rewrite.
2. **`bd dolt push` is MANDATORY** here to publish the claim to the shared task graph.
3. `git push <control_remote> <control_branch>` to publish the control plane.
4. On push rejection, re-run the preamble then push again — **bounded** per
   `references/cadre-sync.md` (do not loop unbounded).

This publishes **only the control plane**; the product-code push stays in §2. In
`local` mode (or when `config.json` is absent), skip this section — today's
single-machine behavior is unchanged.

## 4. Next Step

Once the PR is open (or merged), run `cadre-archive <track_id>` to extract
learnings, tear down the worktree, and move the track to `cadre/archive/`.
