---
description: Sync context docs with current codebase state
---

# Conductor Refresh

Sync conductor context documentation with the current codebase state.

## 1. Verify Setup

Check conductor/ exists with core files. If not, suggest `/conductor-setup`.

## 2. Determine Scope

If no argument, ask:
- `all` - Full refresh
- `tech` - tech-stack.md only
- `product` - product.md only
- `workflow` - workflow.md only
- `track [id]` - Specific track
- `repos` - **Polyrepo only:** reconcile `repos.json` ↔ `.gitmodules`, toggle
  `sync_mode` / per-repo `enabled` (see section 8b)

## 3. Analyze Drift

Compare current codebase against docs:
- **Tech:** Scan package.json, requirements.txt, etc. for new/removed deps
- **Product:** Check completed tracks not reflected in product.md
- **Workflow:** Check CI/CD changes, new tooling

## 4. Present Drift Report

Show what's changed since last setup/refresh.

## 5. Confirm Updates

Ask user to approve changes.

## 6. Apply Updates

- Create backups (*.md.bak)
- Update files with new information
- Add refresh marker to top of files

## 7. Update State

Create/update `conductor/refresh_state.json` with timestamp and changes.

## 8. Commit

```bash
git add conductor/
git commit -m "conductor(refresh): Sync context with codebase"
```

---

## 8a. CONSOLIDATE LEARNINGS (Pattern Flywheel)

**PROTOCOL: Aggregate and consolidate learnings across all tracks into project patterns.**

1. **Scan All Track Learnings:**
   - Read `learnings.md` from all tracks in `conductor/tracks/*/`
   - Read `learnings.md` from all archived tracks in `conductor/archive/*/`

2. **Extract Pattern Candidates:**
   - Find patterns mentioned 2+ times across different tracks
   - Find gotchas that reoccur
   - Find context that applies project-wide

3. **Present Consolidation Report:**
   > "## Learnings Consolidation Report"
   > 
   > **Patterns found across tracks:**
   > | Pattern | Tracks | Already in patterns.md? |
   > |---------|--------|-------------------------|
   > | "Use Zod for validation" | auth, api, users | ❌ No |
   > | "Barrel exports required" | auth, config | ✅ Yes |
   > 
   > **New patterns to add:** [list]
   > **Duplicate patterns to merge:** [list]
   > 
   > "Would you like to update `conductor/patterns.md`? (yes/no)"

4. **Update `conductor/patterns.md`:**
   - Add new patterns with source attribution
   - Merge duplicates
   - Remove outdated patterns (if confirmed)
   - Format:
     ```markdown
     - <pattern description> (from: <track_ids>, <date>)
     ```

5. **Create `conductor/patterns.md` if Missing:**
   - It is normally created by `conductor-setup`. If absent, recreate it by
     copying `<TEMPLATES_DIR>/patterns.md` (resolve `<TEMPLATES_DIR>` as described
     in `references/template-locator.md`), then merge in the patterns gathered
     above and update the `Last refreshed:` footer.
   - If the templates bundle can't be found, fall back to this structure:
     ```markdown
     # Codebase Patterns

     Reusable patterns discovered during development. Read this before starting new work.

     ## Code Conventions
     - <patterns related to code style>

     ## Architecture
     - <patterns related to architecture decisions>

     ## Gotchas
     - <common mistakes to avoid>

     ## Testing
     - <patterns for testing approaches>

     ---
     Last refreshed: <timestamp>
     ```

---

## 8b. REPOS & SYNC RECONCILE (Polyrepo only)

**Run when `conductor/repos.json` exists with `mode: "polyrepo"` and the scope is
`all` or `repos`.** This is the "later overridable" path for the topology/sync
choices made at setup. See `references/polyrepo-git.md` and `references/conductor-sync.md`.

1. **Reconcile manifest vs `.gitmodules`:**
   - Submodules in `.gitmodules` not in `repos.json` → offer to **add** entries
     (prompt for `default_branch`/`enabled`).
   - Entries in `repos.json` whose submodule was removed → offer to **remove** or
     mark `enabled: false`.
   - Probe each repo's remote host and confirm `pr_provider` still matches
     (`git -C <submodule_path> remote get-url origin`).

2. **Toggle sync mode:**
   - Show current `config.json.sync_mode`; offer to switch `local` ↔ `shared`.
   - Switching to `shared`: add the shared-state `.gitattributes` drivers (see
     `references/conductor-sync.md`) and publish the control plane for the first time.
   - Switching to `local`: stop auto-pushing; leave existing remote state intact.

3. **Toggle per-repo `enabled`:** let the user enable/disable specific repos
   (disabled repos are skipped by newtrack/implement/status/land).

4. **Optional submodule pointer refresh (gated, default off):**
   `git submodule update --init --remote` — offer it here only (never automatic).

5. **Commit + publish:** commit `repos.json`/`config.json`/`.gitattributes`
   changes; in shared mode run the sync postamble (`bd dolt push` + control-plane push).

---

## 9. BEADS DRIFT CHECK

**PROTOCOL: Include Beads status in drift analysis.**

1. **Availability Check:**
   - Run the standard Beads availability check (see `references/beads-error-handler.md`)
   - If `BEADS_AVAILABLE=false`: skip this section silently

2. **Analyze Beads vs Conductor Drift:**
   - Tasks done in Beads but `[ ]` in plan.md
   - Tasks `[x]` in plan.md but open in Beads
   - Orphaned Beads tasks
   - **Shared mode:** also reconcile `tracks.md` from Beads — Dolt is the canonical
     shared task graph, so a teammate may have added/closed tracks that
     `tracks.md` doesn't yet reflect. Surface tracks present in Beads but missing
     from `tracks.md` (and vice-versa) and offer to sync.
   - If any `bd` command fails: Follow Beads Error Handler Protocol (see `references/beads-error-handler.md`)

3. **Offer Sync Options:**
   > A) Sync Beads → Conductor (trust Beads)
   > B) Sync Conductor → Beads (trust plan.md)
   > C) Skip
