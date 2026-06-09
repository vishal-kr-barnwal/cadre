# Conductor Formula

Manage track workflow templates: $ARGUMENTS

Subcommands:
- `list` (default) — list available formulas
- `show <name>` — show a formula's structure and variables
- `create <track_id>` — distill a reusable template from a completed track
- `wisp [formula]` — start an ephemeral exploration (no audit trail)

---

## 1.0 BEADS CHECK

**PROTOCOL: Verify Beads is available for formula management.**

1. **Check Beads CLI:** Run `which bd`
   - If NOT found:
     > "⚠️ Beads CLI (`bd`) is required for formula management."
     > "Install from: https://github.com/steveyegge/beads"
     - HALT

2. **Check Beads Initialization:**
   - If `.beads/` directory does NOT exist:
     > "⚠️ Beads is not initialized in this project."
     > "Run `bd init` first, or use `/conductor-setup` to set up the project."
     - HALT

---

## 2.0 PARSE SUBCOMMAND

**PROTOCOL: Determine action from arguments.**

1. **Parse arguments:**

   **If empty or "list":** → section 3.0 (List Formulas)

   **If "show <name>":** extract the name → section 4.0 (Show Formula Details)

   **If "create [track_id] [--as <name>]":** → section 6.0 (Create Template from Track)

   **If "wisp [formula] [--var key=value]":** → section 7.0 (Ephemeral Exploration Wisp)

   **Otherwise:** announce usage and the four subcommands, then HALT.

---

## 3.0 LIST FORMULAS

**PROTOCOL: Display available workflow templates.**

1. **Query Beads:**
   ```bash
   bd formula list --json
   ```

2. **Handle Empty Result:**
   - If no formulas found:
     > "No formulas found in this project."
     > 
     > **To create a formula:**
     > 1. Complete a track using `/conductor-implement`
     > 2. Run `/conductor-formula create <track_id>` to extract a reusable template
     > 
     > **Or use Beads directly:**
     > ```bash
     > bd mol distill <epic-id> --as "Template Name"
     > ```

3. **Display Results:**
   > "## Available Formulas (Track Templates)"
   > 
   > | Formula | Description | Variables |
   > |---------|-------------|-----------|
   > | `<name>` | `<description>` | `<var_list>` |
   > 
   > **Usage:**
   > - `/conductor-formula show <name>` - View formula details
   > - `bd mol pour <name>` - Create persistent track from formula
   > - `/conductor-formula wisp <name>` - Quick ephemeral track

---

## 4.0 SHOW FORMULA DETAILS

**PROTOCOL: Display formula structure and required variables.**

1. **Query Beads:**
   ```bash
   bd mol show <formula_name> --json
   ```

2. **Handle Not Found:**
   - If formula not found:
     > "Formula '<name>' not found."
     > "Run `/conductor-formula list` to see available formulas."
   - HALT

3. **Display Structure:** name, description, variables table, phase tree, and usage
   examples (`bd mol pour <name> --var key=value` and
   `/conductor-formula wisp <name> --var key=value`).

---

## 5.0 CONDUCTOR INTEGRATION NOTES

**PROTOCOL: Explain how formulas work with Conductor.**

> ### How Formulas Work with Conductor
> 
> Beads formulas are reusable workflow templates. When you complete a track, you can extract it as a formula for reuse.
> 
> | Beads Concept | Conductor Mapping |
> |---------------|-------------------|
> | **Formula** | Track template (reusable pattern) |
> | **Proto** | Frozen template (ready to use) |
> | **Mol** | Feature track (persistent, auditable) |
> | **Wisp** | Quick exploration (ephemeral, no clutter) |
> 
> **Workflow:**
> 1. Create and complete a track: `/conductor-newtrack` → `/conductor-implement`
> 2. Extract as formula: `/conductor-formula create <track_id>`
> 3. Reuse for new work: `bd mol pour <formula>` or `/conductor-formula wisp <formula>`

---

## 6.0 CREATE TEMPLATE FROM TRACK (`create`)

**PROTOCOL: Extract a reusable template from a completed track's Beads epic.**

### 6.1 Track Selection
- **track_id provided:** validate `conductor/tracks/<track_id>/` exists; load `metadata.json`.
- **No track_id:** list `[x]` tracks from `tracks.md` and ask the user to choose; if
  none, instruct them to complete a track first and HALT.

### 6.2 Validate Track
1. If the track is NOT `[x]`: warn and offer to extract anyway or complete first (HALT if completing first).
2. Read `metadata.json` for `beads_epic`. If none:
   > "⚠️ This track has no Beads integration. Templates are extracted from Beads epics."
   - HALT

### 6.3 Determine Template Name
- `--as <name>` if provided, else derive a kebab-case name and confirm.

### 6.4 Analyze Track for Variables
Read `spec.md` and `plan.md`; propose `{{variables}}` for specific names/versions/paths
in a table and let the user adjust.

### 6.5 Extract Template
```bash
bd mol distill <beads_epic_id> --as "<template_name>" --var <value>=<var> --json
```
- **Success:** capture proto ID; announce name/proto/variables; show usage
  (`bd mol pour`, `/conductor-formula wisp <name>`, `/conductor-formula show <name>`).
- **Failure:** show error; follow the Beads Error Handler Protocol; suggest manual fallback.

### 6.6 Register with Conductor (Optional)
Create `conductor/templates/<template_name>/` with `metadata.json`, `spec.template.md`,
`plan.template.md` (specific values replaced by `{{variable}}` placeholders); announce.

### 6.7 Cleanup
Offer to **Archive** (run `/conductor-archive <track_id>`), **Keep**, or **Delete** the
source track (confirm before deleting).

---

## 7.0 EPHEMERAL EXPLORATION WISP (`wisp`)

**PROTOCOL: Create an ephemeral exploration track with no audit trail.**

Wisps are **ephemeral** workflow instances that live in the Dolt `wisps` table
(excluded from sync via `dolt_ignore`), are **never** synced to git, and leave no
audit trail — ideal for exploration, debugging, quick fixes, patrol/health checks.
Use persistent tracks instead when work needs an audit trail, spans sessions, or
requires team coordination.

### 7.1 Parse Arguments
- **Formula name provided:** use it; capture any `--var key=value`.
- **No formula name:** run `bd formula list --json`; if formulas exist, present and ask
  the user to choose or describe an exploration; if none, ask what to explore → 7.3.

### 7.2 Create Wisp from Formula
```bash
bd mol wisp <formula_name> [--var key=value ...] --json
```
- **Success:** report wisp ID + formula; show `bd mol current`; remind it won't sync to
  git. Navigation: `bd mol current`, `bd close <step> --continue`, `bd mol squash <wisp>`,
  `bd mol burn <wisp>`.
- **Failure:** display the error and suggest alternatives.

### 7.3 Create Ad-hoc Wisp
```bash
bd create "Exploration: <user_description>" -t epic -p 3 --json
bd mol wisp <epic_id> --json
```
Announce the wisp ID/topic; add discovered work with
`bd create "<finding>" --deps discovered-from:<wisp_id> --json`; finish with
`bd mol squash <wisp_id>` (digest) or `bd mol burn <wisp_id>` (no trace).

### 7.4 Wisp Management
| Action | Command |
|--------|---------|
| List wisps | `bd mol wisp list` |
| Current step | `bd mol current` |
| Complete step | `bd close <step> --continue` |
| Save with summary | `bd mol squash <wisp> --summary "..."` |
| Delete completely | `bd mol burn <wisp>` |
| Clean up orphans | `bd mol wisp gc` |

### 7.5 Transition to Persistent Track
If the exploration found work worth keeping, offer to **Convert** to a persistent track
via `/conductor-newtrack` (then burn the wisp), **Create follow-up issues**
(`bd create … --deps discovered-from:<parent>`), **Squash** with a digest, or **Burn**.
