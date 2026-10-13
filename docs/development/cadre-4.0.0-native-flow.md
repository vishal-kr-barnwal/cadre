# Cadre 4.0.0 native Codex lifecycle verification

This record covers a disposable brownfield project exercised through real Codex
CLI sessions on 2026-10-13. It supplements the deterministic harness tests; it is
not a claim that every model, mode, client or possible interruption was tested
natively.

## Environment and method

- Candidate: the local 4.0.0 working tree based on
  `58abcc3139949886f4dab7079f7207e8290b75d7`, schema 2, template set v6.
- Client: Codex CLI 0.159.2, `gpt-6.1-sol`, high reasoning.
- Runtime: local built `harness/dist/cadre-mcp.mjs`, explicitly configured for
  ephemeral native sessions. No globally installed client configuration changed.
- Fixture: `/Users/vishal/.codex/tmp/cadre4-native-flow-20261013/shop`.
  Sibling files retain prompts, raw JSONL tool transcripts, stderr, final messages,
  proposal manifests, source hashes and stage snapshots.
- The initial repository contained a small Node ESM catalog and passing test.
  Cadre inspected this brownfield code and incorporated the requested cart API.
- Execution used policy-v2 Autonomous approval with sequential task groups.
  The test driver supplied explicitly labelled synthetic approvals after
  inspecting proposals. These are fixture decisions, not real product acceptance.
- Each interruption ended a native session at a specified durable boundary. A
  fresh session resumed from disk. This tests workflow restart, not process death
  in the middle of an individual filesystem write; maintained tests cover those
  finer promotion boundaries.

## Native scenarios

| Scenario | Observed result |
| --- | --- |
| Brownfield create | Existing source, tests and Git inspected; user intent incorporated; approved setup applied and reconciled once. |
| Track drafting interruption | Only the specification was staged before stopping. Fresh Codex retained its exact SHA-256 and completed the same five-file candidate. |
| Partial implementation | T1.1/T1.2 committed and checkpointed; later tasks remained pending. |
| Revision during implementation | Added exact basis-point discounts; approved revision advanced canonical state to revision 2 and superseded the old execution. |
| Revision interruption after apply | Fresh Codex committed/reconciled the original receipt once, inherited Autonomous authority and retained completed node evidence. |
| Intervention after implementation | Driver deliberately injected an arithmetic bug that escaped the existing 24 tests. This was controlled application test data, not a Cadre defect. |
| Review and remediation | Codex reproduced the defect, retained failed evidence, appended remediation phases and fixed it in one attempt. Two new regressions failed before the fix and passed afterwards. |
| Cumulative re-review | All 26 tests, both README examples and 200,020 independent arithmetic comparisons passed. Completion remained pending explicit approval. |
| Manual edit after clean proposal | Original completion token rejected changed README content. All 32 canonical file hashes remained unchanged. Manual edit was then reverted additively. |
| Clean completion after restoration | A fresh session reused the original persisted token successfully, committed review evidence and receipt together once, and reconciled at `9fcaf45b3b5afd00a7495f0e409de9e2e1ceca02`. |
| Archive interruption and recovery | Applied the exact approved batch, stopped before commit, then recovered in a fresh session. One archive commit (`0e83c3b`) retained all ten historical artifacts byte-for-byte and reconciled the original receipt. |
| Refresh after archive | Approved and applied current product/technology context plus a fresh refresh record; reconciled one commit (`b305d9c`). All archived artifact hashes remained unchanged. |

The seeded defect used a Number intermediate in discount calculation. For subtotal
`4503599627370495` and discount `9999`, it returned `450359962737` instead of
`450359962738`. The pre-fix boundary sweep found 5,754 mismatches among 200,020
cases; exact BigInt arithmetic reduced that to zero. Failed checks and resolution
evidence remain in the fixture's review report, learning and execution journal.

## Guidance issues found and corrected

1. Active revision authoring initially produced five rejected MCP calls:
   incorrect completed-task marker syntax, nonsequential pending IDs, an omitted
   declared file, and validation against the still-bound old execution graph.
   The runtime rejected these without promoting invalid state. Revision guidance
   now states the exact marker syntax and pending-ID rules, and uses the combined
   `candidate_apply` preparation that derives supersession before validation.
   The next native session prepared/applied the corrected revision without errors.
2. A review context read changed `knownSources` midway through pagination and
   received `CONTEXT_SNAPSHOT_CHANGED`. Codex corrected its call and continued.
   Shared guidance now explicitly requires stable scope, token and knowledge
   arguments across continuation pages. The runtime guard remains intact.

The manual-edit rejection is expected safety behavior, not a discovered defect.
The arithmetic fault was deliberately seeded and fixed only in the dummy app.
These native observations required skill/validation guidance changes, not a new
runtime state-recovery bypass or weakened approval policy.

During archive recovery, Codex's helper script selected an in-progress JSONL tool
event with a null result instead of its completed event. The commit command
therefore failed before mutation. A premature reconcile returned `COMMIT_PENDING`;
Codex corrected the event selection, made the one commit, and reconciled normally.
This was a native agent orchestration error with a successful runtime guard, not
a duplicate-commit or archive-state defect.

## Verification

The final isolated regression run passed **480 tests**, with zero failures,
cancellations or skips. Its `CADRE_HOME` was separate from the native fixture's
proposal cache. Type checking and the documentation content/lint/type/static-build
checks passed. Package validation and `pack --dry-run` passed. All eight edited
mutation skills passed the skill validator.

The native sequence used **14 fresh Codex sessions**. Final fixture HEAD is
`b305d9c5686d14737c83e329da17bde2bfab1eed`. Independent final checks passed:

- One archived track, no active tracks, no recovery journals, clean Git and only
  the primary worktree.
- All **nine receipts** have exactly one reachable operation commit, the exact
  receipt trailer and matching committed artifact hashes, including archive
  deletions. No record-SHA follow-up commits were needed.
- Original Autonomous origin, authorization time and cumulative baseline remain
  intact. T1.1/T1.2 node evidence is identical across all three retained journals.
- Review history contains `changes_requested` then `clean`; the stable finding
  is resolved with exactly one remediation attempt.
- All archived artifacts match the approved archive hashes after refresh.
- Fresh final fixture tests: **26 passed**, zero failures, cancellations or skips.

`final-verification.json`, `final-verification.log`, `final-fixture-tests.log` and
`14-final-status.json` in the evidence directory retain these checks. This flow
found no unresolved Cadre state/recovery defect. It does not establish exhaustive
native coverage of Governed/Phase/Track modes, parallel workers, other clients,
or revert/wisp; those remain distinct from this Autonomous/sequential native run
and the broader automated regression matrix.
