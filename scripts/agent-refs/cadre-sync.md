# Control-Plane Sync (shared mode)

Cadre's **control plane** is everything that describes the work, not the
work itself: `cadre/` (tracks.md, repos.json, config.json, all
`tracks/<id>/*`) plus the Beads Dolt DB under `.beads/`. In polyrepo mode this
all lives in the **control repo**.

Sync behavior is governed by `cadre/config.json`:

- **Absent, or `"sync_mode": "local"`** → today's behavior. Commits stay local;
  nothing is pulled or pushed automatically. **Skip this entire file.**
- **`"sync_mode": "shared"`** → the control plane is shared with teammates via
  `control_remote`/`control_branch`. Follow the preamble and postamble below.

> **Product-repo CODE is never auto-pushed regardless of sync mode.** Shared mode
> shares orchestration state only. Code branches go up only at `/cadre-land`
> (or archive's safety-net push).

## Sync preamble (top of every command that mutates control-plane state)

Run before reading/modifying `cadre/` or Beads:

1. `git pull --rebase <control_remote> <control_branch>` on the control repo.
2. `bd dolt pull` to sync the shared task graph.
3. `.beads/**` conflicts auto-resolve via the `merge=ours` driver (Dolt owns its
   own history). Do not hand-merge `.beads/`.
4. Regenerable per-track state JSON resolves without hand-merging:
   `parallel_state.json` is **ephemeral** and resolves via the `merge=ours`
   driver (keep our side; it is rebuilt at the next parallel dispatch).
   `implement_state.json` is a **scalar JSON object**, so a line-`union` merge
   would interleave keys and produce **invalid JSON** — it stays on a **normal
   merge** (no `.gitattributes` entry); on the rare real conflict, discard the
   stale side and let the next `/cadre-implement` rebuild it from `plan.md` +
   Beads. **Never apply `merge=union` to any single-object JSON file.**
5. **Spec/plan/manifest conflicts** (`spec.md`, `plan.md`, `repos.json`,
   `config.json`) are surfaced to the user — **never auto-clobber them.** Stop and
   ask how to resolve.
6. Submodule pointer refresh is **optional and gated** (default off):
   `git submodule update --init --remote` is offered in `/cadre-refresh`, not
   run automatically here.

If `pull_on_command_start` is `false` in config, skip the pull but still run the
postamble push after mutation.

## Sync postamble (after a command mutates control-plane state)

1. Commit the `cadre/` changes in the control repo as usual.
   - **Per-repo / per-track `metadata.json` writes use key-scoped jq (CAS),
     never a full-file rewrite** — e.g. `jq '.review = $obj'` / `jq '.lease = …'`,
     not `jq '{…whole object…}'`. Sibling commands (review, implement, ship) may
     write different keys of the same file concurrently; a full rewrite clobbers
     a teammate's just-written key, a scoped assignment preserves it.
2. Make the Beads Dolt push **mandatory** (not optional) in shared mode — Dolt is
   the canonical shared task graph; tracks.md / state JSON are its human-readable
   mirror. Run the `bd dolt push` that `beads.json` `pushOn*` triggers would fire,
   even if that trigger is set to optional.
3. `git push <control_remote> <control_branch>` to publish the control plane.
4. On push rejection (someone else pushed): re-run the preamble (pull --rebase +
   dolt pull), resolve per the rules above, then push again.
5. **On rejection due to a duplicate `track_id`** (a `git push` non-fast-forward
   or `bd dolt push` rejection where the conflicting object is a track another
   teammate created with the *same* `shortname_YYYYMMDD` ID): a sibling claimed
   the ID first. Do **not** force-push or overwrite theirs. Instead, re-suffix
   the local track per the collision rule in the CONTRACT — append
   `-<2-char base36>` as the LAST path segment (`auth_20260615` →
   `auth_20260615-b`, keeping `shortname_YYYYMMDD` parseable since the suffix
   trails the date). Renaming touches all of:
   - the track directory `cadre/tracks/<old_id>/` → `cadre/tracks/<new_id>/`;
   - the track branch(es) `track/<old_id>` → `track/<new_id>` (every repo in
     polyrepo mode);
   - `metadata.json` `track_id` (key-scoped jq);
   - the Beads epic title / track-scope label `cadre-track:<old_id>` →
     `cadre-track:<new_id>`.
   Then regenerate the index per `/cadre-status --regen-index` (the derived
   index is a mirror of `metadata.json`, not an authority — it has no ID column to
   edit), re-run the preamble, and push again. Never derive the new ID from the
   Beads epic ID.

## `.gitattributes` (added in shared mode)

```
# Beads Dolt DB — keep main's version on merge; Dolt manages its own history
.beads/** merge=ours
# Ephemeral per-track state — rebuilt next dispatch; keep our side, don't conflict
cadre/tracks/**/parallel_state.json  merge=ours
```

> **Why not `merge=union`?** `union` concatenates both sides' lines, which is
> only safe for append-only line logs. `parallel_state.json` and
> `implement_state.json` are single JSON objects — unioning them interleaves
> keys/braces into invalid JSON. `parallel_state.json` uses `merge=ours`;
> `implement_state.json` stays on the **normal merge** (no attribute) — either
> way a conflict is resolved by discarding the stale copy and regenerating, never
> by blindly splicing.

These drivers only take effect once registered (see "Driver registration"
below). Leave `repos.json` / `config.json` / `spec.md` / `plan.md` on normal
merge so structural conflicts surface intentionally rather than being silently
merged.

## Driver registration (shared-mode setup)

`merge=ours` is a named driver, not a built-in — the `.gitattributes` lines
above are inert until the driver is defined in git config. Shared-mode setup
(`/cadre-setup` when `sync_mode == "shared"`) must register it once per
clone:

```
git config merge.ours.driver true
```

(`true` is the no-op "always keep ours" driver shipped with git.) If this is
missing, git falls back to a normal text merge for those files and the
ephemeral/scalar-JSON files can conflict. Re-run on every fresh clone of the
control repo; it is local config, not committed.
