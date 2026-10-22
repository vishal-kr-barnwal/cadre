---
title: Release Notes
description: Cadre release changes and migration guidance.
section: Reference
order: 230
---

# Release Notes

## 4.1.0-beta.0 - 2026-10-22

The opt-in [GitHub Integration Beta](/github-collaboration) adds shared PR
ownership, checkpoint pushes, phase synchronization and enforcement. Local-only
workflows remain unchanged, and existing 4.0.0 project state remains compatible.
Install this prerelease with `npm install -g cadre-ai@beta`; stable installs keep
using the `latest` channel. Tag `beta-4.1.0` publishes `4.1.0-beta.0` through the
beta release workflow. GitLab integration is planned for a future release; see the
[roadmap](/team-and-polyrepo) for current status.

## 4.0.0 - 2026-10-14

Cadre 4.0.0 is a breaking runtime/API release that removes parallel legacy
mutation paths while preserving supported project state and delivery workflows.
The package, runtime, docs and native plugin manifests are versioned together at
4.0.0. This release also includes the revision, review and recovery hardening
recorded in the unreleased 3.9.2 development notes below.

### One active mutation contract

- Use operation receipts for initialization, implementation completion, clean review and archive. Remove legacy direct-write completion paths and the `archive_batch_record`, `setup_record_commit` and `setup_record_git_initialized` tools. The MCP surface now has 22 tools.
- Ship only immutable template set v6. Published v1–v5 source bytes remain unchanged for historical fixtures; they are excluded from the npm and installed plugin payloads.
- Keep schema-2 project/track state, schema-1 execution journals and receipts, approval policy v2, retained-context reuse, all ten workflows, four approval modes and both schedules.
- Continue existing 3.9.0/3.9.1/3.9.2 schema-2/v5 projects without rewriting metadata or requiring a project refresh. Install the new runtime and reload the client. Receipt recovery and historical evidence remain supported.
- Warn on unsupported older formats with `PROJECT_UPGRADE_REQUIRED` and prevent delivery mutations. Do not silently translate approval authority or change old version labels.
- Clarify active revision drafting: use the combined revision preparation path, exact completed-task commit markers, and sequential task ordinals. Preserve completed IDs and renumber only pending work; do not compare a proposed graph against its unsuperseded execution through separate candidate inspection. This addresses rejected proposals observed in a native Codex interruption/revision test.
- Keep scope, retained-context tokens and knowledge arguments stable across context pages; adding `knownSources` midway invalidates the cursor. Native testing exercised the rejection and recovery, and the shared workflow guidance now states this constraint.

### Compatibility and verification

- Reconcile public guides and the package README with the 4.0 receipt/recovery paths, approval modes, archive selection and all 22 MCP tools.
- Fix documentation heading links containing underscores or punctuation. Add social-preview images, page structured data and export validation for metadata, internal links, sitemap and robots directives.
- Keep homepage content near the top on tall mobile viewports instead of stretching the hero to the viewport height. Add npm package links to desktop and mobile navigation, and run content/SEO validation before Cloudflare deployment.

All ten skills, four approval modes, sequential/parallel scheduling, schema-2
project/track state, historical journals and approval evidence remain supported.
Direct MCP consumers must replace the three removed setup/archive tools with
receipt-based initialization and archive operations plus `candidate_apply`
reconciliation. New template requests use v6; older template catalogs are no
longer shipped. Compatible 3.9.x/v5 projects do not need a migration.

Verification passed **480/480 harness tests**, type checking, package validation,
pack dry run and the full documentation check. A disposable brownfield project
completed **14 real Codex sessions** through interrupted track drafting, revision
during implementation, a seeded defect and review/remediation cycle, stale
completion rejection after a manual edit, clean completion, interrupted archive
recovery and refresh. Its **26 tests** and **200,020 independent arithmetic
comparisons** passed. All nine operation receipts mapped to exactly one commit;
original authority, completed-task evidence and archived history were preserved.

The native run used Autonomous approval and sequential scheduling with labelled
synthetic fixture approvals. It does not establish exhaustive native coverage of
every client/mode. Final 4.0.0 installation and activation checks passed for
Codex, Claude Code and Zed, including packaged server parity, narrow approval
settings and discovery of all ten skills.

### Roadmap at the 4.0.0 release

Three optional capabilities are planned beyond 4.0.0:

1. **Deeper GitHub / GitLab integration** for coordinating work across multiple
   people, including shared work status, ownership and review handoffs.
2. **A knowledge base built as work happens**, capturing decisions and learning
   during delivery and using relevant knowledge as context for subsequent work.
3. **Polyrepo support** for coordinating dependencies and delivery across
   multiple repositories while retaining per-repository history and approvals.

Each capability will be independently **opt-in and disabled by default**. The
core single-repository workflow will remain usable without enabling any of them.
These are upcoming roadmap items, not features shipped in 4.0.0; no delivery dates
are committed. See the [roadmap](/team-and-polyrepo).

### Older-project upgrade route

1. Install the bridge: `npm install -g cadre-ai@3.9.0`, then `cadre-ai install --target all --scope user`. Reload the client.
2. In 3.9.0, complete or reconcile interrupted operations and run Cadre refresh for an explicitly approved migration to schema-2 project/active-track state and template v5 at a quiescent boundary. Preserve historical records. Make any required approval-policy choice explicitly.
3. Install `cadre-ai@4.0.0`, run `cadre-ai install --target all --scope user`, reload the client and continue.

This bridge is unnecessary for compatible 3.9.x/v5 projects. An already inconsistent track still requires its existing approved recovery; installation never repairs approval records by changing labels.

## 3.9.2 - Unreleased

Cadre 3.9.2 fixes an active-revision bug in 3.9.1 that could strand a revised track with **“Autonomous scope changed; obtain explicit authority through refresh/revise.”** A revision record could be committed while canonical state still retained revision 1 and the original execution authority. Repeating receipt reconciliation could not advance fields missing from that approved promotion.

### Active revision fix

- Preview and approve the revision record, state revision, scope authority, and execution disposition together. Reject incomplete scope-only promotions and inconsistent revision numbers before mutation.
- At a quiescent boundary, preserve the old journal as `superseded` history and start a new execution for the revised graph. Keep original authorization, cumulative review baseline, finding identities/attempts, completed-task commits, verification, and handoffs. Superseded does not claim successful completion.
- Inherit approval and scheduling modes. An empty historical scheduler now routes to the new execution instead of becoming a delivery blocker.
- Preserve completed tasks and phases. Reject new members in completed commit groups, rewritten authority/history, and unfinished worker/task activity; appended delivery uses a fresh group.
- Clarify the v5 revise prepare path so it does not run legacy inspection against the old execution binding. Existing committed retries remain zero-change and preserve their original receipt.
- Treat removed worker worktrees and branches as historical provenance, including paths inherited from earlier executions. Revise and refresh check actual Git/filesystem activity, retain completed evidence, and still reject live workers, orphaned paths, retained branches, and unsafe symlinks.
- Support active scope cascades within one v5 refresh approval. Each affected track supplies a fresh revision record, synchronized counters, and reassessed learning/dependency context; the runtime derives journal supersession and renewed Autonomous scope authority. Context-only refresh keeps the journal and scope references stable, including identical copied spec/plan files.
- Reject standalone revision-record promotions and records that disagree with canonical spec/plan counters. Reject counter-only context refreshes while retaining learning-only dependent reseeding.
- Preserve the complete original Autonomous authority during context refresh, including its cumulative review baseline, finding attempts and blockers. Reject authored authority/policy rewrites before mutation; verify explicitly created legacy migration authority against its original execution.
- Persist approved unchanged-input fingerprints in the temporary recovery journal. Resume rejects changed pattern, dependency and context inputs before any remaining writes, preserves dirty files and pending intent, and retains zero-change committed replay. Published receipt formats remain unchanged; older pending receipts check fingerprints retained in their proposed artifacts.
- Support approved-spec revisions in imported `drafting-plan` tracks after refresh. Retain prior spec approval, keep the draft plan unapproved, and return to track planning before implementation. Initial drafts without a plan use explicit previous plan revision 0.

### Review, reversal and retry safeguards

- Enforce the persisted blocked/stalled Autonomous gate before automatic remediation and generic recovery. A proposed checkpoint cannot remove a blocker; only the explicit approved refresh retry renews authority. Pending remediation retains its original authority even after state promotion or candidate-stage loss.
- Bind revert reconciliation to the complete original artifact manifest from `candidate_inspect.files`. Reject changed, missing or extra authored artifacts before writing state; preserve exact authority through self-contained ignored recovery proof. Correct the regression fixture that previously read the nonexistent `manifest` result field.
- Verify actual reversal patches/results in an isolated Git index and object directory. Reject empty, unrelated, incomplete, reordered or wrong-result reversals; require retained execution provenance and explicitly approved merge mainlines. Conflict resolutions require an approved result tree limited to the target paths. Published receipt schemas and immutable templates remain unchanged.
- Reject changed product or verification-policy content before clean completion in every approval mode. Interrupted clean and finding-bearing review recovery checks the reviewed HEAD before remaining writes; already committed approvals retain historical zero-change replay.
- Constrain revert reconciliation to its persisted approved reversal, reachable additive reversal commits, exact durable reversal record, retained original journal and matching restored execution. Preserve the original Autonomous authorization, cumulative baseline, finding attempts and blockers; reject state-only authority rewrites.
- Add an explicit `reviewRetry` request to refresh prepare for blocked/stalled policy-v2 Autonomous loops. A new digest-bound approval records the full prior loop and human instructions, retains every attempt and the original cumulative baseline, and grants a new bounded two-attempt budget. Healthy loops cannot silently renew authority.
- Correct archive interruption guidance: resume the original pending promotion through `candidate_apply`, commit/reconcile once, and use the original archive token only for committed replay. Do not repeat apply or create another batch to bypass `COMMIT_PENDING`.

### Create and target-scoped reversal fixes

- Bind create approval to the repository HEAD, index and tracked/untracked product inputs. Recheck canonical setup before initial promotion; stale proposals cannot overwrite a newer initialized project. Interrupted setup retains the original repository evidence, while committed receipt replay remains zero-change after later delivery.
- Require reversal commits and journal resets to match the named task, phase or track and approved whole shared group. Reject commits from another scope and omitted delivery boundaries; a phase integration reverses its introduced tasks once. Preserve unrelated nodes, worker history, handoffs and the execution contract.
- Compute Git’s rename-aware reversal result in disposable refs, worktree, index and object storage. Verify exact resulting trees and bound approved conflict resolutions to target paths and verified later renames, preserving the delivery Git state.
- Retain pre-existing user edits through an approved `reverts/revert-<id>-baseline.json` artifact. Stage preparation returns `revertBaseline`; the operation names its `repositoryBaselinePath`. Changed product/policy inputs still block apply and recovery. The runtime never stashes, cleans or commits those user files.
- Published receipts and immutable templates remain unchanged. Existing projects need no schema migration. Older pending operations retain their original approval contract; missing required evidence needs an explicitly approved repair rather than fabricated hashes or repeated Git reversals.

### Shared review and execution-history invariants

- Apply completed-plan preservation to every review mode. Remediation keeps the specification revision and completed phases/tasks intact, increments the plan revision once, and appends one execution-bound review cycle. Ordinary review cannot silently reopen delivered work.
- Preserve completed and superseded execution journals byte-for-byte during refresh. Active journal changes are limited to an explicitly supported legacy policy migration or runtime-derived supersession; context refresh cannot replace verification, approvals, commits or handoffs.
- Distinguish actual merge deltas from direct-main and fast-forward completion heads during phase/track reversal. Require every uncovered task boundary, require separate reversals for tasks already present in the selected merge mainline, and reject reversing a task twice through its covering merge.
- Enforce the same preservation rules before preview/promotion and during pending recovery. New ignored recovery journals retain exact original state, plan and journal bytes. Older intents reuse matching original evidence when available and otherwise require an approved repair; committed receipts remain historical zero-change replay.
- Published receipt schemas and immutable templates remain unchanged. Existing healthy projects need a runtime update/server restart, without a project migration. Already-affected state needs an explicitly approved evidence-based repair.

### Project-wide transition admission

- Share project configuration, track identity, terminal review, dependency readiness and cycle rules between candidate promotion and canonical validation. Validate the proposed overlay without writing a temporary control plane, including during interrupted recovery.
- Preserve lifecycle status, checkpoint, execution ownership and commit authority during context-only refresh. Completion belongs to clean review; scope changes use their approved revision transition.
- Reserve track IDs across active and archived locations. Archived work requires a distinct successor ID; an older pending duplicate proposal is retained for approved repair.
- Treat dependency changes as scope revisions even when plan text is unchanged. Require the next track revision and a fresh revision record, and reject active delivery with unfinished dependencies.
- Reject invalid project context and removal of required ignore rules before promotion. Shared configuration checks cover recovery after stage loss as well as fresh proposals.
- Keep published receipt schemas and immutable templates unchanged. Healthy projects need the updated runtime and server restart, without a project migration. Invalid older pending operations retain their intent and files for an explicitly approved repair.

### Workflow routing and refresh records

- Correct Zed upgrade guidance: run `workspace: reload` before opening a new Agent thread. Native testing found that replacing the installed payload can leave a running workspace with an empty cached skill list; reloading restores all ten skills.

- Require a fresh, nonempty Markdown audit record for every refresh, including context-only updates, policy migration and approved Autonomous retries. Preserve earlier records and bind the selected new record into project refresh metadata and history. Multiple fresh migration records remain supported.
- Reject revise proposals that create a track without an existing approved active baseline. New tracks use track; completed or archived work uses a distinct successor.
- Preserve the committed approved specification, revision and dependencies when finishing an imported draft plan. Scope changes use revise, even when the working copy already contains an unapproved specification edit.
- Recheck these boundaries during interrupted promotion using original before-images, including after partial writes and stage loss. Reject invalid older pending intents without changing their files; preserve zero-change replay for already-committed approvals. Healthy projects need only the updated runtime and server restart, without a schema migration.

### Revision recovery and draft counter boundaries

- Share basic track-state validation between canonical reads and proposed overlays. Reject empty checkpoints and malformed state before approval or interrupted promotion, rather than reporting a valid proposal that becomes invalid canonical state.
- Enforce fresh revision records, synchronized specification/plan/track counters and retained history during pending revision recovery. Reject incomplete older specification-only promotions, reused records, stale counters and erased history without changing the pending intent or remaining files. Refresh scope revisions use the same record checks.
- Bind draft planning's specification revision counter to the reachable specification approval, even if an unapproved on-disk draft has already changed its counter. Valid draft planning and partial recovery remain supported.
- Preserve already-committed receipt replay and supported evidence-based repairs. These guards do not change published receipt schemas or immutable templates; healthy projects need the updated runtime and server restart, without a project migration.

### Imported draft revision authority

- Resolve imported draft specification counters from their reachable approval commit during track, revise and refresh. Edited unapproved draft counters cannot become the baseline for a new scope revision.
- Recheck the draft lifecycle during pending revision recovery. A specification revision retains `drafting-plan`, its prior specification evidence and an unapproved plan; it cannot create plan or execution approval. Invalid older intents remain available for approved repair.
- Allow a scope refresh to introduce the first draft plan when the approved specification predates it. Missing proposed artifacts count as additions instead of causing a filesystem error.
- Repeated revise/refresh sequences and interrupted promotion retain valid draft approvals. Receipt schemas and templates are unchanged; healthy projects need a runtime update and client restart, without migration.

### Repairing an already stuck track

Updating the runtime prevents the faulty transition; it does **not** silently rewrite previously approved state. Reconcile the original receipt once, preserve it and the original revision record, and use revise to prepare a fresh, explicitly approved repair from actual canonical counters and verified execution evidence. When the current plan and journal differ, the repair names the original execution graph and reachable plan commit under `Recovery evidence`; the runtime verifies that committed baseline. Do not manually clear operations or rewrite journals to bypass the scope guard.

### Validation

Latest verification passed **450/450 maintained tests**, including 11 new imported-draft regressions. A further **24/24 packaged stdio cases** passed across three client identities, four approval modes and both schedules. The matrix rotated all four two-step revise/refresh orders and initial-plan variants, recovered 48 revisions, and completed planning, implementation, review and archive for all 24 tracks. Frozen installation, type checking, package validation, pack dry run, all ten skill validators and full documentation checks passed. The final candidate is installed and enabled in Codex and Claude; all three installed MCP bundles match the tested build and initialize with 25 tools. Native Zed lists all ten skills and shows an active server after workspace reload. The locally packed global CLI reports 3.9.2 and passes doctor. These are synthetic runtime fixtures plus native installation checks, not exhaustive model-driven conversations. No additional defect appeared in the final pass; publication has not been performed.

Previous verification passed **439/439 maintained tests**, including 19 new revision-recovery and draft-counter regressions. A further **24/24 packaged stdio matrix cases** passed across three client identities, four approval modes and both schedules; all 24 tracks completed revision, implementation, review and archive. Frozen installation, strict type checking, package validation, pack dry run, all ten skill validators and full documentation checks passed. Codex and Claude report the updated candidate enabled; all three installed MCP bundles match the tested build and initialize with 25 tools. Native Zed lists all ten skills and shows an active server after workspace reload. The locally packed global CLI reports 3.9.2 and passes doctor. These are synthetic runtime fixtures plus native installation checks, not exhaustive model-driven conversations. No known blockers remain in this tested scope; publication has not been performed.

Previous verification passed **420/420 maintained tests**, including 20 new workflow-routing and refresh-record regressions. A further **48/48 matrix cases** passed: 24 full lifecycle cases and 24 packaged stdio routing/restart cases across three client identities, four approval modes and both schedules. These cases completed review and archive for 72 tracks. Frozen installation, type checking, package validation, pack dry run, all ten skill validators and full docs checks passed; the final installer guidance also passed all eight CLI tests. The updated candidate is installed and enabled in Codex and Claude. All three installed MCP bundles match the tested build and initialize with 25 tools; native Zed lists all ten skills and shows an active server after `workspace: reload`. The global CLI reports 3.9.2 and passes doctor. These are synthetic runtime fixtures plus native installation checks, not exhaustive model-driven conversations. No known blockers remain in the tested scope; publication has not been performed.

Previous verification passed **400/400 maintained tests**, including 21 new regressions for project-wide admission, context-refresh preservation, dependency revisions and interrupted recovery. **144/144 packaged stdio cases** passed across three client identities, four approval modes and both scheduling modes: 96 unsafe transition cases, 24 repeated remediation flows through archive, and 24 final configuration/restart flows through refresh, review and archive. A separate **24/24 lifecycle matrix** completed revision, revert, review, archive, refresh and successor delivery. Type checking, package validation, pack dry run, complete docs checks and all ten skill validators passed. These are runtime fixtures with explicit synthetic approvals, not exhaustive native AI conversations. The final candidate installed successfully in Codex, Claude and Zed; Codex/Claude report enabled candidate versions, all three installed MCP bundles match the tested build and initialize with 25 tools, and unrelated client settings are preserved. Zed native verification also passed: its Skills settings list all ten Cadre workflows, and MCP settings show Cadre enabled with a green server status. The native Zed process launches the tested packaged bundle. No known release blockers remain in the tested scope; publication has not been performed.

Previous follow-up verification passed **357/357 maintained tests**, with 40 new regressions for repository-bound create, target-aligned reversals, rename semantics, retained edits and recovery. **169/169 packaged stdio checks** passed: 156 matrix cases, three unborn-Git checks, seven existing review/revert recovery checks and three nested-baseline restart recoveries. The matrix covers all four approval modes and both requested scheduling modes across three client identities; 120 valid reversals finished review/archive and 24 wrong-scope reconciliations were rejected. These are runtime fixtures, not exhaustive native AI conversations. Native installer/activation validation remains a publication gate.

Earlier verification on 2026-10-13 recorded **317/317 maintained harness tests**, including 38 new regressions for blocked review, approval manifests, reversal results and recovery. The follow-up matrix passed **78/78 cases** and **15/15 packaged stdio server checks**, covering former defect rejection, complete lifecycle, repeated retry budgets, interrupted archive and restart recovery. Earlier verification passed 102 matrix and nine packaged cases. Type, package, packaging, and documentation checks pass. These are disposable runtime fixtures with explicit test approvals; exhaustive native AI-session coverage is not claimed. Final patched-payload installation and activation remain publication gates.

### Upgrade

```bash
npm install -g cadre-ai@3.9.2
cadre-ai --version
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, reload Claude Code plugins, and run `workspace: reload` in Zed before opening a new Agent thread. Existing 3.9.0/3.9.1 projects using v5 need no routine refresh or schema/template migration. Older contracts retain their existing approved refresh requirements. Codex, Claude Code, and native Zed Agent remain stable integrations. Final clean completion still requires explicit approval.


## 3.9.1 - 2026-10-01

Cadre 3.9.1 fixes implementation/review bookkeeping loops and interrupted-operation recovery. Native Zed Agent joins Codex and Claude Code as a stable integration. Track remains the default approval mode and Parallel remains the default scheduling mode; clean completion still requires explicit final approval.

### Lifecycle and recovery fixes

- Preserve the verified implementation HEAD and original Autonomous execution authority across bookkeeping commits. Route already committed prerequisites forward instead of requesting another bookkeeping commit.
- Replay completed implementation, clean-review, revision, refresh, and archive operations from their original immutable receipts. Verify approval identity and unique reachable Git evidence; successful retries make zero changes and do not append history or create another commit.
- Resolve archive receipts before checking moved-track eligibility or reading removed candidate stages, and return the actual receipt path.
- Permit only exact runtime-generated track-index changes during parallel integration, with proposal-bound hashes. Continue rejecting tampered state, unrelated dirty files, and worker edits to protected Cadre artifacts.
- Include exact derived state changes in candidate and archive previews, including project history and refresh metadata. Archive preview and apply share one deterministic derivation so reviewers can reconstruct the final files and verify their hashes.
- Reject incomplete specification sections before promotion. Stale dependency diagnostics identify the exact expected sources and fingerprints for reassessment.
- Clarify exact scheduler node IDs, safe artifact filenames, governed pause/resume, apply-time approval confirmation, and approval ordering around additive Git reverts. Explicitly map `implement auto` to Autonomous approval mode.
- Fix the homepage Digests label contrast in dark mode by giving its amber background a matching dark-theme token.

### Stable Zed Agent

Zed Agent support is stable as of 3.9.1. The integration continues to use ten global `cadre-*` skills, the packaged custom MCP server, exact tool permission entries, and the existing chat fallback for approval forms. Native plugins remain the integration path for Codex and Claude Code.

### Validation

Native Codex fixtures exercised all ten workflows and all eight approval/scheduling combinations: Governed, Phase, Track, and Autonomous with Sequential and Parallel scheduling. Nine fixtures ended valid and clean with 11 archived tracks, 56 uniquely verified receipts, and no live workers or managed worktrees. Additional paths covered planned revision, active task reversal/reimplementation, archived revise and completed revert successors, batch archive, and two context refreshes. Fixtures used explicitly scoped test approvals; these results cover representative lifecycle paths rather than every possible repository or conflict.

All 118 harness tests passed, along with package and documentation checks. Automated regressions cover receipt replay, approval identity, derived-state hash reconstruction, integration tampering, dependency diagnostics, and patch compatibility. Installed Codex and Claude plugins are enabled at the candidate version; Zed discovers all ten skills with the packaged server active. Homepage checks cover light/dark themes and desktop/mobile rendering.

### Upgrade and compatibility

```bash
npm install -g cadre-ai@3.9.1
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, reload Claude Code plugins, and open a new Zed Agent thread. Existing 3.9.0/v5 projects continue without a refresh, schema migration, or rewritten history. Template set v5 and schema-2 state are unchanged. Interrupted tracks may still need their existing receipt reconciled before continuation. Older runtime/template contracts retain their approved refresh requirements. Installation does not approve project work.

Direct MCP clients should accept the additional `stateChanges` preview fields and zero-change committed retry results. Re-run previews in a new server session; process-local proposal tokens are not portable between sessions.

## 3.9.0 - 2026-09-25

Cadre 3.9.0 reduces bookkeeping commits and repeated context while preserving human approval, verification, provenance, and interruption recovery. Track remains the default approval mode and Parallel remains the default scheduling mode. Codex and Claude Code are stable integrations; native Zed Agent remains beta.

### Cohesive commits and verifiable lineage

- Introduce immutable template set **v5** and schema-2 project/track state. Preserve published v1–v4 templates and historical SHA-based records.
- Replace follow-up SHA-recording commits with stable operation references and immutable receipts. Each receipt binds the approval digest, base commit, and exact artifact hashes; Git trailers identify it. Resolution verifies a unique commit reachable from HEAD and its committed contents rather than trusting a trailer alone.
- Persist recovery intent before promotion. Pending commits block dependent delivery; reconciliation changes temporary state only. Commit execution stays with the agent's Git tools.
- Use one initialization commit; one combined specification, plan, learning and dependency-context commit; one commit per approved revision, refresh or archive batch; and one execution-completion and clean-review commit each. Remove automatic execution-start, phase-record, final-verification-phase and clean-evidence-only commits. Explicit handoff/blocker checkpoints remain available.
- Let related tasks in one phase share an approved commit group. Preserve individual task verification, authorization and handoffs; validate the collapsed dependency graph and schedule independent groups in parallel. A shared-commit reversal requires approval and reconciliation for every affected task.

### Bounded context and MCP work

- Capture approved, source-linked dependency contracts and inherited constraints on active tracks. Verify source fingerprints and approval provenance; missing or stale coverage triggers explicit reassessment or an identified full-source fallback. Required project instructions and the complete current specification/plan remain authoritative.
- Add compact retained-context tokens after complete retrieval, section-level reuse, 48 KiB default pages and the existing 64 KiB maximum. Preserve inventory compatibility, expiry handling, context-loss resets, stale-memory checks and pagination drift detection.
- Add atomic `complete_group` checkpoints, composite verification without separate starts, direct-main phase completion and reusable scheduler results.
- Add constrained `candidate_apply` for track, revise, refresh, review remediation and revert reconciliation. It promotes only approved Cadre artifacts and records recovery/provenance; it cannot edit arbitrary product files or execute Git commands.
- Cap ordinary serialized runtime errors at **8 KiB**, retaining complete diagnostics through explicit `diagnostic_read` pagination. The purpose-built MCP catalog now has 25 tools.

### Integration and recovery fixes

- Permit only validated, execution-bound coordinator state/journal changes during integration, and verify their contents remain unchanged. Continue rejecting unrelated dirty files and worker edits to protected Cadre state.
- Prefer fast-forward integration; create merge commits only for divergent histories. Record integration provenance in either case.
- Provide a narrowly ignored, ownership-checked build-cache directory and reject unowned content or symlink escapes.
- Recover receipts whose trailers were supplied in separate Git message paragraphs, allow empty archive update manifests, and accept standard review bug artifact paths.
- Rebase active dependency-context source paths under the approved archive batch while preserving archived learning. Batch committed artifact reads and reuse receipt resolution during an inspection.

### Measured validation

- **111 automated tests** cover receipts, crash recovery, grouped scheduling/reverts, dirty-state integration, bounded errors, context freshness/pagination, legacy migration and historical evidence.
- A fresh native Codex lifecycle completed create → track → implement → clean review → archive, plus status and read-only Wisp, with **6 commits, 37 Cadre calls and zero separate verification starts**.
- Disposable native Codex sessions exercised all ten workflows, including revision recovery, whole-group additive reversal and review remediation.
- Controlled FRM-shaped context replay reduced combined request/response bytes by **93.4%** (743,728 → 49,033) and calls from **45 to 5**. The smaller Dhivon-shaped replay reduced bytes by **19.9%** (46,742 → 37,442), with no call-count regression.
- A synthetic 6,113-path error serialized to **700 bytes** in the ordinary MCP response. Full diagnostics remained readable.

These are synthetic regression/native-fixture results, not a same-scope rerun of the original FRM and Dhivon sessions. Token usage, elapsed time, calls and bytes are reported separately in the audit; byte reduction is not a token-savings claim.

### Upgrade and compatibility

```bash
npm install -g cadre-ai@3.9.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, reload Claude Code plugins, and open a new Zed Agent thread. Installation updates the runtime and skills; it does not migrate project state or approve work.

Use one approved refresh at a quiescent boundary to migrate an existing project to runtime 3.9.0, template set v5 and schema-2 state. Include reassessed dependency context for active tracks. Preserve approvals, findings, completed nodes, historical journals and SHA references. Existing executions retain their original contract; commit grouping applies to new executions. Cadre 3.8.0/v4 executions may continue their original contract to a safe boundary before refresh. Earlier legacy policy migrations still require their explicit authority choice.

Curated dependency context requires human review for completeness. Fingerprints establish freshness and receipt verification establishes provenance; neither substitutes for assessing the actual requirements. No existing Git history is rewritten.


## 3.8.0 - 2026-09-08

Cadre 3.8.0 makes Track the default approval mode and introduces continuous
Autonomous implementation, verification, cumulative review, and remediation.
Parallel remains the scheduling default; Sequential is available with all four
approval modes. Codex and Claude Code remain stable integrations; Zed remains beta.

### Approval modes

| Mode | Human approval boundaries |
|---|---|
| Governed | Task, integration, phase verification, track verification, and review |
| Phase | Phase verification, track verification, and review |
| **Track — default** | Track verification and review; the previous Autonomous behavior |
| Autonomous | One final approval after implementation, verification, review, and remediation reach a clean result |

Autonomous follows MCP `nextStep` into the installed implement/review skills.
`ready_for_review` is an internal lifecycle handoff, not an intermediate pause.
After a clean review, Cadre presents verification results, remediation history,
and the exact completion proposal. The author can approve that proposal without
running review again or report additional bugs to continue remediation. Only
explicit approval marks the track completed. Changed product or verification
inputs require renewed verification/review.

### Durable review and recovery

- Persist the original authorization, initial review baseline, loop checkpoint,
  stable finding identities, and remediation attempt history.
- Inspect and bind exact staged remediation artifacts to the persisted Autonomous
  authorization; validate review journals before promotion and revalidate digests
  during recovery.
- Start a new execution for each remediation graph while preserving completed
  phases, historical execution journals, findings, and commit provenance.
- Review the complete accumulated implementation, including remediation changes.
- Continue while making verifiable progress; pause after the same finding remains
  unresolved through two remediation attempts, or for scope decisions, conflicting
  requirements, unavailable verification, and external blockers.
- Never treat persisted-mode authorization as the final human completion decision.

### Fixes

- Start the MCP server through symlinked payload paths, including macOS temporary
  directory aliases.
- Accept `project_status` with an omitted or null execution ID to select persisted
  current state, while rejecting invented execution IDs.
- Reject malformed review operation/artifact fields before promotion and document
  the exact resumable journal contract.

### Upgrade and migration

```bash
npm install -g cadre-ai@3.8.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new Zed
Agent thread. Existing projects remain readable and require an approved refresh
to runtime 3.8.0 and template set v4 before further delivery. Published v1–v3
templates remain unchanged, and v4 retains the v3 memory requirements.

Legacy Autonomous does not authorize the expanded loop. At a quiescent worker
boundary, use the existing staged, digest-bound refresh to explicitly choose
Track (retain the previous gates) or Autonomous (authorize the continuous loop).
Status exposes the migration requirement; the refresh journals the exact choice
and preserves completed historical evidence. Existing Governed and Phase choices
remain intact. Journals without an approval mode retain conservative handling.
Installation itself neither migrates project authority nor approves completion.

### Validation

96 automated tests cover modes independently of scheduling, inheritance, legacy
migration, repeated remediation, stalls and blockers, stale proposals, recovery,
and v3/v4 compatibility. Release validation also includes strict TypeScript,
package validation and dry-run inspection, documentation checks, and native
Codex/Claude/Zed installation, skill discovery, and MCP activation.

Disposable native projects verified clean-first-pass and remediation loops,
Track-default gates, and withheld final approval. Native Zed also recovered a
validated pre-promotion review journal in a fresh task without duplicate phases,
findings, executions, or commits. Zed can still need recoverable tool-input and
plan-format retries; validation rejects invalid inputs without weakening gates.

## 3.7.1 - 2026-09-07

Fixes finding-bearing review and scope-revision proposals that failed validation
before Cadre could return an approval digest. Inspection now validates the proposed
lifecycle transition while preserving the canonical state and completed execution
until approval. The digest requirement remains intact.

Completed former final verification phases keep their titles, task IDs, commit
provenance, and original dependencies when remediation adds a new final gate.
Replacement executions carry that completed work forward. Between approved
promotion and replacement execution, `context_read` labels retained handoffs as
historical evidence instead of blocking on the older graph.

Validation also rejects conflicting staged state/plan targets, empty approved
plans, malformed staged plan syntax, and reopening terminal tracks. Active
execution checks remain enforced, and missing or malformed unapproved drafts
can still be repaired through staging.

### Upgrade

```bash
npm install -g cadre-ai@3.7.1
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new Zed
Agent thread. Template set v3 and published v1/v2/v3 files are unchanged.
Existing projects, including 3.7.0 projects, remain readable and use the approved
`refresh` workflow to record runtime 3.7.1 before delivery. Re-inspect a blocked
review proposal with the updated server, then obtain approval bound to its digest.

### Validation

The 82 automated tests cover staged review, nested revision, repeated verification
cycles, replacement execution, historical context, and Codex/Claude structured
responses plus Zed text responses. Release checks include type checking, package
validation and dry-run inspection, documentation checks, and native installer,
discovery, and MCP activation. Zed remains beta.

## 3.7.0 - 2026-09-06

Adds template v3, durable task handoffs, seed-freshness validation, scoped `context_read` with drift-sensitive pagination, compact status/detail views, and batched provenance validation. Existing projects require an approved refresh before further delivery; v1/v2 templates and historical evidence remain unchanged. The runtime remains self-contained, and approval, verification, and commit provenance requirements remain intact.

### Audit corrections

Cadre 3.7.0 checks linked pattern references and Markdown fences, rejects invalid staged revision paths and lost execution bindings, verifies plan provenance, and reads archived execution detail. Review preparation evidence is separate from the confirmation recorded by apply. Error messages remain visible in native Claude. Refresh bookkeeping retains history against committed artifacts, and revert preparation explicitly preserves the target worktree and index. Resetting execution evidence requires an exact original journal snapshot, and completion retains the approval digest and resulting commit provenance in a durable receipt/history entry.

Context reuse requires retained source text in the current session; fresh sessions read it again. Aggregate byte measurements include requests and a cold resume. Small projects can have higher overhead. Bytes are not tokens, and structural checks do not prove the truth of agent-authored learning. Native installation and activation across all three clients remain release prerequisites.

The native Zed audit also made the revert write order explicit: persist and reread the approval receipt before restoring implement ownership, initially leaving the reconciliation SHA null. Commit that receipt with reconciliation, then record the actual SHA and history entry. This keeps approval evidence available during interrupted bookkeeping.

### Upgrade

```bash
npm install -g cadre-ai@3.7.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new Zed Agent thread. Existing projects need one approved refresh before delivery can continue.

### Validation

All 79 automated tests, package checks, and documentation checks passed. Native Claude/Codex audits and native Zed installation, discovery, MCP, staged-revert, and fresh-session recovery checks passed. Zed remains beta; native testing does not cover every possible workflow branch.

## 3.6.0 - 2026-09-02

### Agent-visible MCP results

- All 22 MCP tools now publish output schemas covering their stable
  agent-facing fields and exact success/error variants.
- Every response ends with compact JSON that is deeply equal to
  `structuredContent`, including elicitation, templates, status, execution,
  mutations, and structured failures. Agents can safely recover
  `proposalToken` and every other follow-up field from model-visible text.
- Approval-required results include the complete proposal and
  `proposalToken`; applied results omit the token. Template and candidate
  bodies remain outside mirrored descriptors.
- The serialized tool-catalog limit is now 64 KiB to accommodate output
  schemas while preserving Node 18 support and the existing 22 tool names and
  wire shapes.
- Zed installation now refreshes Node executable-path changes for an existing
  server that still targets the exact Cadre-managed MCP file; foreign server
  targets remain protected from replacement.

Canonical artifact formats and template set v2 are unchanged. Existing 3.5.1
projects remain readable and use the normal approved `refresh` workflow to
record runtime 3.6.0 before further mutation.

```bash
npm install -g cadre-ai@3.6.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new
Zed Agent thread so each client loads the 3.6.0 schemas and runtime guidance.

## 3.5.1 - 2026-08-27

Cadre 3.5.1 hardens all ten workflows against validation, routing, stale-stage,
and interrupted-write failures. Codex and Claude Code support remains stable;
native Zed Agent support remains beta.

### Candidate and status recovery

- Candidate inspection validates every staged root or nested `plan.md` through
  exact `planValidations`, returns sorted `plans`, and binds validation context
  into the approval digest.
- Candidate preparation accepts `expectedFiles` and safely prunes obsolete
  regular files after a complete symlink/non-file preflight.
- Project status reports sorted staged candidates in project view and keeps
  canonical, candidate-only, shadowed, malformed, and unknown states distinct.
  Focused views include complete errors and a selected-track/dependency subset.
- Track, revise, review, revert, refresh, status, and archive guidance now stop
  or resume at the correct lifecycle boundary instead of confusing an
  unapproved stage with canonical state.

### Convergent operations

- Project initialization resumes when partial canonical files exactly match
  the approved proposal.
- Execution finish reuses persisted completion evidence and completes any
  remaining journal, state, plan, or index writes.
- Clean-review retry repairs a stale index without duplicating its review
  cycle. Its Git range is derived from execution base through reviewed HEAD.
- Archive apply and record resume from their approved operation journal and do
  not duplicate track or project history.
- Implementation creates one final `cadre(implement): complete <track-id>`
  bookkeeping commit before review.

### Corrected MCP schemas

The four approval-aware tools now use strict `request` prepare/apply unions,
and `execution_checkpoint` uses strict `scope` plus event-specific `action`
objects. The retired `candidate_inspect.targetStatus`, singular `plan` result,
and `review_complete.commitRangeStart` are removed. The MCP surface remains 22
tools within the 18 KiB catalog limit.

Unapproved 3.5.0 candidate stages must be re-inspected. Approved operation
journals remain readable and resumable. Existing 3.5.0 projects use the normal
approved `refresh` workflow to record runtime 3.5.1; template set v2 is
unchanged.

```bash
npm install -g cadre-ai@3.5.1
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, run `/reload-plugins` in Claude Code, and open a new
Zed Agent thread so each client loads the corrected schemas and skills.

## 3.5.0 - 2026-08-27

Cadre 3.5.0 adds beta support for the native Zed Agent. Codex and Claude Code
remain stable integrations, and Cadre's lifecycle, governance, project state,
and active v2 template semantics are unchanged.

### Native Zed Agent beta

- `cadre-ai install --target zed` installs all ten workflows as global
  `/cadre-*` skills and configures the packaged Cadre MCP server.
- Auto-detection includes Zed when its CLI is installed, and `--target all`
  now selects Codex, Claude Code, and Zed.
- Installation preserves Zed JSONC comments and unrelated settings, uses
  collision-safe skill links, and adds one exact allow rule for each of the 22
  Cadre MCP tools unless `--prompt-mcp-tools` is supplied.
- Uninstall removes only Cadre-owned skill links and a matching context-server
  entry. It preserves permission preferences and unrelated configuration.

### Zed runtime compatibility

- Generated Zed skills request `template_get_many` with
  `contentMode: "text"`; Codex and Claude retain the embedded-resource default.
- Zed uses the existing single-question chat fallback because it does not
  advertise MCP form elicitation.
- The MCP tool catalog is centralized so server registration, permissions,
  validation, and tests cannot drift.

### Compatibility and upgrade

Existing 3.4 projects remain readable. After installing 3.5.0, run Cadre
`refresh` and approve the runtime-version update before further state mutation;
the template set remains v2 and no lifecycle migration is introduced.

```bash
npm install -g cadre-ai@3.5.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation, run `/reload-plugins` in Claude Code, and open
a new Zed Agent thread. In Zed, verify the ten beta `cadre-*` skills, the
active Cadre MCP server, and `/cadre-status`.

## 3.4.0 - 2026-08-27

Cadre 3.4 is a breaking MCP and template-efficiency release. It reduces the
public surface to 22 tools, makes adaptive schemas honest, coalesces execution
bookkeeping, and introduces compact v2 project workflow defaults.

### Breaking MCP migration

- Every approval-aware command now requires `mode: "prepare" | "apply"` and
  rejects mixed shapes. Apply accepts only `proposalToken`.
- `candidate_inspect` replaces separate manifest and staged-plan reads.
- `project_status` gains project, track, and implementation views; implementation
  preflight is one call.
- Template discovery and individual reads use MCP resources; known bundles use
  `template_get_many`. Template bodies occur once as embedded resources and
  structured data contains descriptors only.
- Apply receipts contain status, digest/checkpoint, counts, and changed paths
  instead of repeated manifests or canonical bodies.

### Candidate and initialization safety

- Candidate staging now lives under `.cadre/stage/<candidate-id>/`; Cadre
  enforces `/stage/` in `.cadre/.gitignore` before files are written.
- `.cadre/init/*` is never a project destination. During initial creation the
  `.cadre` bootstrap shell may contain only `.gitignore` and `stage`.
- Initialization requires staged product, guidelines, and tech-stack files.
  The MCP generates unchanged workflow and selected styleguide defaults, binds
  them into the approval digest, and accepts staged overrides.

### v1 to v2 refresh

- Published v1 templates remain immutable and readable; new projects use v2.
- Existing v1 projects report `upgradeRequired`. Status, wisp, and explicit
  refresh remain available; other mutations fail with
  `PROJECT_REFRESH_REQUIRED`.
- Upgrade occurs only through a human-approved refresh containing the compact
  v2 workflow, runtime/template versions, and ignore rule. Nothing rewrites a
  legacy project automatically.

### Execution and budgets

- Worktree creation records start, integration records merge state, and cleanup
  records completion. Lost-response retries finish only the missing half.
- A normal delegated task uses four MCP calls; governed integration uses five.
- Regression budgets cap the tool catalog at 18 KiB, workflow at 6 KiB, common
  template/status bundles at 4–8 KiB, and checkpoint/apply receipts at 4 KiB.

### Compatibility and upgrade

- Direct MCP clients must migrate removed template/candidate/worktree reads to
  resources, `candidate_inspect`, and scoped `project_status`, and must send
  the explicit adaptive `mode` shapes.
- Existing v1 projects stay readable after installation. Run Cadre `refresh`
  and approve the complete v2 workflow/version proposal before using other
  state mutations.
- Proposal tokens created by 3.3.0 are not portable to 3.4.0; prepare the
  operation again under the new schema.

```bash
npm install -g cadre-ai@3.4.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code so both
clients load the 3.4 schemas and skills.

## 3.3.0 - 2026-08-09

Cadre 3.3.0 is an MCP reliability and context-efficiency release. Compared
with 3.2.0, it makes preview/apply proposals restart-safe and replaces repeated
full-journal and full-artifact responses with compact, digest-bound receipts
and manifests. Existing `.cadre` project state remains compatible.

### Durable Proposal Capabilities

- Replaces self-contained gzip/base64 proposal tokens—which could exceed
  27,000 characters during project initialization—with 42-character opaque
  capabilities backed by Cadre-owned runtime records.
- Stores normalized input, proposal kind, semantic digest, schema version, and
  creation time under `${CADRE_HOME:-~/.cadre}/runtime/proposals` so apply can
  continue after an MCP server restart.
- Bounds retention to seven days, 256 records, 32 MiB total, and 8 MiB per
  proposal, with oldest-first cleanup.
- Uses 192-bit random identifiers, exclusive writes, fsync, restrictive file
  permissions, ownership checks, and symlink/path protections. Callers never
  provide a proposal filesystem path.
- Preserves digest recomputation and stale-state rejection for every
  preview/apply pair. A durable token is a capability to the approved input,
  not permission to bypass current-state validation.

### Compact Execution Protocol

- Execution checkpoint preparation now returns the proposed event as a compact
  `from` → `through` → `to` transition receipt plus its checkpoint and digest.
- Execution checkpoint mutation returns the applied receipt and compact
  `derivedStatus`: ready phases, ready tasks, active nodes, blocked nodes, and
  focused event guidance. The complete journal is no longer echoed after every
  transition.
- `execution_status` now defaults to a scheduler view with execution metadata,
  counts, scheduling arrays, minimal active/blocked node records, and relevant
  guidance. Optional `nodeId` returns full detail for one node.
- Full execution journals remain unchanged on disk and remain the canonical
  source for atomic transitions, validation, recovery, and provenance.

In the production journal that exposed the issue, the execution contained 46
nodes. The old derived status represented about 19.5 KiB before MCP framing;
the installed 3.3.0 server returned a complete 3.1 KiB MCP status response with
no embedded journal. Regression budgets cap checkpoint responses below 4 KiB
and a 50-node default status view below 8 KiB.

### Manifest-Based Mutation Results

Large preview/apply families now return concise outcome metadata and
path/SHA-256 manifests instead of repeating canonical content:

- Project initialization returns the complete initialization path/hash
  manifest without echoing the 30 KiB workflow template.
- Execution start reports execution identity, modes, node count, and initial
  scheduling state rather than its complete journal and track state.
- Execution finish reports the final status and hashes for journal, state,
  plan, and `tracks.md`.
- Review and archive report lifecycle outcomes, moves, commits, and hashes
  without repeating complete states, pattern content, seeds, or indexes.
- Derived track-index preview reports its path and SHA-256 digest rather than
  the complete rendered index.

### Compatibility

Existing 3.2.0 projects, operation journals, and execution journals require no
migration. Tool names, `proposalToken` inputs, semantic event names, proposal
digests, and scheduler arrays remain stable. Direct MCP clients must adapt to
the compact response shapes and use reported paths when complete canonical
artifacts are genuinely required.

Proposal tokens created by 3.2.0 are not portable into 3.3.0. Re-run the
matching preview after upgrading; no project mutation is repeated by doing so.

### Upgrade

```bash
npm install -g cadre-ai@3.3.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code after
upgrading so both clients load the 3.3.0 MCP response schemas.

## 3.2.0 - 2026-08-07

Cadre 3.2.0 is a breaking simplification of the MCP execution and governance
surface, based on failure and approval-flow analysis from a complete production
delivery session. It removes compatibility aliases and shifts deterministic
identity, Git, and bookkeeping decisions into the runtime.

### Smaller Execution Contract

- Replaces low-level execution node mutation tools with semantic checkpoint
  commands.
- Uses semantic events—`start`, `record_commit`, `record_integration`,
  `record_verification`, `complete`, `block`, and `resume`—that expand into
  complete legal transition sequences.
- Changes `execution_status` from low-level next-status guidance to semantic
  event guidance with the evidence required by each event.
- Keeps `phase` as the default approval mode and inherits the recorded mode
  when an execution resumes.

### Opaque Preview/Apply Binding

- Every mutation preview returns an opaque `proposalToken`; apply accepts only
  that token.
- Removes repeated apply arguments, caller-supplied proposal digests, and the
  `proposalDigest` compatibility alias.
- Derives execution IDs, timestamps, Git bases and heads, review heads, archive
  IDs and commits, and worktree ancestry from authoritative local state.
- Restricts template inputs to catalog IDs and archive writes to structured
  pattern, pattern-index, and active-track-seed updates.

### Git And Finalization Reliability

- Validates that persisted project, track, plan, execution, review, revision,
  and archive commit references are reachable from repository history.
- Allows canonical integration when only its exact active execution journal is
  dirty while continuing to reject unrelated product or Cadre changes.
- Atomically writes completed plan markers, the execution journal,
  `ready_for_review` state, and the generated `tracks.md` index at finish.
- Derives clean-review evidence with ancestry checks and selects all eligible
  completed tracks in dependency order for a bare archive command.

### Compatibility And Upgrade

The removed 3.1.x MCP tools, repeated apply inputs, and digest alias are not
retained. Existing persisted project state remains validated by the 3.2.0
runtime, but active clients must reinstall the plugin to receive the new tool
schemas.

```bash
npm install -g cadre-ai@3.2.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code after
upgrading.

## 3.1.0 - 2026-07-30

Compared with 3.0.2, Cadre 3.1.0 makes approval frequency an explicit,
persisted execution policy and reduces routine implementation overhead without
weakening digest-gated mutations or manual verification.

### Approval Governance

- Adds `governed`, `phase`, and `autonomous` implementation approval modes.
  `phase` is the default: regular phase work runs autonomously and pauses once
  at the phase's final manual-verification task. `autonomous` pauses only at
  track-level verification; `governed` retains task-by-task gates.
- Treats one approved semantic proposal as an authorization envelope over its
  unchanged deterministic journals, indexes, validation, commits, lifecycle
  transitions, and provenance. Create, track, review, revise, refresh, revert,
  and archive no longer split one decision into mechanical follow-up prompts.
- Keeps material ambiguity, scope changes, failed required checks, unsafe
  state, destructive work, and remote publication outside those envelopes.

### Native Interaction

- Adds the read-only `workflow_elicit` MCP tool for bounded client-native
  clarification and approval forms in Codex and Claude Code.
- Binds approval forms to a proposal digest or immutable verification
  checkpoint and normalizes approval, requested changes, decline, and cancel.
- Uses one concise text question when form elicitation is unsupported or the
  active host policy is non-interactive, including Codex Full Access. Policy
  rejection is not reported as a human decline.
- Summarizes unchanged workflows and defaults instead of printing their full
  content into the conversation.

### Execution Runtime And Efficiency

- Makes `execution_status` self-describing with legal next transitions and
  required evidence. MCP failures now return structured errors, and every
  mutation preview exposes a uniform `proposalDigest` alias.
- Adds ordered execution-node batching guidance, avoids global tool-catalog
  discovery and speculative previews, runs independent read-only checks in
  parallel, and reuses verification when only `.cadre/**` bookkeeping changed.
- Infers task worktree phase identity from its task node ID and makes cleanup
  interruption-safe after an integrated node was already marked complete.
- Finalizes the execution journal, `ready_for_review` state, and derived
  `tracks.md` under one digest, eliminating a separate index-repair step.
- Keeps distinct product-task commits while reducing Cadre-only Git commits to
  phase and final readiness checkpoints.

### Compatibility And Upgrade

Existing 3.0.x projects and execution journals remain readable; missing legacy
approval-mode fields are interpreted as `governed`. Run `refresh` to adopt the
new project workflow guidance. New executions default to `phase` unless the
human explicitly selects another mode.

```bash
npm install -g cadre-ai@3.1.0
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex conversation and run `/reload-plugins` in Claude Code after
upgrading.

## 3.0.2 - 2026-07-29

Compared with 3.0.1, Cadre 3.0.2 validates proposed execution graphs directly
from plan Markdown so approval workflows no longer need temporary project
copies or premature writes to canonical `.cadre/` state.

### Fixed

- Adds read-only validation for an exact unapproved proposal with an explicit
  target lifecycle status.
- Updates `track` to validate the proposed plan as `planned`, and updates
  review remediation to validate the replacement graph as `in_progress` rather
  than checking the stale approved plan under `ready_for_review` rules.
- Updates `revise` to validate changed plan content against its intended
  post-approval status before any approved artifact is replaced.
- Eliminates the temporary control-plane copy workaround and its associated
  cleanup prompts and residue risk.

### Runtime And Compatibility

- Extracts a reusable content parser while preserving the existing file-backed
  parser and canonical `execution_graph_validate` contract for approved plans.
- Bounds draft Markdown input at 256 KiB and accepts an optional diagnostic
  source label without granting the tool access to project paths.
- Adds coverage for derived manual-verification barriers, lifecycle-sensitive
  validation, oversized input rejection, compiled MCP exposure, and zero
  filesystem mutation.

There are no project state-schema, template, command-name, or migration changes
from 3.0.1. Existing initialized projects and approved plan validation remain
compatible.

### Install Or Upgrade

```bash
npm install -g cadre-ai@3.0.2
cadre-ai doctor
cadre-ai install
```

Start a new Codex conversation or reload Claude Code plugins after upgrading.

## 3.0.1 - 2026-07-29

Cadre 3.0.1 fixes project creation in the published npm package and adds
package-boundary safeguards for every native workflow and immutable template.

### Fixed

- Restores the logical `project/gitignore` template required by project
  initialization. npm treated the former nested `.gitignore` source
  file as packlist configuration, omitted the template itself, and also
  suppressed the disposable `wisps/` placeholder from the package.
- Stores the provider asset under the packaging-safe physical name
  `gitignore.template` while preserving the public template ID, content hash,
  generated `.cadre/.gitignore` path, and initialization behavior.
- Makes both `cadre-ai doctor` and `cadre-ai install` reject an incomplete
  immutable template catalog before a marketplace is changed.

### Packaging And Documentation

- Defines the complete 38-template `v1` catalog as an explicit runtime
  contract and rejects missing, unexpected, or duplicate template IDs.
- Adds npm packlist regression coverage for all ten workflow skills, both
  worker definitions, both runtime bundles, native plugin manifests, MCP
  configurations, and every immutable template.
- Audits `track`, `implement`, `review`, `revise`, `archive`, `refresh`,
  `revert`, `status`, and `wisp`; no other workflow asset was missing from the
  published package.
- Points both the repository README and the npm package README to the canonical
  [Cadre documentation](https://cadre-docs.pages.dev/).

There are no command, state-schema, template-content, or migration changes from
3.0.0. Existing initialized projects remain compatible.

### Install Or Upgrade

```bash
npm install -g cadre-ai@3.0.1
cadre-ai doctor
cadre-ai install
```

Start a new Codex conversation or reload Claude Code plugins after upgrading.

## 3.0.0 - 2026-07-28

Cadre 3.0 is a major simplification around a human-governed, Git-aware
create-to-archive lifecycle for OpenAI Codex and Claude Code.

### Workflow Model

- Replaces the prior generic packet workflow with ten native skills: `create`,
  `track`, `implement`, `review`, `revise`, `archive`, `refresh`, `revert`,
  `status`, and `wisp`.
- Uses `.cadre/` for approved mutable target-project state.
- Adds explicit greenfield/brownfield creation, separate workflow/styleguide
  acceptance, feature/bug specifications, validated dependency DAG plans, and
  derived manual-verification barriers.
- Makes parallel implementation the default when multiple safe nodes are ready,
  with explicit sequential mode available.
- Supports clean, journaled handoffs between sequential phase execution and
  task-worker fan-out while retaining worker history and one main scheduler.
- Preserves completed/archived history by routing changed intent to successor
  tracks.

### Human Governance And Recovery

- Adds digest-gated preview/apply operations for deterministic project, review,
  archive, execution, derived-index, and worktree changes.
- Journals setup, track, execution, revision, review remediation, refresh,
  revert, and archive work before mutation.
- Reconciles expected commits, dirty artifacts, worktrees, branches, commits,
  and merges after interruption rather than restarting or discarding state.
- Binds clean review to execution ID, plan revision, graph digest, reviewed
  HEAD, and accepted risks.

### Parallel Worktrees

- Adds phase/task dependency scheduling and bounded workers.
- Keeps phase and task worktrees as safe sibling paths.
- Makes the main agent the sole scheduler, state owner, integrator, conflict
  resolver, cleanup owner, and recorder of human approval.
- Allocates one global worker bound across parallel phases and phase-local task
  waves without concurrent mutating modes inside the same phase.
- Adds constrained preview/apply worktree creation, non-squash integration, and
  ancestry-proven cleanup.

### Runtime And Packaging

- Publishes a self-contained `cadre-ai` package with one executable,
  `cadre-ai`.
- Builds two bundles: `dist/cadre-cli.mjs` and `dist/cadre-mcp.mjs`.
- Installs `cadre@cadre` through a local dual-client marketplace for Codex and
  Claude Code at user scope.
- Ships ten workflow skills, Claude worker definitions, immutable template set
  `v1`, typed validation, and 35 purpose-built MCP tools.
- Configures narrow Codex MCP approval and both Claude server enablement plus
  tool allowlisting while preserving unrelated settings.

### Project Context And Learning

- Ships product, engineering-guideline, technology, workflow, pattern,
  styleguide, track, execution, revision, revert, refresh, and archive
  templates.
- Includes default styleguides for Go, Java, Kotlin, Maven, Gradle, JavaScript,
  TypeScript, React, HTML/CSS, Dart, Flutter, Swift, SwiftUI, and Python.
- Carries dependency-phase learning forward and distills durable patterns during
  multi-track archive batches.

### Breaking Migration From 2.x

Cadre 3.0 does not support the prior 2.x state or command contract in place.
Important removals include:

- the `cadre` executable alias (use `cadre-ai`);
- `cadre/` project state (3.0 uses `.cadre/`);
- generic `cadre_workflow`, `cadre_action`, and `cadre_read` packets;
- the 19-workflow setup/newtrack/ship/land/release family;
- Copilot and Antigravity plugins;
- provider evidence, team boards, merge trains, project skills, formulas,
  LSP/DAP, and polyrepo orchestration.

Polyrepo mode is planned but not included. See
[Polyrepo Mode — Coming Soon](team-and-polyrepo.md).

For an existing 2.x project, preserve its state and Git history. Install 3.0,
start a new client session, and run `create` only after choosing a deliberate
migration or fresh `.cadre/` initialization strategy. Do not mechanically rename
`cadre/` to `.cadre/`; the schemas and lifecycle differ.

### Install Or Upgrade

```bash
npm install -g cadre-ai@3.0.0
cadre-ai doctor
cadre-ai install
```

Reload Codex or Claude Code and confirm `cadre@cadre` is installed and enabled.
