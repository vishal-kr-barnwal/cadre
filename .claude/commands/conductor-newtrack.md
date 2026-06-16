---
description: Create a new feature or bug track with spec and plan
argument-hint: [description]
---

<!-- 
SYSTEM DIRECTIVE: You are an AI agent for the Conductor framework.
CRITICAL: Validate every tool call. If any fails, halt and announce the failure.
-->

# Conductor New Track

Create a new track for: $ARGUMENTS

---

## 1.0 SETUP CHECK

**PROTOCOL: Verify Conductor environment is properly set up.**

1. **Check Required Files:** Verify existence of:
   - `conductor/product.md`
   - `conductor/tech-stack.md`
   - `conductor/workflow.md`

2. **Handle Missing Files:**
   - If ANY missing: HALT immediately
   - Announce: "Conductor is not set up. Please run `/conductor-setup` first."
   - Do NOT proceed.

3. **Topology check:** Read `conductor/repos.json`. If absent or `mode` ≠
   `"polyrepo"`, this is **monorepo mode** — every step below behaves exactly as
   today; ignore the polyrepo-only notes. If `mode == "polyrepo"`, follow
   `references/polyrepo-git.md` for the per-repo branch/worktree model and the
   repo annotation. If `conductor/config.json` has `sync_mode: "shared"`, run the
   sync preamble from `references/conductor-sync.md` before mutating any state.

---

## 2.0 NEW TRACK INITIALIZATION

### 2.1 Get Track Description and Determine Type

1. **Load Project Context:** Read `conductor/` directory files.

2. **Get Track Description:**
   - **If `$ARGUMENTS` provided:** Use it as track description
   - **If empty:** Ask:
     > "Please provide a brief description of the track (feature, bug fix, chore, etc.) you wish to start."
     Wait for response.

3. **Infer Track Type:** Analyze description to classify as "Feature" or "Something Else" (Bug, Chore, Refactor). Do NOT ask user to classify.

---

### 2.2 Interactive Specification Generation (`spec.md`)

1. **Announce:**
   > "I'll now guide you through questions to build a comprehensive `spec.md` for this track."

2. **Questioning Phase (3-5 questions):**

   **Question Classification - CRITICAL:**
   - **1. Classify Question Type:** Before EACH question, classify as:
     - **Additive:** For brainstorming/scope (users, goals, features) - allows multiple answers
     - **Exclusive Choice:** For singular commitments (specific technology, workflow rule) - single answer

   - **2. Formulate Based on Classification:**
     - **If Additive:** Open-ended question + options + "(Select all that apply)"
     - **If Exclusive Choice:** Direct question, do NOT add multi-select

   - **3. Interaction Flow:**
     - **CRITICAL:** Ask ONE question at a time. Wait for response before next question.
     - Last option for every question MUST be "Type your own answer"
     - Confirm understanding by summarizing before moving on

   **If FEATURE (3-5 questions):**
   - Clarifying questions about the feature
   - Implementation approach, interactions, inputs/outputs
   - UI/UX considerations, data involved

   **If SOMETHING ELSE - Bug, Chore, etc. (2-3 questions):**
   - Reproduction steps for bugs
   - Specific scope for chores
   - Success criteria

3. **Draft `spec.md`:** Generate with sections:
   - Overview
   - Functional Requirements
   - Non-Functional Requirements (if any)
   - Acceptance Criteria
   - Out of Scope

4. **User Confirmation:**
   > "I've drafted the specification. Please review:"
   > ```markdown
   > [Drafted spec.md content]
   > ```
   > "Does this accurately capture the requirements? Suggest changes or confirm."

   Revise until confirmed.

---

### 2.3 Interactive Plan Generation (`plan.md`)

1. **Announce:**
   > "Now I will create an implementation plan (`plan.md`) based on the specification."

2. **Generate Plan:**
   - Read confirmed `spec.md` content
   - Read `conductor/workflow.md`
   - Generate hierarchical Phases, Tasks, Sub-tasks
   - **CRITICAL:** Plan structure MUST adhere to workflow methodology (e.g., TDD tasks)
   - Include `[ ]` status markers for each task/sub-task

   **CRITICAL: Inject Phase Completion Tasks**
   - Check if `conductor/workflow.md` defines "Phase Completion Verification and Checkpointing Protocol"
   - If YES, for EACH Phase, append final meta-task:
     ```
     - [ ] Task: Conductor - User Manual Verification '<Phase Name>' (Protocol in workflow.md)
     ```
   - Replace `<Phase Name>` with actual phase name

3. **Analyze for Parallel Execution Potential:**
   
   a. **Identify Parallelizable Tasks (within phases):**
      - For each phase, analyze tasks for:
        - File ownership conflicts (do any two tasks modify the same files?)
        - Logical dependencies (does task B need output from task A?)
        - Independent work (can tasks run without coordination?)
   
   b. **Identify Parallelizable Phases:**
      - Analyze phases for:
        - Cross-phase dependencies (does Phase B need Phase A's output?)
        - Independent scopes (can Phase 1 and Phase 2 run without coordination?)
        - Example: "Core Backend" and "UI Components" often have no dependencies
   
   c. **Present Parallel Execution Options:**
      > "I've analyzed the plan for parallel execution potential:"
      > 
      > **Task-Level Parallelism:**
      > - **Phase 1: [Phase Name]** ([N] tasks)
      >   - Tasks [list] can run in parallel (no file conflicts)
      >   - Task [X] depends on Task [Y] → must be sequential
      > - **Phase 2: [Phase Name]** ([N] tasks)
      >   - All tasks share files → sequential execution only
      > 
      > **Phase-Level Parallelism:**
      > - Phase 1 and Phase 2 are independent → can run in parallel
      > - Phase 3 requires Phase 1 and Phase 2 → must wait for both
      >
      > "Would you like to enable parallel execution? (yes/no)"
   
   d. **If User Confirms Parallel:**
      - **For task-level parallelism:**
        - Add `<!-- execution: parallel -->` annotation after eligible phase headings
        - Add `<!-- files: path1, path2 -->` annotation to each task with its file ownership
        - Add `<!-- depends: taskN -->` annotation where task dependencies exist within phase
      
      - **For phase-level parallelism:**
        - Add `<!-- depends: -->` (empty) for phases with no dependencies (can run immediately)
        - Add `<!-- depends: phase1, phase2 -->` for phases that depend on specific phases
        - Phases WITHOUT any `<!-- depends: -->` annotation default to sequential (depends on previous phase)
      
      **Example Output:**
      ```markdown
      ## Phase 1: Core Setup
      <!-- execution: parallel -->
      
      - [ ] Task 1: Create auth module
        <!-- files: src/auth/index.ts, src/auth/index.test.ts -->
        
      - [ ] Task 2: Create config module
        <!-- files: src/config/index.ts -->
        
      - [ ] Task 3: Create utilities
        <!-- files: src/utils/index.ts -->
        <!-- depends: task1 -->
      
      ## Phase 2: UI Components
      <!-- execution: parallel -->
      <!-- depends: -->
      
      - [ ] Task 1: Create login page
        <!-- files: src/pages/login.tsx -->
      
      ## Phase 3: Integration
      <!-- execution: sequential -->
      <!-- depends: phase1, phase2 -->
      
      - [ ] Task 1: Wire up auth with UI
      ```
   
   e. **If User Declines Parallel:**
      - Keep all phases as default sequential (no annotations needed)
      - Announce: "All phases and tasks will execute sequentially."

3.5. **Annotate Target Repos (POLYREPO ONLY — skip in monorepo mode):**
   - For each task, decide which product repo it touches and append a
     `<!-- repo: <name> -->` annotation (parallel to `<!-- files: -->`). The name
     MUST match a `repos[].name` in `conductor/repos.json`.
   - Tasks that belong to the `default_repo` may omit the annotation (it defaults
     there), but prefer being explicit for clarity.
   - **Prefer one repo per task.** If a task genuinely spans two repos, split it
     into per-repo tasks; only annotate a single task with multiple repos as a
     last resort.
   - Confirm the union of target repos with the user — these become the per-repo
     branches/worktrees created in step 10a.
   - **Fleet advisory (advisory only — never blocks):** for each chosen repo, you
     MAY list its in-flight track branches with
     `git -C <submodule_path> ls-remote --heads origin 'track/*'`. If any other
     `track/*` branches already exist on a repo you're about to touch, warn the
     user that a teammate may have an in-flight track there (naming the repo and
     branches), then continue — this is informational, not a halt. If the command
     fails (e.g. offline, no remote), **degrade silently**: skip the advisory and
     proceed without warning or error.
   - Example:
     ```markdown
     - [ ] Task 1: Add /login endpoint
       <!-- repo: api -->
       <!-- files: src/auth/login.ts -->
     - [ ] Task 2: Build login form
       <!-- repo: web -->
       <!-- files: src/pages/login.tsx -->
     ```
   - **Merge-order directive (optional):** if some repos must land before others
     (e.g. the API before the web client that consumes it), add a single
     `<!-- repo-order: a > b > c -->` comment near the top of `plan.md`. Repos are
     listed left-to-right in the order they should merge. This is parsed into
     `metadata.json` `merge_order` in step 2.4.7 and consumed by `/conductor-land`
     and the merge-train CI. If absent, repos merge in alphabetical order. Only the
     repos you name need appear; any omitted repos merge after, alphabetically.

4. **User Confirmation:**
   > "I've drafted the implementation plan. Please review:"
   > ```markdown
   > [Drafted plan.md content]
   > ```
   > "Does this cover all necessary steps based on spec and workflow? Suggest changes or confirm."

   Revise until confirmed.

---

### 2.4 Create Track Artifacts and Update Main Plan

0. **Compute git identity (`<git-identity>`):** Run
   `git config user.email` (fallback `git config user.name`, else treat as null).
   Hold this value for the rest of the command — it populates `metadata.owner`,
   the Beads epic `--assignee`, and (shared mode only) `metadata.lease.owner`.
   If null, silently proceed with `owner: null` and omit the Beads `--assignee`.

1. **Check for Duplicate Track Name:**
   - List existing directories in `conductor/tracks/`
   - Extract short names from track IDs (`shortname_YYYYMMDD` → `shortname`)
   - If proposed short name matches existing:
     - **HALT** creation
     - Explain track with that name exists
     - Suggest different name or resuming existing track

2. **Generate Track ID:** Create base ID: `shortname_YYYYMMDD`.
   - **Collision-proof suffix:** if a directory `conductor/tracks/<shortname_YYYYMMDD>`
     already exists (e.g. a same-day re-creation that slipped past the name check),
     append `-<2-char base36>` as the **last path segment** — e.g.
     `auth_20260615` → `auth_20260615-b`. The suffix comes *after* the date and is
     `-`-separated, so the `shortname_YYYYMMDD` parse still works. Pick the random
     2-char base36 value, retry if that directory also exists. **Never** derive the
     ID from the Beads epic ID.
   - **Shared mode (`config.json` `sync_mode: "shared"`):** if the publish step in
     §3.0 is later rejected because another machine already pushed this exact
     `track_id` (a push / `bd dolt push` conflict), re-suffix the track — rename the
     directory, the `track/<track_id>` branch, the `tracks.md` row, the
     `metadata.json` `track_id`, and the Beads epic title — then re-publish. The
     detailed rejection-recovery branch lives in `references/conductor-sync.md`
     (owned by the sync master); this command only needs to honor the re-suffix.

3. **Ask for Priority:**
   > "What priority should this track have?"
   > A) 🔴 Critical - Blocking other work
   > B) 🟠 High - Important, do soon
   > C) 🟡 Medium - Normal priority (default)
   > D) 🟢 Low - Nice to have

   Default to "medium" if skipped.

4. **Ask for Dependencies (Optional):**
   > "Does this track depend on any other tracks being completed first?"
   - If yes: List incomplete tracks from `conductor/tracks.md`, let user select
   - Store selected track_ids in `depends_on` array
   - Default to empty array if skipped or no incomplete tracks

5. **Ask for Time Estimate (Optional):**
   > "Estimated hours to complete? (Enter number or skip)"
   - Store in `estimated_hours` or null if skipped

6. **Create Directory:** `conductor/tracks/<track_id>/`

7. **Create `metadata.json`:**
   ```json
   {
     "track_id": "<track_id>",
     "type": "feature",
     "status": "new",
     "priority": "medium",
     "depends_on": [],
     "estimated_hours": null,
     "created_at": "YYYY-MM-DDTHH:MM:SSZ",
     "updated_at": "YYYY-MM-DDTHH:MM:SSZ",
     "description": "<Initial user description>",
     "owner": "<git-identity>",
     "reviewer": null,
     "git_branch": "track/<track_id>",
     "worktree_path": ".worktrees/<track_id>"
   }
   ```
   Populate with actual values from steps 0, 3-5.
   - `owner` is `<git-identity>` from step 0 (set it to `null` if git identity is
     unset — never write an empty string). `reviewer` is always `null` at creation.

   **SHARED MODE ONLY (`conductor/config.json` `sync_mode: "shared"`):** also add a
   `lease` object claiming the track for the creating user. In monorepo + local
   mode, **omit `lease` entirely (no-op)** — do not add a `null` key, do not change
   any behavior. Shared-mode `lease` schema:
   ```json
   "lease": {
     "owner": "<git-identity>",
     "host": "<hostname>",
     "acquired_at": "<ISO-8601 UTC>",
     "heartbeat_at": "<ISO-8601 UTC>"
   }
   ```
   `<hostname>` is the output of `hostname`; `acquired_at` and `heartbeat_at` are
   both the current UTC time at creation.

   **Concurrency-safe writes:** when adding Beads fields, `review`, or `lease` later
   (here or in sibling commands), use key-scoped `jq` (e.g.
   `jq '.review = $obj'`), never a full-file rewrite, so concurrent writes from
   sibling commands don't clobber each other.

   **POLYREPO ONLY:** also add a `repos` map — one entry per target repo from the
   union computed in step 3.5. Keep the flat `git_branch`/`worktree_path` fields
   for compatibility (they point at the control repo's branch). Resolve each
   repo's `submodule_path`/`default_branch` from `conductor/repos.json`. **Always
   include `submodule_path`** — `/conductor-land` and the merge-train CI read it to
   target the right submodule:
   ```json
   "repos": {
     "api": { "submodule_path": "repos/api", "git_branch": "track/<track_id>", "worktree_path": ".worktrees/<track_id>/api", "base_branch": "main" },
     "web": { "submodule_path": "repos/web", "git_branch": "track/<track_id>", "worktree_path": ".worktrees/<track_id>/web", "base_branch": "main" }
   }
   ```

   **POLYREPO ONLY — `merge_order`:** scan the confirmed `plan.md` for a
   `<!-- repo-order: a > b > c -->` directive (see step 3.5). If present, split on
   `>`, trim each repo name, and store the result as an **array, left-to-right**:
   ```json
   "merge_order": ["api", "web"]
   ```
   Store the array verbatim — do **not** topo-sort, de-dupe against the repo graph,
   or run cycle detection; it is a plain ordering hint. If the directive is absent,
   **omit `merge_order` entirely** (downstream treats an absent field as
   alphabetical order).

8. **Write Files:**
   - `conductor/tracks/<track_id>/spec.md`
   - `conductor/tracks/<track_id>/plan.md`

9. **Initialize Learnings File (Ralph-style progress tracking):**
   
   a. **Read Project Patterns:** If `conductor/patterns.md` exists:
      - Read and display: "📚 **Codebase Patterns:** Found X patterns from previous tracks"
      - These patterns will guide implementation
   
   b. **Check for Similar Archived Tracks:**
      - Scan `conductor/archive/` for tracks with similar names/descriptions
      - If found, ask:
        > "Found similar archived track(s): `<track_ids>`"
        > "Would you like to seed learnings from a previous track? (Enter track_id or 'skip')"
      - If selected: Copy relevant patterns from archived track's `learnings.md`
   
   c. **Create `learnings.md` from template:**
      - Resolve `<TEMPLATES_DIR>` as described in `references/template-locator.md`.
      - Copy `<TEMPLATES_DIR>/learnings.md` to
        `conductor/tracks/<track_id>/learnings.md`, replacing every `{{track_id}}`
        with the real track id.
      - Under the `## Codebase Patterns (Inherited)` heading, insert the patterns
        gathered above (from `conductor/patterns.md` or archived tracks).
      - If `<TEMPLATES_DIR>` can't be found, fall back to creating the file with
        this minimal structure:
        ```markdown
        # Track Learnings: <track_id>

        Patterns, gotchas, and context discovered during implementation.

        ## Codebase Patterns (Inherited)

        <patterns from conductor/patterns.md or archived tracks>

        ---

        <!-- Learnings from implementation will be appended below -->
        ```

10. **Update Tracks File:**
   - Announce: "Updating the tracks file."
   - Append to `conductor/tracks.md`:
     ```markdown

     ---

     ## [ ] Track: <Track Description>
     *Link: [./conductor/tracks/<track_id>/](./conductor/tracks/<track_id>/)*
     ```

10a. **Scaffold Commit + Create Worktree:**
   - Stage and commit all conductor files to the **control repo** (main):
     ```bash
     git add conductor/tracks/<track_id>/
     git add conductor/tracks.md
     git commit -m "conductor(newtrack): scaffold <track_id>"
     ```

   **MONOREPO MODE (no `repos.json`):**
   - Create the worktree (track branch now inherits all scaffold files):
     ```bash
     bd worktree create .worktrees/<track_id> --branch track/<track_id>
     ```
   - **If `bd` command fails:** → Follow Beads Error Handler Protocol (see references/beads-error-handler.md)
     - Degraded fallback: `git checkout -b track/<track_id>`
   - Announce: "Worktree ready at `.worktrees/<track_id>` on branch `track/<track_id>`"

   **POLYREPO MODE (`repos.json` with `mode: "polyrepo"`):** create **one
   worktree per target repo** (see `references/polyrepo-git.md`). For each entry
   in `metadata.json.repos`:
   - Ensure the submodule is initialized: `git submodule update --init <submodule_path>`.
   - Fetch + create the per-repo worktree in submodule context:
     ```bash
     git -C <submodule_path> fetch origin <base_branch>
     git -C <submodule_path> worktree add <abs path .worktrees/<track_id>/<repo>> -b track/<track_id> origin/<base_branch>
     ```
   - **Fallback** (if worktree-of-submodule fails): `git -C <submodule_path> checkout -b track/<track_id> origin/<base_branch>` and record that submodule path as the worktree path (degraded mode in `references/polyrepo-git.md`).
   - Announce each: "Worktree ready at `.worktrees/<track_id>/<repo>` on branch `track/<track_id>` (repo: <repo>)."
   - The conductor scaffold stays committed to the **control repo** only — product
     worktrees start clean from each repo's base branch.

11. **Announce Completion:**
    > "New track '<track_id>' has been created and added to the tracks file. Run `/conductor-implement` to start."

---

### 2.5 BEADS INTEGRATION

**PROTOCOL: Sync track with Beads for persistent task memory.**

1. **Check Beads Availability:**
   - Check if `bd` command exists: `which bd`
   - If command not found:
     > "⚠️ Beads CLI (`bd`) is not installed. Beads provides persistent task memory across sessions."
     > "A) Continue without Beads integration"
     > "B) Stop - I'll install Beads first (see: https://github.com/steveyegge/beads)"
     - If user chooses A: Skip remaining Beads steps, continue to completion
     - If user chooses B: HALT and wait for user to install

2. **Create Epic for Track with Full Context:**
   - Map priority: critical=0, high=1, medium=2, low=3
   - Extract technical approach from `spec.md` for design field
   - Extract acceptance criteria from `spec.md`
   - Run:
     ```bash
     bd create "<track_id>: <description>" \
       -t epic -p <priority_number> \
       --design "<technical approach from spec>" \
       --acceptance "<completion criteria from spec>" \
       --assignee "<git-identity>" \
       --json
     ```
   - `<git-identity>` is the value of `git config user.email` (fallback
     `git config user.name`, else null). Compute it once at the start of step 2.4
     (see step 2.4.0) and reuse it for the epic assignee and `metadata.owner`. If
     null, omit `--assignee` rather than passing an empty string.
   - Store returned epic ID (e.g., `bd-a3f8`)

3. **Create Tasks for Each Phase with Context:**
   - Parse `plan.md` for phases and tasks
   - For each phase:
     ```bash
     bd create "<phase_name>" -t milestone --parent <epic_id> --json
     ```
   - For each task in phase:
     ```bash
     bd create "<task_description>" \
       -t story \
       --parent <phase_id> \
       --design "<task technical notes>" \
       --acceptance "<task done criteria>" \
       --json
     ```
4. **Set Up Dependencies:**
   - **Phase-level dependencies (CRITICAL - depends on annotations):**
     - **If phase has NO `<!-- depends: -->` annotation (default):**
       - Add sequential dependency: `bd dep add <phase2_id> <phase1_id>` (depends on previous phase)
     - **If phase has `<!-- depends: -->` (empty):**
       - Do NOT add any phase dependencies (can start immediately, parallel with other phases)
     - **If phase has `<!-- depends: phase1, phase2 -->`:**
       - Add ONLY listed dependencies: `bd dep add <current_phase_id> <phase1_id>`, `bd dep add <current_phase_id> <phase2_id>`
   
   - **Task-level dependencies (CRITICAL - depends on execution mode):**
     - **If phase is `<!-- execution: sequential -->` (or no annotation):**
       - Add sequential dependencies: `bd dep add <task2_id> <task1_id>` for each consecutive task pair
     - **If phase is `<!-- execution: parallel -->`:**
       - Do NOT add automatic sequential dependencies between tasks
       - ONLY add dependencies for tasks with explicit `<!-- depends: taskN -->` annotations
       - Example: Task 3 has `<!-- depends: task1 -->` → `bd dep add <task3_id> <task1_id>`

5. **Update Metadata:**
   - Add to `conductor/tracks/<track_id>/metadata.json`:
     ```json
     {
       "beads_epic": "bd-a3f8",
       "beads_tasks": {
         "phase1": "bd-a3f8.1",
         "phase1_task1": "bd-a3f8.1.1",
         "phase1_task2": "bd-a3f8.1.2",
         "phase2": "bd-a3f8.2",
         "phase2_task1": "bd-a3f8.2.1",
         "phase2_task2": "bd-a3f8.2.2"
       }
     }
     ```
   - **Key naming convention:**
     - Phase keys: `phase{N}` (1-indexed, e.g., `phase1`, `phase2`)
     - Task keys: `phase{N}_task{M}` (both 1-indexed, e.g., `phase1_task1`, `phase2_task3`)
   - Store ALL phase and task IDs returned from `bd create --json` commands
   - **Write with key-scoped `jq`** (e.g. `jq '.beads_epic = $e | .beads_tasks = $t'`),
     never a full-file rewrite — this preserves the `owner`/`reviewer`/`lease`
     fields written in step 2.4.7 and avoids clobbering concurrent sibling writes.

7. **Seed Epic with Init Note:**
   - After creating the epic, run:
     ```bash
     bd note <epic_id> "TRACK INITIALIZED: <track_id>
     SPEC: <one-line summary from spec.md>
     PHASES: <count> phases — <comma-separated phase names>
     BRANCH: track/<track_id>
     WORKTREE: .worktrees/<track_id>
     KEY CONSTRAINTS: <main technical decisions from spec>" --json
     ```
   - **Polyrepo:** replace the `WORKTREE:` line with a `REPOS:` line listing each
     target repo and its worktree (e.g. `REPOS: api=.worktrees/<id>/api, web=.worktrees/<id>/web`).
   - This note seeds the epic with enough context to recover a session after compaction.

8. **Announce:** "Track synced to Beads as epic <epic_id>."

9. **Parallel Execution Notes (if parallel enabled):**
   - For each task in a parallel phase, add file ownership to Beads notes:
     ```bash
     bd note <task_id> "PARALLEL_ENABLED: true
     FILES_OWNED: <comma-separated file list from <!-- files: --> annotation>
     DEPENDS_ON: <task dependencies from <!-- depends: --> annotation>" --json
     ```
     (Polyrepo: also add a `REPO: <repo>` line from the task's `<!-- repo: -->`.)
   - This enables workers to query their exclusive files from Beads

**ERROR HANDLING:** If any `bd` command fails during steps 2-8:
- Announce the specific error
- Ask user:
  > "⚠️ Beads command failed: <error message>"
  > "A) Continue without Beads integration - track files are already created"
  > "B) Retry the failed command"
  > "C) Stop - I'll fix the issue first"
- If A: Skip remaining Beads steps, announce track created without Beads sync
- If B: Retry the failed command
- If C: HALT and wait for user

---

## 3.0 SYNC POSTAMBLE (polyrepo + shared mode only)

If `conductor/config.json` has `sync_mode: "shared"`, publish the control plane
per `references/conductor-sync.md`: `bd dolt push` then
`git push <control_remote> <control_branch>`. In `local` mode (or monorepo),
commits stay local — do not push.
