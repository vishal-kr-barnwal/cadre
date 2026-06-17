---
description: Open and link the cross-repo PR group for a polyrepo track, then let the merge train land it
---

<!--
SYSTEM DIRECTIVE: You are an AI agent for the Cadre framework.
CRITICAL: Validate every tool call. If any fails, halt and announce the failure.
CRITICAL: This workflow only OPENS and LINKS PRs. It never merges autonomously —
the host's merge-train CI fires once every sibling PR is approved and green.
-->

# Cadre Land

Open the cross-repo PR group for the polyrepo track named in the workflow arguments.

`cadre-land` is the **polyrepo** ship step. It opens one PR per touched
product repo **plus** the control-repo PR, links them as a group with a shared
label, and records the PR URLs. The generated **merge-train CI** in the control
repo then merges them in a fixed order — **product repos first, the control repo
last** — once every sibling PR is approved and CI-green.

> **Monorepo projects use `cadre-ship` instead.** If `cadre/repos.json`
> is absent or not `mode: "polyrepo"`, tell the user to run `cadre-ship`
> and halt.

---

## 1. Verify Setup & Topology

1. Resolve the project root with `cadre_current_root` using the per-call `root`
   argument. Use the returned root for all MCP calls in this workflow.
2. If `cadre/tracks.md` doesn't exist → tell the user to run `cadre-setup`
   first and halt.
3. Read `cadre/repos.json`. If absent or `mode` ≠ `"polyrepo"` →
   > "This is a monorepo project. Use `cadre-ship <track_id>` to push the
   > branch and open a single PR."
   and halt.
4. Read `cadre/config.json` for `pr_provider` (`github`|`gitlab`) and
   `merge_train`. If `sync_mode: "shared"`, run the sync preamble
   (`references/cadre-sync.md`) first.
5. **Select track:** if `track_id` is provided, use it; else list completed (`[x]`)
   tracks not yet archived and ask. Resolve the active track from
   `metadata.json.status` (source of truth), never the derived `tracks.md` cache.
   Read `cadre/tracks/<track_id>/metadata.json` for the `repos` map.
   **Ownership guard (at selection).** Before mutating the track (pushing
   branches, recording PR URLs into `metadata.json`), run the topology-independent
   ownership guard (`references/ownership-guard.md`) for `<track_id>`. If the
   track is foreign-held, take over or halt per that guard; on take-over (or when
   you are the holder / your identity is `null`) your next `metadata.json` write
   sets `owner = <git-identity>` via key-scoped `jq`. This applies in **both**
   monorepo and polyrepo and even where the advisory `lease` is a no-op.
6. **Gate — reviewed?** Call `cadre_review_gate` with `root` and `trackId`. The
   machine-readable MCP review gate in **§1.5** is authoritative — do **not**
   prompt here unconditionally. Only when the MCP result contains reason
   `No recorded review verdict` may you fall back to the soft prompt (suggest
   `cadre-review <track_id>` and ask whether to proceed anyway). If a review
   exists, take **no** action here — §1.5 either refuses or proceeds. Never ask
   "proceed anyway?" against an approved track.

### 1.5 Review-Gate Enforcement (machine-readable)

Use the `cadre_review_gate` result and enforce it **before** any push/PR work:

- **`review` absent** (`verdict == "absent"`) → keep today's behavior: the soft
  confirmation prompt from the section-1 step-5 "reviewed?" gate (ask whether to
  proceed anyway). Do not block. This is the **only** branch that prompts.
- **Any blocking MCP reason other than absent review** →
  **REFUSE.** Print a clear message naming the verdict and blocking count, e.g.
  > "Track `<track_id>` has an unresolved review (verdict: changes_requested,
  > <n> blocking findings). Resolve them and re-run `cadre-review` before
  > landing." — then halt without opening any PR.
- **`ok: true`** → proceed. Surface any MCP warnings (for example older reviews
  without `reviewed_sha`) as non-blocking notes.

---

## 2. Ensure CLI & Auth

- **GitHub:** verify `gh auth status`. **GitLab:** verify `glab auth status`.
- If the CLI is missing or unauthenticated, switch to **plain-CLI fallback** (step
  6): print the exact PR-create commands for the user to run, and skip the
  automated creation.

---

## 2b. Land Preflight (all-or-nothing) — polyrepo, BEFORE any push/PR

Validate **EVERY** touched repo first. This is a gate: if **any** check fails,
**halt before opening (or pushing for) ANY PR** — never open a partial group.
First call `cadre_polyrepo_preflight` with `root`. If it returns `ok: false`,
surface the returned errors and halt before any push/PR work. Then follow the
remaining **preflight asserts in `references/polyrepo-git.md`** for checks not yet
covered by MCP; this workflow just drives the loop over `metadata.json.repos`
(plus the control repo) and aggregates results.

> **Fan out per-repo (parallel).** Every per-repo check below is **read-only and
> independent** — the submodule `git submodule status`, the `git config -f
> .gitmodules` lookup, the `ls-remote` base-existence probe, the `rev-list`
> behind-base count, and the host `gh api`/`glab api` merge-method probe touch
> only one repo and never each other's state. **Run them per-repo in parallel
> (one sub-agent / one job per repo) rather than as a serial loop**, then
> aggregate: the gate still fails fast if **any** repo fails. Serializing them
> only makes a many-repo track slower; correctness is unchanged.

For each entry in `metadata.json.repos`:

1. **Submodule initialized.** `git submodule status <submodule_path>` is checked
   out (no leading `-`). If uninitialized, **halt** and tell the user to run
   `git submodule update --init <submodule_path>` (or `cadre-validate`).
2. **`submodule_path` matches `.gitmodules`.** The path recorded in
   `repos.json`/`metadata.json` must equal the authoritative `.gitmodules` entry
   (`git config -f .gitmodules --get submodule.<name>.path`). On mismatch,
   **halt** and point the user at `cadre-refresh repos`.
3. **PR base exists on remote.** The base branch — `repos.json` `default_branch`
   for that repo — must exist on the remote
   (`git -C <submodule_path> ls-remote --exit-code --heads origin <default_branch>`).
   If missing, **halt**.
4. **Track branch not behind base.** Compare `track/<track_id>` against the base.
   **First capture the PRE-REBASE tip** of the track branch for the §3
   reviewed-SHA check (so a rebase-onto-base below cannot move the head past the
   reviewed commit and false-positive the §3 gate):
   ```bash
   prerebase_tip=$(git -C <submodule_path> rev-parse track/<track_id>)
   # stash it per repo (prerebase_tip_<repo>) for the behind-base rebase guard below
   # — NOT for §3 (§3 uses only the control tip below; reviewed_sha is
   # control-repo-scoped, product-repo advancement is the merge train's concern).
   # ALSO capture THIS control repo's track-branch tip (no -C) — this is what §3
   # enforces reviewed_sha against:
   #   prerebase_tip_control=$(git rev-parse track/<track_id>)
   ```
   If the track branch is **behind** base
   (`git -C <submodule_path> rev-list --count track/<track_id>..origin/<default_branch>` > 0),
   **OFFER a rebase** (`git -C <submodule_path> rebase origin/<default_branch> track/<track_id>`).
   **Never force-rebase and never force-push** — ask first; if declined, halt.

5. **Squash guardrail (merge commits must be allowed).** The merge train pins each
   submodule gitlink to a product PR's **merge commit** (squash is disabled by
   guardrail — see §7), so deterministic pinning requires that each product repo
   *allow merge commits* and is *not* squash-only. Probe the host via API; this is
   read-only here:

   **GitHub** (per product `repo_slug`, e.g. `org/api`):
   ```bash
   gh api "repos/<slug>" --jq '{merge: .allow_merge_commit, squash: .allow_squash_merge}'
   ```
   If `allow_merge_commit` is `false` (merge commits disallowed) or the repo is
   effectively squash-only, **WARN** — name the repo and explain that cross-repo
   tracks require merge commits for deterministic submodule gitlink pinning — and
   **OFFER** (do not auto-apply) the fix:
   ```bash
   gh api -X PATCH "repos/<slug>" -F allow_merge_commit=true -F allow_squash_merge=false
   ```

   **GitLab:** read the project's `merge_method` (`glab api "projects/<url-encoded-slug>" --jq '.merge_method'`).
   If it is not `merge` (i.e. `ff` or `rebase_merge` which force a single squashed
   commit), **WARN** the same way and **OFFER** to set it back to merge commits:
   ```bash
   glab api -X PUT "projects/<url-encoded-slug>" -f merge_method=merge
   ```

   **Never auto-apply** the fix — print the command and let the user run it.
   **Warn-and-proceed if offline / no API access** (the probe failing on
   connectivity or missing auth is not a real misconfiguration); note the check was
   skipped and continue.

**Also check the control repo** the same way (base = `config.json`
`control_branch`).

**Latent divergence flag.** If a repo's `metadata.json` `base_branch` differs
from its `repos.json` `default_branch`, **warn** — the PR base (step 4) uses
`repos.json` `default_branch`, but stale `metadata.base_branch` may mislead other
commands. Surface it so the user can reconcile via `cadre-refresh repos`.

**Offline / no-network.** If remote queries fail because you are offline
(`ls-remote` / `rev-list` against `origin` error out on connectivity, not on a
real mismatch), **warn and proceed** — note that base-existence and behind-base
checks were skipped, and let the push step surface any real problem.

Only after **all** repos pass (or are warned-and-proceeded while offline) do you
continue to step 3.

---

## 3. Push Per-Repo Branches

**Re-read the review gate first (TOCTOU close).** The MCP verdict checked in §1.5 is a
point-in-time snapshot; the preflight + sync above can take a while, during which a
reviewer may flip it. Call `cadre_review_gate` again immediately before the first
push and abort if it now blocks — do **not** open a partial group against a
freshly-blocked track.

**Then enforce `reviewed_sha` (the control branch must not have advanced past the
reviewed commit).** `cadre-review` records `metadata.review.reviewed_sha` = the
**control-repo** track-branch HEAD it actually reviewed — a single scalar. It is
**control-repo-scoped; do NOT fan it across product repos.** Each product repo has a
different HEAD, so comparing the one control SHA against every repo's tip would
false-abort essentially every polyrepo landing. Per-product-repo advancement is
observed downstream by the merge train, not here. Compare `reviewed_sha` against the
**control repo's PRE-REBASE tip** captured in §2b step 4 (`prerebase_tip_control`) —
**not** the post-rebase HEAD, so a rebase-onto-base does not false-positive. If the
control pre-rebase tip differs from `reviewed_sha` (the control branch genuinely
advanced past the reviewed commit), **abort** (or soft-prompt re-review):
```bash
# reviewed_sha is absent on tracks reviewed before this field existed -> skip (no regression)
reviewed_sha=$(jq -r '.review.reviewed_sha // empty' "$META")
tip="$prerebase_tip_control"   # control repo's tip captured in §2b step 4, BEFORE any rebase
if [ -n "$reviewed_sha" ] && [ -n "$tip" ] && [ "$tip" != "$reviewed_sha" ]; then
  echo "🚫 control: branch advanced past reviewed commit ${reviewed_sha} (pre-rebase tip ${tip}); re-review needed."
  echo "   Re-run cadre-review <track_id>, or confirm to proceed anyway."
  exit 1   # abort; on a soft-prompt build, ask instead of exiting
fi
```
A missing `reviewed_sha` (older review, or `bd`/review predating this field) **skips
this check** — never block a previously-valid review. Use the pre-rebase tip so the
§2b rebase-onto-base offer cannot make a clean branch look advanced.

For each entry in `metadata.json.repos` (and the control repo), make sure the
`track/<track_id>` branch is on its remote so a PR can be opened from it. This is
idempotent if `cadre-implement` or `cadre-archive` already pushed. The
per-repo pushes (and any read-only `ls-remote` / `fetch` probes around them) are
**independent across repos — fan them out per-repo in parallel** rather than as a
serial loop (each writes only its own repo's remote ref):

```bash
# product repos
git -C <submodule_path> push origin track/<track_id> --force-with-lease
# control repo
git push <control_remote> track/<track_id> --force-with-lease
```

Product code is pushed here for the PR — this is the sanctioned push point (commits
were kept local through implement). Flush Dolt first if shared:
`bd dolt push`.

---

## 4. Open the PR Group

Let `LABEL = <merge_train.group_label_prefix>:<track_id>` (default
`cadre-track:<track_id>`).

1. **One PR per touched product repo** (`track/<id>` → that repo's `default_branch`).
   **Open these in parallel — fan out per-repo (see §4a),** since each repo's
   create is independent. **Idempotent create (reuse, never duplicate).** Before
   creating, look for an already-open PR/MR on that head→base; if one exists, reuse
   its URL and treat it as success (so a retry or a concurrent sibling run does not
   open a duplicate):

   **GitHub:**
   ```bash
   existing=$(gh pr list --repo <org/repo> \
     --head track/<track_id> --base <default_branch> --state open \
     --json url --jq '.[0].url // empty')
   if [ -n "$existing" ]; then
     pr_url="$existing"   # reuse — already open, treat as success
   else
     pr_url=$(gh pr create --repo <org/repo> \
       --head track/<track_id> --base <default_branch> \
       --title "<track_id>: <description> (<repo>)" \
       --body "<see cross-link block below>" \
       --label "<LABEL>")
   fi
   ```
   **GitLab:**
   ```bash
   existing=$(glab mr list --repo <org/repo> \
     --source-branch track/<track_id> --state opened \
     --output json | jq -r '.[0].web_url // empty')
   if [ -n "$existing" ]; then
     pr_url="$existing"   # reuse — already open, treat as success
   else
     pr_url=$(glab mr create --repo <org/repo> \
       --source-branch track/<track_id> --target-branch <default_branch> \
       --title "<track_id>: <description> (<repo>)" \
       --description "<cross-link block>" --label "<LABEL>")
   fi
   ```
   (Reusing an existing PR/MR still falls through to the label + cross-link +
   record steps below, so a half-finished prior run is completed, not duplicated.)

2. **The control-repo PR** for the cadre `track/<track_id>` branch (carries the
   `cadre/` state changes). The submodule gitlink bumps are **NOT** applied
   now — the merge train applies them after the product PRs merge. Open it with the
   same `<LABEL>`, using the **same idempotent reuse-then-create guard** as the
   product PRs above (`gh pr list --head track/<track_id> --base <control_branch>
   --state open` / `glab mr list --source-branch track/<track_id> --state opened`)
   so a re-run reuses the existing control PR instead of opening a second one.

3. **Apply the group label** to every PR (product + control) so the merge-train CI
   recognizes the group.

### 4a. Fan out the per-repo PR-open work (parallel)

The product-repo opens are mutually independent — each `gh pr list`/`gh pr create`
(or `glab` equivalent) and its label application touch a single repo's host API and
nothing shared. **Open them per-repo in parallel (one sub-agent / job per repo)
rather than as a serial loop.** Only the metadata-record step (§5.2) writes shared
state (`metadata.json`), so keep that on key-scoped `jq` writes and, in shared mode,
re-read `$META` from disk before each patch (a parallel sibling may have recorded
its `repos[<repo>].pr_url` since you loaded it). Open the **control-repo PR after**
the product fan-out so its cross-link block can list every sibling URL.

---

## 5. Cross-Link & Record

1. **Cross-reference block** — write into every PR body the full sibling list so
   reviewers see the whole group:
   ```markdown
   ### Cadre cross-repo group: <track_id>
   This PR is part of a coordinated group. The merge train merges product repos
   first, then the control repo last. Do not merge manually out of order.

   - api:     <pr_url>
   - web:     <pr_url>
   - control: <control_pr_url>
   ```
2. **Record URLs in `metadata.json`:** set each
   `repos[<repo>].pr_url`, `repos[<repo>].repo_slug` (the `org/repo` slug the host
   CLI needs), and a top-level `control_pr_url`. These are exactly what the
   merge-train CI reads.
   ```json
   "repos": {
     "api": { "submodule_path": "repos/api", "git_branch": "track/<id>",
              "worktree_path": ".worktrees/<id>/api", "base_branch": "main",
              "repo_slug": "org/api", "pr_url": "https://github.com/org/api/pull/12" }
   },
   "control_pr_url": "https://github.com/org/platform-control/pull/34"
   ```
   (`submodule_path`/`git_branch`/`worktree_path`/`base_branch` were written by
   `cadre-newtrack`; `cadre-land` adds `repo_slug` + `pr_url`. Record the
   PR/MR URL exactly as the host CLI returns it — GitHub `…/pull/N` or GitLab
   `…/merge_requests/N`; the merge-train CI parses the trailing number either way.)

   **Write each field with a key-scoped `jq`, never a full-file rewrite**, so a
   concurrent sibling write (or a re-run) doesn't clobber unrelated keys:
   ```bash
   # in shared mode, RE-READ metadata from disk immediately before patching
   # (a teammate may have landed a sibling repo since you loaded it)
   tmp=$(mktemp)
   jq --arg r "$repo" --arg url "$pr_url" --arg slug "$repo_slug" \
     '.repos[$r].pr_url=$url | .repos[$r].repo_slug=$slug' "$META" > "$tmp" && mv "$tmp" "$META"
   # control PR:
   jq --arg url "$control_pr_url" '.control_pr_url=$url' "$META" > "$tmp" && mv "$tmp" "$META"
   ```
   In **shared mode**, re-read `$META` from disk before each patch (do not reuse a
   stale in-memory copy) so concurrent sibling writes are preserved.
3. Commit the metadata update to the control repo; push it in shared mode.

---

## 6. Plain-CLI Fallback (unauthenticated `gh`/`glab`)

If step 2 found no usable CLI, do **not** fail — print the exact commands for the
user to run for each repo and the control repo (the `gh pr create` / `glab mr
create` lines from step 4, fully substituted), plus the label and cross-link body.
**Keep the `--label "<LABEL>"` flag on every printed command — do not drop it.**
The merge-train CI keys the whole group off that label; a PR created without it is
invisible to the train. Tell the user to paste the resulting PR URLs back so you
can record them in `metadata.json` (step 5.2) on the next run.

---

## 7. Report Group Status (re-runnable)

`cadre-land` is safe to re-run to poll the group. Report, per PR:

- Review decision (approved / changes requested / pending)
- CI status (green / running / failed)
- Merge-train state: not-ready / ready (all approved + green) / merged

When the train fires, it merges each product PR with a **merge commit** (squash is
disabled by guardrail, so the gitlink can be pinned deterministically — GitHub
`gh pr merge "$pr" --repo "$repo" --merge --delete-branch=false`; GitLab the
merge-commit method, never `squash=true`), reads that merge commit's SHA
deterministically (GitHub `gh pr view "$pr" --repo "$repo" --json mergeCommit
--jq '.mergeCommit.oid'`; GitLab `.merge_commit_sha // .sha`), bumps the submodule
gitlinks on the control branch to those merge commits, then merges the control PR
last (see `templates/ci/cadre-merge-train.*`). If a merge-commit SHA comes back
empty/null, the train echoes a message and `exit 1`s to re-fire.

**Merge order.** The CI honors `metadata.json` `merge_order` when present: the
listed repos merge first in that left-to-right order, then the alphabetical
remainder, and the control repo last in every case (product-first, control-last).
Absent `merge_order` → plain alphabetical product order, control last.

**Control-PR label self-heal (GitHub only — gate on `config.json`
`pr_provider == "github"`).** Before reporting, verify the control PR still
carries the group label `<prefix>:<track_id>` (default
`cadre-track:<track_id>`) — labels are occasionally dropped by automation or
manual edits, and the merge-train CI keys the group off this label:
```bash
labels=$(gh pr view "$control_pr" --json labels --jq '.labels[].name')
case "$labels" in
  *"$LABEL"*) : ;;                                  # present, nothing to do
  *) gh pr edit "$control_pr" --add-label "$LABEL" || \
       echo "WARN: could not re-apply $LABEL to control PR — re-apply manually" ;;
esac
```
Re-applying is **warn-only** — never halt on a failed label edit. (Skip this
entirely for GitLab / `pr_provider != "github"`.)

**Auto-fire reality check (tell the user):** neither host has a native cross-repo
"all siblings approved" event. The control-repo workflow fires on the **control
PR's own** review/check events, and on a schedule/dispatch. A review or green on a
**product** repo does **not** by itself fire the train. Practical options:
- Re-run `cadre-land <track_id>` after approving product PRs — it re-checks
  the whole group and the control PR's next review/check event lands it; **or**
- Trigger manually — GitHub: `workflow_dispatch` with the track id; GitLab: run the
  pipeline with `CADRE_TRACK=<track_id>`; **or**
- Wire product repos to `repository_dispatch`/webhook the control repo on approval
  (documented in the CI template header).
If `merge_train.auto_fire` is false, only manual/dispatch runs land the group.

**Don't serialize the whole org behind one train lane.** The merge-train workflow
should scope its concurrency group **per track** (e.g. `cadre-merge-train-<track_id>`
— GitHub `concurrency.group`, GitLab `resource_group`) rather than a single global
`cadre-merge-train` lane, so one stalled or conflicted track does not block every
other track's landing. Pair that with an **auto-fire trigger** — `repository_dispatch`
(GitHub) / pipeline `trigger` or webhook (GitLab), keyed on the track id — so a
sibling product-repo approval fires that track's train without waiting on a global
schedule. The concurrency-group value and trigger wiring live in the CI templates
(`templates/ci/cadre-merge-train.{github,gitlab}.yml`); reference and tune them
there, not in this workflow.

**On partial failure** (a product PR merged but a later step failed): the train
halts, leaves merged product PRs in place, and comments on the control PR naming
landed vs blocking repos. It does **not** re-fire itself — **someone or CI must
re-trigger it** (the control PR's next review/check event, a `workflow_dispatch` /
pipeline run, or a re-run of `cadre-land`). The train **is idempotent on
re-fire**: it skips already-merged product PRs and reconstructs the gitlink bumps,
so re-triggering after the failing repo is green safely completes the landing.

---

## 8. Next Step

Once the group has merged, run `cadre-archive <track_id>` to extract
learnings, tear down the per-repo worktrees, and move the track to
`cadre/archive/`.
