# Cadre 3.9.2 candidate verification

Verification through 2026-10-13 covers the active-revision fix and three additional
recovery defects found during lifecycle testing, plus the subsequent authority, interrupted-input and imported-draft fixes. This is a candidate verification
record. The final payload has passed automated validation and native installation.
Zed UI activation and skill discovery also passed. No known release blockers
remain in the tested scope; publication is pending. See the final section for
current results.

## Fixed failures

1. Removed worker paths and branch names were mistaken for live workers. Revise
   and context-only refresh now inspect actual Git/filesystem activity, retaining
   completed provenance even when inherited from an earlier execution. Live or
   registered worktrees, orphaned paths, retained branches, unfinished work, and
   unsafe symlinks still block the transition.
2. Refresh promised active scope cascades but could not supersede an old execution
   safely. A complete v5 refresh now includes a fresh revision record and matching
   track/spec/plan counters for each affected track. The runtime derives retained
   journal disposition and Autonomous authority in the same approval. Context-only
   refresh leaves the current journal and scope references stable. Legacy contract
   or policy migration precedes a later scope revision.
3. A revision record alone could be committed without advancing state. Preview now
   rejects record-only revisions, missing state, and contradictory counters before
   canonical mutation. Learning-only reseeding remains legal. Counter-only context
   refreshes cannot masquerade as approved scope revisions.

Installation does not repair already approved inconsistent state. Preserve the
old receipt and record, reconcile once, and prepare a fresh explicitly approved
repair using actual canonical counters and verified original execution evidence.
No routine project refresh is required for existing 3.9.0/3.9.1 projects using v5;
schema-2 state and template set v5 remain unchanged.

## Maintained tests and package checks

The latest complete harness run passed **317/317 tests**, with no failures, skips or cancellations. The earlier follow-on run passed 279/279 tests.
An earlier complete run passed 216 tests; its 63 follow-on maintained cases are
described below.
The original recovery suite adds 37 cases. Subsequent extended verification adds
45 maintained cases: eight authority tests, 27 interrupted-recovery tests and ten
imported-draft tests. These cover both supported legacy migration and rejection of
unapproved authority rewrites, four promotion interruption boundaries, dirty-file
preservation, old pending receipt identity, committed replay after later guidance
changes, and draft revision through planning, delivery, review and archive.

One existing negative test needed its expected diagnostic updated because the new
authority guard rejects its invalid operation earlier. The final full run includes
that corrected assertion and all new cases. A subsequent authority regression run
also passed 8/8 cases with the final comparison allowing JSON key reordering while
retaining exact field values, finding arrays and approval policy.

Checks passed:

```sh
pnpm install --frozen-lockfile
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
pnpm --filter cadre-ai pack --dry-run
pnpm --filter cadre-docs check
node harness/dist/cadre-cli.mjs --version
node harness/dist/cadre-cli.mjs doctor
```

The built CLI reports 3.9.2. Doctor confirms a self-contained runtime and 39/39
current templates. Package validation covers ten workflows, typed MCP, immutable
templates, and all three integration definitions. Documentation checks cover
content, lint, types, and the static build.

## Lifecycle matrix

Each matrix covers three MCP client identities/formats (Codex, Claude Code, Zed)
with Governed, Phase, Track, and Autonomous approval, each requesting Sequential
and Parallel scheduling:

| Matrix | Passed | Main coverage |
| --- | --- | --- |
| Maintained worker recovery | 24/24 | Create/track, worker commit/integration/cleanup, context refresh with identical scope copies, active revise, active scope refresh, inherited authority/completed task evidence, implementation, clean approval, archive, committed replay |
| External complete lifecycle | 24/24 | Planned and active revision, task Git revert/reimplementation, completion/review/archive, refresh, dependency-linked terminal successor, unchanged archived source, committed replay |
| External findings remediation | 24/24 | Active context refresh, finding-bearing review, remediation execution, cumulative evidence, clean approval, archive, committed replay |

The two external matrices ended with **72 archived tracks**, valid and clean
state. The complete lifecycle matrix verified **312 reachable receipt commits**.
The maintained worker matrix adds 24 archived tracks. These are disposable,
synthetic runtime fixtures with explicit fixture approvals, not 72 model-driven
native client sessions. Wisp coverage verifies its read-only contract; terminal
revise/revert coverage exercises successor handling rather than reopening history.
They cover representative supported transitions, not every repository/conflict.

Local run logs, matrix drivers, retained external fixtures, and machine-readable
results are stored under `~/.codex/tmp/cadre-fixes-20261012/` on the verification
host. Earlier failing runs exposed a too-narrow inherited-worker path check and
fixture expectation errors; the final corrected checks above passed. No additional
unresolved product failure was found in this covered matrix.

## Additional fixed boundaries and fresh retesting

- Context refresh preserves the complete existing Autonomous loop and approval
  policy. It cannot shorten the original cumulative review range, replace its
  authorization, erase finding attempts, or bypass a blocker. Creation of an absent
  loop during explicit legacy migration is checked against the original execution.
- Pending recovery stores the approved unchanged-input fingerprints in its ignored
  journal. Changed patterns, dependency sources or consumed context stop further
  writes with `OPERATION_INPUT_DRIFT`. The journal and dirty files are retained;
  restoration of approved inputs is deliberate. Original immutable receipt formats
  remain unchanged. Older pending receipts check fingerprints retained in proposed
  artifacts, and committed replay remains independent of later source changes.
- Imported `drafting-plan` tracks can revise their approved specification, retain its
  original approval in history, and keep the plan unapproved. Initial drafts with no
  plan use explicit previous plan revision 0. Track planning approves the final
  baseline before execution.

Fresh additional matrices passed **24/24 two-worker scenarios** and **96/96 explicit
approval-mode transition checks**. The latter contains 78 reviewed/archived results
and 18 expected pre-execution blocks for leaving Autonomous without an approved
policy transition; these blocks are correct safety behavior. The two matrices
ended with 102 archived tracks and no unexpected errors. Governed parallel tests
reject stale integration approval and live remaining workers still block refresh.

Two packaged stdio server scenarios cover all three new fixes. The former review
baseline exploit is rejected; valid interrupted recovery completes a cumulative
review that includes the first implementation commit and ends archived. The draft
scenario advances the specification while retaining `commits.plan: null`.

Current evidence is under `~/.codex/tmp/cadre-extended-fixes-20261012/` on the test
host. Earlier extended verification bug reproductions are retained separately;
a passing defect-observation test is not described as a successful workflow.

## Follow-on review, revert, retry and archive fixes

All four additional failures reported by combination verification are fixed:

1. Clean completion checks product and verification-policy freshness in every
   approval mode. Pending clean and finding-bearing review recovery validates the
   retained reviewed HEAD before any remaining write, including old intent
   formats. Changed product files and pending intent remain intact on rejection;
   committed approval replay stays independent of later product changes.
2. Revert promotion preserves the entire authored Autonomous loop and its original
   cumulative review baseline. It requires the persisted approved reversal,
   reachable additive reversal commits, exact durable reversal record/original
   journal snapshot, and matching restored implement ownership. Existing blockers
   remain blocked; task, phase and active-track reversals retain original coverage.
3. Refresh prepare accepts explicit `reviewRetry: {trackId, refreshPath, reason}`
   for a blocked/stalled policy-v2 loop. Stage unchanged current state and the
   instruction record, without scope or execution edits. The approved receipt
   records the full previous loop in history and a fresh two-attempt budget whose
   baseline preserves every old attempt. Healthy loops cannot renew budgets,
   stale inputs reject, and automatic remediation cannot replace retry authority.
4. Archive guidance routes pending promotion through `candidate_apply` resume,
   one receipt commit and reconciliation. Its original apply token is used only
   for committed replay. The pending-token `COMMIT_PENDING` guard remains intact.

The final suite adds **63 maintained cases**: 24 review freshness/recovery, 18
reversal scope/authority, eight explicit retry/remediation recovery, and 13 archive
recovery/guidance cases. Real stalled retry tests retain two failed executions,
allow two new executions and stop at the limit again. Older review fixtures now
use reachable Git evidence with approved scope established before implementation.
An unintended fixture-helper edit was corrected during verification; it did not
change product code. Compact tool labels keep the unchanged 25-tool catalog at
81,851 bytes, below its existing 80 KiB limit; schemas and exact tool names remain
stable except for the documented optional retry request.

Fresh external checks passed:

| Matrix | Passed | Coverage |
| --- | --- | --- |
| Complete lifecycle | 24/24 | All approval/scheduling combinations and three client identities, real task reversal, revision, delivery, clean review, archive, refresh, terminal successors and replay |
| Findings remediation | 24/24 | Context refresh, approved remediation, cumulative review and archive |
| Additional boundaries | 54/54 | 24 stale review rejections, 24 three-track archive/reseed/dependency-remap cases, six explicit blocked retries through completion/archive |
| Packaged stdio server | 9/9 | All-mode stale review rejection, interrupted review freshness, authority rejection, explicit retry, archive recovery and committed replay |

The 102 external matrix cases and nine packaged cases passed without unexpected
errors. These use synthetic approvals and runtime/client-format fixtures, not
native AI sessions. Wisp coverage checks its read-only contract.

The final complete suite, type/package validation, pack dry run, frozen install,
documentation checks and built CLI doctor passed. Earlier failed runs exposed
legacy fixture assumptions and catalog size; fixtures and labels were corrected
without weakening freshness checks or raising the catalog limit. Two intermediate
runs were cancelled after identifying fixture edits; the final complete run has
no cancellations, failures or skips. That run preceded the additional blocked-review and reversal-proof fixes below.

Evidence is retained under `~/.codex/tmp/cadre-all-four-fixes-20261012/`, including
`test-final.log`, matrix JSON/driver files and packaged stdio results. Immutable
receipt formats, schema-2 state and template set v5 are unchanged. Optional retry
metadata is created only by a new explicitly approved retry; existing projects
need no routine refresh or migration for these fixes.

## Native client and publication gate

Before these additional fixes, native Codex/Claude candidate plugins were enabled
at 3.9.2 with packaged MCP payloads; Zed discovered all ten skills and showed the
Cadre server active. The previous Codex model-driven smoke verified revised
execution startup and retained completed evidence. Those observations do not
validate installation of this final patched payload.

Before publishing, reinstall the final local build into all three clients and
verify candidate listings, ten Zed skills, native server activation, payload hashes,
and narrow MCP approvals as required by repository release instructions. No npm
publication, GitHub release, tag, push, or final native activation is claimed here.


## Blocked review and reversal proof fixes (2026-10-13)

Continued verification reproduced three additional failures: a blocked loop could
accept a remediation snapshot without explicit retry approval; final reversal
reconciliation could change an unrelated journal node despite its original hash
manifest; and an unrelated empty commit could be recorded as a product reversal.
All three now have runtime rejection and maintained regressions.

- Automatic remediation validates the persisted previous loop before accepting its
  proposed checkpoint. Generic review resume retains and revalidates the exact
  original authority, including after partial state promotion or stage loss.
- Revert checks the complete original path/hash manifest and exactly matching
  reversal record. New recovery stores the original temporary operation and
  authored state under ignored staging, preserving receipt/template formats.
  Each resume verifies the original hash binding and deterministic resulting state.
- Reversal proof verifies retained execution commit provenance, distinct ordered
  targets/reversals and actual reverse results, using a temporary Git index/object
  directory. Text, binary, mode, rename, multi-commit and both merge mainlines are
  tested; source index, object inventory and history remain unchanged by proof.
  Conflicts require an exact approved `conflictResolutionTrees` result limited to
  the target paths. Empty or wrong-result commits cannot reset delivery evidence.
- The revert authority fixture now reads `candidate_inspect.files`. Its previous
  `inspected.manifest` expression silently omitted hashes. New failures were
  reproduced again with a complete valid original manifest before fixing them.

Existing v5 projects need no schema/template migration. Install the patched
runtime and restart its server to receive these checks. Committed historical
operations remain zero-change replay. Valid older pending operations can retain
proof when exact original state/stage remains available. Older partial intent or
approval missing that evidence requires an explicitly approved evidence repair;
retain its intent, receipt and Git changes rather than replacing hashes or
repeating reversals.

The final complete suite passed **317/317 tests** (387,381 ms), with zero failures,
skips or cancellations. It adds 38 cases: eight blocked/recovery review checks,
21 original reversal approval/recovery checks, and nine Git-result proof checks.
The earlier complete regression run passed 315 tests before the two additional
review-resume cases were added; the final run includes both and the final guards.

The follow-up external matrix passed **78/78 cases**: 24 complete lifecycles,
18 repeated-budget/active-retry/blocked-review cases, 12 original-approval/Git-proof
rejections, and 24 interrupted multi-track archive cases across all four approval
modes and both scheduling modes. All three former reproductions now assert actual
rejection; these are successful safety checks, not acceptance-observation tests.
The broader matrix began before the last review-resume extension; the final full
suite and packaged checks below retest that extension on the final source.

The rebuilt packaged stdio server passed **15/15 checks**: three blocked-review
rejections, three valid refresh retry recoveries across three server processes,
two reversal rejections after restart, six partial review/revert recoveries after
candidate-stage loss across all three client identities, and one legacy blocked
review intent rejection after restart. Valid flows finish review and archive;
rejected flows retain their original state and recovery intent.

Frozen install, type checking, source/package validation, pack dry run, docs
content/lint/types/static build, CLI version and doctor checks pass. The built
CLI remains 3.9.2 with 39 templates and a self-contained runtime. Published
receipts, immutable templates and MCP tool schemas remain unchanged.

Host-local drivers, retained external fixtures and logs are under
`~/.codex/tmp/cadre-audit-fixes-20261013/`. Final evidence uses
`full-tests-final.log`, `matrices.log` and `packaged-final.log`. The audit
fixtures use explicit synthetic approvals and MCP client identities; exhaustive
model-driven native client sessions are not claimed. Native installation/activation
and publishing remain separate release gates.

## Repository-bound create and target-aligned reversal follow-up

Five further defects from the expanded audit are fixed:

- Create fingerprints repository HEAD, index and tracked/untracked product inputs,
  rejects canonical state introduced after preview, and retains the original
  repository evidence through interrupted promotion. A separately initialized
  project cannot be overwritten by an older token. Historical committed replay
  remains zero-change. Existing unborn Git worktrees are supported without
  reinitialization, while wrong Git bases and nested roots are rejected.
- Reversal commits and journal resets must agree with the named task/phase/track
  and explicitly approved shared group. All required delivery boundaries are
  covered; an approved phase integration reverses its introduced tasks once.
  Unrelated nodes and the execution contract remain unchanged. Quiescent worker
  ownership is cleared for reimplementation while history/handoffs are retained.
- Git computes rename-aware reversal results with disposable refs, worktree,
  index and object storage. The delivery Git state is not used for experiments.
  Exact conflict trees remain bounded to target paths and verified later renames.
- Stage preparation returns a dirty-input `revertBaseline`. Its exact JSON is an
  approved `reverts/revert-<id>-baseline.json` artifact, named by
  `repositoryBaselinePath` in the operation and reversal record. Unchanged prior
  edits survive reconciliation; new product/policy/index drift blocks it.
  Recovery remains self-contained after stage loss, including nested staging.

The final complete suite passed **357/357 tests** (367,370 ms), with zero failures,
skips or cancellations. This adds 40 maintained cases to the previous 317-test
suite: 30 create/freshness/recovery cases, six Git-result/scope cases, three
baseline recovery cases and one multi-assertion journal-reset case.

The packaged matrix passed **156/156 cases**: 12 brownfield initialization cases
and 144 reversal cases across three MCP identities, all four approval modes and
both requested scheduling modes. All 120 valid reversals reached review/archive;
all 24 wrong-task reconciliations failed before canonical promotion and retained
the original journal. Supplemental packaged checks passed **13/13**: three
unborn-Git initializations, seven review/revert recovery cases, and three nested
baseline recoveries after partial state promotion and stage loss. The latter
reject changed user inputs, retain intent, restore the approved inputs deliberately,
and finish delivery/review/archive without another Git reversal.

The matrix began before final compatibility refinements for unborn Git roots and
canonical nested baseline paths. The complete 357-test run and supplemental
packaged checks cover those final refinements. A previous full run exposed the
MCP catalog budget; compact shared-detail advertisements retain strict runtime
validation and keep the original 80 KiB budget. An invalid fixture claiming an
existing Git repository without Git was corrected to request initialization.
Earlier interrupted test runs remain diagnostic evidence, not final results.

Frozen installation, TypeScript, package validation, pack dry run, docs checks,
CLI doctor, and both edited skill validators pass. The package remains 3.9.2,
with immutable templates and published receipt schemas unchanged. Stage preparation
adds optional baseline output; no project schema migration is required. Older
pending create approvals missing repository evidence require an explicit repair,
and older reversals retain their original clean-input contract. No automatic
approval renewal, source-file cleanup, history rewrite or repeat reversal occurs.

Evidence and retained matrix fixtures are under
`~/.codex/tmp/cadre-all-five-fixes-20261013/`; final logs include `complete.log`,
`*-final.log`, `unborn.log`, `recovery-packaged.log`, `nested-restart.log`, and
`results.json`. Native AI-session coverage and final native installer activation
remain separate release checks.


## Shared transition preservation follow-up (2026-10-13)

The subsequent cross-workflow audit reproduced three additional gaps: phase
reconciliation treated an ordinary completion HEAD as a merge covering its
ancestors; ordinary review could replace completed work with unchecked tasks;
and refresh protected active journals but allowed rewriting completed journals.

The fixes enforce completed-plan and state preservation across all review modes,
protect every staged historical journal, and evaluate phase reversal coverage
against the actual Git parents and approved mainline. Direct-main/fast-forward
completion requires all distinct task deltas. Tasks already in the selected
mainline remain separate reversals; covered tasks cannot be reversed twice.

Preview and generic promotion/resume share the checks. Original before-images
are bound to the existing pre-promotion hashes and retained only in ignored
recovery state. Partial promotion and stage loss do not change the approved
baseline. Older review intents may reuse their existing exact review authority;
other missing evidence requires an approved repair without discarding intent or
repeating product work. Completed receipts replay unchanged. No published
receipt schema, immutable template, production dependency or MCP tool was added.

The complete maintained suite passed **379/379 tests** (442,936 ms), with zero
failures or skips. The 22 new tests cover completed-plan/state preservation in all
four approval modes and both scheduling modes, incomplete phase/track reversals,
actual merge mainlines, completed/superseded journals, valid interrupted recovery
with stage loss, and rejection of unsafe older intents without changing files.

The rebuilt packaged stdio server passed **96/96 cases** (275,652 ms) across
three client identities, four approval modes and sequential/parallel scheduling:
24 replacement reviews, 24 historical-journal rewrites and 24 incomplete phase
reversals were rejected both before and after cold restart; 24 valid remediation
flows retained completed nodes, resumed execution, completed review and archived.
These are runtime fixtures with explicit synthetic approvals, not native AI
conversations.

The separate source/in-memory lifecycle matrix passed **24/24 cases**, covering
all three client identities, four approval modes and both scheduling modes. Each
case completed create, track, status, the wisp read-only contract, planned and
active revision, active revert, implementation, clean review, archive, refresh,
and a successor through completion/archive. Original and successor archive
receipts replayed without changes; canonical state validation passed.

TypeScript, package validation, pack dry run, complete docs checks, CLI doctor and
all three edited skill validators passed. Documentation content checks also
passed after recording these results. Earlier diagnostic runs with obsolete error
message assertions were corrected; the complete 379-test run is authoritative.

Evidence and test drivers are under
`~/.codex/tmp/cadre-shared-invariants-fixes-20261013/`, including `full-tests.log`,
`packaged-matrix.log`, `matrix-results.json`, `lifecycle.log`, `validate.log`,
`pack.log` and `docs.log`. Native installer/activation and publication remain
separate gates; this work does not claim a release.


## Publish-readiness admission follow-up (2026-10-13)

The next audit found that context refresh could change lifecycle state, new track
creation could reuse an archived ID, and dependency edits could evade scope
revision and admit unfinished prerequisites. A further configuration probe found
that refresh could admit an unsupported project context or remove required ignore
rules. In each case candidate success could precede canonical validation failure.

The fixes share project metadata and whole-track-set invariants between canonical
validation and a read-only proposed overlay. Candidate preview and generic
promotion/recovery validate configuration, unique active/archive identity, final
clean review binding, dependency readiness/cycles and affected staged artifacts.
Context refresh retains lifecycle, execution ownership and artifact authority;
dependency edits route through revision. Original refresh state and any required
plan before-image are retained in ignored recovery evidence and checked against
existing approval hashes. Committed historical receipts still replay unchanged.

Healthy existing projects need the updated installed payload and server restart,
without a schema migration. Older invalid pending operations fail before writes
and retain their exact intent; already-affected state requires an approved repair.
Evidence, fixture repositories and final validation logs are retained under
`~/.codex/tmp/cadre-publish-readiness-20261013/`.


Final automated verification passed **400/400 maintained tests** with no failures
or skips. The 21 new tests cover all four approval modes and both schedules,
valid interrupted refresh recovery, archived identity, dependency revision, and
invalid configuration in preview and older partial/intent recovery. Compatibility
checks preserve repair of already-committed historical revision defects and
legacy interrupted archive operations.

The broader matrix passed **144/144 cases**: 96 packaged negative cases rejected
before/after restart, 24 packaged repeated remediation flows completed three
review cycles and archived, and 24 source/in-memory full lifecycle cases archived
original and successor tracks. A further **24/24 final packaged cases** rejected
invalid context/ignore changes after restart, then completed valid context refresh,
review and archive. All matrix modes cover three client identities, four approval
modes and two requested schedules. These are explicitly approved synthetic runtime
fixtures, not exhaustive model-driven native conversations.

Frozen dependency installation, strict TypeScript, package validation, pack dry
run, full docs checks, all ten skill validators and CLI doctor passed. The initial
full run found four compatibility-test failures; those were fixed and the complete
400-test rerun is authoritative. Logs: `final-tests.log`, `matrix.log`,
`config-matrix.log`, `compatibility.log`, `final-check.log`, `final-validate.log`,
`final-pack.log`, `docs.log` and `doctor.log` in the evidence directory above.

Native installation from the final build succeeded for all clients. Codex reports
`3.9.2+codex.local-20261013T111117Z` installed/enabled; Claude reports
`3.9.2+claude.local-20261013T111117Z` enabled at user scope. Zed is `1.23.2` and
has all ten collision-safe skill links, the packaged server command and 25 exact
Cadre tool permissions. Codex/Claude narrow approval settings are present, and
fingerprints confirm unrelated settings were preserved. All three installed MCP
bundles match SHA-256
`066a1ff985d6daada8ba20c2f1a47919ddf4a7842d1d0ed7bb171c230c10331c`
and independently initialize as Cadre 3.9.2 with 25 tools. The global CLI was
updated from the locally packed candidate; `cadre-ai --version` now reports
`3.9.2`, and its installed-package doctor passes all 39 templates and the
self-contained runtime check.

**Native gate completed (2026-10-13):** after the Mac was unlocked, Zed's
User / AI / Agent Configuration / Skills settings visibly listed all ten
`cadre-*` workflows. User / AI / General / MCP Servers showed `cadre` enabled
with a green status indicator. The Zed process (PID 87505) owned Node children
87523 and 87663 running the installed marketplace's `dist/cadre-mcp.mjs`.
The bundle SHA-256 remained identical to the tested candidate above.

The old sample project's Restricted Mode was preserved. Native activation was
inspected in the already-trusted harness repository window without executing a
workflow or creating a root `.cadre/` directory. No model request was sent.
The native gate is complete, and there are no known release blockers in the
verified scope. No tag, push, npm publication or GitHub release was performed.

## Workflow routing and refresh audit follow-up (2026-10-13)

This pass reproduced four additional runtime defects in disposable projects:
refresh accepted a missing audit record, refresh could overwrite an earlier
record, revise could create a new track without an approved baseline, and track
planning could replace an already-approved draft specification without revision.
All four formerly accepted probes now reject before mutation.

New shared guards run before preview/promotion and during interrupted recovery.
Every new refresh retains fresh nonempty records and binds its primary record to
project metadata/history. Multiple fresh migration records remain valid. Revision
requires an existing approved active baseline; draft planning compares the spec
against its reachable committed approval and preserves revision/dependencies.
Original before-images support valid partial recovery after candidate-stage loss;
invalid older pending operations preserve their intent and files for approved
repair. Already-committed receipts still replay without changes. Published receipt
schemas and immutable templates remain unchanged; healthy projects need only a
runtime update and server restart.

Twenty maintained regressions cover mode/schedule combinations, all three client
identities, primary-record selection, dirty draft specifications, interrupted
recovery and older invalid pending intents. The initial full run had 395 passes
and 24 failures from an older positive fixture that reused one refresh record for
two approvals. That fixture now uses fresh records; migration and retry fixtures
were corrected for the same audit contract. The final rerun is recorded below.

Native update testing found a fifth issue in the reload instructions: a running
Zed workspace displayed an empty global skill list after payload replacement,
despite valid links. Running `workspace: reload` restored all ten skills; the
Cadre MCP server was green after reload. Installer guidance, both READMEs and
getting-started/troubleshooting docs now include that action. This is a native
cache-refresh requirement, not missing skill files. Native Zed reports 1.23.3.

The candidate installed successfully into Codex and Claude at
`3.9.2+codex.local-20261013T142048Z` and
`3.9.2+claude.local-20261013T142048Z`, respectively, both enabled. All three
installed servers match the tested MCP bundle SHA-256
`5425f1efcba36c417749b17b5e3764c1c9d4873227e438d2213180885d1ad098`
and initialize as 3.9.2 with 25 tools. Narrow Cadre permissions and unrelated
settings are preserved. No model request or root project initialization was used
for native verification. The installer-message-only follow-up passed all eight
CLI tests against the rebuilt package.

Evidence and retained matrix projects are under
`~/.codex/tmp/cadre-workflow-routing-20261013/`. The runtime matrices use explicit
synthetic approvals, not exhaustive model-driven native conversations. No tag,
push, npm publication or GitHub release was performed.

The follow-up matrix passed **48/48 cases** with zero failures or skips:
24 source/in-memory complete lifecycles and 24 packaged stdio routing/restart
cases. Each set covers three client identities, four approval modes and both
scheduling modes. All 72 delivered tracks completed review and archive, including
24 successor tracks. Missing/reused refresh records and revision-created tracks
were rejected before and after MCP restart; valid consecutive refreshes and
committed replay passed. The final native Zed process (PID 50416) owns Node child
51105 running the tested packaged MCP bundle. The global locally packed CLI
reports 3.9.2 and passes doctor with 39 templates and a self-contained runtime.

Final verification passed **420/420 maintained tests** with zero failures,
cancellations or skips (724,000 ms). This complete rerun includes all corrected
fixtures and 20 new regressions. Frozen installation, strict TypeScript, package
validation, pack dry run, all ten skill validators, full documentation checks and
the focused eight-test CLI rerun passed. The CLI rerun covers the final
installer-message change; MCP runtime bytes are unchanged by that message.
Authoritative logs are `final-tests.log`, `matrix.log`, `cli-final.log`,
`validate-final.log`, `pack-final.log`, `docs.log`, `skills.log`, `payloads.log`
and `native-config.log` in the evidence directory above. No additional defect
was found in the final pass, and no known blockers remain in this tested scope.

## Revision recovery and draft counter audit (2026-10-13)

The next audit reproduced four defects: a fresh metadata revision could promote
an empty checkpoint and invalidate canonical state; older pending revisions could
change scope without the required revision record/counters; pending revisions
could erase prior history; and draft planning could adopt an unapproved
specification revision counter. Each accepted baseline probe now rejects before
mutation. Recovery probes also cover operations whose artifacts were partly or
fully written before interruption.

Basic state checks now run in the shared canonical/overlay validator. A shared
revision guard binds pending promotion to original history, a fresh record and
synchronized track/specification/plan counters, including refresh scope revisions.
Draft planning reads the counter from the reachable specification approval rather
than the dirty draft. Nineteen maintained regressions cover these failures,
preservation of invalid intents, valid partial recovery and committed replay.
Track and revise skill guidance explains the evidence requirements. No published
receipt schema or immutable template changed; healthy projects need a runtime
update and server restart, not a project migration. Older invalid pending intents
remain intact for approved repair rather than being silently rewritten.

The packaged stdio matrix passed **24/24 cases** across three client identities,
four approval modes and both scheduling modes. Every case rejected invalid
checkpoint/counter/recovery probes across server restarts, then completed valid
draft planning, active revision, implementation, review and archive. All 24 tracks
were archived. The first matrix driver read scheduling mode from track state
instead of the execution journal; correcting that test-driver assertion resolved
the failure. The final matrix has no failures, cancellations or skips.

Native installation succeeded with Codex
`3.9.2+codex.local-20261013T150746Z` installed/enabled and Claude
`3.9.2+claude.local-20261013T150746Z` enabled at user scope. All three installed
MCP bundles match SHA-256
`1324088073794138be6396d6553ba2b2b7a2943a289344749100e677271fc368`
and initialize as Cadre 3.9.2 with 25 tools. Native Zed 1.23.3 lists all ten
skills after `workspace: reload` and shows Cadre enabled with a green server
indicator. Zed PID 95612 owns Node child 96631 running the installed marketplace
bundle. Narrow Cadre permissions and unrelated settings are preserved. The global
CLI was updated from the local candidate tarball, reports 3.9.2 and passes doctor
with all 39 templates and a self-contained runtime.

Evidence and disposable projects are retained under
`~/.codex/tmp/cadre-revision-boundaries-20261013/`. These are synthetic runtime
fixtures plus native discovery/activation checks, not exhaustive model-driven
conversations. No model request, root `.cadre/`, tag, push, npm publication or
GitHub release was used for this audit.

Final verification passed **439/439 maintained tests** with zero failures,
cancellations or skips (476,158 ms). The intermediate 437-test run imported the
runtime before the history fix and failed the two new erased-history regressions;
the final complete rerun includes that fix and both later draft-counter recovery
tests. Frozen installation, strict TypeScript, package validation, pack dry run,
all ten skill validators and full documentation checks passed. Authoritative logs
are `final-tests.log`, `matrix-final.log`, `check-final.log`, `validate.log`,
`pack.log`, `skills.log`, `docs.log`, `payloads.log`, `native-config.log` and
`doctor.log` in the evidence directory above. No additional defect was found in
the final pass, and no known blockers remain in the tested scope.

## Imported draft authority audit (2026-10-13)

This pass reproduced three defects. Draft revise and refresh accepted an edited,
unapproved specification counter as the next revision's baseline. Recovery of an
older draft revision could mark its unfinished plan approved. A scope refresh
failed with `ENOENT` when adding the first draft plan to an approved specification.
The negative probes and missing-plan matrix failure are retained in the evidence
folder below.

Track planning and draft revision now share committed specification approval
lookup. Recovery also preserves the draft status, unapproved plan and prior spec
approval evidence. Refresh recognizes newly introduced artifacts before reading
their old bytes. Eleven maintained regressions cover both workflows, interrupted
invalid intents, the initial missing-plan case and all four two-step revise/refresh
orders. Valid partial writes and stage loss retain their existing recovery path.
No published receipt schema or immutable template changed.

The packaged matrix covers three client identities, four approval modes and both
schedules. It rotates all four revise/refresh orders and drafts with/without an
initial plan, checks malformed proposal rejection before and after restart, then
recovers two revisions before planning, implementing, reviewing and archiving.
Its initial driver incorrectly called resume after reconciliation had removed the
intent; the corrected driver checks committed reconciliation. A later run exposed
the real missing-plan refresh bug, which is covered by a maintained regression.
The superseded full test run was stopped when that runtime fix landed; only the
final complete rerun is authoritative.

Evidence and retained projects: `~/.codex/tmp/cadre-draft-authority-20261013/`.
These are synthetic approvals and runtime fixtures, plus native installation
checks. They do not claim exhaustive model-driven conversations. No root `.cadre/`,
push, tag, npm publication or GitHub release is part of this audit.

Native candidate validation passed after the final missing-plan fix. Codex reports
`3.9.2+codex.local-20261013T155950Z` installed/enabled, and Claude reports
`3.9.2+claude.local-20261013T155950Z` enabled at user scope. All three installed
MCP bundles match SHA-256
`9d11ff8b6988a4e80725e237b31b30cafa64ebc407769f05db0845b2c28c1a9d`
and initialize as Cadre 3.9.2 with 25 tools. Native Zed 1.23.3 visibly lists all
ten Cadre skills and shows the server enabled with a green indicator after
`workspace: reload`. Zed PID 4536 owns Node child 5140 running the installed
marketplace bundle. Narrow permissions and unrelated settings are preserved.
The global CLI was updated from the local candidate tarball, reports 3.9.2 and
passes doctor with all 39 templates and a self-contained runtime. No model
request or project trust change was needed for native verification.

The final packaged matrix passed **24/24 cases** with zero failures, cancellations
or skips (464,617 ms). It completed 48 interrupted draft revisions and archived
all 24 tracks after plan approval, implementation and clean review. All three
clients, four approval modes and two schedules are represented. Sequence and
initial-plan variants rotate across those combinations rather than claiming the
full Cartesian product of every possible workflow input.

Final verification passed **450/450 maintained tests** with zero failures,
cancellations or skips (544,980 ms). Frozen installation, strict TypeScript,
package validation, pack dry run, all ten skill validators and full docs checks
passed. Authoritative logs are `final-tests.log`, `matrix-final.log`,
`check-final.log`, `validate-final.log`, `pack-final.log`, `skills.log`, `docs.log`,
`payloads-final.log`, `native-config.log` and `doctor.log` in the evidence folder.
No additional defect appeared in the final pass, and no known blockers remain in
the tested scope. Healthy projects need the updated runtime and client restart;
invalid older pending intents retain their evidence for approved repair.
