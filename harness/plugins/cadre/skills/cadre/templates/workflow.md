# Project Workflow

## Guiding Principles

1. **Cadre State Is Packet-Owned:** Cadre records progress through MCP
   task-completion, mutation, workflow, review, Beads, and validation packets.
2. **The Plan Is Authoritative:** `plan.md` describes the work, but agents do not
   directly edit task markers or checkpoint metadata.
3. **The Tech Stack Is Deliberate:** Changes to the tech stack must be reflected
   in Cadre context through the appropriate packet before implementation relies on
   them.
4. **Test-Driven Development:** Write tests before implementing behavior whenever
   the task is testable.
5. **High Code Coverage:** Aim for more than 80 percent coverage for new or
   changed modules unless the packet records an approved exception.
6. **User Experience First:** Product decisions should prioritize the user's
   workflow, clarity, and failure recovery.
7. **Non-Interactive and CI-Aware:** Prefer one-shot project commands for tests,
   builds, linters, and formatters.

## Task Lifecycle

All Cadre orchestration uses MCP packets. If a required packet returns `ok:false`,
halt and report the packet error instead of recreating Cadre state logic outside
MCP.

1. **Select Work:** Use Cadre status or implementation-prep packets to select the
   next available track, phase, or task.
2. **Claim Work:** Use the implementation workflow packet or mutation packet to
   claim ownership before product edits begin.
3. **Red Phase:** Add or update product tests that express the expected behavior.
   Run the relevant project test command and confirm the new test fails for the
   intended reason when practical.
4. **Green Phase:** Implement the smallest product change that satisfies the test
   and acceptance criteria.
5. **Refactor:** Improve clarity, duplication, performance, and accessibility
   while preserving behavior.
6. **Verify:** Run targeted tests first, then broader project checks according to
   risk. Include coverage when the project has coverage tooling.
7. **Commit Product Work:** Make clear product commits for the completed unit of
   work according to the team's normal commit policy.
8. **Record Completion:** Call the Cadre task-completion packet with test,
   coverage, commit, and summary evidence. The packet updates plan state, metadata,
   Beads state, journals, and indexes.

## Commit Discipline

- Prefer one product commit per completed task or coherent implementation
  checkpoint.
- For larger tasks, commit after each significant tested change instead of
  batching an entire track into one commit.
- Keep commit messages task-aware by mentioning the track id, phase/task intent,
  or user-visible behavior changed.
- After each task-level commit, call the Cadre task-completion packet with the
  commit SHA, tests run, coverage when available, files changed, and a concise
  implementation note. Cadre records that evidence in track metadata, journals,
  and Beads-backed notes.
- Do not mark a task complete until its commit evidence and verification summary
  have been recorded through Cadre.

## Polyrepo Notes

In polyrepo mode, Cadre packets identify the repo, branch, worktree, task, and
commit evidence for each product repository. Product commands run in the
appropriate repo worktree. Cadre control-plane synchronization, cross-repo review
links, fleet status, and merge-train metadata are packet-owned.

In monorepo mode, the same packet lifecycle applies with a single product repo.

## Quality Gates

Before marking any task complete through Cadre packets, verify:

- Tests for the changed behavior pass.
- Coverage meets the project's threshold or the packet records an approved reason.
- Code follows the relevant style guide in `code_styleguides/`.
- Public APIs are documented when the project convention requires it.
- Type checks, lint checks, and static analysis pass when configured.
- User-facing changes have appropriate accessibility and responsive checks.
- Documentation is updated when behavior, setup, or operations changed.
- Security-sensitive changes receive explicit review evidence.

## Phase Completion

When a task completes a phase, use Cadre workflow and completion packets to gather
phase evidence, validate coverage, record the checkpoint, and refresh indexes.
Manual verification plans may be summarized for the user, but Cadre checkpoint
state is recorded only through packets.

## Development Commands

Project setup, tests, builds, linters, formatters, local servers, and product
commits remain normal product work. Use the commands configured by the project and
keep them non-interactive. These commands must not mutate Cadre control-plane,
Beads, provider, index, review, archive, handoff, or validation state directly.
