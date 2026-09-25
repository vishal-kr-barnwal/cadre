# Cadre cohesive changes and bounded context audit

Verified locally on 2026-09-25 with Node 26.8.2 and native Codex CLI 0.154.0. The development audit covers the changes released in 3.9.0: template set v5 and schema-2 state. During that audit the installed plugin, FRM, Dhivon, and their Git histories were not changed. Release installation validation is recorded separately; it does not migrate those projects.

## Problem established by both baselines

The observed sessions mixed product delivery with repeated state/provenance commits, separate verification starts, repeated context inventories and recursive archived dependency reads. Both encountered integration blocked by coordinator-owned dirty state. Dhivon additionally produced two 628,796-byte cache errors containing 6,113 paths each.

| Observed baseline | FRM | Dhivon |
| --- | ---: | ---: |
| Product / Cadre-only / merge commits | 47 / 71 / 6 | 13 / 12 / 6 |
| Cadre MCP calls | 1,002 | 171 |
| Context reads / continuations | 576 / 507 | 68 / 39 |
| Context request bytes | 2,493,505 | 102,039 |
| Context response bytes | 31,327,109 | 1,660,579 |
| Separate verification starts | 27 | 3 |
| Client input tokens | 262,359,601 | 81,661,742 |
| Client cached input tokens | 254,753,536 | 78,503,936 |
| Client output tokens | 1,037,971 | 333,826 |

These are aggregate observations from the original sessions, not a controlled before/after experiment. Historical elapsed time is unavailable. The sanitized [baseline fixture](../../harness/test/fixtures/efficiency/baselines.json) retains counts, synthetic dependency topology and failure conditions; it excludes raw rollouts, credentials and project content.

## Implemented behavior

- Stable `op:<id>` references resolve to exactly one commit reachable from HEAD. Resolution verifies the committed receipt, approval digest binding, base ancestry and every artifact hash. Receipt artifact reads use Git batch reads; one inspection reuses receipt resolution and history enumeration.
- A flushed recovery journal precedes promotion. Uncommitted operations block dependent delivery. Agent Git tools create the operation commit with returned trailers; reconciliation only removes temporary recovery state. Retrying promotion/reconciliation does not create another commit.
- New plans group related tasks within a phase. The scheduler collapses group dependencies, rejects cycles, orders internal dependencies, and exposes independent ready groups. Atomic completion preserves each task's authorization, verification and handoff. Reverting a shared commit requires the whole group's approved reconciliation and original journal snapshot.
- Track, revise, refresh, remediation and revert reconciliation use constrained `candidate_apply`. Initialization, execution finish, clean review and archive retain their existing semantic operations and return receipts. MCP does not edit arbitrary product files or run Git commits.
- Dependency context records full source coverage, fingerprints, stable constraint identities and approval provenance. Missing, modified or stale context uses an identified full-source fallback. Archive rebases moved source paths under the batch approval; historical learning stays unchanged.
- Context defaults to 48 KiB, retains the 64 KiB ceiling, and issues a short-lived retained-context token only after complete retrieval. Section hashes permit reuse when unrelated parts of a file change. Compaction requires clearing the token; expiry, pagination drift and stale required guidance remain checked.
- Integration permits only validated, execution-bound coordinator state/journal changes, verifies their unchanged contents, and fast-forwards when possible. Workers cannot modify protected Cadre state. Build cache ownership is explicit and narrowly ignored; unrelated dirty files and symlinks remain blocked.
- Serialized runtime errors stay within 8 KiB; explicit diagnostic reads retain full detail. A 6,113-path synthetic error serialized to **700 bytes** in the ordinary MCP response.
- An approved refresh migrates at quiescence, preserves legacy evidence and the current execution contract, and enables grouping only for new executions. All ten skills, worker guidance, schemas and public documentation describe the new path. Immutable v1–v4 template bytes are unchanged.

## Controlled context replay

The FRM-shaped fixture has two direct dependencies and ten transitive archived tracks. Every source contains a curated required-constraint sentinel plus synthetic historical detail. Dhivon supplies the smaller, dependency-free shape. Each test makes five reads with a context-loss reset before the fourth read.

The before path uses full dependency retrieval, `knownSources` inventories and 16 KiB pages. The after path uses approved curated context, retained tokens and 48 KiB pages. Both paths execute the current reader; this isolates retrieval behavior rather than claiming an end-to-end replay of the old binary. Request inventories remain fixed throughout each paginated read. Every curated constraint is asserted after cold retrieval, and changed required guidance forces full-source fallback.

| Fixture / path | Calls | Request bytes | Response bytes | Combined bytes |
| --- | ---: | ---: | ---: | ---: |
| FRM-shaped before | 45 | 42,781 | 700,947 | 743,728 |
| FRM-shaped after | 5 | 897 | 48,136 | 49,033 |
| Dhivon-shaped before | 5 | 10,197 | 36,545 | 46,742 |
| Dhivon-shaped after | 5 | 897 | 36,545 | 37,442 |

Combined context bytes fell **93.4%** for the FRM shape and **19.9%** for the Dhivon shape. FRM-shaped context calls fell 45 → 5. The last measured replay took approximately 636 ms and 273 ms respectively, including both paths and fixture work inside the measurement. These domain tests have no client token counters. Byte savings do not establish token savings.

## Native Codex sessions

The final clean lifecycle ran in one fresh disposable directory against the built local MCP server, with user configuration ignored and no plugin installation. It exercised create → track → implement → clean review → archive, status and read-only Wisp. Real `node --test` checks passed, retained context was reused, all five operation receipts reconciled, and the final worktree was clean.

| Final clean lifecycle | Measured result |
| --- | ---: |
| Total commits | **6** |
| Product / Cadre / merge commits | 1 / 5 / 0 |
| Cadre MCP calls | 37 |
| Context reads | 2 |
| Separate verification starts | **0** |
| Composite verification checkpoints | 2 |
| Serialized MCP request / response bytes | 7,960 / 78,580 |
| Context request / response bytes | 257 / 32,143 |
| Host log-write elapsed time | 310 seconds |
| Client input / cached input tokens | 1,778,175 / 1,702,656 |
| Client output / reasoning output tokens | 7,073 / 63 |

The six commits are initialization, combined track, product implementation, execution completion, clean review, and archive. This meets the six-commit target against the plan's previously derived twelve-commit path; twelve was not remeasured in a matching native session. The domain lifecycle independently produced six commits, seven checkpoint actions and zero separate verification starts in approximately 5.66 seconds.

A second disposable clone exercised track, revise, refresh, grouped implementation, whole-group additive revert, recovery, reimplementation and review remediation. Review caught an intentionally seeded non-string input defect (3 passing tests, 1 failing), appended remediation, and finished with all 4 tests passing and a clean worktree. It preserved the original reversal journal, prior completed evidence and the initialization receipt.

| Revision / revert / remediation audit, including continuation | Result |
| --- | ---: |
| New commits / total including cloned initialization | 13 / 14 |
| Cadre calls | 68 |
| Serialized request / response bytes | 19,001 / 148,301 |
| Host log-write elapsed time, summed sessions | 751 seconds |
| Client input / cached input tokens | 3,077,547 / 2,914,688 |
| Client output / reasoning output tokens | 18,734 / 1,349 |
| Separate verification starts | 0 |

The 13 new commits include one deliberately seeded product fault and one additive reversal. They represent multiple approved operations and remediation, not the ordinary one-task lifecycle. Across both fixtures all ten workflows ran.

Earlier native attempts exposed three defects, which were corrected and retried without rewriting history: trailers supplied in separate Git `-m` paragraphs, an empty archive update manifest rejected by input validation, and a standard `bugs/bug-001.md` remediation path missing from the allowlist. Their failed calls and token costs remain separately recorded in [native results](../../harness/test/fixtures/efficiency/native-results.json); they are excluded from the fresh lifecycle row. The first recovery lifecycle used 38 calls across three sessions and also ended at six commits. Tests additionally cover crashes during promotion and after commit creation, before reconciliation.

Elapsed times above use captured log creation-to-final-write times and include native startup; they are not latency estimates from model output. Native byte counts serialize captured MCP arguments/results without JSON-RPC framing. Token counters come directly from Codex `turn.completed` events and include cached input; no token saving percentage is inferred. Historical projects and small synthetic native sessions differ in scope, so their total call/token counts are not directly comparable.

## Regression and package verification

**111 tests passed.** Coverage includes crash/resume without duplicate commits; forged, missing, ambiguous and unreachable receipts; grouped and independent scheduling; whole-group revert evidence; owned dirty integration and unrelated files; cache ownership/symlinks and oversized errors; required-guidance drift, unchanged sections, token expiry/compaction and pagination; quiescent legacy migration; archive reseeding and preserved historical learning. Existing legacy, autonomous review, packaging and installer tests also pass.

Completed checks:

```sh
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
pnpm --filter cadre-ai pack --dry-run
pnpm --filter cadre-docs check
```

Docs verification includes content validation, lint, types and static build. No installation into active clients or release command was run during the development audit. The subsequent 3.9.0 release follows the repository's full release and three-client installation process.

## Reproduction

The recorded [domain measurements](../../harness/test/fixtures/efficiency/domain-results.json) retain separate calls, bytes and elapsed-time counters. The domain scenarios live in [efficiency.test.ts](../../harness/test/efficiency.test.ts); the measured context replay is in [memory.test.ts](../../harness/test/memory.test.ts). Run these from `harness/`:

```sh
node --import tsx --test test/efficiency.test.ts
node --import tsx --test --test-name-pattern='FRM and Dhivon shaped' test/memory.test.ts
```

For native replay, build the harness, create an empty temporary Git workspace, and substitute the absolute harness root for `{{HARNESS_ROOT}}` in [native-lifecycle.txt](../../harness/test/fixtures/efficiency/native-lifecycle.txt). Pass that prompt to `codex exec --ignore-user-config --ignore-rules --skip-git-repo-check --json`, with its cwd set to that disposable workspace, `approval_policy="never"`, and `mcp_servers.cadre` configured to launch `node <harness-root>/harness/dist/cadre-mcp.mjs`. Set `mcp_servers.cadre.env.CADRE_HOME` to a separate temporary runtime directory. The prompt authorizes only the exact synthetic fixture and requires stopping on scope drift or runtime defects.

Clone the resulting fixture into another temporary directory, select its initialization commit on a new local fixture branch, and run [native-changes.txt](../../harness/test/fixtures/efficiency/native-changes.txt) using the same isolated MCP configuration. Do not run either scenario in a real project. Retain JSONL logs locally and generate sanitized metrics with:

```sh
node harness/scripts/measure-efficiency-audit.mjs /path/to/run-events.jsonl
```

The measurement script reads logs only, emits aggregate counts and structural checkpoint sequences, and does not copy prompts, tool output or credentials. Exact bytes and elapsed time can vary with temporary path lengths and machine load.
