# Ownership Guard (topology-independent)

Run this **before any command mutates a track** — `cadre-implement` at track
selection, and `cadre-flag`, `cadre-revise`, `cadre-revert`, `cadre-handoff`
before they edit a track's plan/spec/state. It stops two people (or their agents)
from clobbering the same track in **any** topology — including the **default
monorepo mode**, where the advisory `lease` is a no-op and was previously the only
guard.

## 1. Compute identity

`<git-identity>` = `git config user.email` (fallback `git config user.name`, else
`null`). This is the current operator.

## 2. Read ownership

For the target `<track_id>`, read:

- `cadre/tracks/<track_id>/metadata.json` → `owner`, `status`, and (shared mode
  only) `lease`.
- `cadre/tracks/<track_id>/implement_state.json` (if present) → `owner`, `status`.

The effective holder is `implement_state.json.owner` when that file exists, else
`metadata.json.owner`.

## 3. Decide

The track is **foreign-held** when ALL of these hold:

- the effective holder is **non-null**, AND
- `<git-identity>` is **non-null**, AND
- they **differ**, AND
- the track is **active** — `metadata.json.status == "in_progress"`, or
  `implement_state.json.status` ∈ {`in_progress`, `handed_off`}.

In **shared mode**, additionally treat a `lease` held by a different identity with
a **fresh** `heartbeat_at` (within the staleness window in §5) as foreign-held,
even if `owner` is unset.

**Exception — a handoff addressed to you.** If the track's Beads epic `assignee` ==
`<git-identity>` (you are the named recipient of a `cadre-handoff --for-teammate`,
typically carrying a `handoff:pending` label), the track is **not** foreign-held even
when the effective `owner` differs — it is a pending handoff *to you*. Proceed with a
clean pickup (no take-over prompt): your claim sets `owner = <git-identity>` and
clears the `handoff:pending` label. Ownership intentionally stays with the author
until you pick it up, so `cadre-status` Team View can group the pending handoff by
`assignee`.

## 4. Act

- **Not foreign-held** (track is free, you are the holder, or your identity is
  `null`): proceed **silently**. Your next state write MUST set
  `owner = <git-identity>` (shared mode: also claim/refresh the `lease`).
- **Foreign-held:**
  > "⚠️ Track `<track_id>` is held by `<holder>` (status `<status>`). Take over?
  >  A) Take over — set yourself as owner and proceed
  >  B) Stop — leave it to `<holder>`"
  - **A:** proceed; your next `metadata.json` / `implement_state.json` write sets
    `owner = <git-identity>` (shared mode: steal the `lease`).
  - **B:** HALT.

### Atomic claim (Beads-CAS — the real serialization point)

When Beads is configured (`beads_enabled`; see `references/beads-integration.md`),
the **claim itself** must be a single compare-and-set against the shared Dolt
task graph — not a read-then-write — so two operators racing to take the same
**free** (or stale) track cannot both win. In the **default monorepo** mode the
advisory `lease` is a no-op, so this Beads conditional write is the **only** real
serialization point that closes the two-pickers race (the take-over of a
genuinely *foreign-held* track is still gated by the §3/§4 prompt).

Read the track's `beads_epic` from `metadata.json`, then attempt **one**
conditional update that claims the epic only if it is unheld or its lease is
stale (staleness window per §5):

```bash
bd sql "UPDATE issues SET assignee='<git-identity>'
        WHERE id='<beads_epic>'
          AND (assignee IS NULL OR assignee=''
               OR assignee='<git-identity>'
               OR updated_at < datetime('now','-30 minutes'))"
```

Read **rows-affected**: `1` → **you won** the claim; `0` → someone else already
holds it → treat the track as **foreign-held** (fall through to the §4 take-over
prompt / pick another). The `OR assignee='<git-identity>'` clause makes the claim
**idempotent for the rightful holder**: re-running `cadre-implement` on your own
track, or picking up a track **handed off to you** (assignee == you; see the §3
handoff exception), wins cleanly (`1`) instead of being locked out for the staleness
window. On a handoff pickup, also clear the `handoff:pending` label
(`bd label remove <beads_epic> handoff:pending`). Ground the exact `bd`/SQL interface in
`references/beads-integration.md`.

On a win, **mirror** the owner into `metadata.json` so the file reflects Beads.
If `bd` is unavailable, HALT and restore the Beads prerequisite; do not replace
the CAS with a file-only read-decide-write claim.

Always write `owner` with a **key-scoped** `jq` update (never a full-file
rewrite), so a concurrent sibling write to another key is not clobbered:

```bash
META="cadre/tracks/<track_id>/metadata.json"
tmp="$(mktemp)"
jq --arg o "<git-identity>" '.owner = $o' "$META" > "$tmp" && mv "$tmp" "$META"
```

## 5. Staleness window (canonical: 30 minutes)

A `lease` (or `implement_state.json`) whose `heartbeat_at` / `last_updated` is older
than **30 minutes** is **stale**: treat the track as free and reclaim it **without**
the take-over prompt (note the reclaim in your announcement). This single
**30-minute** window is the canonical value shared by `cadre-implement`'s
take-over check and the `cadre-validate` lease sweep — do not use a different
threshold.
