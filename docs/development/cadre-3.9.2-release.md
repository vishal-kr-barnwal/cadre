# Cadre 3.9.2 candidate verification

Verification on 2026-10-12 covers the active-revision fix and three additional
recovery defects found during lifecycle testing. This is a candidate verification
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

The complete harness run passed **170/170 tests**, with no failures or skips. One
subsequently added multi-track atomic refresh regression passed separately, for
**171 distinct maintained tests checked**. Type checking also includes that new
test. The recovery suite adds 37 cases, including 24 complete worker lifecycle
cases, eight record-only rejection cases, and five boundary/cascade regressions.

Checks passed:

```sh
pnpm install --frozen-lockfile
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
# Final added regression, from harness/:
node --import tsx --test --test-name-pattern='multi-track' test/candidate-recovery.test.ts
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
