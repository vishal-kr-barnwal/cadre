# Cadre 3.9.2 candidate verification

Verification on 2026-10-12 covers the active-revision fix and three additional
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

The final complete harness run passed **216/216 tests**, with no failures or skips.
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
