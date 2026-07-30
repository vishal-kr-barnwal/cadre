---
name: create
description: Initialize or resume Cadre in a greenfield or brownfield repository using MCP-provided templates and human-approved product, engineering, workflow, styleguide, pattern, and project-state artifacts. Use for Cadre setup, project onboarding, or the create command; classify the repository first and do not overwrite an initialized project.
---

# Cadre Create

Use the Cadre MCP as the authoritative runtime and template provider. Do not copy runtime code or templates into the project. Treat every rendered artifact and state mutation as a proposal until the human approves it. If required Cadre MCP tools are unavailable, stop and report that the plugin runtime is unavailable; never reconstruct templates from memory.

## Procedure

1. Resolve the exact project root. Inspect its manifests, source layout, tests, agent guidance, Git status, and recent history. Run `git rev-parse --show-toplevel`: if it succeeds, never initialize a nested repository; if it fails, record that the approved root requires `git init`. Ask which root to use if the boundary is materially ambiguous. Read every existing file before proposing an edit.
2. Explicitly classify the context as `greenfield` or `brownfield`, with evidence. A substantive implementation, behavior, user/data/interface contract, or delivery history is brownfield. If a scaffold, prototype, migration, or incomplete evidence makes the classification unclear, ask a blocking question before drafting or mutating anything.
3. Call `project_status` when `.cadre/project.json` exists and use its embedded structured validation; do not repeat `state_validate` at command entry. Reconcile its setup journal, worktree, and recent commits. Resume the recorded checkpoint exactly; do not restart or overwrite setup. Offer `$refresh` or `$status` only after completed setup.
4. Call `template_get_many` once for `project/product`, `project/guidelines`, `project/tech-stack`, `project/workflow`, and `project/styleguides/general`. Retain that versioned bundle across approval turns and do not refetch it unless its version or content hash changes. `patterns/index.md`, `.gitignore`, `project.json`, `tracks.md`, and the empty lifecycle directories are initialization outputs derived by the MCP; do not render or pass them as caller-supplied files. For greenfield work, use explicit user intent and ask about missing material product/stack choices. For brownfield work, distinguish evidenced current reality from desired change and preserve deliberate conventions.
5. Draft `product.md`, `guidelines.md`, and `tech-stack.md`. Resolve any material ambiguity through targeted questions; do not invent product behavior, constraints, or stack decisions.
6. Present the default `workflow.md` as its own approval item using its template ID, template-set version, content hash, a concise summary of its material rules and consequences, and the choice to use the default or request changes. Do not print the complete unchanged bundled workflow unless the human asks to see it. If changes are requested, show a focused diff against the identified default and summarize the resulting behavior; show the complete revised workflow only on request. Obtain explicit workflow acceptance; approval of other artifacts does not imply this approval.
7. Call `styleguide_resolve` with the approved technologies. Always include the general guide. For each resolved language, framework, markup, or build-tool guide, ask whether to use the default, amend it, or use a user-provided replacement. Preserve evidenced brownfield conventions. Show the complete final styleguide set for explicit approval.
8. After the project files, workflow, and styleguides are approved, call `project_init_preview` with only those caller-supplied files and the approved metadata. Do not pass `patterns/index.md` or any other MCP-derived output. Present one final initialization approval containing the complete target-path and SHA-256 manifest, a concise summary of generated state, the context classification, project root, Git disposition, consequences, and proposal digest. Identify unchanged previously reviewed files by path and hash instead of printing their full contents again; show generated or changed content only when it is material, or the human asks. This single approval replaces a separate pre-preview manifest approval. After explicit confirmation, call `project_init_apply` with the approved inputs and digest. The audit-only `approvedAt` timestamp may reflect the final approval and is excluded from the semantic proposal digest. The apply atomically creates mutable `.cadre` state and approved context only; it never installs a runtime or template copies there.
9. If Git disposition is `initialize`, run `git init` only at the approved root, verify `git rev-parse --show-toplevel` equals that root, then call `setup_record_git_initialized`. If Git is unavailable, initialization fails, or a different repository appears, stop with the setup journal intact. For an existing repository, verify its root again.
10. Call `state_validate` and show the result. Commit the approved setup as `cadre(create): initialize project harness` only when validation is clean and checkpoint is `commit-pending`.
11. Call `setup_record_commit` with that SHA, then call `tracks_render_preview`, show the derived result, and call `tracks_render_apply` with its unchanged digest if needed. Commit the bookkeeping as `cadre(create): record setup commit`.

## Resume protocol

- `git-pending`: initialize Git only when the journal says `initialize`; verify the exact approved root and record the checkpoint.
- `commit-pending` plus matching dirty artifacts: validate and create the expected artifact commit.
- Clean worktree plus matching expected HEAD/base relationship: treat the artifact commit as successful and record that SHA; never repeat it.
- Recorded setup SHA plus dirty bookkeeping: finish only the follow-up state commit.
- Journal, files, digest, worktree, or HEAD mismatch: stop and show the mismatch. Never guess, discard, or restart.

All later commands must read `.cadre/workflow.md`. Every file is rendered from a versioned MCP template, every multi-step mutation is resumable, and human approval gates artifacts and state changes.
