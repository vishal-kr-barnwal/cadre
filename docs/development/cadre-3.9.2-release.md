# Cadre 3.9.2 candidate verification

Verification through 2026-10-13 covers the active-revision fix and three additional
recovery defects found during lifecycle testing, plus the subsequent authority, interrupted-input and imported-draft fixes. This is a candidate verification
record. Publication and fresh native installer checks for the final patched
payload remain pending.

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

The final complete harness run passed **279/279 tests**, with no failures or skips.
The preceding complete run passed 216 tests; 63 follow-on maintained cases are
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
no cancellations, failures or skips. No core source changed after that final run.

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
