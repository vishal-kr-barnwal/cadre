---
name: implement
description: Execute or resume an approved Cadre plan as a dependency DAG, using bounded parallel workers when useful, isolated Git worktrees, verified integration, learning, and commit provenance. Use for implement on a planned or in-progress track.
---

# Cadre Implement

## Cohesive commits and retained context

For v6/schema-2 state, each approved operation produces one immutable receipt under `.cadre/receipts/` and a temporary recovery journal under `.cadre/stage/operations/`. Apply returns `receipt` (or the receipt fields directly): `operationId`, `receiptHash`, `trailers`, and `status: commit_pending`. Include the promoted files and receipt in one agent-created Git commit with both exact returned trailers. Commit execution stays with the agent. Use `candidate_apply` with `request: {mode: "reconcile", projectRoot, operationId}` after committing; reconciliation verifies a unique reachable commit and committed artifacts and changes temporary state only. Never add a follow-up record-SHA commit. An operation reference is `op:<operationId>`, not a Git revision to pass directly to shell Git. Resolve it through receipt reconciliation before Git range commands.

Before any dependent delivery, resolve `commit_pending`. On interruption, inspect the persisted recovery journal and original approval; use `candidate_apply` with `request: {mode: "resume", projectRoot, operationId, approvalDigest}` to finish the already-approved promotion. Reconcile an existing commit before creating another. Any drift or ambiguous/forged receipt blocks continuation. Never replace an approved recovery journal or fabricate its approval.

Use the scheduler and validation in mutation results. Do not immediately request the same status again. For `context_read`, retain `retainedContextToken` only after a complete successful read. Pass it on later reads only while that text remains in context, with the same token across continuation pages. Clear it after compaction, context loss, expiration, or a fresh task. Keep `knownSources` only for compatibility. Default pages are 48 KiB, maximum 64 KiB. Section identity/content hashes allow reuse despite unrelated file changes; source freshness is checked independently. Required project instructions, full current spec/plan, applicable constraints, and repository instructions remain authoritative. Consume every page and require `contextReady`. An explicit full-source dependency fallback must be read completely and reassessed; do not silently omit guidance.

Serialized errors are bounded to 8 KiB. Use `diagnostic_read` with the returned diagnostic ID only when fuller evidence is needed; paginate it. Do not dump cache path lists into conversation. Build outputs belong in the runtime-returned owned `buildCachePath`, never an arbitrary `.cadre/.build-cache` directory.

Legacy SHA records and immutable v1–v5 templates remain evidence. Migrate through one approved refresh at a quiescent boundary before creating a v6 execution. Retain each existing execution's original contract and preserve approvals, completed nodes, findings, journals, and archived learning. The v6 commit instructions here replace legacy follow-up provenance commits described below.

Treat approved `plan.md` as the source of truth. Implement `planned` or `in_progress` tracks; a persisted policy-v2 Autonomous loop may resume `ready_for_review` by continuing review without starting another execution. Main is the sole scheduler and `.cadre/**` owner; workers never spawn workers, edit Cadre state, integrate branches, resolve conflicts, clean worktrees, or record human approval.

At a clarification or manual-verification boundary, inspect host policy before `workflow_elicit`. Under approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise use a concise form bound to execution ID, node ID, and verified commit. Treat only `approved` as approval. On `fallback_required`, or an immediate policy-driven `declined`, ask once in chat; policy rejection is not a human decline. Never request secrets or retry the form.

## Conditional references

Read only the references required by current state:

- parallel or delegated work: `references/parallel-workers.md`
- `governed` approval mode: `references/governed-mode.md`
- an integration conflict: `references/conflict-handling.md`
- interrupted or inconsistent execution: `references/resume-recovery.md`

## Entry and modes

1. Call `project_status` once with `view: "implementation"`, `trackId`, and the known persisted `executionId` if resuming. Omit `executionId` (or use null) when unknown; never infer it from the track ID. This is the complete preflight: validation, graph, scheduler, dependency, and worktree state; do not repeat `state_validate` at command entry. Stop if `valid` or `graph.valid` is false, `upgradeRequired` is true, the track is candidate-only, or the MCP is unavailable. Follow `nextStep` before choosing an implementation node. A review handoff or pending final approval does not require a ready node or another `execution_start`.
2. Use `context_read` for the selected ready or resumed node (`projectRoot`, `trackId`, optional `executionId`, `nodeId`). Consume every `nextCursor` page until `complete: true`; stop on returned errors or relevant `staleMemory`. This supplies `.cadre/workflow.md`, full spec/plan, relevant learning, and pattern/styleguide sources. Read repository instructions and relevant code/callers/tests separately. Read full state or other artifacts before editing them. Reuse unchanged sources already loaded in this session by path/hash; a source hash is not a substitute for reading it after context loss.
3. Scheduling defaults to `parallel`; use `sequential` only when requested. Approval mode defaults to `track`; use `governed`, `phase`, or `autonomous` only when explicitly requested. Resume journaled modes. Stop on `APPROVAL_MODE_MIGRATION_REQUIRED` and use the approved refresh migration; never reinterpret legacy Autonomous authority. A mode authorizes only work bounded by the approved spec and plan.
4. For a new execution, the implement invocation authorizes `execution_start`; call it once with the modes. Do not add a start approval outside `governed`. Resume an existing operation instead of creating another.

`governed` pauses for regular task diffs and integrations. `phase` runs regular phase work autonomously and pauses at each phase's final `User Manual Verification`. `track` also performs phase verification autonomously and pauses at `Track-level User Manual Verification`, then hands off to ordinary review. `autonomous` performs all available verification, invokes review, and implements in-scope remediation until clean; it pauses for one explicit final completion approval.

Host security permission is distinct from Cadre approval. Request only a narrow required command permission, centralize shared network/dependency preparation in main, use existing scripts, and run independent read-only checks in parallel. A permission prompt never approves an artifact, commit, merge, or lifecycle transition.

## Execute ready work

Use the scheduler returned by the preflight or latest mutation receipt. Plan order only breaks ties.

- Execute one ready task directly in main when delegation adds no value. Follow returned `eventGuidance`: `record_commit` requires commit, verification, and authorization; `record_verification` requires those same fields; `record_integration` requires commit and verification; `block` requires a blocker. A running-phase `complete` also requires commit, verification, and authorization.
- Delegate only independent or cohesive work. Read `references/parallel-workers.md` before doing so.
- Include a `handoff` with task `record_commit` and `block`: `decisions`, `failedApproaches`, `openQuestions`, `nextAction`, and `sources` containing repository-relative `path` and exact `sha256`. Keep its serialized JSON within 8 KiB; reference longer durable evidence instead of truncating it. Main records it with the existing checkpoint, without another call or approval. A handoff records observations and never authorizes work.
- Never checkpoint evidence before it exists. Each approved commit group has one cohesive product commit; legacy executions retain distinct task commits. `record_commit` includes focused verification and authorization evidence.
- A `.cadre/**`-only bookkeeping commit does not invalidate product verification while product files, tests, inputs, and verification policy remain unchanged.

For a delegated node, the normal lifecycle is four MCP calls:

1. `worktree_create` creates or reconciles the derived worktree and records `start` with its path and branch.
2. After main reviews the returned worker diff/checks and the worker creates its clean task commit, `execution_checkpoint` records `record_commit` with SHA, verification, and mode/human authorization.
3. `integration` with `request: { mode: "prepare", projectRoot, trackId, executionId, nodeId }` validates and merges immediately in `phase`/`track`/`autonomous`, recording `record_integration` in its receipt. In `governed` it returns `approval_required`; after human approval call only `request: { mode: "apply", proposalToken }`. Never make the governed calls consecutively without human input.
4. `worktree_cleanup` verifies integration, removes the worktree/branch, and records `complete` when all invariants hold.

Do not add standalone `start`, `record_integration`, or `complete` calls around this composite path. Retried calls reconcile an existing worktree, merge commit, removed worktree, or missing journal transition. Keep standalone checkpoints for direct-main work, manual verification, blockers, conflict recovery, and interruption repair.

## Verification, learning, and finish

- A phase barrier depends on all sibling tasks. Prepare evidence against the phase head. In `governed` and `phase`, present it once and record human approval; in `track` and `autonomous`, record persisted-mode authorization.
- After the barrier, integrate the phase and persist dependency-aware learning and task provenance on disk. Complete a direct-main phase in one `complete` checkpoint with verified product/integration HEAD. Do not create phase-record or final-verification commits. Start dependents only after cleanup/completion.
- The final `Track-level User Manual Verification` runs in main against fully integrated canonical HEAD and requires explicit human approval in Governed, Phase, and Track. Autonomous records actual verification and persisted-mode authorization, never a fabricated human approval; unavailable human-only checks block the loop.
- When every node is complete, learning/provenance is recorded, worktrees are gone, and final verification is authorized under the applicable mode, run full relevant checks and call `execution_finish`. It converges interrupted final writes using the persisted completion identity. Commit only its completed journal, plan markers, `ready_for_review` state, and `tracks.md` as `cadre(implement): complete <track-id>`; never let review absorb this bookkeeping.

In Autonomous, follow the `execution_finish.nextStep` after the implementation bookkeeping commit; do not end the task at `ready_for_review`. Never mark a track `completed`; only an explicitly approved clean review may do that.

## Autonomous execution and recovery

`execution_start` creates the policy-v2 `state.autonomousReview` authority and `implementing` checkpoint; `execution_finish` advances it to `reviewing`. Preserve its original authorization, initial review baseline, specification commit, finding identities, and attempted execution IDs across every remediation execution. The review skill owns review, remediation proposals, stalled findings, and final approval.

On resume, read canonical state, review cycles, the current operation, execution journals, staged manifest, and Git. Resume an active implementation rather than replacing it. A pending review operation belongs to review even when partial promotion has already set `in_progress`. After review promotion and its bookkeeping commit, a `remediating` checkpoint starts a new execution for the appended graph with inherited Autonomous mode and scheduling. Preserve all completed phases and execution history. Unavailable human-only checks, conflicting requirements, material scope decisions, and external blockers pause the loop; persist the precise blocker and actual evidence without fabricating approval. Continue while verifiable progress is possible, without a fixed cycle cap.

## MCP skill continuation

Follow `nextStep` from focused `project_status` and `execution_finish` using its exact `projectRoot`, `trackId`, and current `executionId`. `invoke_skill` identifies the installed Cadre skill by `plugin` and `skill`; invoke it through the host's native skill mechanism in the same task. Codex/Claude resolve the Cadre plugin workflow; Zed resolves `cadre-<skill>`. If native invocation is unavailable, load the full skill from its host-advertised installed location and execute its procedure. Reuse an already loaded, unchanged skill; a next step naming the current skill means continue it, not recursive re-entry. Never derive sibling filesystem paths or merely print a slash command. If the installed skill cannot be resolved, stop with that blocker.

Satisfy `prerequisite` before handoff: `implementation_bookkeeping_commit` means finish and commit the implementation journal/plan/state/index; `review_bookkeeping_commit` means finish review promotion, provenance, commits, and operation clearance. Check Git and journal evidence on resume so an already satisfied prerequisite does not create another commit. `await_approval` routes to review to revalidate evidence, prepare the exact completion proposal, and obtain the missing human decision. `blocked` stops automatic work with its reason. `null` supplies no Autonomous continuation and leaves ordinary mode gates in effect. MCP returns routing data; the agent performs the skill invocation. Routing never grants new authority or replaces validation.

## Direct-main checkpoint order

Start the ready phase once. For a commit group, follow `readyGroups` and execute internal dependencies in order, retaining verification, authorization and handoff for every task. Make one product commit for the cohesive change; then call `execution_checkpoint` with `event: "complete_group"`, the shared `commit`, and `tasks: [{nodeId, verification, authorization, handoff}, ...]` containing every member exactly once. The transition is atomic. Independent groups may use isolated worker worktrees; integrate their product commit before atomic completion.

For an ungrouped/legacy task, use start, record_commit, complete. For manual verification, call `record_verification` directly from pending after actual verification and applicable approval: never send a separate verification start. Complete the running direct-main phase with `complete`, verified HEAD, verification and authorization. Repeat for the final phase, without a phase-record commit. `execution_finish` renders all plan markers and returns the receipt for the single `cadre(implement): complete <track-id>` commit. Include learning and durable journals. No execution-start commit is needed. An explicit checkpoint commit is allowed when handing off or stopping at a blocker; explain that boundary.

Integration prefers fast-forward when valid and records provenance independently of merge objects. The coordinator's exactly bound journal/state may remain dirty; unrelated files and worker edits to protected Cadre state still block integration. Reuse returned scheduler state.
