# Cadre Workflow

This file governs every Cadre command except that `wisp` does not mutate Cadre state. If a command-specific instruction conflicts with this file, stop and present the conflict to the human.

Cadre's plugin-scoped MCP server is the authoritative runtime and immutable template provider. Project-local `.cadre/` contains only approved mutable context, lifecycle artifacts, and history; it must not contain copied Cadre runtime code or template catalogs. Stateful commands fail closed when required Cadre MCP tools are unavailable.

## Non-negotiable operating rules

### Read before edit

Before editing an existing file, read the current file and its directly relevant context, including applicable repository instructions, callers, tests, types, and configuration. Before creating a file, inspect the target directory and nearby conventions. Never change a file by guessing its current contents. Record material evidence read in the task or review summary.

### Human governance

Treat every artifact and state transition as a proposal until the human reviews and explicitly approves it. Present exact content or a focused diff, consequences, unknowns, and verification evidence. Approval for one artifact or transition does not imply approval for later ones. Persist an approved checkpoint before pausing a multi-stage flow so another session can resume it.

Combine related decisions into one approval when their complete exact artifacts, state transitions, consequences, and verification are available together. In particular, do not split finding disposition from an already-prepared remediation proposal, reject-all risk acceptance from clean-review completion, or a uniquely determined archive selection from its full batch proposal. A combined response must unambiguously approve every included consequence. Any changed content, selection, digest, or newly discovered consequence requires a corrected proposal and new approval.

An `implement` invocation authorizes execution using its persisted `approvalMode`: `governed`, `phase`, or `autonomous`. This is scoped authorization for work already bounded by the approved specification and plan, not permission to guess through material ambiguity, expand scope, waive required checks, perform destructive or remote actions, or conceal conflicts and exceptions. `phase` is the default unless the human explicitly requests another approval mode. Starting a `phase` or `autonomous` execution from that invocation does not require a separate approval prompt.

### Clarification gate

Inspect available files, history, state, and approved artifacts before asking. If a material choice remains ambiguous and different answers would change scope, requirements, acceptance criteria, dependencies, compatibility, architecture, plans, or cascading state, ask the human a concise targeted question and pause that branch of work. Do not guess, choose a convenient default, or treat silence as approval. Continue without asking only when evidence resolves the choice or the assumption is immaterial and is explicitly disclosed.

`create` must explicitly classify the repository as `greenfield` or `brownfield`. Greenfield means no substantive existing product implementation/history; brownfield means existing implementation, behavior, users, data, interfaces, or delivery history must be understood and preserved or intentionally changed. If evidence is mixed or insufficient, ask which classification to use before drafting Cadre artifacts. Persist the approved classification in `project.json` and `product.md`.

`track`, `revise`, and `refresh` must apply this gate before drafting and again whenever later analysis reveals a new material ambiguity.

### Create-time workflow and styleguide acceptance

During `create`, present this default workflow as its own approval item and ask whether it is acceptable or should be changed. Do not infer workflow acceptance from approval of product, stack, or other setup artifacts. Apply requested changes, present the revised workflow, and obtain explicit acceptance before writing it.

Always propose `styleguides/general.md`. Match the approved tech stack against the bundled default catalog, then propose the applicable language, framework, and build-tool guides. For each guide, let the human choose the bundled default, an amended default, or a user-provided replacement. Framework/tool guides supplement their language guide: HTML/CSS underpins browser UI; TypeScript supplements JavaScript; React for the web supplements HTML/CSS plus JavaScript or TypeScript; Flutter supplements Dart; SwiftUI supplements Swift; Maven or Gradle supplements Java/Kotlin. Copy only the approved set. In brownfield projects, existing enforced conventions take precedence unless the human explicitly approves replacing them.

### Interruption-safe operations

At command entry, call `project_status` once and use its embedded structured validation. Reserve a separate `state_validate` call for final mutation gates or focused diagnostics; do not perform redundant full-project validation scans. Derived-state warnings such as a stale generated `tracks.md` are resumable drift, not canonical corruption. Present and repair them through the approved MCP render gate before a final commit.

Within one command flow, inventory required context once and reuse content whose Git path/hash is unchanged. Continue truncated reads from the first unread line instead of restarting them. Do not run line-count or repeated path-discovery passes before known reads. Consecutive reviews reread the current lifecycle artifacts and changed implementation range while reusing unchanged project guidance. Archive reads selected evidence and provenance in one bounded pass. Fetch known immutable template IDs directly with `template_get_many`; do not call the catalog merely to rediscover them.

For every multi-step state mutation—and specifically `create`, both spec/plan stages of `track`, `implement`, finding-bearing `review`, `revise`, `refresh`, `revert`, and archive batches—write an operation journal immediately after approval and before artifact writes or Git mutations. Use `project.json.setup.operation` for create, track `state.json.operation` plus `executions/execution-<ts>.json` for implementation, track `state.json.operation` for other track-local flows including revert, and a versioned operation file under `.cadre/operations/` for refresh and archive batches. Record the action, durable checkpoint, base commit, expected commit message, approved artifact paths, and per-artifact progress.

On every command entry, reconcile an existing journal before starting new work:

1. If the journal exists and matching files are dirty, resume the first incomplete artifact/checkpoint, validate, and create the expected commit.
2. If the journal exists, the worktree is clean, and HEAD matches its expected message and base relationship, the artifact commit already succeeded; record HEAD instead of repeating work.
3. If the artifact SHA is recorded and only the approved state bookkeeping is dirty, finish its `cadre(...): record ...` commit.
4. If files, journal, approval record, Git status, or HEAD disagree, stop and present the mismatch. Never reset, discard, reconstruct from guesses, or restart the flow.

Advance the checkpoint after each durable artifact write. Once the artifact commit is identified, append it to history, clear the operation, advance the lifecycle checkpoint, and commit the state record. This protocol makes interruption before a commit, after a commit, or before its follow-up state commit resumable.

During `create`, detect an existing worktree with `git rev-parse --show-toplevel` and never initialize a nested repository. If no worktree exists, record the approved project root and `initialize` disposition through the MCP initialization preview/apply gate before running `git init` there. Verify the resulting root and record that checkpoint before the setup commit. Resume a pending initialization from the journal; stop if the observed repository conflicts with the recorded disposition or root.

For deterministic MCP mutations, call the read-only preview immediately before apply and pass its digest unchanged. Show the exact proposal to the human whenever the owning workflow and persisted approval mode require a human decision. In `phase` or `autonomous` implementation, execution start plus deterministic worktree, clean integration, cleanup, journal, index, and bookkeeping mutations already covered by the implementation invocation do not create new approval prompts. A changed digest that changes content or consequences requires a corrected proposal at the next applicable approval barrier; a stale digest caused only by an internal ordering error must be refreshed before presentation rather than forcing duplicate approval. The MCP never grants approval or replaces required repository inspection. Its Git surface is limited to constrained, digest-gated Cadre worktree creation, integration, and safe cleanup; it accepts no arbitrary command, path, force deletion, or automatic conflict resolution.

Resuming an already-approved operation is the narrow exception to another human approval: the operation journal must contain the same approval/content digest and the newly previewed final artifacts must be identical to the approved proposal, with only recorded checkpoint progress changed. Any content, selection, consequence, or approval-digest mismatch requires a corrected proposal and new approval.

When a command skill explicitly instructs direct writes for approved Cadre artifacts and no corresponding MCP mutation tool is declared, those direct writes are intentional. Do not search the global tool list for an undeclared operation. Journal the change first, use the available MCP validation and derived-render gates, and stop if the resulting state does not match the approved proposal.

### Sources of truth

- `plan.md` is the execution source of truth for phase/task identities, dependencies, verification barriers, completion, and commit provenance. Display order is only a deterministic scheduling tie-breaker.
- `spec.md` is the scope and acceptance source of truth.
- Each track's `state.json` is the canonical source for its identity, title, type, status, track dependencies, revision, checkpoints, operation pointer, completed execution, and history; it must agree with the approved spec and plan. Active execution nodes are derived from the execution journal, never duplicated as singular active phase/task fields.
- Track location is derived: non-archived state lives at `tracks/<track-id>` and archived state at `archive/<track-id>`. Never persist a track path field.
- `project.json` contains project/setup/refresh history only; it does not duplicate track records.
- `tracks.md` is a generated lifecycle summary discovered from track-local state. It intentionally omits dependencies and paths; never hand-edit it.
- Templates are immutable plugin resources addressed by logical IDs such as `track/spec`; they are rendered into approved artifacts but are never copied into `.cadre/`.
- Git is the implementation history. Do not claim completion without recorded commits.
- `.cadre/.gitignore` keeps `.worktrees/` and `wisps/` out of Git. Worktree and Wisp contents are runtime-only and never Cadre history.

## Lifecycle

```text
drafting-spec -> drafting-plan -> planned -> in_progress -> ready_for_review
                     |             |             |              |
                     +-- revise ---+-------------+              +-- revise --> in_progress/planned
                                   |             |              +-- approved bugs --> in_progress
                                   +-------------+              +-- clean review --> completed --> archived

completed/archived -- changed intent --> successor track
```

Legal track statuses are `drafting-spec`, `drafting-plan`, `planned`, `in_progress`, `ready_for_review`, `completed`, and `archived`. The `revise` command may be invoked in any status, but it routes according to the approved-baseline rules below; it does not make completed or archived history mutable. Only review can mark `completed`; only archive can mark `archived`.

## Track construction

- Track type is exactly `feature` or `bug`.
- A spec contains functional requirements, non-functional requirements, acceptance criteria, additional information, dependencies, and impact.
- A plan is an acyclic graph. Every regular phase explicitly declares phase dependencies; every regular task explicitly declares same-phase task dependencies. Missing declarations, unknown references, self-dependencies, cross-phase task dependencies, and cycles are invalid.
- Every delivery/remediation phase ends with a task named `User Manual Verification`; its dependencies are derived as every sibling delivery task and must not be repeated in the plan.
- The final phase is named `Track-level User Manual Verification`, contains only `User Manual Verification`, and implicitly depends on every preceding phase. Those dependencies are derived and must not be repeated.
- A track may start implementation only when every declared dependency is completed or archived after completion.
- After spec and plan approval, populate the marked Pattern Seed section at the top of `learning.md` only from relevant, existing patterns and cite the source pattern paths. Do not create a separate seed file.

## Implementation scheduling and discipline

`implement` defaults to parallel mode unless the human explicitly requests sequential execution. Persist the requested and effective mode in the execution journal. Parallel mode is permission to schedule ready work concurrently, not a requirement to create workers: when fewer than two safe executable nodes are ready, execute in the main agent without worker overhead. Bound workers by the minimum of ready nodes, host capacity, and the approved workflow maximum of 3.

Persist one independent implementation approval mode:

- `governed`: require human approval for every regular task diff and commit, conflict resolution, manual-verification barrier, and material integration transition.
- `phase` (default): execute regular task work, commits, integrations, conflict resolution within approved scope, worktree lifecycle, generated state, and bookkeeping autonomously; pause exactly once at each phase's final `User Manual Verification` task.
- `autonomous`: execute regular work and phase-level verification autonomously; pause only at `Track-level User Manual Verification`.

All modes stop for a material ambiguity, scope or compatibility decision, failed required check needing an exception, unsafe or mismatched state, destructive action, remote publication, or other authority not granted by the approved spec, plan, and execution. Such a stop is a clarification or blocker, not a routine approval gate. Track-level manual verification always requires the human.

The main agent is the only scheduler and operational owner of every phase integration worktree. Workers never spawn workers, mutate `.cadre/**`, merge, resolve integration conflicts, delete worktrees, or record human approval. Treat the track as a hierarchical DAG: phase dependencies determine active phases, task dependencies determine ready tasks inside each running phase, and main allocates the global worker bound across all ready work. Different phases may run different modes concurrently. Inside one phase, use direct main execution for one ready task, a temporary phase-worker lease for a tightly coupled sequential chain when delegation is justified, or task-worker fan-out for two or more independent ready tasks.

A phase has one mutating execution mode at a time but may switch modes at a clean, journaled checkpoint. Before fan-out, the phase worker finishes and records the current task, verifies the phase worktree is clean, reports its HEAD, releases its lease through a `running`-to-`running` phase update with `workerId: null`, and remains inactive. Main creates each task worktree from that recorded phase HEAD and integrates branches one at a time. Only after every active task worker is completed and its integration/cleanup recorded may main assign a phase worker again. A phase/task worker edits product files only in its assigned absolute worktree, runs focused verification, and returns a structured diff/evidence/learning summary. In `governed` it waits for human task approval before committing; in `phase` or `autonomous` main reviews scope and evidence, then authorizes the commit under the persisted mode.

Before creating workers, main performs a host-permission preflight from the approved plan, repository scripts, lockfiles, and likely checks. Host security permission and Cadre lifecycle approval are separate: a shell, network, listener, or filesystem prompt does not approve an artifact, commit, merge, verification result, or journal transition. Reuse already-approved commands and prefixes; centralize shared installs, registry access, image pulls, and code generation; use locked/offline worker commands where supported; and request a new permission only for one exact necessary operation with a narrow reusable prefix. Do not chain unrelated privilege levels, repeat equivalent commands, or use scaffolding modes that create nested repositories requiring destructive cleanup. A worker that encounters an unexpected permission stops and reports the exact command to main.

Cadre worktrees use sibling namespaces because one worktree cannot safely contain another:

```text
.cadre/.worktrees/<track>/<execution>/phases/P1
.cadre/.worktrees/<track>/<execution>/tasks/P1--t1-1
```

Git ancestry comes from the recorded base commit, not directory nesting. All independent task workers in one dependency wave branch from the same clean phase HEAD; after their merges, the next wave branches from the updated phase HEAD. A task-worker branch merges without squashing into the registered phase integration worktree when one exists. Direct canonical integration is reserved for an explicitly main-coordinated single-task phase; multi-task or phase-verified delivery creates a phase integration worktree first. Tasks executed internally by a phase worker are already on that phase branch and do not get a redundant task merge. Phase branches merge without squashing, one at a time, into the canonical branch. The main agent performs every preview/apply gate and journal transition. A worker commit is recorded immediately in the execution journal; the plan task becomes complete only after canonical integration and records that reachable worker commit SHA.

1. Load this workflow and the full current track. Validate the DAG and reconcile the execution journal, Git worktrees, branch tips, dirty files, and recent commits before scheduling.
2. Root phases read the marked Pattern Seed. Every other phase reads learning from all declared dependency phases; parallel sibling phases do not assume each other's learning.
3. Derive ready phases and tasks from completed dependencies, combine ready tasks from every running phase into one global queue, and allocate workers by the critical path, downstream work unblocked, then plan order. When one approved decision yields multiple transitions that are already valid, use the ordered `execution_nodes_preview`/`execution_nodes_apply` batch. Never batch across a human approval, commit, verification, integration, conflict resolution, or other external evidence boundary.
4. Follow read-before-edit and keep every worker limited to its assigned node and worktree.
5. Write/update tests and documentation required by the spec and Definition of Done.
6. Run focused checks per task, combined phase checks after task integration, and the relevant broader suite after conflict resolution, phase integration, and before track verification.
7. Main reads every worker diff and evidence. In `governed`, present each regular task for human approval before its Conventional Commit. In `phase` or `autonomous`, main may authorize an in-scope, fully verified task commit without another prompt and records the persisted mode as its approval evidence. A phase worker checkpoints one regular task at a time and waits for main to record the distinct SHA before starting the next task. Manual-verification nodes may reuse phase-head or merge evidence instead of creating empty commits.
8. Resolve task conflicts in the phase integration worktree and phase conflicts in the canonical worktree. Read both sides and rerun combined verification. In `governed`, present the resolution for approval. In `phase` or `autonomous`, resolve an unambiguous in-scope conflict autonomously and retain it for the next verification evidence; stop for clarification if it requires a material product or scope decision. Never let the leaf worker silently resolve integration conflicts.
9. Phase-level manual verification becomes ready only after every sibling task is integrated. Run its technical evidence in the phase worktree through the phase worker when present, otherwise through main. `governed` and `phase` require one human approval at this final phase task; `autonomous` records the verified evidence without a prompt. Afterward checkpoint, phase integration, provenance, learning, and cleanup are deterministic consequences and do not create extra approvals outside `governed`. A phase remains `running` until all sibling tasks and this barrier are `completed`; integration and cleanup must not run early.
10. Track-level manual verification becomes ready only after every phase is integrated, is executed entirely by the main agent in the canonical worktree, and requires explicit human approval in every mode.
11. Remove a worktree with `git worktree remove` and delete its branch without force only after clean, recorded integration. Never delete dirty, conflicted, unintegrated, or mismatched work.
12. Append dependency-aware phase learning. Do not overwrite earlier learning.

## Definition of Done

A task is done when its approved outcome exists, relevant tests cover success/failure/edge cases, checks pass or documented exceptions are approved, formatting and repository conventions are satisfied, docs are updated, no unrelated changes are included, its diff and evidence were reviewed at the barrier required by the persisted approval mode, and commit provenance is recorded.

A phase is done when all tasks are integrated, phase learning is recorded, combined verification passes, and its final User Manual Verification is approved by the human in `governed` or `phase`, or authorized by verified evidence in `autonomous`. A track is ready for review only after all execution nodes are complete, all worker branches are integrated, all worktrees are removed, the journal is finalized, and track-level manual verification is approved in main. It is completed only after an approved clean review bound to the current execution ID, plan revision, graph digest, and reviewed HEAD.

## Review and remediation

Review acceptance criteria, non-functional requirements, diffs, callers, tests, security, compatibility, error paths, and learning claims. Present findings before recording them. Approved findings go in `bugs/bug-<review-ts>.md`; insert dependency-aware remediation phases before the single final track-level verification phase, ending each with manual verification. Reset the final barrier to pending while preserving its prior evidence in the review cycle and completed execution journal. A replacement execution carries already-completed plan nodes forward from their commit provenance and schedules only pending work. Set the track back to `in_progress`. A clean cycle records the current execution ID, plan revision, graph digest, and reviewed HEAD. Repeat implement/review until a clean review is approved.

## Revisions, refreshes, and cascading impact

`revise` is callable at any point, with these state-specific semantics:

- In `drafting-spec`, continue the interrupted or active `track` specification flow. There is no approved baseline yet, so do not create a revision entry.
- In `drafting-plan`, a change to the approved specification is a revision; a change only to the unapproved plan continues the `track` planning flow.
- In `planned`, revise the approved baseline and remain `planned`.
- In `in_progress`, first reconcile any operation and active or dirty task work. Preserve completed tasks and commits, supersede rather than erase affected work, and remain `in_progress` when all dependencies are satisfied. Return to `planned` when a newly approved dependency is incomplete.
- In `ready_for_review`, use `review` for defects against the approved specification. Use `revise` for a changed desired outcome, scope, requirement, or acceptance criterion; invalidate review readiness, append the necessary delivery and manual-verification work, and return to `in_progress`, or `planned` when an approved dependency is incomplete.
- In `completed` or `archived`, keep the track immutable and propose a successor feature or bug track that references it. Do not reopen it or rewrite its clean-review history.

A semantic revision requires an approved specification baseline and no unresolved non-revision operation. Reconcile a matching revision journal before doing new work. If active implementation or dirty work overlaps the revision, present its exact state and obtain approval to complete, preserve as superseded, or revert it before applying the revision.

Every approved semantic revision gets `revisions/revision-<ts>.md` and a track-local `operation.action` of `revise` before artifact mutation. Increment the track revision once per approved revision; increment the specification revision only when the specification changes and the plan revision only when the plan changes. A revision must record its source and target status, base commit, affected phases/tasks, treatment of completed and partial work, review-readiness impact, and transitive dependency impact. Preserve completed-work provenance and append replacement work rather than erasing history.

Every project refresh gets `refreshes/refresh-<ts>.md`. Assess transitive dependent tracks whenever a spec, acceptance criterion, dependency, workflow, pattern, tech-stack, or styleguide change may affect them. Present all cascading changes for approval before mutation. Preserve superseded content and completed-work provenance rather than erasing history.

## Archival and learning

Archive one or more selected completed tracks in one approved batch. Require `completed` status and clean centralized state validation; do not recompute the DAG, manual-verification barriers, or review evidence inside archive. Validate the whole selection before mutation, distill the selected learning as one corpus into patterns with source track/task/commit provenance, reconcile it with existing patterns, then propose relevant reseeding for all active tracks. Journal the ordered selection and per-track/artifact progress, move each full track directory to `archive/`, validate once, and commit the batch together. Never discard history or start another archive batch while one is incomplete.

## Git safety and commits

- Use Conventional Commits for product work.
- Cadre-only state commits use `cadre(<command>): <description>`.
- Do not mix unrelated work into a task commit.
- Prefer additive `git revert` commits. Do not rewrite shared history or use destructive reset/checkout as the default revert mechanism.
- Do not overwrite dirty user changes. Stop and explain overlap.
