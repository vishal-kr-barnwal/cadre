---
title: Team And Polyrepo
description: Shared sync, ownership, leases, team boards, polyrepo control repos, and merge trains.
section: Scale
order: 6
---

# Team And Polyrepo

Cadre supports solo work, single-repo teams, and polyrepo control repos. The
same workflow packets operate in every topology, but sync, ownership, provider
evidence, and publication behavior change based on project configuration.

## Monorepo Mode

Monorepo mode is the default. If `cadre/repos.json` does not exist, Cadre treats
the project root as the product repo.

Use:

- `cadre-ship` for publication planning.
- `cadre-status` for live status and team boards.
- `cadre-review` for the quality gate.
- `cadre-validate` for state and annotation checks.

Absent `cadre/config.json`, provider mode is local and no hosted provider MCP
evidence is required.

## Shared Sync

For teams, choose shared sync during setup. Shared sync pushes and pulls the
control plane so teammates see owners, leases, review queues, blockers, and
available work.

Shared sync covers:

- `cadre/` project state.
- The Beads Dolt graph.
- Review and handoff evidence.
- Team-board visible ownership and blocker state.

Product code remains local until ship or land workflows publish it.

Shared-mode mutating workflows run a sync preamble and postamble through
Cadre packets. Merge attributes protect machine-owned state such as Beads DB
files and parallel worker audit files from unsafe text merges.

## Ownership And Leases

Cadre records owner and reviewer information from the running git identity,
usually `git config user.email` with `user.name` as fallback.

Ownership is the durable assignment. Shared-mode leases are advisory activity
signals. A lease can include owner, host, acquired time, and heartbeat time so
teammates can see who is actively driving a track.

Leases are swept when stale. The canonical staleness window is 30 minutes.
Monorepo/local mode does not need advisory leases.

## Team Boards

Useful compact resources:

| Resource | Use |
|----------|-----|
| `cadre://team-board` | WIP, owners, blockers, handoffs, reviews, and Beads evidence. |
| `cadre://my-next-actions` | Current user's WIP, review work, handoffs, available work, and reclaimable work. |
| `cadre://review-queue` | Tracks awaiting review or changes. |
| `cadre://handoff-inbox` | Incoming resumable context. |
| `cadre://quality-gate` | Plan integrity, review gate, and collision state for one track. |
| `cadre://parallel-state` | Worker wave and merge-back state. |
| `cadre://repo-topology` | Mono/polyrepo topology and configured repos. |
| `cadre://integrations` | Optional MCP availability and LSP coverage in one compact view. |

These resources are bounded so agents do not need to reread the whole Cadre
tree to answer status questions.

## Polyrepo Control Repo

Polyrepo mode is opt-in. It activates when `cadre/repos.json` exists with
`"mode": "polyrepo"`.

The control repo owns Cadre state and Beads memory:

```text
platform-control/
├── cadre/
│   ├── repos.json
│   ├── config.json
│   └── tracks/<id>/
├── .beads/
├── .gitmodules
├── repos/api/
├── repos/web/
└── .worktrees/<track_id>/<repo>/
```

`.gitmodules` is authoritative for submodule path and URL. `cadre/repos.json`
adds Cadre metadata such as `default_repo`, `default_branch`, and enabled state.

Example:

```json
{
  "mode": "polyrepo",
  "control_repo": { "name": "platform-control", "path": "." },
  "default_repo": "api",
  "repos": [
    {
      "name": "api",
      "submodule_path": "repos/api",
      "url": "git@github.com:org/api.git",
      "default_branch": "main",
      "enabled": true
    },
    {
      "name": "web",
      "submodule_path": "repos/web",
      "url": "git@github.com:org/web.git",
      "default_branch": "main",
      "enabled": true
    }
  ]
}
```

## Repo-Scoped Work

Tasks can include repo annotations:

```markdown
- [ ] Task 1: Add API endpoint
  <!-- repo: api -->
  <!-- files: src/routes/session.ts -->

- [ ] Task 2: Add UI form
  <!-- repo: web -->
  <!-- files: src/pages/login.tsx -->
```

If a task has no `<!-- repo: -->` annotation, Cadre routes it to
`default_repo`.

Polyrepo implementation behavior:

- Worktrees are per repo under `.worktrees/<track_id>/<repo>/`.
- Commits are recorded per repo.
- Parallel file conflict checks compare `(repo, file)` tuples.
- Reverts group SHAs per repo and stop on the first conflict.
- Status and LSP/code-intelligence output are repo-qualified.

## Ship Vs Land

Use `cadre-ship` for monorepos. Use `cadre-land` for polyrepo control repos.

`cadre-land`:

1. Enforces the review gate.
2. Runs all-or-nothing local preflight across touched product repos.
3. Pushes each product repo's `track/<id>` branch and the control branch.
4. Plans or opens one PR/MR per touched product repo plus one control PR/MR.
5. Applies a shared `cadre-track:<id>` label.
6. Records provider URLs and evidence through Cadre packets.

Hosted provider actions must use GitHub or GitLab MCP evidence when configured.

## Merge Train

The generated merge train lands a cross-repo PR group in a safe order:

1. Verify sibling PRs/MRs are approved and green.
2. Merge product PRs/MRs first using merge commits.
3. Capture deterministic merge SHAs.
4. Update control-repo submodule gitlinks to those SHAs.
5. Re-run control checks.
6. Merge the control PR/MR last.

The train is not truly atomic because GitHub and GitLab do not provide
cross-repo atomic merge. If one repo fails after others have landed, the train
halts, reports the landed and blocked repos, and can be re-triggered
idempotently after the blocker is fixed.

Required setup:

- A cross-repo token such as `CADRE_TRAIN_TOKEN` with write access to every
  product repo.
- Branch protection on product repos and the control repo.
- Merge commits enabled so submodule gitlinks can pin deterministic merge SHAs.
