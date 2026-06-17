---
description: Validate Cadre project integrity
---

# Cadre Validate

Validate the integrity of this Cadre project.

## 0. Sync Preamble (shared mode only)

Validate **mutates shared control-plane state** — it clears stale leases, stamps
owners, registers the merge driver, and regenerates the index. Run against a stale
local snapshot, those fixes both reconcile the wrong picture and stay local, so
read `cadre/config.json` `sync_mode` first.

- `sync_mode == "shared"` → run the **sync preamble** from `references/cadre-sync.md`
  now (pull control plane with `git pull --rebase` + `bd dolt pull`) **before**
  diagnosing anything in the sections below, so the lease sweep, owner checks, and
  index-drift detection reconcile the *current* shared truth — not a stale local
  copy. The matching **sync postamble** runs in step 7 after fixes are applied.
- Absent or `sync_mode == "local"` → skip the preamble/postamble entirely (today's
  behavior; nothing is pulled or pushed).

## 1. Core Files Check

Verify these files exist in `cadre/`:
- `product.md`
- `tech-stack.md`
- `workflow.md`
- `tracks.md`

## 2. Tracks Consistency

Enumerate tracks from the **source of truth** — each `cadre/tracks/*/metadata.json`
— never from the derived `tracks.md` index. For each track directory:
- Verify files: `metadata.json`, `spec.md`, `plan.md`
- Validate metadata.json has: track_id, type, status, created_at

> **Fan out the per-track detection.** Everything in sections 2–5c is **read-only,
> per-track, and independent** (it inspects each track's own files and reports —
> it never mutates state until step 7). With many tracks this loop SHOULD be fanned
> out across tracks in parallel — inspect each track concurrently and collect the
> findings — rather than walked strictly serially. Auto-fixes (step 7) and the sync
> postamble stay sequential and single-writer; only the *detection* is parallel.

## 3. Orphan Detection

- List all directories in `cadre/tracks/`.
- A directory **missing its `metadata.json`** (no valid track manifest) is a true
  ❌ orphan — report it (offer cleanup in step 7).
- A directory **with a valid `metadata.json` but absent from the `tracks.md`
  generated region** is **not** an orphan — it is **index drift** (the derived
  index simply hasn't been regenerated). Report it via the Index Drift check
  (Section 4), fixable by `/cadre-status --regen-index`. Do not flag such a
  track as an orphan.

## 4. Index Drift

`cadre/tracks.md` is a **derived index** (a cache); each track's
`metadata.json` `status` field is the **single source of truth**. This check
detects when the index has fallen out of sync with that truth — it never
hand-flips a marker to "reconcile."

- For each track, map its `metadata.json` `status` to the canonical marker
  (`new`→`[ ]`, `in_progress`→`[~]`, `completed`→`[x]`, `blocked`→`[!]`,
  `skipped`→`[-]`).
- Compare against the `## [<marker>] Track:` line for that track inside
  `tracks.md`'s generated region (between `<!-- cadre:index:start -->` and
  `<!-- cadre:index:end -->`). A missing track entry, an extra/stale entry,
  or a disagreeing marker is **index drift**.
- Report each drift as a ⚠️ Warning naming the track, the metadata status, and
  the (incorrect) marker currently in the index.
- **Do not edit `tracks.md` markers by hand.** Offer in step 7 to fix all drift
  at once by regenerating the index per `/cadre-status --regen-index` (which
  rebuilds the marked region deterministically from per-track metadata,
  preserving the human-authored preamble).

> **Shared mode:** a `tracks.md` **merge conflict** is likewise resolved
> deterministically by running `/cadre-status --regen-index` — per-track
> `metadata.json` files rarely collide, and the derived index never needs a
> manual merge. If you encounter conflict markers in `tracks.md`, regenerate
> rather than hand-resolving.

## 5. Plan Integrity

For each `plan.md`:
- Must have at least one phase and task
- Valid markers only: `[ ]`, `[~]`, `[x]`, `[!]`
- Completed tracks should have all tasks completed
- Validate parallel execution annotations if present

## 5a. Parallel Execution Validation

For tracks with parallel execution annotations:
- Check `<!-- execution: parallel -->` is after valid phase heading
- Verify all tasks in parallel phases have `<!-- files: ... -->` annotation
- Detect file conflicts (same file in multiple tasks)
- Verify `<!-- depends: ... -->` references valid task IDs
- Check `metadata.json` for `worktree_path` — verify the path exists on disk
- Scan `.worktrees/` for directories matching `<track_id>_worker_*` — any not matching a live open Beads task (`bd ready --parent <id>`) = stale orphan
- Check `git branch --list 'track_<track_id>_worker_*'` for orphan branches (branch exists but worktree was removed)
- Report stale worktrees/branches as ❌ Errors (offer auto-cleanup in step 7)

## 5b. Polyrepo Manifest & Submodule Integrity

**Run only when `cadre/repos.json` exists with `mode: "polyrepo"`** (skip
silently in monorepo mode). See `references/polyrepo-git.md`.

- **Preflight asserts:** run the shared **Preflight asserts** snippet in
  `references/polyrepo-git.md` (the same definition `/cadre-land` runs before
  opening PRs) so validate and land agree on what a "land-ready" polyrepo looks
  like. Surface each failed assert as a ❌ Error here rather than halting, so the
  full report still renders. Do not duplicate the assert logic inline — reference
  the one snippet.
- **Manifest ↔ `.gitmodules` parity:** every `repos[].submodule_path` has a
  matching `.gitmodules` entry (and vice-versa). Report drift (added/removed
  submodules not reflected in `repos.json`).
- **Submodules initialized:** `git submodule status` shows each enabled repo
  checked out (no leading `-`). Flag uninitialized submodules.
- **Paths exist:** each `submodule_path` exists on disk.
- **`default_repo` valid:** it names a real entry in `repos`.
- **Annotations valid:** every `<!-- repo: <name> -->` in every `plan.md`
  references a known `repos[].name`. Report unknown repo annotations as ❌ Errors.
- **Per-repo worktrees:** for each `metadata.json.repos[*].worktree_path`, verify
  the path exists and is on branch `git_branch`.
- **Orphan per-repo branches:** in each submodule,
  `git -C <submodule_path> branch --list 'track/*'` / `'track_*_worker_*'` whose
  worktree no longer exists = stale orphan.
- **`config.json` sanity:** `pr_provider` is `github` or `gitlab`;
  `sync_mode` is `shared` or `local`; if `merge_train.enabled`, the matching CI
  file exists in the control repo.

Reuse the existing orphan/auto-fix scaffolding (step 7) for cleanup offers.

## 5c. Team / Shared-Mode Invariants

**Additive, degrade gracefully, and back-compat first.** Resolve sync mode once:
read `cadre/config.json` `sync_mode`. The lease sweep below runs **only when
`sync_mode == "shared"`** (skip silently otherwise). The merge-driver check
(5c.2(c)) runs **whenever `.beads/** merge=ours` is present in `.gitattributes`**
— i.e. for every full-Beads project (monorepo + polyrepo, local + shared), not
only shared mode. The overlapping-`files:` and real-owner checks below also run in
monorepo/local mode but are no-ops there because lease/owner metadata is absent (no
two assignees, no lease objects), so they simply pass.

Compute `<git-identity>` once for this command: value of `git config user.email`
(fallback `git config user.name`, else null). Used only to label "your" tracks in
messages — never to mutate ownership here.

### 5c.1 Stale-lease sweep (shared mode only)

For each track whose `metadata.json` carries a non-null `lease` object
(`{ owner, host, acquired_at, heartbeat_at }`):

- Compute lease age from `lease.heartbeat_at` (fall back to `acquired_at` if
  `heartbeat_at` is absent) against the current UTC time.
- **Stale threshold: heartbeat older than the canonical 30-minute window**
  (see `references/ownership-guard.md`) — the **same** threshold `/cadre-implement`
  uses for its take-over check, so a lease is never "fresh" to one command and
  "stale" to another. Treat an unparseable timestamp as stale.
- Report each stale lease as a ⚠️ Warning naming the track, `lease.owner`,
  `lease.host`, and the heartbeat age, e.g.
  > "Track `<track_id>` holds a stale lease (owner `<owner>` on `<host>`, last
  > heartbeat <N>h ago)."
- Offer in step 7 to **clear** stale leases: set `lease` to `null` with a
  key-scoped write — `jq '.lease = null' metadata.json` to a temp file then move
  into place — so a concurrent sibling write isn't clobbered. Never clear a lease
  whose heartbeat is fresh, and never clear a lease you cannot prove is stale.
- **Re-read immediately before clearing (close the TOCTOU).** Detection above may
  have run against a snapshot that the preamble's `git pull --rebase` (step 0) then
  advanced — or a live owner may have heartbeated since. Just before you write
  `lease = null`, **re-read `lease` from `metadata.json` on disk** and **re-check
  the heartbeat age** against the **canonical 30-minute window** (see
  `references/ownership-guard.md` §5 — the single source for this threshold). If the
  re-read lease is now absent, or its `heartbeat_at` is now within the window (a
  live worker refreshed it), **abort the clear** for that track and leave the lease
  intact — never evict a freshly-heartbeated worker.
- **Beads-CAS-aware clear.** When `BEADS_AVAILABLE` (see step 8 / `references/beads-integration.md`),
  the lease's real serialization point is the shared Dolt DB, not the local file.
  Release ownership atomically with a single conditional update keyed on the lease
  still being stale, then read rows-affected:
  ```bash
  # Clear the epic's assignee/owner only if it is still the stale holder.
  bd sql "UPDATE issues SET assignee = NULL
          WHERE id = '<beads_epic>' AND assignee = '<lease.owner>'"
  # rows-affected: 1 → you won the release; mirror lease=null into metadata.json.
  #                0 → someone re-acquired it (re-assigned / heartbeated) → ABORT
  #                    the clear, leave the lease, report it as still-held.
  ```
  On `1`, **then** mirror the cleared state to `metadata.json` with the key-scoped
  `jq '.lease = null'` write above (Dolt is canonical; the file is its mirror). On
  `0`, treat the track as foreign-held again and skip it. If `bd` is unavailable,
  fall back to the local re-read-and-recheck path above (the file becomes the only
  guard, exactly as in monorepo mode).

### 5c.2 Team invariants

(a) **No cross-owner file overlap.** Collect every in-progress track (status
   `"in_progress"` read from each `metadata.json` — the source of truth, not the
   derived `tracks.md` index). For each, gather its in-progress
   tasks' `<!-- files: ... -->` globs from `plan.md`. If two in-progress tracks
   with **different** `owner` (fall back to Beads `assignee`) claim an overlapping
   file/glob, report a ❌ Error naming both tracks, both owners, and the
   overlapping path(s). Same-owner overlap (one person, sequential work) is **not**
   an error. If owners can't be resolved on both sides, downgrade to a ⚠️ Warning
   (can't prove a cross-owner conflict). This is detection only — never reassign.

(b) **Real owner on in-progress tracks.** Every in-progress (`[~]`) track must
   have an `owner` (in `metadata.json`) and/or Beads `assignee` that is a real
   identity — **not null/empty and not the literal string `"cadre"`** (the
   legacy placeholder). Report a violation as a ⚠️ Warning, e.g.
   > "In-progress track `<track_id>` has no real owner (owner: `<value>`). Set it
   > with `bd update <id> --assignee <git-identity>` and record `owner` in
   > metadata.json."
   Offer in step 7 to stamp the current `<git-identity>` as `owner` (key-scoped
   `jq '.owner = $id'`) — only when `<git-identity>` is non-null and the track is
   genuinely unowned (never overwrite an existing real owner). **Make the stamp
   Beads-CAS-aware** when `BEADS_AVAILABLE`: claim the epic atomically with a single
   conditional update against the Dolt DB, keyed on it still being unowned, then read
   rows-affected:
   ```bash
   bd sql "UPDATE issues SET assignee = '<git-identity>'
           WHERE id = '<beads_epic>' AND (assignee IS NULL OR assignee = '' OR assignee = 'cadre')"
   # rows-affected: 1 → you won the claim; mirror owner into metadata.json (jq '.owner = $id').
   #                0 → a real owner already holds it → do NOT overwrite; leave the
   #                    metadata.json stamp unwritten and report it as owned.
   ```
   On `1`, mirror `owner` to `metadata.json` with the key-scoped `jq` write above; on
   `0`, skip the stamp (a teammate claimed it first). If `bd` is unavailable, fall
   back to the local key-scoped `jq` stamp (file is the only guard, as in monorepo
   mode).

(c) **`ours` merge driver registered.** Runs whenever `.beads/** merge=ours` is
   present in `.gitattributes` (every full-Beads project — monorepo + polyrepo,
   local + shared), not only shared mode. The `merge=ours` driver the
   `.gitattributes` relies on must be registered, or git falls back to its default
   text merge, which injects conflict markers into the Dolt DB files (and, in
   shared mode, into the pinned per-track state files).
   Check `git config merge.ours.driver`:
   - Empty/unset → ❌ Error: "`.beads/** merge=ours` is configured but the `ours`
     merge driver is not registered; git's default text merge will inject conflict
     markers into the Dolt DB files (and pinned state in shared mode) on merge."
   - Also verify the expected `.gitattributes` lines exist (the `.beads/** merge=ours`
     entry, plus — in shared mode — the per-track state-file entries written at
     setup); report any missing line as a ⚠️ Warning.
   Offer in step 7 to register it: `git config merge.ours.driver true` (mirrors
   setup's `git config merge.ours.driver >/dev/null 2>&1 || git config merge.ours.driver true`).

### 5c.3 State-file repair

For each track, validate `implement_state.json` and `parallel_state.json` (when
present) as well-formed JSON — `jq empty <file>` must succeed. A common shared-mode
corruption is **union-merge damage**: a `merge=union` driver applied to these scalar
JSON objects interleaves both sides' lines into invalid JSON (this is exactly why
the registered `merge=ours` driver in 5c.2(c) is required for the pinned
`parallel_state.json`).

- **Parse failure** → ❌ Error naming the file and track.
- Offer in step 7 to repair:
  - `parallel_state.json` is **ephemeral** (deleted at phase end) — offer to
    **delete** the corrupted file so it regenerates cleanly on the next
    `/cadre-implement`.
  - `implement_state.json` is **resume state** — do **not** silently regenerate
    (a real divergence must not be lost). Offer to **back it up**
    (`implement_state.json.corrupt`) and reconstruct a minimal valid object from
    `plan.md` progress + `<git-identity>` as `owner` and the current UTC time as
    `last_updated`, surfacing to the user that resume position was reset. If the
    user declines, leave the file and keep the ❌ Error.
  - In shared mode, recommend confirming the merge driver fix from 5c.2(c) so the
    corruption does not recur.

## 6. Report

Present summary with:
- ✅ Valid items
- ⚠️ Warnings
- ❌ Errors
- Recommendations for fixes

In shared mode, include a **Team invariants** line summarizing the 5c results
(leases swept, owner/file-overlap status, merge-driver registration, state-file
health). In monorepo/local mode omit it — those checks are no-ops there.

## 7. Auto-Fix Option

Offer to fix auto-fixable issues:
- Missing metadata fields
- Index drift: regenerate `tracks.md` per `/cadre-status --regen-index`
  (rebuild the marked region from per-track metadata) — never hand-edit a marker [4]
- Orphan cleanup
- Stale-lease clears (shared mode — set `lease` to null, key-scoped) [5c.1]
- Stamp `<git-identity>` as `owner` on a genuinely unowned in-progress track [5c.2(b)]
- Register the `ours` merge driver when `.beads/** merge=ours` is present (`git config merge.ours.driver true`) [5c.2(c)]
- State-file repair: delete corrupted `parallel_state.json`; back up + reconstruct
  corrupted `implement_state.json` (only with confirmation) [5c.3]

All metadata fixes use **key-scoped `jq` writes to a temp file then move into
place** (e.g. `jq '.lease = null'`, `jq '.owner = $id'`) — never a full-file
rewrite — so concurrent sibling writes in shared mode aren't clobbered.

**Sync postamble (shared mode only).** Once the chosen fixes are applied, publish
the reconciled control plane rather than leaving the repairs local. When
`sync_mode == "shared"` (resolved in step 0), run the **sync postamble** from
`references/cadre-sync.md`: commit the `cadre/` changes (lease clears, owner
stamps, regenerated index, repaired state files), make the `bd dolt push`
**mandatory** (Dolt is the canonical shared task graph — the lease/owner CAS
writes above live there), then `git push` the control plane; on push rejection,
re-run the preamble (pull --rebase + dolt pull) and push again. In absent/`local`
mode, skip the postamble — fixes stay local as today. Product-repo CODE is never
pushed here; only the control plane is published.

---

## 8. BEADS VALIDATION

**PROTOCOL: Include Beads consistency checks.**

1. **Availability Check:**
   - Run the standard Beads availability check (see `references/beads-error-handler.md`)
   - If `BEADS_AVAILABLE=false`: skip this section silently

2. **Verify Beads Integration:**
   - Task status sync between Beads and plan.md
   - No orphan epics/tasks
   - Epic links valid in `metadata.json`
   - If any `bd` command fails: Follow Beads Error Handler Protocol (see `references/beads-error-handler.md`)

3. **Add to Report:** Beads integration section with sync status

4. **Auto-Fix:** Offer to sync status markers between systems
