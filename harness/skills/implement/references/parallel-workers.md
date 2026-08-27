# Parallel and delegated workers

Use bounded parallelism only when at least two safe nodes are ready; otherwise work in main. Bound workers by ready nodes, host capacity, and workflow limits. The phase DAG controls active phases and same-phase task dependencies control task readiness.

Use a main-owned phase integration worktree for non-trivial phases. Create task waves from the same clean recorded phase HEAD and integrate a wave before deriving downstream work. Only one mutating execution mode may own a phase at a time.

Every worker prompt includes its absolute worktree, track/execution/node IDs, approved outcome, dependencies and learning, relevant files, checks, and commit scope. Require the worker to read before editing, change product files only, avoid `.cadre/**`, avoid agent spawning and Git integration/history operations, run focused verification, and return changed files, checks, risks, learning, and proposed commit message. The worker returns an uncommitted diff for main scope review, then commits only after main authorizes it under the persisted approval mode. It returns the SHA and waits.

Workers must not merge, rebase, reset, clean up, force Git operations, or switch to other plan work. A phase worker must stop at a clean handoff while task workers for that phase are active.
