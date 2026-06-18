---
description: Create a new feature or bug track with spec and plan
---

<!-- 
SYSTEM DIRECTIVE: You are an AI agent for the Cadre framework.
CRITICAL: Validate every tool call. If any fails, halt and announce the failure.
-->

# Cadre New Track

Create a new track from the workflow arguments.

---

## 1.0 SETUP CHECK

**PROTOCOL: Verify Cadre environment is properly set up.**

0. **Resolve project root via MCP:** Call `cadre_project` with `action: "root"` with the workflow
   `root` argument (the current project root or any path inside it). Use the
   returned root for all project-scoped MCP calls in this workflow.

1. **Check Required Files:** Verify existence of:
   - `cadre/product.md`
   - `cadre/tech-stack.md`
   - `cadre/workflow.md`
   - `cadre/beads.json`

2. **Handle Missing Files:**
   - If ANY missing: HALT immediately
   - Announce: "Cadre is not set up. Please run `cadre-setup` first."
   - Do NOT proceed.

3. **Topology check:** Read `cadre/repos.json`. If absent or `mode` ≠
   `"polyrepo"`, this is **monorepo mode** — every step below behaves exactly as
   today; ignore the polyrepo-only notes. If `mode == "polyrepo"`, follow
   `references/polyrepo-git.md` for the per-repo branch/worktree model and the
   repo annotation. Call MCP `cadre_project` with `action: "sync_control_plane"` with `mode: "pre"`
   before mutating state; it no-ops unless `cadre/config.json` has
   `sync_mode: "shared"`.

4. **Load existing track inventory via MCP:** Call `cadre_status` with `action: "team"` with
   `root`. Use the returned `tracks[]` for duplicate-name, dependency-prompt, and
   existing-owner context instead of scanning `tracks.md` for authoritative state.

5. **Beads prerequisite:** Run the standard Beads availability check
   (`references/beads-error-handler.md`). If unavailable, HALT; track creation must
   not proceed without the durable Beads epic/task graph.

---

## 2.0 NEW TRACK INITIALIZATION

### 2.1 Get Track Description and Determine Type

1. **Load Project Context:** Read the minimal project context needed for this
   track: `cadre/product.md`, `cadre/tech-stack.md`, `cadre/workflow.md`, and
   `cadre/patterns.md` if present. Do not read unrelated track histories unless
   the user asks for them.

2. **Get Track Description:**
   - **If workflow arguments are provided:** Use them as the track description
   - **If empty:** Ask:
     > "Please provide a brief description of the track (feature, bug fix, chore, etc.) you wish to start."
     Wait for response.

3. **Parse mode flags:** Support faster creation modes:
   - `--quick`: ask only questions that would materially change scope or risk.
   - `--defaults`: use medium priority, no dependencies, no time estimate, and
     skip optional prompts unless required for correctness.
   - `--from-brief`: treat the workflow arguments as the source brief and avoid
     restating questions that the brief already answers.

4. **Infer Track Type:** Analyze description to classify as "Feature" or
   "Something Else" (Bug, Chore, Refactor). Do NOT ask user to classify.

---

### 2.2 Interactive Specification Generation (`spec.md`)

1. **Announce:**
   > "I'll now guide you through questions to build a comprehensive `spec.md` for this track."

2. **Questioning Phase (batched, 0-5 questions):**

   **Question Classification - CRITICAL:**
   - **1. Classify Question Type:** Before EACH question, classify as:
     - **Additive:** For brainstorming/scope (users, goals, features) - allows multiple answers
     - **Exclusive Choice:** For singular commitments (specific technology, workflow rule) - single answer

   - **2. Formulate Based on Classification:**
     - **If Additive:** Open-ended question + options + "(Select all that apply)"
     - **If Exclusive Choice:** Direct question, do NOT add multi-select

   - **3. Interaction Flow:**
     - Ask a compact batch of the 2-3 highest-value questions when possible.
     - Ask one question at a time only when the previous answer determines the next
       branch.
     - Last option for every choice-style question MUST be "Type your own answer".
     - In `--quick` or `--from-brief` mode, ask zero questions when the brief is
       already specific enough to produce a useful spec.
     - Summarize assumptions once before drafting instead of after every answer.

   **If FEATURE (normally 2-5 questions; fewer in quick/from-brief modes):**
   - Clarifying questions about the feature
   - Implementation approach, interactions, inputs/outputs
   - UI/UX considerations, data involved

   **If SOMETHING ELSE - Bug, Chore, etc. (normally 1-3 questions):**
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
   - Read `cadre/workflow.md`
   - Generate hierarchical Phases, Tasks, Sub-tasks
   - **CRITICAL:** Plan structure MUST adhere to workflow methodology (e.g., TDD tasks)
   - Include `[ ]` status markers for each task/sub-task

   **CRITICAL: Emit a `<!-- files: ... -->` annotation for EVERY task.**
   The files annotation is a **first-class plan artifact**, not a parallel-only
   one — emit it for each task in **every** phase regardless of execution mode.
   For each task, list the files it is expected to create or modify:
   ```markdown
   - [ ] Task 1: Implement JWT validation
     <!-- files: src/auth/jwt.ts, src/auth/jwt.test.ts -->
   ```
   This drives downstream cross-track collision and cross-owner overlap checks
   (`cadre-implement`, `cadre-validate`). If a task's files are genuinely
   unknowable up front, emit a best-effort list and refine it during
   implementation rather than omitting the annotation. The parallel-execution
   step below (step 3.d) reuses these same annotations — it adds `execution:` /
   `depends:` metadata but does NOT re-introduce `files:` (they already exist).

   **CRITICAL: Inject Phase Completion Tasks**
   - Check if `cadre/workflow.md` defines "Phase Completion Verification and Checkpointing Protocol"
   - If YES, for EACH Phase, append final meta-task:
     ```
     - [ ] Task: Cadre - User Manual Verification '<Phase Name>' (Protocol in workflow.md)
     ```
   - Replace `<Phase Name>` with actual phase name

3. **Analyze for Parallel Execution Potential:**

   **Packet-first planning check:** before doing manual analysis, call
   `cadre_track` with `action: "plan_assist"` using the draft `planText` (and
   `trackId` when files already exist), then call `cadre_intel` with
   `action: "test_impact"` and `action: "dependency_graph"` for detected tests,
   manifests, and build graph hints. Use those packet results as the primary
   source for file claims, likely tests, phase dependencies, and parallel
   candidates. Manual analysis below is only for gaps or user-facing
   explanation.
   
   a. **Identify Parallelizable Tasks (within phases):**
      - For each phase, analyze tasks for:
        - File ownership conflicts (do any two tasks modify the same files?)
        - Logical dependencies (does task B need output from task A?)
        - Independent work (can tasks run without coordination?)
   
   b. **Identify Parallelizable Phases:**
      - Analyze phases for:
        - Cross-phase dependencies (does Phase B need Phase A's output?)
        - File ownership conflicts between phases (do ready phases claim the same repo+file?)
        - Independent scopes (can Phase 1 and Phase 2 run without coordination?)
      - Phase-level parallelism is executed only through the concrete scheduler:
        `cadre_track` with `action: "phase_schedule"` computes ready groups and splits conflicting phases.

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
      > - Phase 1 and Phase 2 have no cross-phase dependency and no file overlap → same ready group
      > - Phase 3 depends on Phase 1 and Phase 2 → waits for both
      >
      > "Would you like to enable parallel execution? (yes/no)"
   
   d. **If User Confirms Parallel:**
      - **For task-level parallelism:**
        - Add `<!-- execution: parallel -->` annotation after eligible phase headings
        - Ensure each task carries its `<!-- files: path1, path2 -->` ownership
          annotation (already emitted in step 2 for every task — verify it is
          present and accurate for the parallel tasks; do not duplicate it)
        - Add `<!-- depends: taskN -->` annotation where task dependencies exist within phase

      - **For phase-level parallelism:**
        - Add `<!-- depends: -->` (empty) to phases that can start immediately.
        - Add `<!-- depends: phase1, phase2 -->` to phases that depend on specific
          phases.
        - Leave the annotation absent for the default sequential rule (a phase
          depends on the previous phase).
        - Do not rely on prose alone: `cadre-implement` will call
          `cadre_track` with `action: "phase_schedule"` to compute the actual ready groups and file-conflict
          splits.
      
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
        <!-- files: src/app.tsx -->
      ```
      (Every task carries a `<!-- files: -->` annotation — including
      sequential-phase tasks — per the first-class rule in step 2.)
   
   e. **If User Declines Parallel:**
      - Keep all phases as default sequential (no `execution:`/`depends:`
        annotations needed). The per-task `<!-- files: -->` annotations from step 2
        STAY — they are first-class and required regardless of execution mode.
      - Announce: "All phases and tasks will execute sequentially."

3.1. **Semantic impact check (when existing code is touched):**
   - If the drafted plan names existing files, public symbols, APIs, routes, or
     modules, call MCP `cadre_intel` with `action: "lsp_impact"` with `root`, the relevant `files[]` and/or
     `symbols[]`, and a small `limit`. Use its references/file-symbol output to
     refine `<!-- files: -->` ownership, identify likely tests/callers, and warn
     about hidden integration work before the user confirms the plan. If LSP is not
     configured, the tool still returns low-token repo-map references; do not block
     track creation solely because code intelligence is unavailable.

3.5. **Annotate Target Repos (POLYREPO ONLY — skip in monorepo mode):**
   - For each task, decide which product repo it touches and append a
     `<!-- repo: <name> -->` annotation (parallel to `<!-- files: -->`). The name
     MUST match a `repos[].name` in `cadre/repos.json`.
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
     `metadata.json` `merge_order` in step 2.4.7 and consumed by `cadre-land`
     and the merge-train CI. If absent, repos merge in alphabetical order. Only the
     repos you name need appear; any omitted repos merge after, alphabetically.

3.6. **Cross-Track File-Collision Advisory (advisory only — never blocks):**
   Now that every task carries a `<!-- files: -->` annotation (and, in polyrepo, a
   `<!-- repo: -->` annotation), warn if this new track's claimed files overlap
   another **active** track's claimed files.
   - **Use MCP for the existing-fleet side:** call `cadre_status` with `action: "collisions"` with
     `root` and use its returned active-track claims/collisions as the canonical
     view of current cross-track overlap. For the new, not-yet-written draft plan,
     parse the draft in memory using the same `<!-- repo: -->` / `<!-- files: -->`
     contract before comparing it against the MCP result.
   - **Collect this track's claims:** the set of `(repo, file)` tuples across all
     tasks in the drafted `plan.md`. In **monorepo** mode there is one logical
     repo, so the tuple's repo component is the control repo (effectively compare
     bare `file` paths). In **polyrepo** mode resolve each task's repo from its
     `<!-- repo: -->` annotation (defaulting to `default_repo`) and compare the
     **`(repo, file)` tuple**, not the bare path — the same relative path in two
     different repos is **not** a collision.
   - **Collect every other planned/active track's claims:** an included track is any
     `cadre/tracks/*/metadata.json` whose `status` is not `completed`, `archived`,
     or `skipped` (i.e. `new`, `in_progress`, or `blocked`). Parse the `files:`
     (and polyrepo `repo:`) annotations from each such track's `plan.md`.
   - **Report overlaps:** if any `(repo, file)` tuple is claimed by both this track
     and another planned/active track, warn (do NOT halt):
     > "⚠️ File overlap: `<repo>/<file>` is also claimed by planned/active track
     > `<other_track_id>` (owner: `<owner>`). Two tracks editing the same file may
     > conflict at ship/land. Consider narrowing scope or coordinating."
     List one line per overlapping tuple (naming the other track and its `owner`,
     falling back to its Beads `assignee`). This mirrors `cadre-validate`'s
     cross-owner file-overlap check, surfaced early at creation time.
   - **Degrade silently:** if another track's `plan.md` is missing or unparseable,
     skip it without error. This advisory never blocks track creation.
   - After the track artifacts are written, call MCP `cadre_track` with `action: "integrity"` with
     `root` and the new `trackId`. Treat errors as plan-generation defects to fix
     before committing; surface warnings for user awareness.

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
   Hold this value for the rest of the workflow — it populates `metadata.owner`,
   the Beads epic `--assignee`, and (shared mode only) `metadata.lease.owner`.
   If null, silently proceed with `owner: null` and omit the Beads `--assignee`.

1. **Check for Duplicate Track Name:**
   - List existing directories in `cadre/tracks/`
   - Extract short names from track IDs (`shortname_YYYYMMDD` → `shortname`)
   - If proposed short name matches existing:
     - Present the existing matching track IDs and their statuses.
     - Ask the user to choose exactly one path:
       - Resume/use the existing track, then stop this creation workflow.
       - Rename the new track's short name, then continue with the renamed value.
       - Create a separate same-shortname track, then continue and require the
         collision-proof suffix below.
       - Stop without creating anything.
     - If the user has passed `--quick`, `--defaults`, or `--from-brief` and the
       brief clearly requests a separate follow-up track, choose the
       same-shortname suffixed path without prompting and note the decision.

2. **Generate Track ID:** Create base ID: `shortname_YYYYMMDD`.
   - **Collision-proof suffix:** if a directory `cadre/tracks/<shortname_YYYYMMDD>`
     already exists (e.g. a same-day re-creation that slipped past the name check),
     append `-<2-char base36>` as the **last path segment** — e.g.
     `auth_20260615` → `auth_20260615-b`. The suffix comes *after* the date and is
     `-`-separated, so the `shortname_YYYYMMDD` parse still works. Pick the random
     2-char base36 value, retry if that directory also exists. **Never** derive the
     ID from the Beads epic ID.
   - **Shared mode (`config.json` `sync_mode: "shared"`):** if the publish step in
     §3.0 is later rejected because another machine already pushed this exact
     `track_id` (a push / `bd dolt push` conflict), re-suffix the track — rename the
     track DIRECTORY, the `metadata.json` `track_id` (key-scoped `jq`), the
     `track/<track_id>` branch(es), and the Beads epic title + `cadre-track:<id>`
     label — then call MCP `cadre_mutate` with `action: "regen_index"` and
     re-publish. The detailed rejection-recovery branch lives in
     `references/cadre-sync.md` (owned by the sync master); this workflow only
     needs to honor the re-suffix.

3. **Ask for Priority:**
   - If `--defaults` is present, set `"medium"` without prompting.
   - Otherwise ask:
     > "What priority should this track have?"
     > A) 🔴 Critical - Blocking other work
     > B) 🟠 High - Important, do soon
     > C) 🟡 Medium - Normal priority (default)
     > D) 🟢 Low - Nice to have

   Default to "medium" if skipped.

4. **Ask for Dependencies (Optional):**
   - If `--defaults` is present, set `depends_on: []` without prompting.
   - Otherwise ask:
     > "Does this track depend on any other tracks being completed first?"
   - If yes: List incomplete tracks from the `cadre_status` with `action: "team"` result, let user select
   - Store selected track_ids in `depends_on` array
   - Default to empty array if skipped or no incomplete tracks

5. **Ask for Time Estimate (Optional):**
   - If `--defaults` is present, set `estimated_hours: null` without prompting.
   - Otherwise ask:
     > "Estimated hours to complete? (Enter number or skip)"
   - Store in `estimated_hours` or null if skipped

6. **Build metadata draft (do not write yet):** prepare the object that will become
   `cadre/tracks/<track_id>/metadata.json`, but keep it in memory until the Beads
   dry-run below succeeds.
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

   **SHARED MODE ONLY (`cadre/config.json` `sync_mode: "shared"`):** also add a
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
   (here or in sibling workflows), use key-scoped `jq` (e.g.
   `jq '.review = $obj'`), never a full-file rewrite, so concurrent writes from
   sibling workflows don't clobber each other.

   **POLYREPO ONLY:** also add a `repos` map — one entry per target repo from the
   union computed in step 3.5. Keep the flat `git_branch`/`worktree_path` fields
   for compatibility (they point at the control repo's branch). Resolve each
   repo's `submodule_path`/`default_branch` from `cadre/repos.json`. **Always
   include `submodule_path`** — `cadre-land` and the merge-train CI read it to
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

7. **Beads dry-run before any track files are written:**
   - Call MCP `cadre_track` with `action: "create_beads_tree"` with `dryRun: true`, `trackId`,
     `planText`, `specText`, and the metadata draft from step 6.
   - Require `ok: true`. If it fails, HALT before creating
     `cadre/tracks/<track_id>/`, before regenerating `tracks.md`, before committing,
     and before creating any worktree.
   - Review the returned epic/task/dependency plan and `metadata_patch` shape. Repair
     the plan/spec draft and retry the dry-run until the Beads tree is correct.

8. **Write scaffold files:**
   - Create directory: `cadre/tracks/<track_id>/`
   - Write `cadre/tracks/<track_id>/metadata.json` from the step 6 draft.
   - `cadre/tracks/<track_id>/spec.md`
   - `cadre/tracks/<track_id>/plan.md`

8a. **Create live Beads metadata before index/commit/worktree:**
   - Immediately after the scaffold files exist, call MCP
     `cadre_track` with `action: "create_beads_tree"` again without `dryRun`.
   - Require `ok: true`; this creates/repairs the deterministic Beads epic/tree and
     patches `metadata.json` with `beads_epic` and `beads_tasks` using the
     key-scoped CAS helper.
   - If it fails, do not regenerate `tracks.md`, commit, or create worktrees. Repair
     the cause and retry the live call; if abandoning the track, remove the
     uncommitted `cadre/tracks/<track_id>/` scaffold so no file-only partial track is
     stranded.

9. **Initialize Learnings File (Ralph-style progress tracking):**
   
   a. **Read Project Patterns:** If `cadre/patterns.md` exists:
      - Read and display: "📚 **Codebase Patterns:** Found X patterns from previous tracks"
      - These patterns will guide implementation
   
   b. **Check for Similar Archived Tracks:**
      - Scan `cadre/archive/` for tracks with similar names/descriptions
      - If found, ask:
        > "Found similar archived track(s): `<track_ids>`"
        > "Would you like to seed learnings from a previous track? (Enter track_id or 'skip')"
      - If selected: Copy relevant patterns from archived track's `learnings.md`
   
   c. **Create `learnings.md` from template:**
      - Resolve `<TEMPLATES_DIR>` as described in `references/template-locator.md`.
      - Copy `<TEMPLATES_DIR>/learnings.md` to
        `cadre/tracks/<track_id>/learnings.md`, replacing every `{{track_id}}`
        with the real track id.
      - Under the `## Codebase Patterns (Inherited)` heading, insert the patterns
        gathered above (from `cadre/patterns.md` or archived tracks).
      - If `<TEMPLATES_DIR>` can't be found, fall back to creating the file with
        this minimal structure:
        ```markdown
        # Track Learnings: <track_id>

        Patterns, gotchas, and context discovered during implementation.

        ## Codebase Patterns (Inherited)

        <patterns from cadre/patterns.md or archived tracks>

        ---

        <!-- Learnings from implementation will be appended below -->
        ```

10. **Regenerate Tracks Index:**
   - Announce: "Updating the tracks file."
   - `cadre/tracks.md` is a DERIVED INDEX, never hand-edited. The new track's
     `metadata.json` already carries `"status": "new"` (step 8), which is the
     single source of truth. Do NOT append a `## [ ] Track:` block in place.
   - Instead, call `cadre_mutate` with `action: "regen_index"` with `root`. Require `ok: true`; on failure,
     halt and surface the MCP error. The new track (marker `[ ]` from status `new`)
     appears in the regenerated region automatically. Do not inline the algorithm.

10a. **Scaffold Commit + Create Worktree:**
   - Stage and commit all cadre files to the **control repo** (main):
     ```bash
     git add cadre/tracks/<track_id>/
     git add cadre/tracks.md
     git commit -m "cadre(newtrack): scaffold <track_id>"
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
   - The cadre scaffold stays committed to the **control repo** only — product
     worktrees start clean from each repo's base branch.

11. **Announce Completion:**
    > "New track '<track_id>' has been created and added to the tracks file. Run `cadre-implement` to start."

---

### 2.5 BEADS INTEGRATION

**PROTOCOL: Sync track with Beads for persistent task memory.**

**Preferred MCP path:** the dry-run belongs before project mutation in step 7
(`cadre_track` with `action: "create_beads_tree"` with `dryRun: true`, draft `planText`, `specText`,
and metadata). The live call belongs immediately after scaffold files exist in
step 8a, before index regeneration, commit, or worktree creation. The live call
creates the deterministic epic, phases, tasks, dependencies, design/acceptance
context, initialization notes, parallel file-ownership notes, and the
`metadata.json` `beads_epic` / `beads_tasks` CAS patch in one recoverable unit.
Workers rely on this Beads context during parallel and phase-level execution, so
repair MCP errors instead of recreating a partial context-less tree by hand. If
the live call returns `ok: true`, skip the raw `bd create` / `bd dep add`
sequence below and continue to publish. If it returns an actionable error, repair
that error; do not silently create a file-only track.

1. **Check Beads Availability:**
   - Check if `bd` command exists: `which bd`
   - If command not found:
     > "⚠️ Beads CLI (`bd`) is not installed. Beads provides persistent task memory across sessions."
     > "Install Beads, then re-run this workflow."
     - HALT. Cadre tracks require Beads; do not create a file-only track.

2. **Create Epic for Track with Full Context (idempotent):**
   - Map priority: critical=0, high=1, medium=2, low=3
   - Extract technical approach from `spec.md` for design field
   - Extract acceptance criteria from `spec.md`
   - **Use a deterministic epic id** `cadre-<track_id>` so a retry after a
     half-completed create + metadata write never strands or duplicates the epic:
     ```bash
     bd create "<track_id>: <description>" \
       --id cadre-<track_id> \
       -t epic -p <priority_number> \
       --design "<technical approach from spec>" \
       --acceptance "<completion criteria from spec>" \
       --assignee "<git-identity>" \
       --json
     ```
   - **"Already exists" is success, not failure.** If `bd create --id` reports the
     id already exists (a prior run created the epic but crashed before writing
     `metadata.beads_epic`, or this is an outright retry), treat it as a no-op
     success: do NOT route it through the ERROR HANDLING block below, do NOT
     re-create under a new id. Continue with epic id `cadre-<track_id>`.
   - **Only the EPIC is idempotent — the children are NOT.** The phase/task
     `bd create` calls in step 3 carry **no** `--id` (they get Beads hash ids), so
     blindly re-running step 3 on an already-existing epic creates **duplicate**
     phase/task issues under it. On an "already exists" epic, first check whether
     children already exist
     (`bd ready --parent cadre-<track_id> --json` / `bd list --parent cadre-<track_id> --json`):
     if they do, **SKIP step 3** and only (re)write `metadata` (step 5) from the
     existing tree. Re-running `bd note` (step 7) merely appends a duplicate note and
     is harmless.
   - `<git-identity>` is the value of `git config user.email` (fallback
     `git config user.name`, else null). Compute it once at the start of step 2.4
     (see step 2.4.0) and reuse it for the epic assignee and `metadata.owner`. If
     null, omit `--assignee` rather than passing an empty string.
   - Store the epic ID `cadre-<track_id>` for the steps below (and write it to
     `metadata.beads_epic` in step 5).

3. **Create Tasks for Each Phase with Context:**
   - Parse `plan.md` for phases and tasks with `cadre_track` with `action: "parse_plan"`:
     ```json
     { "root": "/absolute/path/to/project", "planPath": "cadre/tracks/<track_id>/plan.md" }
     ```
     Use the returned phases/tasks/annotations as the authoritative structure for
     Beads task creation.
   - For each phase:
     ```bash
     bd create "<phase_name>" -t task --parent <epic_id> --labels cadre:phase --json
     ```
   - For each task in phase:
     ```bash
     bd create "<task_description>" \
       -t task \
       --parent <phase_id> \
       --labels cadre:task \
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
   - Add to `cadre/tracks/<track_id>/metadata.json` (`beads_epic` is the
     deterministic id `cadre-<track_id>` from step 2; task/phase ids are whatever
     `bd create --json` returned):
     ```json
     {
       "beads_epic": "cadre-<track_id>",
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
- Follow `references/beads-error-handler.md`: retry once or halt. Do not leave a
  new track without its Beads epic/tasks.

---

## 3.0 SYNC POSTAMBLE (shared mode only)

After committing the new track control-plane files, call MCP
`cadre_project` with `action: "sync_control_plane"` with `mode: "post"`. It publishes only when
`sync_mode == "shared"` and no-ops in local mode. Product-repo CODE is still never
auto-pushed regardless of topology; only the control plane is published here.
