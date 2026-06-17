---
description: Initialize project with Cadre context-driven development
---

<!-- 
SYSTEM DIRECTIVE: You are an AI agent. Follow these instructions precisely.
CRITICAL: Validate every tool call. If any fails, halt and announce the failure.
-->

# Cadre Setup

Initialize this project with context-driven development. Follow this workflow precisely and sequentially.

---

## 1.0 RESUME CHECK

**PROTOCOL: Before starting setup, determine the project's state using the state file.**

1. **Read State File:** Check for `cadre/setup_state.json`
   - If it does NOT exist, this is a new project. Proceed to Section 1.1.
   - If it exists, read its content.

2. **Resume Based on State:** Let `last_successful_step` be `STEP`. Also read the
   optional `topology` key (`"monorepo"` | `"polyrepo"`); it is set at Section 2.0a
   and governs whether polyrepo-only steps run on resume.
   - If `STEP` is `"2.0a_topology"`:
     - If `topology` is `"polyrepo"`: Announce "Resuming: Topology selected (polyrepo). Next: Submodule registration." → Proceed to **Section 2.0b**
     - Else: Announce "Resuming: Topology selected. Next: Product Guide." → Proceed to **Section 2.1**
   - If `STEP` is `"2.0b_repos_manifest"`: Announce "Resuming: Submodules registered. Next: Product Guide." → Proceed to **Section 2.1**
   - If `STEP` is `"2.1_product_guide"`: Announce "Resuming: Product Guide complete. Next: Product Guidelines." → Proceed to **Section 2.2**
   - If `STEP` is `"2.2_product_guidelines"`: Announce "Resuming: Guidelines complete. Next: Tech Stack." → Proceed to **Section 2.3**
   - If `STEP` is `"2.3_tech_stack"`: Announce "Resuming: Tech Stack complete. Next: Code Styleguides." → Proceed to **Section 2.4**
   - If `STEP` is `"2.4_code_styleguides"`: Announce "Resuming: Styleguides complete. Next: Workflow." → Proceed to **Section 2.5**
   - If `STEP` is `"2.5_workflow"`: Announce "Resuming: Scaffolding complete. Next: Beads Integration." → Proceed to **Section 2.7**
   - If `STEP` is `"2.7_beads_monorepo"`: Announce "Resuming: Beads complete. Next: Sync Mode." → Proceed to **Section 2.7a**
   - If `STEP` is `"2.7a_sync_mode_mono"`: Announce "Resuming: Sync mode configured. Next: Finalize." → Proceed to **Section 2.8**
   - If `STEP` is `"2.7_beads_polyrepo"`: Announce "Resuming: Beads complete. Next: Sync Mode & PR Provider." → Proceed to **Section 2.7b**
   - If `STEP` is `"2.7b_sync_mode"`: Announce "Resuming: Sync mode configured. Next: Finalize." → Proceed to **Section 2.8**
   - If `STEP` is `"complete"`:
     - Announce: "Project already initialized. Use `/cadre-newtrack` or `/cadre-implement`."
     - **HALT** the setup process.
   - If `STEP` is unrecognized: Announce error and halt.

---

## 1.1 PRE-INITIALIZATION OVERVIEW

Present to user:
> "Welcome to Cadre. I will guide you through:
> 1. **Project Discovery:** Analyze if this is new or existing project
> 2. **Product Definition:** Define vision, guidelines, and tech stack
> 3. **Configuration:** Select code style guides and workflow
> 4. **Beads Integration:** Set up persistent task memory
>
> Let's get started!"

---

## 2.0 PHASE 1: PROJECT SETUP

### 2.0 Project Inception - Brownfield/Greenfield Detection

1. **Classify Project Maturity:**

   **Brownfield Indicators (ANY match = Brownfield):**
   - Version control: `.git`, `.svn`, `.hg` directories exist
   - Dirty git repo: `git status --porcelain` returns non-empty output
   - Dependency manifests: `package.json`, `pom.xml`, `requirements.txt`, `go.mod`, `Cargo.toml`
   - Source directories: `src/`, `app/`, `lib/` containing code files

   **Greenfield Condition:**
   - NONE of above indicators found
   - Directory is empty or contains only generic docs (e.g., single `README.md`)

2. **Execute Based on Maturity:**

   **IF BROWNFIELD:**
   - Announce: "Existing project detected."
   - If uncommitted changes detected: "WARNING: You have uncommitted changes. Please commit or stash before proceeding."
   - **Request Permission:**
     > "I've detected an existing project. May I perform a read-only scan to analyze it?"
     > A) Yes
     > B) No
     >
     > Please respond with A or B.
   - If denied, halt and await instructions.
   - **Code Analysis:** *(These probes are read-only and independent, so they may be
     fanned out in parallel — e.g. one tool call per artifact — rather than run
     strictly serially; collect the results before drafting.)*
     - Respect `.gitignore` and any agent ignore patterns (e.g. `.aiexclude`)
     - Analyze README.md, package.json, directory structure
     - Extract: Programming Language, Frameworks, Database Drivers
     - Infer: Architecture type (Monorepo, Microservices, MVC)
     - Summarize project goal from README header or package description
   - Proceed to **Section 2.0a**

   **IF GREENFIELD:**
   - Announce: "New project will be initialized."
   - Initialize git if `.git` doesn't exist: `git init`
   - **Ask:** "What do you want to build?"
   - **CRITICAL:** Wait for user response before any tool calls.
   - Upon response:
     - Execute: `mkdir -p cadre`
     - Create `cadre/setup_state.json`: `{"last_successful_step": ""}`
     - Write response to `cadre/product.md` under `# Initial Concept`
   - Proceed to **Section 2.0a**

---

### 2.0a Topology Selection (Interactive)

**PROTOCOL: Choose whether this project is a single repository (monorepo) or a
multi-repo control plane (polyrepo). This decides whether polyrepo-only steps run.**

1. **Ask:**
   > "How is this project's code organized?"
   > A) **Single repository (monorepo)** — all code lives in this one repo *(default; behaves exactly as today)*
   > B) **Polyrepo / control repo** — this repo orchestrates work across several product repos (git submodules)
   >
   > Please respond with A or B.

2. **Persist the choice** in `cadre/setup_state.json` (merge, don't overwrite
   other keys). First ensure the dir/state file exist (brownfield may not have
   created them yet): `mkdir -p cadre` and, if `setup_state.json` is absent,
   initialize it as `{"last_successful_step": ""}`. Then:
   - For A: set `"topology": "monorepo"`.
   - For B: set `"topology": "polyrepo"`.
   - Set `"last_successful_step": "2.0a_topology"`.

3. **Branch:**
   - **If A (monorepo):** Announce "Single-repo project — polyrepo steps skipped."
     → Proceed to **Section 2.1**. *(No `repos.json` is written, and the
     submodule/PR-provider/merge-train steps are skipped. A monorepo still gets a
     sync-mode prompt + `config.json` at **Section 2.7a** so a shared-mode team can
     share tracks/Beads/leases — sync is topology-independent, not polyrepo-only.)*
   - **If B (polyrepo):** → Proceed to **Section 2.0b**.

---

### 2.0b Submodule Registration & Manifest (Polyrepo only)

**PROTOCOL: Register the product repos as submodules and write the manifest. Run
only when `topology == "polyrepo"`. See `references/polyrepo-git.md` for the model.**

1. **Discover existing submodules:**
   - Read `.gitmodules` if present and run `git submodule status`.
   - List any submodules found (name, path, URL).

2. **Offer to add repos (gated):**
   - **Ask:** "Which product repos should this control plane manage? For each, give
     a short name and clone URL (or confirm the ones already detected)."
   - For each new repo the user supplies, with explicit confirmation, run:
     ```bash
     git submodule add <url> repos/<name>
     ```
   - If the user declines to add submodules now, proceed with whatever is already
     registered (they can add more later via `/cadre-refresh`).

3. **Pick the default repo:**
   - **Ask:** "Which repo is the `default_repo` (tasks with no `<!-- repo: -->`
     annotation route here)?" — list the registered repos as options.

4. **Write `cadre/repos.json`:** Resolve `<TEMPLATES_DIR>` per
   `references/template-locator.md`, copy `<TEMPLATES_DIR>/repos.json` to
   `cadre/repos.json`, then fill it from `.gitmodules` + the answers:
   - `mode`: `"polyrepo"`
   - `control_repo.name`: this repo's name; `control_repo.path`: `"."`
   - `default_repo`: the chosen default
   - `repos[]`: one entry per submodule (`name`, `submodule_path`, `url`,
     `default_branch` (probe with `git -C repos/<name> symbolic-ref --short HEAD`
     or default `main`), `enabled: true`).
   - `.gitmodules` stays authoritative for path+URL; `repos.json` layers Cadre
     metadata on top.

5. **Commit State** (merge keys):
   ```json
   {"last_successful_step": "2.0b_repos_manifest", "topology": "polyrepo"}
   ```

6. **Continue:** Proceed to **Section 2.1**.

---

### 2.1 Generate Product Guide (Interactive)

1. **Announce:** "Now let's create `product.md`."

2. **Ask Questions Sequentially (max 5):**
   - **Question Classification:** Before each question, classify as:
     - **Additive:** For brainstorming (users, goals, features) - add "(Select all that apply)"
     - **Exclusive Choice:** For singular decisions - do NOT add multi-select
   - **Format:** Vertical list with options:
     ```
     A) [Option A]
     B) [Option B]
     C) [Option C]
     D) Type your own answer
     E) Autogenerate and review product.md
     ```
   - For Brownfield: Ask context-aware questions based on code analysis
   - **AUTO-GENERATE:** If user selects E, stop questions and generate based on context

3. **Draft Document:** Generate `product.md` using ONLY user's selected answers. Ignore unselected options.

4. **User Confirmation Loop:**
   > "I've drafted the product guide. Please review:"
   > ```markdown
   > [Drafted content]
   > ```
   > A) **Approve** - Proceed
   > B) **Suggest Changes** - Tell me what to modify
   - Loop until approved.

5. **Write File:** Append to `cadre/product.md`, preserving `# Initial Concept`.

6. **Commit State:** Write `cadre/setup_state.json`:
   ```json
   {"last_successful_step": "2.1_product_guide"}
   ```

7. **Continue:** Proceed to Section 2.2.

---

### 2.2 Generate Product Guidelines (Interactive)

1. **Announce:** "Now let's create `product-guidelines.md`."

2. **Ask Questions Sequentially (max 5):**
   - Topics: Prose style, brand messaging, visual identity
   - Same A/B/C/D/E format as Section 2.1
   - For each option, provide brief rationale and highlight recommendation

3. **Draft Document:** Generate using ONLY user's selected answers.

4. **User Confirmation Loop:** Same as Section 2.1.

5. **Write File:** Write to `cadre/product-guidelines.md`.

6. **Commit State:**
   ```json
   {"last_successful_step": "2.2_product_guidelines"}
   ```

7. **Continue:** Proceed to Section 2.3.

---

### 2.3 Generate Tech Stack (Interactive)

1. **Announce:** "Now let's define the technology stack."

2. **Ask Questions Sequentially (max 5):**
   - Topics: Programming languages, frameworks, databases, tools
   - Same A/B/C/D/E format

   **FOR BROWNFIELD:**
   - **CRITICAL:** Document EXISTING stack, don't propose changes
   - State inferred stack and ask:
     > A) Yes, this is correct
     > B) No, I need to provide the correct tech stack

3. **Draft Document:** Generate using ONLY user's selected answers.

4. **User Confirmation Loop:** Same as Section 2.1.

5. **Write File:** Write to `cadre/tech-stack.md`.

6. **Commit State:**
   ```json
   {"last_successful_step": "2.3_tech_stack"}
   ```

7. **Continue:** Proceed to Section 2.4.

---

### 2.4 Select Code Styleguides (Interactive)

0. **Locate Bundled Templates:** Resolve `<TEMPLATES_DIR>` as described in
   `references/template-locator.md`. This directory holds `workflow.md`,
   `patterns.md`, `learnings.md`, `beads.json`, and `code_styleguides/`, and is
   reused throughout setup.

1. **List Available Guides:** List the files in `<TEMPLATES_DIR>/code_styleguides/`.

2. **For Greenfield:**
   - Recommend guides based on tech stack with explanation
   - Ask:
     > A) Include recommended style guides
     > B) Edit the selected set

3. **For Brownfield:**
   - Announce inferred guides based on tech stack
   - Ask:
     > A) Yes, proceed with suggested guides
     > B) No, I want to add more guides

4. **Copy Files:** `mkdir -p cadre/code_styleguides && cp <TEMPLATES_DIR>/code_styleguides/[selected].md cadre/code_styleguides/`

5. **Commit State:**
   ```json
   {"last_successful_step": "2.4_code_styleguides"}
   ```

---

### 2.5 Select Workflow (Interactive)

1. **Copy Initial Workflow:** Copy `<TEMPLATES_DIR>/workflow.md` (resolved in 2.4) to `cadre/workflow.md`

2. **Ask:**
   > "Use default workflow or customize?"
   > Default includes: 80% test coverage, commit after each task, Git Notes for summaries
   > A) Default
   > B) Customize

3. **If Customize:**
   - **Q1:** "Default coverage is >80%. Change it?"
     - A) No (Keep 80%)
     - B) Yes (Enter new percentage)
   - **Q2:** "Commit after each task or each phase?"
     - A) After each task (Recommended)
     - B) After each phase
   - **Q3:** "Use git notes or commit message for task summary?"
     - A) Git Notes (Recommended)
     - B) Commit Message
   - Update `cadre/workflow.md` based on responses

4. **Create Project Patterns File:** Copy `<TEMPLATES_DIR>/patterns.md` (resolved
   in 2.4) to `cadre/patterns.md`. This is the project's institutional
   knowledge file; tracks read it before starting and append to it on completion.

5. **Seed the Tracks Index:** Create `cadre/tracks.md` as a **derived index**
   (a cache regenerated from each track's `metadata.json` `status` — never
   hand-edit the markers). Write a short human preamble followed by an empty
   generated region:
   ```markdown
   # Tracks

   Master track list. Status markers: `[ ]` new · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` skipped.
   This list is regenerated by `/cadre-status --regen-index`; edit `metadata.json`, not the markers below.

   <!-- cadre:index:start -->
   <!-- cadre:index:end -->
   ```
   The first track created (below / via `/cadre-newtrack`) is spliced into
   this region automatically.

6. **Commit State:**
   ```json
   {"last_successful_step": "2.5_workflow"}
   ```

---

### 2.6 Finalization

1. **Summarize:** List all files created/copied.
2. **Transition:** Announce proceeding to Beads Integration.

---

### 2.7 BEADS INTEGRATION

**PROTOCOL: Set up Beads integration for persistent task memory.**

1. **Check for Beads CLI:**
   - Run `which bd` to detect if Beads is installed
   - **If NOT found:**
     > "⚠️ Beads CLI (`bd`) is not installed. Beads provides persistent task memory across sessions."
     > "A) Continue without Beads integration"
     > "B) Stop - I'll install Beads first"
     - If A: Set `beads_available = false`, then go to the sync-mode step so a
       team can still share `cadre/` tracks without Beads — **Section 2.7a** if
       `topology == "monorepo"`, **Section 2.7b** if `topology == "polyrepo"`.
     - If B: HALT and wait for user

2. **If Beads Available, Ask User:**
   > "Beads detected. Choose integration mode for persistent task memory:"
   > A) Full integration (commits .beads/ to repo)
   > B) Stealth mode - Local only (use `bd init --stealth`)
   >
   > Please respond with A or B.

3. **Initialize Beads:**
   - Run `bd init` (for A) or `bd init --stealth` (for B)
   - **If command fails:**
     > "⚠️ Beads command failed: <error message>"
     > "A) Continue without Beads integration"
     > "B) Retry the failed command"
     > "C) Stop - I'll fix the issue first"
     - If A: Set `beads_available = false`, then go to the sync-mode step (so a
       team can still share `cadre/` tracks without Beads) — **Section 2.7a** if
       `topology == "monorepo"`, **Section 2.7b** if `topology == "polyrepo"`.
     - If B: Retry the command
     - If C: HALT and wait for user
   - Create `cadre/beads.json` from the template: copy
     `<TEMPLATES_DIR>/beads.json` (resolved in 2.4) to `cadre/beads.json`,
     then set `"mode"` to `"stealth"` if the user chose stealth (B); leave it
     `"normal"` for full integration (A). **Copy the template verbatim** — it is the
     canonical schema; do not hand-write the keys here (an inline copy would silently
     drift from `templates/beads.json`). The only field you change after copying is
     `"mode"`.
   - Announce: "Beads integration enabled in [normal/stealth] mode."
   - **Polyrepo note (`topology == "polyrepo"`):** run `bd init` at the **control
     repo root** only (this step is already correct). Submodules get **no** own
     `.beads/` — every member-repo task lives in the control plane's single shared
     Dolt graph. Do not initialize Beads inside any `repos/<name>` submodule.

3a. **Configure `.gitattributes` for Beads (Full Integration only):**
   - **If mode A (full integration):**
     - Check if `.gitattributes` exists in project root
     - If `.beads/** merge=ours` is already present: skip
     - Otherwise append:
       ```
       # Beads Dolt DB — keep main's version on merge; Dolt manages its own history
       .beads/** merge=ours
       ```
     - `git add .gitattributes`
     - **Register the `ours` merge driver (CRITICAL) — runs for ALL full-Beads
       projects (monorepo + polyrepo, local + shared), wherever
       `.beads/** merge=ours` is written:** an unregistered `ours` driver makes git
       fall back to its default text merge, which injects conflict markers into the
       Dolt DB files. Check and register right here:
       ```bash
       git config merge.ours.driver >/dev/null 2>&1 || git config merge.ours.driver true
       ```
     - Announce: "Configured `.gitattributes`: `.beads/` conflicts auto-resolve on PR merge"
   - **If mode B (stealth):** Skip — `.beads/` is not tracked in git.

4. **Commit State** (topology-aware — see Section 1.0 resume map):
   - **If `topology == "polyrepo"`:** write
     `{"last_successful_step": "2.7_beads_polyrepo", "topology": "polyrepo"}` and
     proceed to **Section 2.7b**.
   - **Else (monorepo):** write
     `{"last_successful_step": "2.7_beads_monorepo", "topology": "monorepo"}` and
     proceed to **Section 2.7a**.

---

### 2.7a Sync Mode (Monorepo only)

**PROTOCOL: Decide whether this single repo's control plane (cadre/ + Beads task
graph) is shared with teammates. Run only when `topology == "monorepo"`. Sync is
topology-independent — `sync_mode == "shared"` enables shared tracks/Beads/leases
here exactly as it does in polyrepo. See `references/cadre-sync.md`.**

1. **Choose sync mode:**
   > "How should this repo's control plane (cadre/ + Beads task graph) be shared?"
   > A) **Shared** — push/pull `cadre/` + Beads to a remote so teammates see the same tracks/tasks/leases *(product CODE still stays local until you ship it)*
   > B) **Local** — keep everything local *(today's default behavior)*
   >
   > Please respond with A or B. (Default: B.)

2. **Probe control remote/branch:** determine `control_remote` (default `origin`)
   and `control_branch` (`git symbolic-ref --short HEAD`, default `main`).

3. **Write `cadre/config.json`:** copy `<TEMPLATES_DIR>/config.json` (resolved in
   2.4) to `cadre/config.json`, then set:
   - `sync_mode`: `"shared"` (A) or `"local"` (B). This is the master gate for all
     team/shared behaviors across commands; `"local"` keeps today's behavior.
   - `auto_open`: leave `false` (template default). Opt-in hook that lets
     `/cadre-ship` auto-open the PR after a clean push; teams flip it to `true`
     manually. Keep it present so `ship` can read it without a fallback.
   - `require_second_reviewer`: leave `false` (template default). When a team flips
     it to `true`, `/cadre-ship` refuses a track approved by its own owner
     (`review.self_reviewed`), forcing a second reviewer.
   - `control_remote`, `control_branch` from step 2 (write these whenever
     `sync_mode == "shared"` so the sync pre/postamble can publish the control
     plane; harmless defaults in `local` mode).
   - Leave the polyrepo-only keys at their template defaults: there is no
     `pr_provider`/`merge_train` decision in a monorepo (no cross-repo PR group),
     so do **not** prompt for them — the template values are inert without
     `repos.json`.

4. **Register the merge driver & extend `.gitattributes` (only if
   `sync_mode == "shared"`):** mirror the shared-state setup in
   `references/cadre-sync.md` so synced control-plane state resolves cleanly.
   - Append to project-root `.gitattributes` (skip lines already present), then
     `git add .gitattributes`:
     ```
     # Per-track resume state — these are SCALAR JSON objects, NOT newline-delimited
     # records, so `merge=union` would interleave both sides into INVALID JSON and
     # corrupt resume. Pin to main's copy (parallel_state.json is ephemeral and
     # deleted at phase end); let implement_state.json conflict surface as a normal
     # merge so a real divergence is never silently lost.
     cadre/tracks/**/parallel_state.json  merge=ours
     ```
     Leave `implement_state.json` on **normal merge** (no attribute) so a genuine
     resume-state divergence surfaces as a conflict instead of being clobbered.
     Leave `config.json` / `spec.md` / `plan.md` on normal merge too, so structural
     conflicts surface intentionally.
   - **Register the `ours` merge driver (CRITICAL):** an unregistered `ours` driver
     makes git fall back to its default text merge, which injects conflict markers
     into the pinned state files. Check and register:
     ```bash
     git config merge.ours.driver >/dev/null 2>&1 || git config merge.ours.driver true
     ```
     This is idempotent with any registration already performed in Section 2.7 / 3a
     (which covers `.beads/** merge=ours` for full-Beads projects); the check-then-set
     guard makes it a no-op when already set and the sole registration when Beads was
     skipped, so the per-track `merge=ours` attribute written above always has a live
     driver.

5. **Commit State:**
   ```json
   {"last_successful_step": "2.7a_sync_mode_mono", "topology": "monorepo"}
   ```

6. **Continue:** Proceed to **Section 2.8**.

---

### 2.7b Sync Mode & PR Provider (Polyrepo only)

**PROTOCOL: Configure how the control plane is shared and how cross-repo PRs are
opened. Run only when `topology == "polyrepo"`. See `references/cadre-sync.md`
and `references/polyrepo-git.md`.**

1. **Choose sync mode:**
   > "How should this control plane (cadre/ + Beads task graph) be shared?"
   > A) **Shared** — push/pull `cadre/` + Beads to a remote so teammates see the same tracks/tasks *(product CODE still stays local until you land it)*
   > B) **Local** — keep everything local *(today's behavior)*
   >
   > Please respond with A or B.

2. **Choose PR provider:**
   > "Where are the product repos hosted?"
   > A) **GitHub** (uses `gh`)
   > B) **GitLab** (uses `glab`)
   >
   > *Auto-detect hint:* inspect a product repo's remote — run
   > `git -C repos/<default_repo> remote get-url origin` and pre-select the
   > provider whose host it matches (`github.com` → GitHub, `gitlab.*` → GitLab),
   > but still confirm with the user.

3. **Merge train:**
   > "Enable the cross-repo merge train (auto-merges the PR group once every
   > sibling PR is approved + CI-green, product repos first, control repo last)?"
   > A) Yes, auto-fire (recommended)
   > B) Yes, but manual trigger only (no auto-fire)
   > C) No merge train

4. **Probe control remote/branch:** determine `control_remote` (default `origin`)
   and `control_branch` (`git symbolic-ref --short HEAD`, default `main`).

5. **Write `cadre/config.json`:** copy `<TEMPLATES_DIR>/config.json` to
   `cadre/config.json`, then set:
   - `sync_mode`: `"shared"` (A) or `"local"` (B). This is the master gate for all
     team/shared behaviors across commands; `"local"` keeps today's behavior.
   - `auto_open`: leave `false` (template default). Opt-in hook that lets
     `/cadre-ship` auto-open the monorepo PR after a clean push; teams flip it
     to `true` manually. Keep it present so `ship` can read it without a fallback.
   - `require_second_reviewer`: leave `false` (template default). When a team flips
     it to `true`, `/cadre-ship` and `/cadre-land` refuse a track approved by its own
     owner (`review.self_reviewed`), forcing a second reviewer.
   - `control_remote`, `control_branch` from step 4
   - `pr_provider`: `"github"` or `"gitlab"`
   - `merge_train.enabled`: false only if C; `merge_train.auto_fire`: true for A,
     false for B/C.

6. **Scaffold the merge-train CI (only if `merge_train.enabled`):** copy from
   `<TEMPLATES_DIR>/ci/` the file matching `pr_provider` into the control repo:
   - GitHub → `.github/workflows/cadre-merge-train.yml`
   - GitLab → `.gitlab-ci.yml` (if one already exists, tell the user to `include:`
     the template instead of overwriting; copy it as
     `cadre-merge-train.gitlab-ci.yml` and print include guidance).
   - `git add` the scaffolded file.
   - **Print the cross-repo token + branch-protection prerequisites** from the
     template header: a PAT/App token (GitHub) or group token (GitLab) with write
     access to every product repo, stored as `CADRE_TRAIN_TOKEN`; and required
     approvals + status checks on each product repo's default branch and the
     control branch.

7. **Extend `.gitattributes` for shared state (only if `sync_mode == "shared"`):**
   append (skip lines already present), then `git add .gitattributes`:
   ```
   # Per-track resume state — these are SCALAR JSON objects, NOT newline-delimited
   # records, so `merge=union` would interleave both sides into INVALID JSON and
   # corrupt resume. Pin to main's copy (parallel_state.json is ephemeral and
   # deleted at phase end); let implement_state.json conflict surface as a normal
   # merge so a real divergence is never silently lost.
   cadre/tracks/**/parallel_state.json  merge=ours
   ```
   Leave `implement_state.json` on **normal merge** (no attribute) so a genuine
   resume-state divergence surfaces as a conflict instead of being clobbered.
   Leave `repos.json` / `config.json` / `spec.md` / `plan.md` on normal merge too,
   so structural conflicts surface intentionally.

   **Register the `ours` merge driver (CRITICAL):** an unregistered `ours` driver
   makes git fall back to its default text merge, which injects conflict markers
   into the pinned state files. Before relying on it, check and register:
   ```bash
   git config merge.ours.driver >/dev/null 2>&1 || git config merge.ours.driver true
   ```
   This is idempotent with the registration already performed in Section 2.7 / 3a
   (which covers `.beads/** merge=ours` for every full-Beads project); running it
   again here harmlessly re-asserts the driver for the per-track `merge=ours`
   attributes written above.

8. **Commit State:**
   ```json
   {"last_successful_step": "2.7b_sync_mode", "topology": "polyrepo"}
   ```

9. **Continue:** Proceed to **Section 2.8**.

---

## 2.8 FINAL ANNOUNCEMENT

0. **Gitignore agent-local state:** create or extend `cadre/.gitignore` so
   regenerable agent-local state never gets committed, while all durable track
   artifacts stay versioned. Append only lines not already present.

   - **ALWAYS ignore** (both monorepo and polyrepo, any sync mode):
     ```gitignore
     # Agent-local setup/refresh resume state — never share, always regenerable
     setup_state.json
     refresh_state.json
     ```
   - **ADDITIONALLY** ignore per-track resume state **only when `sync_mode != "shared"`**
     (any repo in local mode, or with no `config.json`) — **topology-independent**, so
     a **shared monorepo** (Section 2.7a) does NOT get these ignore lines, exactly like
     a shared polyrepo. In shared mode this state is intentionally synced (Section 2.7a
     / 2.7b), and the `parallel_state.json  merge=ours` driver added there is dead code
     on a gitignored file — so do NOT ignore it there:
     ```gitignore
     # Per-track resume state — local-only; in shared mode this is synced instead
     tracks/**/implement_state.json
     tracks/**/parallel_state.json
     ```
   - **Never ignore** (these stay committed — do NOT add them): `metadata.json`,
     `spec.md`, `plan.md`, `learnings.md`, `revisions.md`, `blockers.md`,
     `skipped.md`, `tracks.md`, `patterns.md`.
   - `git add cadre/.gitignore`.

1. **Announce Completion:** "Project setup completed! You can now initiate a track using the `newTrack` command."
2. **Commit Files:** `git add cadre && git commit -m "cadre(setup): Add cadre setup files"`
   - In monorepo mode this also stages `config.json` (and `.gitattributes` if
     shared mode extended it). In polyrepo mode this additionally stages
     `repos.json`, `.gitmodules`, and any scaffolded CI file.
3. **Publish control plane (`sync_mode == "shared"` only — monorepo OR polyrepo):**
   this is the first publish of the control plane — follow the sync postamble in
   `references/cadre-sync.md`: `bd dolt push` then
   `git push <control_remote> <control_branch>`. In `local` mode (the monorepo
   default, or any repo without `config.json`), do **not** push — commits stay
   local as today. Product-repo CODE is never pushed here regardless of sync mode.
4. **Next Steps:** "Run `/cadre-newtrack` to begin work."

