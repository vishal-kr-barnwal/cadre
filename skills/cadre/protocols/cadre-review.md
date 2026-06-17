---
description: Review a track's diff before shipping (quality gate)
---

# Cadre Review

Review the work on the track named in the workflow arguments before it ships.

This is the **quality gate** between `cadre-implement` and `cadre-ship`.
It reviews the track's full diff against `main`, records findings, and either clears
the track to ship or routes issues back into the plan.

## 0. Mode

- **`--request [@reviewer]`** → **assign a reviewer; do not review.** Record who
  should review this track and surface it in the team's review queue, then stop (no
  diff, no verdict). Set `metadata.json.reviewer` to the requested person
  (key-scoped jq), and if Beads is available add the label `review:requested` to the
  epic, **adding it BEFORE clearing any stale verdict labels** so a crash never
  strips the track to no review label:
  ```bash
  bd label add <epic_id> review:requested --json
  bd label remove <epic_id> review:ready --json
  bd label remove <epic_id> review:changes --json
  ```
  `cadre-status --team` lists tracks `awaiting review` with their assigned reviewer,
  so review load can be distributed deliberately instead of landing on whoever
  volunteers. In shared mode (`sync_mode == "shared"`), bracket this with the sync
  preamble/postamble from `references/cadre-sync.md` (pull first; then commit
  `cadre/`, **mandatory** `bd dolt push`, push the control branch) so the assignment
  reaches the reviewer's clone.
- **No flag** (default) → run the full review (sections 1-8) and record the verdict.

## 1. Verify Setup

Resolve the project root with `cadre_current_root` using the per-call `root`
argument. Use the returned root for all MCP calls in this workflow.

If `cadre/tracks.md` doesn't exist, tell the user to run `cadre-setup` first.

**Sync preamble (shared mode).** If `cadre/config.json` has `sync_mode == "shared"`
(in **both** monorepo and polyrepo), run the **sync preamble** from
`references/cadre-sync.md` now — `git pull --rebase` the control plane + `bd dolt
pull` — so you review against the latest spec/plan and so the verdict and label you
write below land on top of teammates' state. In `local` mode (or when `config.json`
is absent) skip the preamble. This makes the recorded verdict reach the shipper's
clone (the postamble in §8 publishes it).

## 2. Select Track

- If a `track_id` is provided, use it.
- Otherwise pick the active (`[~]`) track, or — if none is in progress — list
  completed (`[x]`) tracks not yet archived and ask the user to choose.
- Use `cadre_team_status` with `root` for active/completed track selection. Use
  `tracks.md` markers only as human-readable fallback labels.
- Read `cadre/tracks/<track_id>/metadata.json` for `git_branch`
  (default `track/<track_id>`) and `spec.md` for acceptance criteria.
- Call `cadre_parse_plan` with `root` and the selected track's relative `planPath`;
  use the parsed structure when checking task completion and when falling back to
  task SHAs.

## 3. Compute the Diff

Determine the review surface:
```bash
git diff main...<git_branch>          # changes the track introduces vs main
git diff main...<git_branch> --stat   # summary for the report
```
If the branch is absent (work was done directly on the current branch), fall back to
the track's commit range from the `cadre_parse_plan` task SHA data, or
`git diff main...HEAD`.

**POLYREPO (`metadata.json` has a `repos` map):** the track spans several repos.
Compute the diff **per repo** in submodule context and review them together:
```bash
# for each repo in metadata.json.repos:
git -C <submodule_path> diff <base_branch>...track/<track_id> --stat
git -C <submodule_path> diff <base_branch>...track/<track_id>
```
Plus the control-repo diff for the `cadre/` state changes. Report findings
grouped by repo so the reviewer sees each repo's surface distinctly.

If there are no changes, report that and stop.

## 4. Run the Review

**Delegate the actual review to the `/code-review` skill** so findings match the
project's review conventions. Invoke `/code-review` (default effort) scoped to the
track diff from step 3. Also check the track-specific concerns:
- Does the diff satisfy the acceptance criteria in `spec.md`?
- Are all plan tasks marked `[x]` actually implemented (no stubs/TODOs)?
- Tests present and passing for new behavior (per `workflow.md`'s coverage bar)?

**Machine gate (complements `/code-review`, which by design refuses to compile or
look outside the diff).** Run two automated passes and fold their results into the
verdict — they catch regressions a diff-scoped reviewer cannot:

1. **Typecheck / compile / build.** Run the project's declared typecheck/compile/build
   command from `cadre/tech-stack.md` (or `cadre/workflow.md` if that's where the
   build command lives) — e.g. `tsc --noEmit`, `cargo check`, `go build ./...`,
   `mypy`, `mvn -q compile`. In **polyrepo**, run it per touched repo in its
   submodule context. Each unresolved type/compile error is a **blocking** finding;
   add the count to `blocking_count` (computed in §5) and list the errors in the
   findings. **Degrade gracefully:** if no typecheck/compile/build command is
   declared, skip this pass and note in the report that no machine typecheck was
   available (do not fabricate a green result).

2. **Cross-track regression via code intelligence.** Prefer Cadre's LSP review
   helper when present. Resolve `<TEMPLATES_DIR>` per
   `references/template-locator.md` and use
   `<TEMPLATES_DIR>/scripts/cadre-lsp-review.js`; if absent, fall back to a
   project-local `scripts/cadre-lsp-review.js`. Run:
   ```bash
   node <lsp-review-helper> --base main --head <git_branch> --json
   ```
   It reads optional `cadre/lsp.json`, talks to the configured language server(s),
   and reports references outside the track diff for changed/removed symbols. If it
   returns `available: false` (no config) or a non-blocking skip finding, note that
   code intelligence was unavailable and continue. Where another code-intelligence
   backend is available (LSP `find-references` / `incoming-calls`, or an equivalent),
   use it the same way: for each symbol the diff **changed signature of or removed**,
   look up its callers and surface any that live **outside** the track diff — those
   are call sites this track may have broken in code it didn't touch (a cross-track
   regression). Report them as findings (blocking when a removed/renamed symbol still
   has live callers). **Degrade gracefully:** if no LSP / code-intelligence backend
   is available, skip this pass and note it in the report.

## 5. Record Findings

Append a review entry to `cadre/tracks/<track_id>/learnings.md`:
```markdown
## Review — <YYYY-MM-DD>
- **Scope:** <files / commit range>
- **Verdict:** Ready to ship | Changes requested
- **Findings:**
  - [severity] <finding> (file:line)
- **Follow-ups:** <linked tasks or revisions, if any>
```

Then **record the structured verdict in `metadata.json`** so `cadre-ship`
and `cadre-land` can enforce the review gate. Compute the reviewer identity
`<git-identity>` = `git config user.email` (fallback `git config user.name`,
else null). Count `blocking_count` = the number of blocking-severity findings
(e.g. error/blocker/must-fix; a "Changes requested" verdict with any blocking
finding implies `blocking_count > 0`). Write the `review` object with a
**key-scoped** `jq` update (never a full-file rewrite, so concurrent sibling
writes don't clobber):

```bash
META="cadre/tracks/<track_id>/metadata.json"
# Emit JSON null (not the literal string "null") when git identity is unset.
# REVIEWER holds either a quoted JSON string ("a@b.com") or the bareword null.
REVIEWER="$(git config user.email >/dev/null 2>&1 && printf '"%s"' "$(git config user.email)" \
  || { git config user.name >/dev/null 2>&1 && printf '"%s"' "$(git config user.name)"; } \
  || echo null)"
# Carry the machine-measured coverage recorded by cadre-implement d5 (null if none).
COVERAGE="$(jq -r '.last_coverage // "null"' "$META")"
# self_reviewed: true when the reviewer identity equals the track owner.
ME="$(git config user.email 2>/dev/null || git config user.name 2>/dev/null || echo)"
OWNER="$(jq -r '.owner // ""' "$META")"
SELF=false; [ -n "$ME" ] && [ "$ME" = "$OWNER" ] && SELF=true
# reviewed_sha: the track branch HEAD at the moment of review. cadre-ship and
# cadre-land compare the branch's PRE-REBASE tip against this; if the branch
# advanced past it, they demand a re-review (see those workflows' verdict re-read).
BRANCH="$(jq -r '.git_branch // "track/<track_id>"' "$META")"
REVIEWED_SHA="$(git rev-parse "$BRANCH" 2>/dev/null || git rev-parse HEAD)"

# --- Reviewer-race guard + monotonic sequence (no server CAS) -----------------
# review has no compare-and-set, so two reviewers can race and the second write
# wins last. Re-read the verdict currently on disk: review_seq gives every write a
# monotonic id (for audit + downstream detection), and the anti-downgrade check
# stops an `approved` from SILENTLY burying a DIFFERENT reviewer's still-open
# `changes_requested`. (In shared mode the §8 postamble pull-rebase also surfaces a
# truly concurrent cross-clone `.review` write as a normal-merge conflict on
# metadata.json — this guard covers the same-clone / already-pulled case.)
CUR_VERDICT="$(jq -r '.review.verdict // "absent"' "$META")"
CUR_BLOCKING="$(jq -r '.review.blocking_count // 0' "$META")"
CUR_REVIEWER="$(jq -r '.review.reviewer // ""' "$META")"
REVIEW_SEQ="$(( $(jq -r '.review.review_seq // 0' "$META") + 1 ))"
NEW_VERDICT="<approved|changes_requested>"
if [ "$NEW_VERDICT" = "approved" ] \
   && { [ "$CUR_VERDICT" = "changes_requested" ] || [ "$CUR_BLOCKING" -gt 0 ]; } \
   && [ -n "$CUR_REVIEWER" ] && [ "$CUR_REVIEWER" != "$ME" ]; then
  echo "⚠️ $CUR_REVIEWER already requested changes ($CUR_BLOCKING blocking). Approving overrides their verdict."
  # Ask the user to confirm the override. On NO → HALT without writing. On YES →
  # append the superseded verdict to learnings.md (OVERRIDE: approved over
  # $CUR_REVIEWER's changes_requested — <git-identity>, <date>) before writing below.
fi

tmp="$(mktemp)"
jq --arg verdict "$NEW_VERDICT" \
   --argjson blocking <blocking_count> \
   --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   --argjson reviewer "$REVIEWER" \
   --argjson coverage "$COVERAGE" \
   --argjson self "$SELF" \
   --arg reviewed_sha "$REVIEWED_SHA" \
   --argjson seq "$REVIEW_SEQ" \
   '.review = {verdict: $verdict, blocking_count: $blocking, date: $date, reviewer: $reviewer, coverage: $coverage, self_reviewed: $self, reviewed_sha: $reviewed_sha, review_seq: $seq}' \
   "$META" > "$tmp" && mv "$tmp" "$META"
```

After writing the review object, call `cadre_review_gate` with `root` and
`trackId`. Use the returned `ok`, `reasons`, and `warnings` to verify that
`cadre-ship` / `cadre-land` will interpret the verdict as intended. If the MCP
gate result contradicts the just-written verdict, halt and fix `metadata.review`
before publishing.
- `verdict` is `"approved"` for **Ready to ship** (which requires `blocking_count` = 0),
  or `"changes_requested"` for **Changes requested**.
- `reviewed_sha` is the track branch's HEAD commit SHA captured here, at review time.
  It pins the verdict to a specific commit: in `cadre-ship` / `cadre-land` the
  pre-push re-read compares the branch's **pre-rebase** tip against it, and if the
  branch advanced past `reviewed_sha` the gate demands a re-review (the approval no
  longer describes the code being shipped). In **polyrepo** the control-repo branch
  HEAD is captured; per-repo advancement is observed by the merge train.
- `coverage` carries the measured number from `cadre-implement`'s coverage gate so
  the recorded verdict reflects a real measurement, not a self-asserted "tests pass".
  If a track was reviewed with `coverage: null`, note that coverage was never
  measured.
- `review_seq` is a monotonic counter (previous `review_seq` + 1, starting at 1). It
  is **not** a lock — review intentionally runs **no owner ownership-guard** (a
  reviewer is deliberately not the track owner). The sequence plus the anti-downgrade
  guard above are what make concurrent reviews safe: every verdict gets a distinct,
  increasing id for audit, and an `approved` cannot silently erase another reviewer's
  open `changes_requested` without an explicit, logged override.
- **Self-review (warn, or hard-block when configured):** if `metadata.json.owner`
  equals the reviewer `<git-identity>`, the operator is reviewing their own track.
  Read `cadre/config.json` `require_second_reviewer` (default **false**):
  - **false** (default) → warn only ("⚠️ You are the track owner — consider a second
    reviewer"), record the verdict, and proceed (unchanged behavior).
  - **true** → an `approved` self-review is **not** sufficient: record the verdict but
    set `review.self_reviewed: true`; `cadre-ship` and `cadre-land` will refuse to
    ship until a different reviewer approves. Tell the user a second reviewer is
    required.

## 6. Route the Outcome

- **Ready to ship:** announce the track is cleared and suggest `cadre-ship`.
- **Changes requested:**
  - If the issue is a spec/plan gap → suggest `cadre-revise`.
  - If the issue is an unfinished/blocked task → suggest `cadre-flag` or reopen the task.
  - Do **not** advance to ship until findings are resolved (re-run `cadre-review`).

## 7. Beads Sync

**PROTOCOL: Record the review against the track epic (optional).**

1. **Availability Check:** run the standard Beads availability check
   (see `references/beads-error-handler.md`); if `BEADS_AVAILABLE=false`, skip.
2. If the track has `beads_epic` in metadata:
   ```bash
   bd note <epic_id> "REVIEW <date>: <verdict>. <n> findings (<n> blocking)." --json
   ```
   - If a `bd` command fails: follow the Beads Error Handler Protocol.
3. **Set the review label on the epic** so downstream tooling (and other agents)
   can see the gate state. The two states are mutually exclusive, but **add the
   winning label BEFORE removing the losing one(s)** — that ordering means a crash
   between the two `bd` calls leaves the track with the correct label set rather
   than with *neither* (which would read as "review never happened"). Worst case is
   a transient overlap of both labels, which the next flip cleans up.
   - **Approved / clean** (`verdict == "approved"`, `blocking_count == 0`):
     ```bash
     bd label add <epic_id> review:ready --json
     bd label remove <epic_id> review:changes --json
     bd label remove <epic_id> review:requested --json
     ```
   - **Changes requested** (`verdict == "changes_requested"` or `blocking_count > 0`):
     ```bash
     bd label add <epic_id> review:changes --json
     bd label remove <epic_id> review:ready --json
     bd label remove <epic_id> review:requested --json
     ```
   - If a `bd` command fails: follow the Beads Error Handler Protocol.

## 8. Publish the Verdict (shared mode)

The verdict in `metadata.json` and the Beads label only help the shipper if they
reach the shipper's clone. If `cadre/config.json` has `sync_mode == "shared"` (in
**both** monorepo and polyrepo — never gate this on topology), run the **sync
postamble** from `references/cadre-sync.md`:

1. Commit the `cadre/` changes (the `metadata.json` `.review` write from §5, plus the
   `learnings.md` review entry from §5). The `metadata.json` write is already
   key-scoped jq (`.review = {…}`), so it won't clobber a sibling's concurrent write.
2. **`bd dolt push` is MANDATORY** here — it publishes the review label flip from §7
   to the shared task graph.
3. `git push <control_remote> <control_branch>` to publish the control plane.
4. On push rejection, re-run the sync preamble (pull --rebase + `bd dolt pull`),
   re-apply per the postamble's conflict rules, then push again.

This is the same orchestration-state publish every mutating workflow performs; it
pushes **only the control plane** — product code is never auto-pushed (it goes up at
`cadre-ship` / `cadre-land`). In `local` mode (or when `config.json` is absent),
skip this section — the verdict stays local, matching today's behavior.
