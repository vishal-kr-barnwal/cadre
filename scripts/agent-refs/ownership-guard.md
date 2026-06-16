# Ownership Guard (topology-independent)

Run this **before any command mutates a track** — `/cadre-implement` at track
selection, and `/cadre-flag`, `/cadre-revise`, `/cadre-revert`, `/cadre-handoff`
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
**30-minute** window is the canonical value shared by `/cadre-implement`'s
take-over check and the `/cadre-validate` lease sweep — do not use a different
threshold.
