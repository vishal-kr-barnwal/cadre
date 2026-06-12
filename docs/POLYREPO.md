# Polyrepo Support

Conductor-Beads works in two topologies:

- **Monorepo (default).** All code in one repo. This is the original behavior and
  is unchanged — if there is no `conductor/repos.json`, every command behaves
  exactly as it always has.
- **Polyrepo.** A dedicated **control repo** orchestrates work across several
  **product repos** (git submodules). A single track can span multiple repos;
  branches, commits, worktrees, reverts, and PRs become per-repo; and an
  automated **merge train** lands the cross-repo PR group in the correct order.

Everything is **additive and opt-in.** Polyrepo behavior activates only when
`conductor/repos.json` exists with `"mode": "polyrepo"`.

---

## The control-repo model

```
platform-control/                 # the control repo (you run conductor here)
├── conductor/
│   ├── repos.json                # submodule manifest + mode:"polyrepo" + default_repo
│   ├── config.json               # sync_mode + pr_provider + merge_train
│   ├── tracks.md, patterns.md, …
│   └── tracks/<id>/metadata.json # carries a per-repo `repos` map
├── .beads/                       # ONE shared Dolt task graph for ALL repos
├── .gitmodules                   # authoritative path+URL for each product repo
├── .github/workflows/conductor-merge-train.yml   # (or .gitlab-ci.yml)
├── repos/api/                    # product repo (submodule)
├── repos/web/                    # product repo (submodule)
└── .worktrees/<id>/<repo>/       # per-repo track worktrees
```

- **`.gitmodules` is authoritative** for each submodule's path + URL.
  `conductor/repos.json` layers Conductor metadata (`default_branch`, `enabled`,
  `default_repo`) on top.
- **One Beads graph.** All member-repo tasks live in the control plane's single
  Dolt DB. Submodules get **no** own `.beads/`.

### `conductor/repos.json`

```json
{
  "mode": "polyrepo",
  "control_repo": { "name": "platform-control", "path": "." },
  "default_repo": "api",
  "repos": [
    { "name": "api", "submodule_path": "repos/api", "url": "git@github.com:org/api.git",
      "default_branch": "main", "enabled": true },
    { "name": "web", "submodule_path": "repos/web", "url": "git@github.com:org/web.git",
      "default_branch": "main", "enabled": true }
  ]
}
```

`default_repo` is the backward-compat anchor: a task with no `<!-- repo: -->`
annotation routes there.

### `conductor/config.json`

```json
{
  "sync_mode": "shared",
  "control_remote": "origin",
  "control_branch": "main",
  "pull_on_command_start": true,
  "pr_provider": "github",
  "merge_train": { "enabled": true, "auto_fire": true, "group_label_prefix": "conductor-track" }
}
```

Absent `config.json` → `local` → today's behavior (nothing auto-pushed).

---

## Setup

Run `/conductor-setup` and choose **B) Polyrepo / control repo** at the topology
prompt. Setup then:

1. Registers product repos as submodules (`git submodule add <url> repos/<name>`),
   or reads existing `.gitmodules`.
2. Asks for the `default_repo` and writes `conductor/repos.json`.
3. Initializes Beads at the control-repo root only.
4. Asks for **sync mode** (shared vs local) and **PR provider** (GitHub vs
   GitLab — auto-detected from a product remote, then confirmed), plus merge-train
   options, and writes `conductor/config.json`.
5. Scaffolds the matching merge-train CI into the control repo and prints the
   cross-repo token + branch-protection prerequisites.

---

## Per-repo work

- **Task annotation.** Each task in `plan.md` may carry `<!-- repo: <name> -->`
  (parallel to `<!-- files: -->`). Absent → `default_repo`. Never stripped on
  completion — it disambiguates branches, worktrees, and SHAs for the track's life.
- **`metadata.json.repos` map.** One entry per touched repo, each with
  `git_branch`, `worktree_path`, `base_branch`.
- **Worktrees.** `.worktrees/<track_id>/<repo>/` (and
  `.worktrees/<track_id>/<repo>_worker_<N>_<name>/` for parallel workers), created
  in submodule git context.
- **Commits.** `/conductor-implement` switches the working root per task to the
  task's repo worktree, commits there, and records the 7-char SHA in `plan.md`.
  **Product code is never pushed by implement** — it stays local until you land it.
- **Parallel execution** is repo-scoped: file-conflict detection compares
  `(repo, file)` tuples, worker worktrees live per repo, and worker branches merge
  into their own repo's track branch.
- **Reverts** run as per-repo chains: SHAs grouped by repo, reverted
  reverse-order within each repo, halting on the first conflict in any repo (Beads
  tasks reopen only after every repo succeeds).

---

## Cross-repo PRs & the merge train

`/conductor-land <track_id>` is the polyrepo ship step (monorepo uses
`/conductor-ship`). It:

1. Pushes each repo's `track/<id>` branch (and the control branch).
2. Opens **one PR per touched product repo** plus the **control-repo PR**.
3. Applies a shared group label `conductor-track:<id>` to all of them and
   cross-links their bodies.
4. Records PR URLs + `repo_slug` in `metadata.json`.

The generated **merge-train CI** in the control repo then fires (auto, when
`auto_fire: true`) once **every** labelled PR is approved and CI-green:

1. Re-verify all sibling PRs are approved + green.
2. Merge each **product** PR, capturing its new default-branch SHA.
3. On the control track branch, bump each submodule gitlink to the merged SHA;
   commit + push.
4. Re-await the control PR's check on the bumped commit, then merge the **control
   PR last**.

**Why product-first, control-last:** the control PR bumps submodule gitlinks to
the freshly-merged product SHAs. Merging it earlier would point submodules at
unmerged commits. The control PR is the single "seal" commit for the snapshot.

**No true atomicity.** Neither GitHub nor GitLab offers cross-repo atomic merge.
On partial failure the train halts, leaves already-merged product PRs in place,
comments on the control PR, and **re-fires** once the failing repo is green again
(already-merged product PRs are idempotent). Re-run `/conductor-land` to re-check
status.

### Prerequisites

- **Cross-repo token** `CONDUCTOR_TRAIN_TOKEN` — a PAT/GitHub-App token (GitHub)
  or group access token (GitLab) with write access to **every** product repo.
- **Branch protection** on each product repo's default branch and the control
  branch: require approvals + status checks. The train only automates the merge
  click; protection enforces review/CI.

---

## Shared sync mode

In `sync_mode: "shared"`, the **control plane** (`conductor/` + the Beads Dolt
graph) is pushed/pulled to `control_remote/control_branch` so teammates share one
task graph. **Product-repo code always stays local** until you land it.

- Mutating commands run a **sync preamble** (`git pull --rebase` + `bd dolt pull`)
  and a **postamble** (`bd dolt push` + control-plane push).
- `.gitattributes` drivers keep state merges painless:
  ```
  .beads/** merge=ours
  conductor/tracks/**/implement_state.json merge=union
  conductor/tracks/**/parallel_state.json  merge=union
  ```
  `repos.json` / `config.json` / `spec.md` / `plan.md` stay on normal merge so
  structural conflicts surface intentionally.

Toggle `sync_mode` and per-repo `enabled` later via `/conductor-refresh repos`.

---

## Command behavior summary

| Command | Polyrepo behavior |
|---------|-------------------|
| `setup` | Topology prompt, submodule registration, `repos.json`/`config.json`, CI scaffold |
| `newtrack` | `<!-- repo: -->` annotations, `metadata.repos` map, per-repo worktrees |
| `implement` | Per-task repo routing, per-repo commits/SHAs, repo-scoped parallel, sync preamble |
| `revert` | Per-repo revert chains, halt-on-first-conflict |
| `land` *(new)* | Open + link the cross-repo PR group; merge train lands it |
| `archive` | Per-repo worktree teardown + safety-net branch push; no PRs |
| `status` | Repos panel (branches, ahead/behind, PRs) |
| `validate` | `repos.json`↔`.gitmodules` parity, submodule init, annotation validity |
| `handoff` | Per-repo branch/worktree tables; push control plane |
| `refresh` | `repos` scope: reconcile manifest, toggle sync/enabled |
| `revise` | Repo-annotation changes; offer new-repo worktree |
| `ship` | Monorepo only — redirects to `/conductor-land` |

---

## Backward compatibility

- Absent `repos.json` → monorepo (unchanged).
- `metadata.json` without a `repos` map → flat `git_branch`/`worktree_path`.
- Absent `config.json` → `local` sync.
- Plans without `<!-- repo: -->` → `default_repo`.

Existing single-repo projects are untouched; the only change after regenerating
is the addition of new reference files.
