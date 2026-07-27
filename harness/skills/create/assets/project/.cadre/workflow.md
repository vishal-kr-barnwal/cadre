# Cadre Workflow

This file governs every Cadre command except that `wisp` does not mutate Cadre state. If a command-specific instruction conflicts with this file, stop and present the conflict to the human.

## Non-negotiable operating rules

### Read before edit

Before editing an existing file, read the current file and its directly relevant context, including applicable repository instructions, callers, tests, types, and configuration. Before creating a file, inspect the target directory and nearby conventions. Never change a file by guessing its current contents. Record material evidence read in the task or review summary.

### Human governance

Treat every artifact and state transition as a proposal until the human reviews and explicitly approves it. Present exact content or a focused diff, consequences, unknowns, and verification evidence. Approval for one artifact or transition does not imply approval for later ones. Persist an approved checkpoint before pausing a multi-stage flow so another session can resume it.

### Clarification gate

Inspect available files, history, state, and approved artifacts before asking. If a material choice remains ambiguous and different answers would change scope, requirements, acceptance criteria, dependencies, compatibility, architecture, plans, or cascading state, ask the human a concise targeted question and pause that branch of work. Do not guess, choose a convenient default, or treat silence as approval. Continue without asking only when evidence resolves the choice or the assumption is immaterial and is explicitly disclosed.

`create` must explicitly classify the repository as `greenfield` or `brownfield`. Greenfield means no substantive existing product implementation/history; brownfield means existing implementation, behavior, users, data, interfaces, or delivery history must be understood and preserved or intentionally changed. If evidence is mixed or insufficient, ask which classification to use before drafting Cadre artifacts. Persist the approved classification in `project.json` and `product.md`.

`track`, `revise`, and `refresh` must apply this gate before drafting and again whenever later analysis reveals a new material ambiguity.

### Create-time workflow and styleguide acceptance

During `create`, present this default workflow as its own approval item and ask whether it is acceptable or should be changed. Do not infer workflow acceptance from approval of product, stack, or other setup artifacts. Apply requested changes, present the revised workflow, and obtain explicit acceptance before writing it.

Always propose `styleguides/general.md`. Match the approved tech stack against the bundled default catalog, then propose the applicable language, framework, and build-tool guides. For each guide, let the human choose the bundled default, an amended default, or a user-provided replacement. Framework/tool guides supplement their language guide: HTML/CSS underpins browser UI; TypeScript supplements JavaScript; React for the web supplements HTML/CSS plus JavaScript or TypeScript; Flutter supplements Dart; SwiftUI supplements Swift; Maven or Gradle supplements Java/Kotlin. Copy only the approved set. In brownfield projects, existing enforced conventions take precedence unless the human explicitly approves replacing them.

### Interruption-safe operations

For every multi-step state mutation—and specifically `create`, both spec/plan stages of `track`, and archive batches—write an operation journal immediately after approval and before artifact writes. Use `project.json.setup.operation` for create, track `state.json.operation` for track-local flows, and a file derived from `.cadre/templates/project/archive-operation.json` under `.cadre/operations/` for archive batches. Record the action, durable checkpoint, base commit, expected commit message, approved artifact paths, and per-artifact progress.

On every command entry, reconcile an existing journal before starting new work:

1. If the journal exists and matching files are dirty, resume the first incomplete artifact/checkpoint, validate, and create the expected commit.
2. If the journal exists, the worktree is clean, and HEAD matches its expected message and base relationship, the artifact commit already succeeded; record HEAD instead of repeating work.
3. If the artifact SHA is recorded and only the approved state bookkeeping is dirty, finish its `cadre(...): record ...` commit.
4. If files, journal, approval record, Git status, or HEAD disagree, stop and present the mismatch. Never reset, discard, reconstruct from guesses, or restart the flow.

Advance the checkpoint after each durable artifact write. Once the artifact commit is identified, append it to history, clear the operation, advance the lifecycle checkpoint, and commit the state record. This protocol makes interruption before a commit, after a commit, or before its follow-up state commit resumable.

During `create`, detect an existing worktree with `git rev-parse --show-toplevel` and never initialize a nested repository. If no worktree exists, record the approved project root and `initialize` disposition in the setup journal, run `git init` there, verify the resulting root, and checkpoint it before the setup commit. Resume a pending initialization from the journal; stop if the observed repository conflicts with the recorded disposition or root.

### Sources of truth

- `plan.md` is the execution source of truth for phases, tasks, order, status, and commit provenance.
- `spec.md` is the scope and acceptance source of truth.
- Each track's `state.json` is the canonical source for its identity, title, type, status, dependencies, revision, checkpoints, and operation history; it must agree with the approved spec and plan.
- Track location is derived: non-archived state lives at `tracks/<track-id>` and archived state at `archive/<track-id>`. Never persist a track path field.
- `project.json` contains project/setup/refresh history only; it does not duplicate track records.
- `tracks.md` is a generated lifecycle summary discovered from track-local state. It intentionally omits dependencies and paths; never hand-edit it.
- Git is the implementation history. Do not claim completion without recorded commits.

## Lifecycle

```text
drafting-spec -> drafting-plan -> planned -> in_progress -> ready_for_review
      ^                |              |             |              |
      +------ revise --+--------------+-------------+              |
                                                                    v
                  completed <- clean approved review <- review -----+
                       |                                  |
                       v                                  +-> approved bugs
                    archived                                  -> in_progress
```

Legal track statuses are `drafting-spec`, `drafting-plan`, `planned`, `in_progress`, `ready_for_review`, `completed`, and `archived`. A completed or archived track cannot be revised. Only review can mark `completed`; only archive can mark `archived`.

## Track construction

- Track type is exactly `feature` or `bug`.
- A spec contains functional requirements, non-functional requirements, acceptance criteria, additional information, dependencies, and impact.
- A plan contains ordered phases and tasks. Every delivery/remediation phase ends with a task named `User Manual Verification`.
- The final phase is named `Track-level User Manual Verification` and also ends with a `User Manual Verification` task.
- A track may start implementation only when every declared dependency is completed or archived after completion.
- After spec and plan approval, populate the marked Pattern Seed section at the top of `learning.md` only from relevant, existing patterns and cite the source pattern paths. Do not create a separate seed file.

## Implementation discipline

1. Load this workflow and the full current track before acting.
2. At phase start, read the previous phase's learning; phase one reads the marked Pattern Seed section in the same file.
3. Select work from the plan, one task at a time. Re-read the plan between tasks.
4. Follow read-before-edit. Keep scope limited to the active task.
5. Write/update tests and documentation required by the spec and Definition of Done.
6. Run focused tests during work, then formatting/lint/type checks and the relevant broader suite.
7. Present the diff and evidence. Manual-verification tasks require explicit human confirmation.
8. Create Conventional Commits for meaningful implementation units. At minimum, commit each completed task; a large task may contain several meaningful commits.
9. Mark a task complete only after verification and record its implementation commit SHA in `plan.md`. Use a follow-up `cadre(implement): record ...` commit for bookkeeping when necessary.
10. When a phase completes, record its completion commit SHA in both `plan.md` and that phase's `learning.md` section. The final manual-verification task commit may serve as the phase completion commit.
11. Append phase-scoped learning. Do not overwrite prior learning.

## Definition of Done

A task is done when its approved outcome exists, relevant tests cover success/failure/edge cases, checks pass or documented exceptions are approved, formatting and repository conventions are satisfied, docs are updated, no unrelated changes are included, artifacts were shown to the human, and commit provenance is recorded.

A phase is done when all tasks are done, phase learning is recorded, and its final User Manual Verification is explicitly approved. A track is ready for review only after its final track-level manual verification. It is completed only after an approved clean review.

## Review and remediation

Review acceptance criteria, non-functional requirements, diffs, callers, tests, security, compatibility, error paths, and learning claims. Present findings before recording them. Approved findings go in `bugs/bug-<review-ts>.md`; add remediation phases to the plan, ending each with manual verification and restoring a final track-level verification phase. Set the track back to `in_progress`. Repeat implement/review until a clean review is approved.

## Revisions, refreshes, and cascading impact

Every track revision gets `revisions/revision-<ts>.md`; every project refresh gets `refreshes/refresh-<ts>.md`. Assess transitive dependent tracks whenever a spec, acceptance criterion, dependency, workflow, pattern, tech-stack, or styleguide change may affect them. Present all cascading changes for approval before mutation. Preserve superseded content and completed-work provenance rather than erasing history.

## Archival and learning

Archive one or more selected completed tracks in one approved batch. Validate the whole selection before mutation, distill the selected learning as one corpus into patterns with source track/task/commit provenance, reconcile it with existing patterns, then propose relevant reseeding for all active tracks. Journal the ordered selection and per-track/artifact progress, move each full track directory to `archive/`, validate once, and commit the batch together. Never discard history or start another archive batch while one is incomplete.

## Git safety and commits

- Use Conventional Commits for product work.
- Cadre-only state commits use `cadre(<command>): <description>`.
- Do not mix unrelated work into a task commit.
- Prefer additive `git revert` commits. Do not rewrite shared history or use destructive reset/checkout as the default revert mechanism.
- Do not overwrite dirty user changes. Stop and explain overlap.
