# Parallel Worker Dispatch

Cadre runs a phase's independent tasks as parallel **workers**, each in its
own git worktree, coordinated through Beads (the shared Dolt DB) using a **wave
model**: dispatch every task whose dependencies are met, wait for the wave to
finish, then dispatch the next wave.

The *worker prompt* (identity, task, TDD steps, completion sequence) is supplied
by `cadre-implement`. This file covers **how to dispatch a worker on this
tool**.

## Dispatching each worker

<!-- AGENT:claude -->
Call the **`Task` tool** once per worker, passing the worker prompt. `Task`
calls are awaitable — await all workers in the wave before computing the next
wave.
<!-- /AGENT:claude -->
<!-- AGENT:codex -->
Spawn parallel agents — one per task in the wave — using the built-in `worker`
agent type. Tell Codex explicitly: "spawn N agents, one per task; wait for all
before continuing." Manage running agents with `/agent`.
<!-- /AGENT:codex -->

If this tool has no parallel sub-agent primitive, fall back to **sequential**
execution: perform the wave's tasks yourself, one at a time, each inside its own
worktree, following the worker prompt. Correctness first; parallelism is an
optimization.

## Rules that apply on every platform

- **One worktree per worker.** Workers only read/write inside their assigned
  `.worktrees/<track_id>_worker_<N>_<name>/`. Never let two workers share files.
- **Beads is the coordinator, not `parallel_state.json`.** Pre-assign each wave's
  tasks (`bd update … --status in_progress --assignee …`) before dispatch; each
  worker closes its task with `bd close … --continue` so dependent tasks become
  ready for the next wave. `parallel_state.json` is an audit log only.
- **Wait for the whole wave** before computing the next wave with
  `bd ready --parent <epic_id> --json`.
- **Workers never `git push`.** All commits stay local; the coordinator merges
  each worker branch into the track branch in completion order.
- **On failure**, retry the worker, skip the task, or stop — ask the user.

## Coordinator mechanics (run these in order)

`cadre-implement` hands you a phase marked `<!-- execution: parallel -->`.
Drive the whole wave loop here; the *worker prompt* stays inline in
`cadre-implement`. The steps below are platform-agnostic — the only
platform-specific part is **how you dispatch** (see "Dispatching each worker"
above). In **polyrepo** mode, all per-repo branch/worktree routing defers to
`polyrepo-git.md` — resolve each task's `<!-- repo: -->` first.

### 1. Parse the wave (task metadata + dependency graph)

For each task in the phase, extract:
- `<!-- files: path1, path2 -->` — files this task owns exclusively
- `<!-- depends: task1, task2 -->` — dependencies on other tasks in this phase
- `<!-- parallel-group: groupName -->` — optional grouping

Tasks with no unmet `depends:` form the **current wave**; dependent tasks wait for
their dependencies to close. Build the execution order from this graph.

### 2. Detect file conflicts

Check whether any two tasks claim the same file in their `files:` annotation.
- **POLYREPO:** compare `(repo, file)` tuples, not bare paths — the same relative
  path in two different repos is **not** a conflict. Resolve each task's repo from
  its `<!-- repo: -->` annotation first.
- If conflicts are detected:
  > "⚠️ File conflict detected: [files] claimed by multiple tasks"
  > A) Make conflicting tasks sequential (recommended)
  > B) Continue anyway — I'll handle manually
  > C) Stop and revise plan
  - A: remove the parallel annotation from the conflicting tasks. B: proceed with
    warning. C: HALT.

(The **cross-person** overlap check against other operators' in-progress tasks —
shared mode only — is performed by `cadre-implement` before it hands you the
phase.)

### 3. Initialize worker worktrees (replaces file_locks)

- **MONOREPO:** for each parallel task, create an isolated git worktree with a
  Beads redirect:
  ```bash
  bd worktree create .worktrees/<track_id>_worker_<N>_<sanitized_name> \
    --branch track_<track_id>_worker_<N>_<sanitized_name>
  ```
- **POLYREPO:** resolve each task's repo, then create the worker worktree in that
  repo's submodule context (see `polyrepo-git.md`):
  ```bash
  git -C <submodule_path> worktree add \
    .worktrees/<track_id>/<repo>_worker_<N>_<sanitized_name> \
    -b track_<track_id>_worker_<N>_<sanitized_name> origin/<base_branch>
  ```
  Two workers targeting different repos never collide even with identical relative
  paths. The control plane's single `.beads/` DB still coordinates all workers —
  copy/point a `.beads` redirect into each worker worktree.
- `bd worktree` auto-configures a `.beads` redirect file in each worktree pointing
  to the root `.beads/` database. All workers share one Dolt DB — no file_locks.
- **If `bd` fails:** → follow the Beads Error Handler Protocol
  (`beads-error-handler.md`).
- Create `cadre/tracks/<track_id>/parallel_state.json` as an **audit log only**
  (not used for coordination):
  ```json
  {
    "phase": "<phase_name>",
    "execution_mode": "parallel",
    "started_at": "<timestamp>",
    "workers": [],
    "completed_workers": 0,
    "total_workers": <count>
  }
  ```

### 4. Dispatch the wave's workers

- **If Beads enabled:** pre-assign this wave's tasks before dispatch. The assignee
  is the **worker label** for this wave (`worker_<N>_<name>`) — never the literal
  "cadre":
  ```bash
  bd update <beads_task_id> --status in_progress \
    --assignee worker_<N>_<name> \
    --notes "PARALLEL WORKER: Starting in .worktrees/<track_id>_worker_<N>" \
    --json
  ```
- Dispatch one worker per task in the wave using your platform's mechanism (see
  "Dispatching each worker" above), handing each the inline worker prompt from
  `cadre-implement`.
- Record each spawned worker in `parallel_state.json`'s `workers` array:
  ```json
  {
    "worker_id": "worker_<N>_<sanitized_name>",
    "task": "<task_description>",
    "beads_task_id": "<beads_id>",
    "repo": "<repo name (polyrepo) or omit in monorepo>",
    "worktree": ".worktrees/<track_id>_worker_<N>_<sanitized_name>",
    "branch": "track_<track_id>_worker_<N>_<sanitized_name>",
    "depends_on": ["<task_id>"],
    "status": "in_progress",
    "started_at": "<timestamp>"
  }
  ```

### 5. Monitor the wave (wave model, not polling)

- Wait for all workers in the current wave to finish before starting the next wave,
  using your platform's mechanism (see "Dispatching each worker").
- After each wave completes, use **Beads** (not `parallel_state.json`) to find the
  next wave:
  ```bash
  bd ready --parent <epic_id> --json
  ```
  Any newly ready tasks (whose `depends_on` workers just closed via `--continue`)
  form the next wave — repeat from step 4.
- **Worker failure:** if a worker reports an error, or its `parallel_state` entry
  is still `in_progress` after it finishes:
  - Announce: "Worker <worker_id> failed: <error>"
  - **If Beads enabled:** reset for retry —
    `bd update <beads_task_id> --assignee "" --status open --json`
  - Ask the user: "Retry worker? A) Yes  B) Skip task  C) Stop".

### 6. Merge back (aggregate results, one dolt push)

- **MONOREPO:** merge each worker's branch into the track branch in completion
  order:
  ```bash
  # For each worker in order:
  git merge --no-ff track_<track_id>_worker_<N>_<name> \
    -m "cadre(parallel): merge worker_<N>: <task_description>"
  bd worktree remove .worktrees/<track_id>_worker_<N>_<name>
  ```
- **POLYREPO:** merge each worker's branch into **its own repo's** `track/<id>`
  branch, in that repo's git context (group workers by `repo` from
  `parallel_state`):
  ```bash
  # For each worker in order, in its repo:
  git -C <submodule_path> merge --no-ff track_<track_id>_worker_<N>_<name> \
    -m "cadre(parallel): merge worker_<N> (<repo>): <task_description>"
  git -C <submodule_path> worktree remove .worktrees/<track_id>/<repo>_worker_<N>_<name>
  ```
  Never merge a worker branch from one repo into another repo's branch.
- **If a merge conflict occurs:** HALT immediately. Show the conflicting files (and
  the repo) and ask the user to resolve before continuing.
- **If Beads enabled:** after all merges —
  ```bash
  bd dolt push  # One push for all workers combined
  bd ready --parent <epic_id> --json  # Verify all tasks complete
  bd note <epic_id> "PARALLEL PHASE COMPLETE: <phase>
  WORKERS: <N> succeeded
  COMMITS: <sha_list>" --json
  ```
- Hand control back to `cadre-implement` to mark the plan tasks `[x]`, append
  commit SHAs, delete `parallel_state.json`, and process the next ready phase.
