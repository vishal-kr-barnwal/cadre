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
  volunteers. Bracket this with MCP `cadre_sync_control_plane` (`mode: "pre"`
  before the assignment, `mode: "post"` after committing) so the assignment
  reaches the reviewer's clone in shared mode and no-ops in local mode.
- **No flag** (default) → run the full review (sections 1-8) and record the verdict.

## 1. Verify Setup

Resolve the project root with `cadre_current_root` using the per-call `root`
argument. Use the returned root for all MCP calls in this workflow.

If `cadre/tracks.md` doesn't exist, tell the user to run `cadre-setup` first.

**Sync preamble (shared mode).** Call MCP `cadre_sync_control_plane` with
`mode: "pre"` before reviewing. It no-ops in local mode and pulls the shared
control plane plus Beads graph when `sync_mode == "shared"`, so the verdict lands
on current spec/plan state.

## 2. Select Track

- If a `track_id` is provided, use it.
- Otherwise pick the active (`[~]`) track, or — if none is in progress — list
  completed (`[x]`) tracks not yet archived and ask the user to choose.
- Use `cadre_team_status` with `root` for active/completed track selection. Use
  `tracks.md` markers only as human-readable fallback labels.
- Call `cadre_track_context` for the selected track. Use its `track.git_branch`,
  parsed `plan`, task commit SHAs, `task_counts`, `review`, `last_coverage`, and
  Beads IDs. Read `spec.md` only for acceptance criteria prose.

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

2. **Cross-track regression via code intelligence.** Call MCP
   `cadre_lsp_review` with `root`, `base`, and `head` (`<git_branch>`). It wraps
   the configured LSP helper, includes timeout/availability information, and
   returns structured findings for changed, renamed, and removed symbols where
   possible. If it returns `available: false`, note that code intelligence was
   unavailable and continue. Treat live external callers of removed/renamed
   symbols as blocking findings; other external references are warnings unless the
   semantic change clearly breaks callers.

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

Then **record the structured verdict through MCP** so `cadre-ship` and
`cadre-land` can enforce the review gate. Compute the reviewer identity
`<git-identity>` = `git config user.email` (fallback `git config user.name`,
else null). Count `blocking_count` = the number of blocking-severity findings.
Call `cadre_record_review` with `root`, `trackId`, `verdict`, `blockingCount`,
`reviewer`, and `coverage` (from `cadre_track_context.track.last_coverage` or
the latest measured value). The tool writes `metadata.review`, increments
`review_seq`, detects self-review, refuses to silently override another
reviewer's open `changes_requested`, captures `reviewed_sha`, and immediately
returns the `cadre_review_gate` result.

If `cadre_record_review` returns `requires_override`, ask the user to confirm the
override. On confirmation, append the superseded verdict to `learnings.md` and
retry with `allowOverride: true`; otherwise halt without writing a new verdict.
If the returned gate is not `ok` for an intended approval, fix the review data or
route changes before publishing.
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

**PROTOCOL: Record the review against the track epic.**

1. **Availability Check:** run the standard Beads availability check
   (see `references/beads-error-handler.md`); if `BEADS_AVAILABLE=false`, HALT.
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
reach the shipper's clone. Commit the `cadre/` changes, then call MCP
`cadre_sync_control_plane` with `mode: "post"`. The tool no-ops in local mode and
publishes the shared control plane when configured; use `references/cadre-sync.md`
only for bounded manual repair if the structured sync reports a failure.

This is the same orchestration-state publish every mutating workflow performs; it
pushes **only the control plane** — product code is never auto-pushed (it goes up at
`cadre-ship` / `cadre-land`). In `local` mode (or when `config.json` is absent),
skip this section — the verdict stays local, matching today's behavior.
