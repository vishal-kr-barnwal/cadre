---
description: Display current Cadre project progress (add --export to write a summary)
---

# Cadre Status

Show the current status of this Cadre project using the workflow arguments.

## 0. Mode

Pick the flow based on workflow arguments (modes are additive; bare `cadre-status`
behavior is unchanged):

- `--regen-index` → run the **Regenerate Index** flow in section 12 only (rebuild
  `cadre/tracks.md` from per-track `metadata.json`). This is the canonical
  regeneration entrypoint that every other workflow references after it mutates a
  track's status; it does not print the live status.
- `--export` → run the **Export** flow in section 9 only.
- `--team` → run the **Team View** in section 10 (in addition to the live status).
- `--mine` → run the live status (sections 1-8) but filter the multi-track scan to
  tracks whose `metadata.json.owner` equals `<git-identity>` (see Identity below);
  also surface the Team View (section 10) scoped to your own tracks.
- `--repos` → run the **Fleet Board** in section 11 (polyrepo only).
- `--available` (alias `--unowned`) → run the **Available Work** board in section 13:
  the unblocked, unowned work a teammate can pick up. Like `--team`, it performs the
  full multi-track scan.
- `--collisions` → run the **File Collisions** board in section 14: cross-track
  `(repo, file)` overlaps mined from every active track's plan `<!-- files: -->`
  annotations. Like `--team`, it performs the full multi-track scan.
- otherwise → show the live status (sections 1-8) and, in polyrepo mode, the PR
  group / merge-train surface in section 5c.

**Identity:** compute `<git-identity>` once at runtime as
`git config user.email` (fallback `git config user.name`, else null). Used to label
the active owner, resolve `--mine`, and group team WIP.

**Cheap by default:** the full multi-track filesystem scan of every
`cadre/tracks/<id>/metadata.json` (for ownership, leases, review state, and plan
`<!-- files: -->` claims) runs **only** under the multi-track modes — `--team`,
`--mine`, `--repos`, `--available`/`--unowned`, or `--collisions`. Bare
`cadre-status` reads only `tracks.md` + the active track, exactly as before.

**Status source of truth:** each track's `metadata.json.status`
(`new`|`in_progress`|`completed`|`blocked`|`skipped`) is authoritative. `tracks.md`
is a **derived index** (a human-readable mirror) regenerated from metadata — see
section 12. Never hand-flip a marker in `tracks.md`; update the track's
`metadata.json.status` and regenerate the index instead.

## 1. Check Setup

If `cadre/tracks.md` doesn't exist, tell user to run `cadre-setup` first.

## 2. Read State

- Read `cadre/tracks.md` (the human-readable derived index/mirror).
- List all track directories: `cadre/tracks/*/`
- Read each `cadre/tracks/<track_id>/plan.md`

**Resolve the active track from metadata (source of truth), not the index.** Scan
each `cadre/tracks/<id>/metadata.json` for `status == "in_progress"`:
- In **shared mode** (`cadre/config.json` sync is `shared`), filter to the
  track whose `owner` (fallback `assignee`) equals `<git-identity>` — that is *your*
  active track; other in-progress tracks belong to teammates and surface in the Team
  View (section 10).
- In **monorepo/local mode** there is normally a single `in_progress` track; pick it.
- `tracks.md` remains a correct mirror, so the legacy read of its `## [~] Track:`
  marker still works as a fallback if no metadata reports `in_progress` (e.g.
  pre-status tracks). If the metadata-derived active track and the `tracks.md` marker
  disagree, prefer metadata and note that the index is stale — run
  `cadre-status --regen-index` to refresh it.

## 3. Calculate Progress

For each track:
- Read `metadata.json` to get priority and depends_on
- Count total tasks (lines with `- [ ]`, `- [~]`, `- [x]`)
- Count completed `[x]`
- Count in-progress `[~]`
- Count pending `[ ]`
- Calculate percentage: (completed / total) * 100
- Check if blocked (has incomplete dependencies)

## 4. Present Summary

Format the output like this:

```
## Cadre Status

**Active Track:** [track name] ([completed]/[total] tasks - [percent]%)
**Overall Status:** In Progress | Complete | No Active Tracks

### Priority Grouping

Group tracks by priority (read from metadata.json):
- 🔴 Critical
- 🟠 High  
- 🟡 Medium
- 🟢 Low

### Tracks by Priority

**🔴 Critical**
- [~] auth_20241215 - User Authentication (30%)

**🟠 High**
- [ ] payments_20241216 - Payment Integration 🔒
  ⤷ Depends on: auth_20241215

**🟡 Medium**
- [x] setup_20241214 - Project Setup (100%)

**🟢 Low**
- [ ] docs_20241217 - Documentation

### Blocked Tracks

Show 🔒 for tracks with incomplete dependencies.
Show dependency chain: "Depends on: [track_ids]"

### Blockers
List all tasks marked with `[!]`:
- Task name (track_id): Reason

### Current Task
[The task marked with [~] in the active track's plan.md]

### Next Action
[The next task marked with [ ] in the active track's plan.md]

### Recent Completions
[Last 3 tasks marked [x] with their commit SHAs]
```

**Ownership annotation (Active Track line):** read the active track's
`metadata.json`. If `owner` is set, append it to the Active Track line as
`— @<owner>`. If `reviewer` is also set, render the pair as
`@<owner> → rev:@<reviewer>` (e.g.
`**Active Track:** auth (3/10 tasks - 30%) — @alice → rev:@bob`). If `owner` is
absent, omit the annotation entirely (back-compat for tracks created before the
field existed).

## 5a. Parallel Execution Status

If any track's `metadata.json` has a `worktree_path` field (indicating parallel execution was started):

```
### Parallel Execution (Phase: [phase_name])

**Status:** Running | Aggregating | Complete

**Active Worktrees** (from `git worktree list`; **polyrepo:** run per submodule
with `git -C <submodule_path> worktree list` — worker worktrees live under
`.worktrees/<track_id>/<repo>_worker_<N>_<name>`):
- 🟢 .worktrees/<track_id>_worker_0_auth: branch track_<id>_worker_0 (commit: abc1234)
- 🔵 .worktrees/<track_id>_worker_1_config: branch track_<id>_worker_1 (in progress)

**Ready Next** (`bd ready --parent <epic_id>`):
- bd-<id>.2.1 "Task 3 — utils" (unblocked after worker_0 closes)

**Session Context** (`bd show <epic_id>` → notes):
- COMPLETED: <from epic notes>
- IN PROGRESS: <from epic notes>
- NEXT: <from epic notes>
```

## 5b. Repos Panel (Polyrepo only)

**Run only when `cadre/repos.json` exists with `mode: "polyrepo"`** (skip in
monorepo mode). Read `repos.json` + `config.json` and, for each enabled repo, use
`git -C <submodule_path>` to report state:

```
### Repos (polyrepo — sync: shared, PRs: github)

| Repo | Enabled | Track branch | Ahead/Behind base | Worktree |
|------|---------|--------------|-------------------|----------|
| api  | ✅      | track/<id>   | +3 / -0           | .worktrees/<id>/api |
| web  | ✅      | track/<id>   | +1 / -0           | .worktrees/<id>/web |

Default repo: api
```

- Ahead/behind from `git -C <submodule_path> rev-list --left-right --count origin/<base>...track/<id>`.
- If a track has open PRs (`metadata.json.repos[*].pr_url` / `control_pr_url`),
  list them and their merge-train status. Plan-derived progress (sections 3-4)
  is unchanged.

## 5c. PR Group & Merge Train (Polyrepo only)

**Run only when `cadre/repos.json` exists with `mode: "polyrepo"`** (skip in
monorepo mode). Surface the cross-repo PR group and the merge-train order for the
**current/active** track.

1. **Resolve the group label.** Read `cadre/config.json` /
   `repos.json.merge_train.group_label_prefix` (default `cadre-track`); the
   label is `<prefix>:<track_id>`.

2. **List the PR group.** Prefer GitHub:
   `gh pr list --label "<prefix>:<track_id>" --state all --json number,title,state,headRepository,reviewDecision,mergeable,url`
   across the relevant repos (each submodule repo + the control repo). If `gh` is
   unavailable, **degrade silently** to the recorded URLs in
   `metadata.json.repos[*].pr_url` and `metadata.json.control_pr_url` (skip the
   live state columns).

3. **Compute the merge-train order.** Read `metadata.json.merge_order` (array of
   repo names, left-to-right). If absent, default to **product repos first** (the
   enabled submodule repos, alphabetical) then the **control repo last**. Number
   the rows in that order.

4. **Present:**

   ```
   ### PR Group & Merge Train — track <track_id>  (label: <prefix>:<track_id>)

   | # | Repo | PR | State | Review | Mergeable |
   |---|------|----|-------|--------|-----------|
   | 1 | api  | #42 | OPEN  | APPROVED        | ✅ |
   | 2 | web  | #17 | OPEN  | REVIEW_REQUIRED | ⏳ |
   | 3 | (control) | #8 | OPEN | —          | blocked-by-group |

   Merge order: api → web → (control)   [source: metadata.merge_order | default product-first/control-last]
   Train: not fired | running | landed | halted (see cadre-land)
   ```

   - If no PRs exist for the label, print `No open PR group for this track yet —
     run cadre-land to open it.` and skip the table.

## 6. Suggestions

Based on status:
- If no tracks: "Run `cadre-newtrack` to create your first track"
- If track in progress: "Run `cadre-implement` to continue"
- If all complete: "All tracks complete! Run `cadre-newtrack` for new work"

---

## 7. BEADS STATUS

**PROTOCOL: Show Beads task status.**

1. **Availability Check:**
   - Run the standard Beads availability check (see `references/beads-error-handler.md`)
   - If `BEADS_AVAILABLE=false`: skip this section silently

2. **Gather Beads Status:**
   - Run `bd ready --json` to get tasks with no blockers
   - If any `bd` command fails: Follow Beads Error Handler Protocol (see `references/beads-error-handler.md`)
   - For active track with `beads_epic` in metadata:
     - Run `bd show <epic_id> --json` to get full context
     - Read epic notes for last session context (COMPLETED, IN PROGRESS, NEXT)
     - Read design field for technical approach
     - Read acceptance field for completion criteria

3. **Present Beads Status:**
   ```
   ### Beads Task Status

   **Last Session Context (from epic notes):**
   - COMPLETED: <from notes>
   - IN PROGRESS: <from notes>
   - NEXT: <from notes>
   - KEY DECISIONS: <from notes>

   **Ready to Work (no blockers):**
   - bd-a3f8.1.2 P1 "Implement auth middleware"
   - bd-a3f8.2.1 P2 "Write API tests"

   **In Progress:**
   - bd-a3f8.1.1 [active] "Setup database schema"

   **Blocked:**
   - bd-a3f8.3.1 ⤷ Waiting on: bd-a3f8.2.1

   **Discovered During Work:**
   - bd-xyz (discovered-from: bd-a3f8.1.1) "Found race condition"
   ```

4. **Dependency Graph (if complex):**
   ```
   ### Dependency Graph
   bd-a3f8 (Epic: auth_20241226)
   ├── bd-a3f8.1 ✓ Phase 1
   │   ├── bd-a3f8.1.1 ✓
   │   └── bd-a3f8.1.2 ~
   └── bd-a3f8.2 ○ Phase 2 (blocked)
   ```

---

## 8. NEXT ACTIONS

**Molecule Status (if using formula):**
   ```bash
   bd mol current  # Molecule step status
   ```

---

## 9. EXPORT (`--export`)

**Run only when workflow arguments contain `--export`.** Generate a comprehensive,
shareable project summary instead of the on-screen status.

1. **Gather Information:** Read all cadre files:
   - `product.md`, `tech-stack.md`, `workflow.md`
   - `tracks.md` and all track specs/plans

2. **Generate Summary** — markdown with:
   - Product overview
   - Tech stack summary
   - All tracks (completed, in-progress, pending)
   - Statistics (from the progress counts in section 3)

3. **Beads Statistics (if available):**
   - Run the standard Beads availability check (see `references/beads-error-handler.md`)
   - If available: run `bd stats` and append total issues, completion rate, and
     distribution by status. If a `bd` command fails: follow the Beads Error Handler Protocol.

4. **Save Options:**
   - `cadre/export_YYYYMMDD.md`
   - Overwrite `README.md`
   - Print only

5. **Output:** Save and confirm.

---

## 10. TEAM VIEW (`--team` / `--mine`)

**Run only when workflow arguments contain `--team` or `--mine`.** This is the only
flow that performs the **full multi-track scan**; it is a no-op for bare
`cadre-status` (keeping the default cheap). Everything here degrades
gracefully — if `bd` is unavailable, fall back to the filesystem scan; if a data
source is missing, omit that sub-section silently.

1. **Gather WIP.**
   - **Preferred (Beads):** run the standard availability check; if available,
     `bd list --status in_progress --json` and group issues by `assignee`.
   - **Fallback (filesystem):** scan every `cadre/tracks/<id>/metadata.json`;
     a track is WIP if its `plan.md` has a `[~]` task or its `metadata.json` has a
     non-null `lease`. Group by `metadata.json.owner` (fallback `assignee`).
   - For `--mine`, filter both sources to `<git-identity>` (owner/assignee match).

1a. **Gather incoming handoffs.** A track that was routed by
   `cadre-handoff --for-teammate` lands in its *recipient's* queue via the epic's
   `assignee` + the Beads label `handoff:pending` (the `owner` is intentionally left
   on the author, so this is invisible to an owner-only scan). Surface it so the
   recipient actually sees the work waiting for them:
   - **Beads (preferred):** when `bd` is available,
     `bd list --label handoff:pending --json`; group entries by `assignee` (the
     recipient). Each entry's epic id maps back to its track (`cadre-<track_id>` /
     the `beads_epic` in `metadata.json`).
   - For `--mine`, filter to epics whose `assignee` equals `<git-identity>` — these
     are handoffs waiting for **you** to pick up.
   - If `bd` is unavailable, omit this sub-section silently (the `handoff:pending`
     routing is Beads-only).

2. **Gather the Review Queue.** A track is in the review queue when **any** of:
   - `metadata.json.review.verdict == "changes_requested"` **or**
     `metadata.json.review.blocking_count > 0`  → **Changes requested**; or
   - it carries the Beads label `review:changes` (changes requested),
     `review:ready` (cleared, awaiting ship), or `review:requested` (a reviewer was
     assigned via `cadre-review --request` but hasn't reviewed yet → **Awaiting
     review**) — query via `bd list --label review:changes --json` /
     `--label review:ready --json` / `--label review:requested --json` when `bd` is
     available.
   - Annotate each entry with its `metadata.json.reviewer` when set (for
     **Awaiting review** this is the *assigned* reviewer, so load is visible).

3. **Gather blocked-on edges.**
   - **Beads:** from each in-progress/ready issue's `depends_on`, list the
     blocking issue(s).
   - **Filesystem:** include any task line marked `[!]` (read its reason from the
     track's `blockers.md` if present), plus tracks blocked by incomplete
     `metadata.json.depends_on`.

4. **Present:**

   ```
   ## Cadre — Team View   (scope: all | mine=@<git-identity>)

   ### Work In Progress (by owner)
   **@alice**
   - [~] auth_20260615 — User Auth (3/10, 30%)  lease: host-7, ⏱ 12m ago
   **@bob**
   - [~] billing_20260616 — Billing (1/8, 12%)

   ### Incoming Handoffs (by recipient)
   **@carol**
   - ⇢ search_20260614 — Search (handoff:pending) — from @alice → cadre-implement search_20260614

   ### Review Queue
   - 🔴 auth_20260615 — changes requested (2 blocking) — rev:@bob
   - 🟢 search_20260614 — ready to ship (review:ready) — rev:@carol

   ### Blocked On
   - billing_20260616 ⤷ waiting on auth_20260615 (depends_on)
   - bd-a3f8.3.1 ⤷ waiting on bd-a3f8.2.1
   - [!] payments_20260612 "rate-limit task" — blocked: upstream API quota
   ```

   - For shared-mode leases, show the `lease.owner` / `lease.host` and a relative
     age from `lease.heartbeat_at`; in monorepo/local mode there are no leases, so
     omit that annotation.
   - Under **Incoming Handoffs**, show the recipient (the epic `assignee`) and the
     handoff author when known (from the epic notes / `bd mail`), plus a ready-to-run
     `cadre-implement <track_id>` to claim it. In `--mine` this section lists the
     handoffs assigned to **you** — so the recipient of a handoff finally sees the
     waiting work without grepping `tracks.md`.
   - If a sub-section has no entries, print `— none —` under its heading.

---

## 11. FLEET BOARD (`--repos`, Polyrepo only)

**Run only when workflow arguments contain `--repos` AND `cadre/repos.json` exists
with `mode: "polyrepo"`.** In monorepo mode, print
`--repos requires a polyrepo control repo (no cadre/repos.json).` and stop.
Everything here degrades silently if a remote/`gh` is unavailable.

1. **Enumerate submodules.** Read `repos.json`; for each enabled repo resolve its
   `<submodule_path>`.

   > **Fan out per repo (parallel).** Steps 2 and 4 below are **read-only and
   > independent per repo** — each only fetches and inspects its own
   > `<submodule_path>` and never mutates shared state — so they SHOULD be fanned
   > out **one worker per repo in parallel** (rather than a serial loop) and the
   > per-repo results joined before presenting. The `git fetch` round-trips dominate
   > the runtime, so parallel fan-out cuts the fleet scan from O(repos) network waits
   > to roughly one. If this environment has no parallel sub-agent primitive, fall
   > back to the serial loop — the per-repo output is identical either way.

2. **List in-flight track branches per repo** (run per repo, in parallel — see the
   fan-out note above).
   - `git -C <submodule_path> fetch --quiet origin` (skip silently on failure).
   - `git -C <submodule_path> for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/remotes/origin/track/*`
     to list every in-flight `track/<id>` branch on that repo's remote.

3. **Flag repo-level overlap.** After the per-repo workers join, build a map of
   `<track_id> → [repos]` from their combined results. If two or
   more **different** track IDs have live `track/*` branches in the **same** repo,
   flag that repo as contended (multiple tracks touching it concurrently).

4. **Optional PR layer (same flag, degrade silently).** If `gh` is available,
   annotate each branch with its open PR (`gh pr list --head track/<id> --json
   number,state,url` per repo). Omit on failure.

5. **Present:**

   ```
   ## Cadre — Fleet Board (polyrepo)

   | Repo | In-flight track branches | PRs | Overlap |
   |------|--------------------------|-----|---------|
   | api  | track/auth_20260615 (2h), track/billing_20260616 (10m) | #42, #51 | ⚠️ 2 tracks |
   | web  | track/auth_20260615 (2h) | #17 | — |
   | infra| — none —                 | —   | — |

   ⚠️ Overlap: api has auth_20260615 + billing_20260616 in flight — coordinate before ship.
   ```

   - If no repo has any `track/*` branch, print `No in-flight track branches across
     the fleet.`

---

## 12. REGENERATE INDEX (`--regen-index`)

**Run only when workflow arguments contain `--regen-index`.** Rebuild
`cadre/tracks.md` as a **derived index** from each track's
`metadata.json.status` (the single source of truth). This is the **canonical
regeneration entrypoint**: every workflow that changes a track's status writes the
new value to that track's `metadata.json` and then runs this procedure (rather than
hand-editing a marker in `tracks.md`). It is **idempotent**, pure bash/jq, and
**bd-independent** — running it twice in a row leaves the file byte-identical.

**Marker map** (status → index marker):

| status        | marker |
|---------------|--------|
| `new`         | `[ ]`  |
| `in_progress` | `[~]`  |
| `completed`   | `[x]`  |
| `blocked`     | `[!]`  |
| `skipped`     | `[-]`  |

A missing/unknown `status` defaults to `new` → `[ ]` (back-compat for tracks created
before the field existed).

**The marked region.** The generated body lives between sentinel comments, and
everything **outside** them (any human-authored header/preamble) is preserved
verbatim:

```
<!-- cadre:index:start -->
## [~] Track: User Authentication
## [ ] Track: Payment Integration
<!-- cadre:index:end -->
```

Each entry keeps the existing heading shape the repo already uses —
`## [<marker>] Track: <name>` (one line per track) — so every existing reader that
greps `## [..] Track:` keeps working unchanged. Use `metadata.json.name` for
`<name>` (fallback to `track_id` if `name` is absent).

**Procedure:** the splice is a deterministic, pure bash/jq program — it carries no
decisions, so it ships as a **bundled helper script** rather than inline shell.

1. **Resolve the bundled script.** Locate `<TEMPLATES_DIR>` per
   `references/template-locator.md`; the helper is at
   `<TEMPLATES_DIR>/scripts/cadre-regen-index.sh`. Run it from the project root:

   ```bash
   bash "<TEMPLATES_DIR>/scripts/cadre-regen-index.sh"
   ```

   It enumerates `cadre/tracks/*/metadata.json` (deterministically sorted),
   emits one `## [<marker>] Track: <name>` line per track (using the marker map
   above; `name` → fallback `track_id`), and **splices** that body between the
   sentinels — preserving any human preamble above `start` and trailer below `end`.
   It is idempotent (re-running yields a byte-identical file), creates the marked
   region on first run (treating any existing content as preamble, never discarding
   legacy `## [..] Track:` lines), and prints a one-line summary. **bd-independent.**

2. **Fallback (only if the bundled script can't be found** — e.g. a partial
   install): regenerate the marked region by hand from the same contract — for each
   `cadre/tracks/*/metadata.json` (sorted by `track_id`) emit
   `## <marker(.status)> Track: <.name // .track_id>` using the marker map above,
   then replace **only** the lines between `<!-- cadre:index:start -->` and
   `<!-- cadre:index:end -->` (appending a fresh marked region after the existing
   file as preamble if the sentinels are absent). Never hand-edit a marker outside
   the marked region, and never discard human content.

**Shared-mode merge conflicts.** Because the index is **derived**, a Git merge
conflict in `cadre/tracks.md` is resolved deterministically by **regenerating
it** rather than hand-merging: take either side (or `git checkout --theirs/--ours
cadre/tracks.md`), then run `cadre-status --regen-index` to rebuild the
marked region from each per-track `metadata.json`. Per-track metadata rarely
collides (each track owns its own file), so the derived index never needs a manual
merge — this is the whole point of the source-of-truth split.

---

## 13. AVAILABLE WORK (`--available` / `--unowned`)

**Run only when workflow arguments contain `--available` or `--unowned`.** The "what
unblocked work can I pick up?" board — a first-class answer for a teammate (or an
idle agent) looking for the next thing to start, instead of eyeballing `tracks.md`.
Like `--team`, this performs the full multi-track scan and degrades gracefully.

1. **Identity:** compute `<git-identity>` (see Identity above).

2. **Select candidates.** A track is **available** when ALL hold:
   - `metadata.json.status` is `new` (marker `[ ]`) — not in progress, completed,
     blocked, or skipped; AND
   - it is **unowned** — `metadata.json.owner` is null/absent (or, shared mode, any
     `lease` is stale, older than the canonical window in
     `references/ownership-guard.md`); AND
   - it has **no incomplete dependencies** — every id in `metadata.json.depends_on`
     resolves to a track whose `metadata.json.status == "completed"`.
   - **Beads (preferred):** `bd ready --json` already returns unblocked, unassigned
     work; intersect it with the new/unowned tracks above when `bd` is available.

3. **Present** (sorted by priority, then `track_id`):

   ```
   ## Cadre — Available Work   (you: @<git-identity>)

   **🔴 Critical**
   - [ ] payments_20260618 — Payment Integration  (no deps)  → cadre-implement payments_20260618
   **🟡 Medium**
   - [ ] search_20260617 — Search  (deps met)  → cadre-implement search_20260617

   Reclaimable (stale lease):
   - [~] auth_20260615 — held by @alice, lease stale 47m → take over: cadre-implement auth_20260615
   ```

   - If nothing is available, print `No unblocked, unowned work right now — every
     incomplete track is owned or dependency-blocked. See cadre-status --team.`

---

## 14. FILE COLLISIONS (`--collisions`)

**Run only when workflow arguments contain `--collisions`.** The "is anyone else about
to touch the same file as me?" board — it mines every **active** track's plan
`<!-- files: ... -->` annotations and reports cross-track `(repo, file)` overlaps
**before** they collide at merge time. The `<!-- files: path1, path2 -->`
annotation is a first-class plan artifact emitted for **every** task in `plan.md`
(not only parallel phases), so this scan sees the whole fleet's file footprint.
Like `--team`, this performs the full multi-track scan and degrades gracefully.

1. **Select active tracks.** A track is **active** when its
   `metadata.json.status` is `in_progress` or `blocked` (markers `[~]` / `[!]`) —
   i.e. someone is mid-flight on it. Skip `new`, `completed`, and `skipped` tracks
   (a `new` track owns no files yet; finished/abandoned ones no longer contend).

2. **Mine the file claims.** For each active track, parse its
   `cadre/tracks/<track_id>/plan.md` and collect every task's
   `<!-- files: ... -->` annotation, splitting on commas and trimming whitespace.
   Build a claim list of `(track_id, repo, file)` tuples:
   - **Resolve the repo per task.** In **polyrepo** mode a task is annotated with
     `<!-- repo: <name> -->` (default repo from `repos.json` when absent); use that
     as `<repo>`. In **monorepo** mode there is one repo — use a constant sentinel
     `<repo> = "."` so the tuple shape is uniform.
   - Compare on the **`(repo, file)` tuple**, never the bare path — the same path in
     two different submodule repos is **not** a collision in polyrepo mode.

3. **Find cross-track overlaps.** Group the claims by `(repo, file)`. A
   **collision** is any `(repo, file)` tuple claimed by tasks in **two or more
   different active tracks** (same file claimed twice *within one track* is normal
   sequencing, not a collision — ignore it). For each colliding tuple, record the
   set of contending track IDs (and, when known, each track's `owner` for a
   "coordinate with @whom" hint).

4. **Present** (one row per colliding `(repo, file)`, sorted by repo then file):

   ```
   ## Cadre — File Collisions (active tracks)

   | Repo | File | Contending tracks |
   |------|------|-------------------|
   | api  | src/auth/session.ts | auth_20260615 (@alice), billing_20260616 (@bob) |
   | .    | README.md           | docs_20260617 (@carol), search_20260614 (@alice) |

   ⚠️ 2 file collisions across 4 active tracks — coordinate before both land.
   ```

   - In monorepo mode the `Repo` column shows the `.` sentinel; you MAY collapse it
     to a single-column `File` table since there is only one repo.
   - If no `(repo, file)` tuple is claimed by more than one active track, print
     `No cross-track file collisions among active tracks.`
   - If active tracks exist but **none** carry `<!-- files: -->` annotations (e.g.
     legacy plans created before the annotation was first-class), print
     `No <!-- files: --> annotations found on active tracks — cannot compute
     collisions.` so the empty result isn't mistaken for "all clear".
