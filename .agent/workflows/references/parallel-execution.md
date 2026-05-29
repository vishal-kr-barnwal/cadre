# Parallel Worker Dispatch (per platform)

Conductor runs a phase's independent tasks as parallel **workers**, each in its
own git worktree, coordinated through Beads (the shared Dolt DB) using a **wave
model**: dispatch every task whose dependencies are met, wait for the wave to
finish, then dispatch the next wave.

The *worker prompt* (identity, task, TDD steps, completion sequence) is supplied
by `conductor-implement`. **This file only covers HOW to dispatch a worker on
each tool** — the spawn primitive differs per platform, so use the one that
matches the agent you are running inside.

## Dispatch mechanism by platform

| Platform | How to dispatch each worker | Wait / collect |
|----------|-----------------------------|----------------|
| **Claude Code** | Call the `Task` tool once per worker, passing the worker prompt. | `Task` calls are awaitable — await all in the wave. |
| **OpenAI Codex CLI** | Instruct Codex to spawn parallel agents — one per task — using the built-in `worker` agent type ("spawn N agents, one per task; wait for all"). Manage with `/agent`. | Tell Codex to wait for all child agents before continuing. |
| **Cursor** | Use `/multitask` (or Agent-Mode "Parallelize") to split the wave into subagents, one per task; Cursor runs them in parallel git worktrees (up to 8). | Cursor joins subagents automatically; review each before merge. |
| **Google Antigravity** | Use the Agent Manager to spawn one dynamic subagent per task in the wave, each with isolated context. | Monitor in Agent Manager; wait for all before the next wave. |
| **GitHub Copilot** | Copilot CLI: `/fleet` dispatches one subagent per task in parallel (with worktree isolation); or `/delegate` to the cloud coding agent per task. VS Code agent mode: spawn parallel context-isolated subagents. | The `/fleet` orchestrator joins subagents; wait for all before the next wave. |
| **Any other / no primitive** | **Sequential fallback:** the single agent performs the wave's tasks itself, one at a time, each inside its own worktree, following the worker prompt. | N/A — already sequential. |

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

If the running platform cannot spawn parallel sub-agents, fall back to the
sequential path above: correctness first, parallelism is an optimization.
