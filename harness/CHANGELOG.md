# Changelog

## [3.9.2] - Unreleased

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

### Repairing an already stuck track

Updating the runtime prevents the faulty transition; it does **not** silently rewrite previously approved state. Reconcile the original receipt once, preserve it and the original revision record, and use revise to prepare a fresh, explicitly approved repair from actual canonical counters and verified execution evidence. When the current plan and journal differ, the repair names the original execution graph and reachable plan commit under `Recovery evidence`; the runtime verifies that committed baseline. Do not manually clear operations or rewrite journals to bypass the scope guard.

### Validation

Latest verification passed **400/400 maintained tests**, including 21 new regressions for project-wide admission, context-refresh preservation, dependency revisions and interrupted recovery. **144/144 packaged stdio cases** passed across three client identities, four approval modes and both scheduling modes: 96 unsafe transition cases, 24 repeated remediation flows through archive, and 24 final configuration/restart flows through refresh, review and archive. A separate **24/24 lifecycle matrix** completed revision, revert, review, archive, refresh and successor delivery. Type checking, package validation, pack dry run, complete docs checks and all ten skill validators passed. These are runtime fixtures with explicit synthetic approvals, not exhaustive native AI conversations. The final candidate installed successfully in Codex, Claude and Zed; Codex/Claude report enabled candidate versions, all three installed MCP bundles match the tested build and initialize with 25 tools, and unrelated client settings are preserved. Zed native skill discovery and active-server UI verification remain blocked by the locked Mac and must pass before publication.

Previous follow-up verification passed **357/357 maintained tests**, with 40 new regressions for repository-bound create, target-aligned reversals, rename semantics, retained edits and recovery. **169/169 packaged stdio checks** passed: 156 matrix cases, three unborn-Git checks, seven existing review/revert recovery checks and three nested-baseline restart recoveries. The matrix covers all four approval modes and both requested scheduling modes across three client identities; 120 valid reversals finished review/archive and 24 wrong-scope reconciliations were rejected. These are runtime fixtures, not exhaustive native AI conversations. Native installer/activation validation remains a publication gate.

Earlier verification on 2026-10-13 recorded **317/317 maintained harness tests**, including 38 new regressions for blocked review, approval manifests, reversal results and recovery. The follow-up matrix passed **78/78 cases** and **15/15 packaged stdio server checks**, covering former defect rejection, complete lifecycle, repeated retry budgets, interrupted archive and restart recovery. Earlier verification passed 102 matrix and nine packaged cases. Type, package, packaging, and documentation checks pass. These are disposable runtime fixtures with explicit test approvals; exhaustive native AI-session coverage is not claimed. Final patched-payload installation and activation remain publication gates.

### Upgrade

```bash
npm install -g cadre-ai@3.9.2
cadre-ai --version
cadre-ai doctor
cadre-ai install --target all --scope user
```

Start a new Codex task, reload Claude Code plugins, and open a new Zed Agent thread. Existing 3.9.0/3.9.1 projects using v5 need no routine refresh or schema/template migration. Older contracts retain their existing approved refresh requirements. Codex, Claude Code, and native Zed Agent remain stable integrations. Final clean completion still requires explicit approval.


## [3.9.1] - 2026-10-01

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

## [3.9.0] - 2026-09-25

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


## [3.8.0] - 2026-09-08

- Make Track the default approval mode, retaining Governed and Phase with independent Parallel/Sequential scheduling.
- Add continuous policy-v2 Autonomous implementation, verification, cumulative review, and in-scope remediation until clean; return a summary and exact completion proposal for the author's explicit decision.
- Route continuation through MCP `nextStep` and installed implement/review skills across Codex, Claude, and Zed. `ready_for_review` is an internal handoff; approving unchanged clean evidence does not require another review command.
- Persist originating authority, cumulative baseline, stable finding identities, and loop checkpoints. Preserve completed phases and execution history across new remediation graphs and interruption recovery.
- Pause for material scope decisions, unavailable verification, external blockers, or the same finding after two failed remediation attempts. Revalidate staged digests and changed completion evidence.
- Require explicit Track-or-Autonomous migration for legacy Autonomous executions through the existing quiescent, journaled, digest-bound refresh. Preserve Governed/Phase choices and conservative missing-mode handling.
- Introduce immutable template v4 while preserving v1–v3 and v3 memory requirements.
- Fix MCP startup through symlinked payload paths; accept null current-execution selection in status; reject malformed review journals before promotion.
- Clarify that authors can approve a clean completion proposal or report additional bugs; persisted Autonomous authority never substitutes for the final decision.

Validated with 96 automated tests, harness types, package validation and dry-run inspection, docs checks, and native Codex/Claude/Zed tests. Native Zed fresh-task recovery preserved exact staged authorization and history; tool-input retries remain a non-blocking beta reliability limitation.

## [3.7.1] - 2026-09-07

- Fix finding-bearing review and scope-revision candidate inspection using the old `ready_for_review` status and execution graph instead of the proposed lifecycle transition. Canonical state and completed journals remain unchanged before approval.
- Preserve completed historical track-verification phases and their original dependencies when remediation adds a new final gate; replacement executions retain completed provenance.
- Keep `context_read` available between approved remediation and replacement execution: label retained completed handoffs as historical evidence, with their recorded revision and graph, instead of treating them as a current-graph mismatch.
- Reject staged state/plan target conflicts, terminal-track reopening, empty approved plans, and malformed staged plan syntax. Retain active execution and journal integrity checks.
- Add temporary-project regressions for repeated review, replacement execution, nested revisions, and structured/text MCP responses for Codex, Claude, and Zed client identities.

## [3.7.0] - 2026-09-06

### Memory, context, and recovery

- Introduce immutable template v3, preserving v1/v2 and requiring approved refresh before legacy delivery.
- Persist bounded task handoffs with existing execution checkpoints, without additional approval or mutation calls.
- Validate seed metadata/revisions/pattern fingerprints; distinguish stale active guidance from historical evidence and bind staged memory inputs to approval digests.
- Add read-only `context_read` with required-context selection, conservative fallback, source hashes, and drift-sensitive 16 KiB pagination.
- Default status to summaries with explicit full detail and paged/filtered track listings; retain project-wide validation and counts.
- Reuse reads/parses within validation and batch Git provenance resolution. Add correctness, compatibility, recovery, and byte-cost fixtures, including small-project overhead.
- Expand the measured catalog ceiling to 80 KiB for the additional typed context and handoff interfaces; byte counts are not billed token counts.

- Select one MCP result representation from the initialized client identity:
  structured JSON for recognized Codex and Claude Code 2.0.21+ clients, compact
  JSON text for Zed and unknown clients. Remove redundant summaries and JSON
  copies, preserve template bodies once, and advertise output schemas only to
  structured clients while retaining server-side validation for both formats.

### Audit corrections

- Recognize Markdown pattern links and fenced learning examples; expand ambiguous sections and reject incomplete memory metadata.
- Add session-retained source inventories with explicit reuse and `contextReady`; changed sources must be reread.
- Reject invalid staged revision paths, stale revert seeds, and disconnected execution bindings before approval. Verify recorded plan revision/graph at its commit.
- Read archived execution journals, expose complete project/implementation detail, and preserve historical refresh/archive hashes against their artifact commits.
- Separate clean-review proposal evidence from the digest-bound confirmation recorded by apply. Return visible JSON-text errors in every client.
- Clarify direct-main checkpoints, revision provenance, refresh recovery ordering, fact-checked learning, and read-only revert preparation that preserves dirty work.
- Require an exact original execution snapshot before staged reverts reset evidence; retain a durable digest-bound revert receipt, history entry, and reconciliation commit provenance.
- Make receipt persistence and readback an explicit prerequisite to restoring implement ownership; record a null reconciliation SHA first so interruption cannot erase the revert approval while bookkeeping is unfinished.

Validated with 79 automated tests, package and documentation checks, native Claude/Codex audits, and native Zed installation, discovery, MCP, staged-revert, and fresh-session recovery tests. Native Zed support remains beta.

## [3.6.0] - 2026-09-02

### MCP Result Contract

- Added output schemas for all 22 MCP tools. The schemas advertise every
  stable agent-facing top-level field while the server enforces the exact
  success and structured-error variants.
- Made the final text block of every tool response a compact JSON mirror of
  `structuredContent`. This applies to successes, elicitation outcomes,
  template descriptors, and structured errors, so agents can recover every
  decision and follow-up field even when a client does not expose structured
  results directly.
- Kept template and candidate bodies out of mirrored descriptor data. Their
  existing text or embedded-resource blocks remain unchanged and appear before
  the final JSON mirror.
- Tightened adaptive response variants: `proposalToken` is required only when
  `commandStatus` is `approval_required` and is absent after application.
- Raised the validated serialized MCP tool-catalog ceiling from 18 KiB to
  64 KiB to accommodate the complete output schemas while retaining Node 18
  compatibility.
- Made Zed installation safely refresh a changed Node executable path when the
  existing `context_servers.cadre` entry still targets the exact managed Cadre
  MCP file. Entries targeting any other MCP file remain protected conflicts.

This is an additive transport contract change. It does not change canonical
artifact formats, template set v2, tool names, or the prepare/apply token
lifecycle. Existing 3.5.1 projects remain readable and use the normal approved
refresh workflow to record runtime 3.6.0 before further mutation.

## [3.5.1] - 2026-08-27

Cadre 3.5.1 is a workflow-recovery hotfix for candidate validation, staged
track resumption, and interrupted multi-file operations. Codex and Claude Code
remain stable integrations; native Zed Agent support remains beta.

### Fixed

- Replaced the faulty single-plan candidate contract with exact
  `planValidations` for every staged root or nested `plan.md`. Candidate
  digests now bind normalized plan paths and intended target statuses.
- Made `project_status` distinguish canonical, candidate-only, shadowed,
  malformed, and unknown track state. Focused status now returns complete
  validation errors plus track/dependency-specific `focusedErrors`.
- Added exact `expectedFiles` pruning for candidate stages so clarification or
  scope contraction cannot leave stale proposal files behind.
- Made project initialization, execution finish, clean review, archive apply,
  and archive provenance recording converge safely after interruption without
  duplicate cycles or history.
- Derived clean-review ranges from the completed execution base through its
  recorded HEAD, including the first implementation commit.
- Corrected lifecycle routing across all ten workflows, including staged-track
  recovery, immutable terminal tracks, final implementation bookkeeping, and
  Wisp output outside uninitialized repositories.
- Removed client-specific cross-workflow command references from canonical
  guidance and kept generated Zed adapters on text template mode with
  `/cadre-*` recommendations.

### MCP Contract Corrections

- `candidate_inspect` removes the retired singular `targetStatus` input and
  `plan` result in favor of `planValidations` and sorted `plans`.
- `project_init_candidate`, `review_complete`, `archive_batch_candidate`, and
  `integration` now publish strict `request` prepare/apply unions that reject
  mixed-mode calls at schema validation.
- `execution_checkpoint` now publishes a strict `scope` plus event-specific
  `action` contract with explicit evidence requirements.
- `review_complete` no longer accepts `commitRangeStart`.
- The surface remains 22 tools and the generated catalog remains below the
  18 KiB budget.

### Compatibility And Upgrade

- Existing approved operation journals remain readable and resumable.
- Unapproved 3.5.0 candidate stages must be re-inspected under the corrected
  validation contract before approval or promotion.
- Existing 3.5.0 projects remain readable and use the normal approved refresh
  workflow to record runtime 3.5.1 before further mutation. Template set v2 is
  unchanged.
- Reinstall all selected clients and start fresh client sessions so the
  corrected schemas and workflow guidance replace cached 3.5.0 definitions.

## [3.5.0] - 2026-08-27

Cadre 3.5.0 adds beta support for the native Zed Agent while keeping the
Codex and Claude Code integrations stable. Cadre lifecycle, governance,
project-state, and template-set semantics are unchanged.

### Added

- Added `zed` to explicit client selection and auto-detection. `--target all`
  now installs or removes Codex, Claude Code, and Zed integrations.
- Added generated Zed adapters for all ten workflows under
  `zed-skills/cadre-<workflow>/`, exposed in Zed as `/cadre-*` skills through
  collision-safe global symlinks.
- Added JSONC-preserving Zed configuration for the packaged Cadre context
  server and one exact allow rule for each of the 22 Cadre MCP tools.
- Added safe Zed uninstall behavior that removes only Cadre-owned links and a
  matching context server while preserving permissions and unrelated settings.
- Added `contentMode: "text"` to `template_get_many` for clients that cannot
  consume embedded resource bodies, while preserving the existing embedded
  resource default.

### Changed

- Centralized all 22 MCP tool names so server registration, Zed permissions,
  validation, and tests share one catalog.
- Extended the documentation command switcher, installation guides,
  architecture, configuration, troubleshooting, and release validation for
  the Zed Agent beta.
- Updated the runtime version to 3.5.0. Existing 3.4 projects remain readable
  and use the standard explicit `refresh` flow before further state mutation;
  the active template set remains v2.

### Stability

- Codex and Claude Code remain stable integrations.
- Native Zed Agent support is beta in this release. It targets Zed's global
  Skills and custom MCP surfaces, not Codex or Claude ACP agents hosted in Zed.

## [3.4.0] - 2026-08-27

Cadre 3.4.0 is a breaking MCP and template-contract release. Existing v1
projects remain readable but require an explicit approved refresh before
state mutation.

### Breaking Changes

- Adaptive commands now require exclusive `prepare` or `apply` input shapes.
- Direct clients must replace retired template, candidate, and worktree reads
  with MCP resources, `candidate_inspect`, and scoped `project_status`.
- New projects use template set v2. Legacy mutation fails with
  `PROJECT_REFRESH_REQUIRED` until an approved refresh updates workflow and
  runtime/template versions.

### Added

- Added bounded, Git-ignored staging under `.cadre/stage/<candidate-id>/` and
  one `candidate_inspect` call for manifests plus optional plan validation.
- Added scoped project/track/implementation status views, immutable v2
  templates, explicit legacy upgrade reporting, and approved v1→v2 refresh.
- Added honest adaptive schemas requiring `mode`, embedded template resources,
  compact descriptors/receipts, and resumable composite worktree transitions.

### Changed

- New initialization generates unchanged v2 workflow/styleguide defaults in
  MCP and stages only authored context or explicit overrides. `.cadre/init/*`
  remains invalid.
- Removed retired template and candidate tools; resources cover discovery and
  individual reads. The MCP surface is 22 tools.
- Coalesced worktree start, integration, and completion bookkeeping, reducing a
  delegated task to four calls (five for governed integration).
- Legacy projects remain readable but fail closed for mutation until an
  explicit approved refresh upgrades runtime/template versions.

### Compatibility And Upgrade

- Published v1 template files remain byte-for-byte unchanged.
- 3.3.0 proposal tokens must be prepared again after upgrading.
- Reinstall the CLI/native plugins and restart client sessions so the 3.4 tool
  schemas and compact skills replace cached 3.3 definitions.

## [3.3.0] - 2026-08-09

Cadre 3.3.0 makes long-running MCP delivery sessions durable across server
restarts and substantially reduces repeated protocol payloads. It keeps
project-local state and execution journals compatible while changing several
MCP response shapes from complete canonical artifacts to compact receipts and
path/SHA-256 manifests.

### Breaking Changes

- Changed execution checkpoint responses to return a changed-node transition
  receipt instead of the complete execution
  journal. Apply retains compact `derivedStatus` scheduling arrays and focused
  guidance for changed, active, or blocked nodes.
- Changed `execution_status` to return execution metadata, node-status counts,
  ready/active/blocked scheduling state, and minimal actionable-node records.
  It no longer echoes the complete journal or guidance for every completed and
  pending node; pass optional `nodeId` for focused full-node detail.
- Changed initialization, review, archive, execution start/finish, and derived
  track-index responses to return outcome metadata and path/SHA-256 manifests
  instead of full proposed or written artifact contents.
- Changed proposal tokens from self-contained gzip/base64 payloads to 42-byte
  opaque capabilities backed by the local Cadre runtime cache. Outstanding
  3.2.0 tokens must be previewed again after upgrading.

### Added

- Added durable proposal records under
  `${CADRE_HOME:-~/.cadre}/runtime/proposals`, allowing a preview produced by
  one MCP process to be applied safely after Codex or Claude restarts it.
- Added seven-day proposal expiry, a 256-record and 32 MiB retained-cache
  bound, an 8 MiB per-proposal bound, and oldest-first cleanup.
- Added optional focused `nodeId` lookup to `execution_status` without adding a
  separate arbitrary journal-reading tool.
- Added explicit checkpoint receipts recording the semantic event, source
  status, intermediate transition sequence, target status, and checkpoint.

### Changed

- Kept full execution journals as the canonical atomic validation and
  persistence model while projecting only scheduler-relevant state at the MCP
  transport boundary.
- Kept `proposalToken`, preview/apply tool names, semantic digests, stale-state
  recomputation, and compact `derivedStatus` scheduling arrays stable for
  workflow skills.
- Updated implementation guidance to reuse checkpoint apply results, request
  focused node detail only when needed, and avoid re-reading the journal after
  each event.

### Security And Reliability

- Proposal filenames are derived only from validated 192-bit random tokens;
  callers never supply runtime paths.
- Runtime proposal directories and records are permission-restricted, written
  with exclusive creation and fsync, and checked for ownership, file type,
  symlinks, size, kind, expiry, and schema before use.
- Proposal resolution remains digest-gated: every apply recomputes current
  state and rejects a stale proposal even when its runtime record is valid.
- Concurrent cleanup tolerates records already removed by another Codex or
  Claude MCP process, and lost-response retries can reuse retained tokens until
  normal domain idempotency or stale-state checks resolve them.

### Performance

- Reduced the live 46-node `execution_status` result from roughly 19.5 KiB of
  minified domain data to a 3.1 KiB complete MCP response with no embedded
  journal.
- Added response-budget regression checks requiring checkpoint preview/apply
  results below 4 KiB and a 50-node default status view below 8 KiB.
- Removed repeated full workflow, plan, journal, state, pattern, and generated
  index content from mutation responses when an exact digest-bound manifest is
  sufficient.

### Compatibility And Upgrade

- Existing 3.2.0 `.cadre` projects, track states, operation journals, and
  execution journals require no migration.
- Direct MCP consumers that read complete artifacts from preview/apply results
  must adopt the compact receipt and manifest shapes. Canonical artifacts
  remain available at their reported project paths.
- Reinstall the package and native plugins, start a new Codex conversation,
  and run `/reload-plugins` in Claude Code so both clients load the 3.3.0 tool
  schemas. Re-run preview for any proposal token created by 3.2.0.

## [3.2.0] - 2026-08-07

Cadre 3.2.0 simplifies the execution and governance contracts after analysis
of a full production implementation/review/archive session. This is a breaking
MCP release with no compatibility shims for removed tools or apply arguments.

### Breaking Changes

- Replaced `execution_node_*` and `execution_nodes_*` with the semantic
  `execution_checkpoint_*` pair. Events expand into complete legal transition
  sequences and `execution_status` now reports semantic event guidance.
- Changed mutation apply tools to accept only the opaque `proposalToken`
  returned by preview. Repeated semantic inputs, caller-supplied digests, and
  the `proposalDigest` response alias are removed.
- Removed caller-supplied execution IDs, timestamps, Git bases/heads, archive
  batch IDs, archive commits, worktree phase IDs, and worktree base commits
  where the runtime can derive them safely.
- Changed archive content inputs from arbitrary paths to structured pattern,
  pattern-index, and active-track-seed updates. Template IDs are now validated
  from the immutable catalog at the MCP boundary.

### Changed

- Kept `phase` as the default approval mode and preserved recorded mode on
  resume, while eliminating mechanical prompts covered by the active mode.
- Made execution finish atomically derive and write task/phase commit markers,
  the completed journal, `ready_for_review` state, and `tracks.md`.
- Made bare archive selection include all eligible completed tracks in
  dependency order and derive archive metadata from current state.
- Allowed canonical integration with only the exact active execution journal
  dirty; unrelated product or Cadre changes still fail closed.

### Fixed

- Added Git reachability validation for persisted project, track, plan,
  execution, review, revision, and archive provenance.
- Derived clean-review and archive provenance from actual Git history instead
  of accepting guessed SHAs, including ancestry-safe review bookkeeping.
- Added regression coverage for semantic checkpoints, proposal-token binding,
  tracked-journal integration, atomic plan evidence, and unreachable commits.

### Upgrade

- Reinstall the package and native plugins after upgrading. Start a new Codex
  conversation and reload Claude Code plugins so the 3.2.0 MCP schemas replace
  the removed 3.1.x contracts.

## [3.1.0] - 2026-07-30

Compared with 3.0.2, this release adds explicit implementation approval modes,
client-native decision forms, and a more efficient self-describing execution
runtime.

### Added

- Added persisted `governed`, `phase`, and `autonomous` implementation
  approval modes, with `phase` as the default for new executions.
- Added `workflow_elicit` for bounded Codex and Claude clarification and
  digest/checkpoint-bound approval forms.
- Added structured MCP error content, per-node legal transition guidance, and
  a uniform `proposalDigest` alias on mutation previews.
- Added ordered execution-node batches and protocol coverage for supported,
  unsupported, and policy-rejected form elicitation.

### Changed

- Changed workflow governance so one semantic approval covers its named,
  unchanged deterministic journals, indexes, validation, commits, lifecycle
  transitions, and provenance.
- Changed `phase` execution to run regular work autonomously and pause once at
  the final phase verification. `autonomous` pauses only at track verification;
  `governed` retains task-by-task review.
- Changed implementation scheduling to use returned transition guidance and
  derived status instead of global tool discovery, speculative previews, and
  redundant status reads.
- Changed execution bookkeeping to batch already-evidenced transitions, reuse
  unchanged product verification, parallelize independent read-only checks,
  and commit Cadre-only state at phase/final durability boundaries.
- Changed execution finish to update its journal, track state, and generated
  `tracks.md` together under one digest.

### Fixed

- Fixed non-interactive host policy handling so Codex Full Access uses one
  concise text fallback and an automatic policy rejection is not reported as a
  human decline.
- Fixed create-time token waste by summarizing unchanged workflows and default
  artifacts unless the human asks for full content.
- Fixed worktree cleanup recovery when an integrated node was already marked
  complete before cleanup.
- Fixed worktree identity friction by deriving a task's phase from its node ID
  while accepting a matching redundant phase value for compatibility.
- Fixed failed transition previews caused by undiscoverable state-machine
  rules, plain-text-only errors, and inconsistent digest field naming.

### Compatibility

- Existing 3.0.x projects remain compatible. Legacy execution journals without
  `approvalMode` are interpreted as `governed`.
- Run `cadre-ai install --target all --scope user` after upgrading, start a new
  Codex conversation, and run `/reload-plugins` in Claude Code.

Earlier release history is available in the signed `release-3.0.2` and older
Git tags.
