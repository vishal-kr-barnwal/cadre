---
title: Quickstart
description: Run a first human-approved Cadre track from project creation through archive.
section: Start Here
order: 30
---

# Quickstart

This walkthrough assumes Cadre is installed and the client has been reloaded.
Cadre commands are agent skills, not `cadre-ai` shell subcommands.

## 1. Create Project Context

Open the target repository in Codex or Claude Code:

```text
# Codex
$cadre:create

# Claude Code
/cadre:create
```

Cadre inspects the repository, establishes its exact root and Git disposition,
and explicitly classifies the project as greenfield or brownfield. When the
evidence is ambiguous, it asks before drafting.

Review the proposed product, engineering guidelines, technology stack,
workflow, styleguides, patterns, and project state. Workflow and styleguides
receive explicit approval. Only after the full file set and project/Git choices
are approved does Cadre create `.cadre/`, validate it, and record setup commits.

## 2. Create A Feature Or Bug Track

```text
# Codex
$cadre:track Add passwordless login as a feature

# Claude Code
/cadre:track Add passwordless login as a feature
```

Cadre first proposes `spec.md` with functional requirements, non-functional
requirements, acceptance criteria, dependencies, and additional information.
After spec approval and commit, it proposes `plan.md` and `learning.md`.

The plan is an acyclic dependency graph:

- each regular phase declares phase dependencies;
- each regular task declares same-phase task dependencies;
- every delivery phase ends with a derived `User Manual Verification` barrier;
- the final phase contains only track-level manual verification and depends on
  every delivery phase.

The track becomes `planned` only after the plan graph and pattern seed are
approved, validated, and committed.

## 3. Check Status

```text
$cadre:status
/cadre:status
```

Status is read-only. It reports project and track checkpoints, pending
operations, dependencies, execution nodes, review/archive readiness, validation
errors, and managed worktrees.

## 4. Implement The Plan

```text
$cadre:implement passwordless-login
/cadre:implement passwordless-login
```

Parallel mode is the default. Request sequential execution explicitly:

```text
$cadre:implement passwordless-login sequentially
/cadre:implement passwordless-login sequentially
```

Phase approval is also the default: Cadre runs regular work autonomously and
pauses once at each phase's final verification task. Request `governed` for
task-by-task gates or `autonomous` to pause only at track-level verification.
The implement command itself authorizes execution start, so phase and
autonomous modes do not add a start-approval prompt.

Cadre starts a digest-gated execution journal, derives a global queue from ready
phases and phase-local tasks, and creates workers only when at least two safe
nodes can run. A phase can move between sequential execution and task fan-out
only at a clean checkpoint. Workers use isolated Git worktrees; main reviews
every diff and presents it according to the persisted approval mode.

The main agent alone records state, directs commits, integrates branches,
resolves conflicts, removes worktrees, and records manual verification. When
all nodes, learning, provenance, and cleanup are complete, an approved finish
transition moves the track to `ready_for_review`.

## 5. Review

```text
$cadre:review passwordless-login
/cadre:review passwordless-login
```

Review inspects the recorded implementation range and relevant context. If it
finds actionable bugs, it presents the findings together with exact bug and
remediation-plan artifacts. Approved remediation returns the track to
implementation.

If the evidence is clean—or the human explicitly rejects proposed findings and
accepts the risks—Cadre previews a clean completion bound to the current
execution, plan revision, graph digest, and reviewed HEAD. Only `review` can
mark the track `completed`.

## 6. Archive Completed Work

```text
$cadre:archive passwordless-login
/cadre:archive passwordless-login
```

Archive can process one or more completed tracks in a single approved,
resumable batch. It moves track history to the derived archive location,
distills durable learning into project patterns, reseeds relevant active
tracks, rebuilds `tracks.md`, and records Git provenance.

## Supporting Commands

- Use `revise` when the approved desired behavior, scope, or plan changes.
- Use `refresh` when project product, workflow, stack, styleguides, or patterns
  drift from repository evidence or user intent.
- Use `revert` to prepare an additive Git-aware reversal.
- Use `wisp` for lightweight exploration that should not mutate Cadre state.

Continue with [How Cadre Works](how-cadre-works.md) or the complete
[Workflow Guide](workflows.md).
