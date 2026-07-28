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

Raise the bound when phases or tasks have clear dependency and file boundaries,
checks can run concurrently, and the host has spare CPU and memory. Keep it low
when workers compete for shared ports, databases, generated files, package
caches, or expensive test infrastructure. More workers can also move the
bottleneck to human approval and serialized phase integration.

Change the project workflow through `refresh`, approve the new policy, and use
the resulting bound for a new execution. An active execution retains the
`maxWorkers` value recorded in its journal. If that bound must change during an
active track, quiesce work at a clean boundary and create an approved replacement
execution instead of rewriting the existing journal.

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
