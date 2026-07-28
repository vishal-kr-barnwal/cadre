---
title: Workflow Tuning
navTitle: Tuning
description: Adjust context, planning, execution, verification, and approval without bypassing Cadre state.
section: Operations
order: 100
---

# Workflow Tuning

Cadre is tuned through approved artifacts and explicit workflow requests, not
through hidden runtime knobs.

## Keep Context Focused

- Put stable product and engineering decisions in project context.
- Put track-specific requirements and acceptance in `spec.md`.
- Put executable work and verification in `plan.md`.
- Put only semantically relevant durable patterns in the marked Pattern Seed.
- Let later phases read learning only from declared dependency phases.

This keeps worker prompts bounded while preserving the evidence required for
correct decisions.

## Shape Plans For Safe Concurrency

Parallelism follows dependencies. To expose safe work:

- split independent outcomes into separate phases or tasks;
- declare every phase dependency explicitly;
- declare every regular same-phase task dependency explicitly;
- avoid two nodes that must modify the same tightly coupled files at once;
- include tests, formatting, documentation, and Definition of Done work as
  explicit tasks;
- keep the derived manual-verification barriers intact.

Do not create artificial parallelism. When only one node is ready, Cadre runs it
in main without worktree overhead.

## Choose The Worker Bound

New projects use a conservative maximum of three delegated workers. This is a
workflow default; the runtime accepts an approved `maxWorkers` value from `1`
through `32`. Actual concurrency is always the minimum of safe ready nodes, the
execution bound, and available host worker slots.

### Preconditions

Increase the bound only when all of these are true:

- the global ready queue regularly contains more safe nodes than the current
  bound;
- concurrent tasks have clear dependency and file boundaries;
- checks can run independently without sharing writable generated output;
- services, databases, and listeners can use isolated names or ports;
- the host has unused child-agent slots, CPU, and memory;
- approvals and serialized phase merges are not already the bottleneck.

More workers do not help a mostly sequential DAG. They can make a tightly
coupled repository slower by increasing conflicts, cache contention, duplicate
setup, and approval backlog.

### Calculate A Starting Ceiling

Measure one representative worker's peak memory and identify the host's child
agent limit. Reserve at least 25% of system memory for main, Git, the operating
system, editors, and integration checks. Use this conservative estimate:

```text
memory ceiling = floor((total memory - reserved memory) / peak worker memory)

candidate maxWorkers = min(
  available child-agent slots,
  memory ceiling,
  typical safe ready-node count
)
```

CPU-heavy compilers and test suites may require a lower value even when memory
permits more. If every worker runs a heavy build, begin near one worker per two
available CPU cores. I/O-bound or mostly independent editing tasks can usually
use more slots.

Use these ranges as operational guidance, not guarantees:

| Bound | Appropriate use |
|---|---|
| `1` | Explicitly sequential work or shared-resource constraints. |
| `2–3` | Default for ordinary repositories and mixed task graphs. |
| `4–6` | Independent modules on a host with measured spare capacity. |
| `7–12` | Large repositories with strong test, service, and file isolation. |
| `13–32` | Exceptional automation-heavy workloads after staged measurement. |

### Increase Incrementally

1. Run a representative execution at the current bound and record wall time,
   peak memory, check duration, conflicts, failed retries, and approval wait.
2. Raise the bound by one or two workers for a new execution.
3. Compare throughput and failure evidence across at least two representative
   phases rather than one unusually parallel phase.
4. Continue only while total wall time improves materially and integration or
   approval backlog remains stable.
5. Stop increasing when another increment produces little improvement. A useful
   heuristic is less than roughly 10% wall-time improvement across two
   successive trials.

Return to the previous bound when memory pressure causes swapping or process
termination, checks slow down under contention, workers collide on shared
resources, merge conflicts rise, or completed work waits longer for approval
and integration than it spent executing.

### Apply The Change

Change the project workflow through `refresh`, approve the new policy, and use
the resulting bound for a new execution. An active execution retains the
`maxWorkers` value recorded in its journal. If that bound must change during an
active track, quiesce work at a clean boundary and create an approved replacement
execution instead of rewriting the existing journal.

```text
$cadre:refresh increase the implementation worker maximum to 6
/cadre:refresh increase the implementation worker maximum to 6
```

## Select Sequential Mode When Useful

Sequential mode is appropriate when work is highly coupled, the repository has
expensive shared setup, or parallel workers would repeatedly collide. Request
it explicitly at implementation start.

Parallel mode remains useful for independent phases or tasks with clear file
and dependency boundaries. The main agent bounds workers by ready nodes, host
capacity, and the approved workflow maximum.

## Centralize Shared Preparation

Before spawning workers, main should perform shared dependency installation,
registry access, image pulls, code generation, and other network preparation.
Workers should use locked/offline modes when the repository supports them.

This reduces permission churn and prevents concurrent mutation of shared
caches or generated state.

## Tune Verification In The Plan

Each task should name focused checks. Each phase manual barrier should define
evidence the human can actually evaluate. Track-level manual verification
should exercise the fully integrated canonical repository.

Project-wide expectations—formatting, type checks, test suites, commit rules,
or release constraints—belong in `.cadre/workflow.md` and
`.cadre/tech-stack.md`. Use `refresh` to change them.

## Keep Approvals Decision-Ready

Group only changes that share one decision and whose evidence already exists.
Cadre can batch immediately valid execution-node bookkeeping, but it must not
batch across an unobserved commit, verification, integration, conflict
resolution, or human approval.

Archive deliberately groups all selected moves, pattern changes, seed updates,
and the derived index into one complete batch proposal. Review similarly
presents findings with exact remediation artifacts when possible.
