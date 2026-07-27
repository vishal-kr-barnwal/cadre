---
name: cadre-create
description: Initialize or resume Cadre in a greenfield or brownfield repository by creating human-approved product, engineering, workflow, styleguide, template, pattern, and project-state artifacts. Use for Cadre setup, project onboarding, or the create command; classify the repository first and do not overwrite an initialized project.
---

# Cadre Create

Initialize Cadre from the exact tree in `assets/project/`. Treat every generated artifact as a proposal until the human approves it.

## Procedure

1. Inspect the project root, build manifests, source layout, tests, and existing agent guidance. Detect Git with `git rev-parse --show-toplevel`: if it succeeds, inspect that worktree's status/history and never initialize a nested repository; if it fails, record that the approved project root requires Git initialization. If the detected worktree root versus project root is materially ambiguous, ask which project root to use. Before proposing changes to an existing file, read that file and its directly relevant context. Never infer file contents from names or memory.
2. Explicitly classify the project context:
   - `greenfield`: no substantive existing product implementation/history, and the work establishes a new product or system.
   - `brownfield`: a substantive implementation, behavior, users, data, interfaces, or delivery history already exists.
   State the classification and evidence. If evidence is mixed or insufficient—for example a scaffold, partial migration, prototype, or code without clear product intent—ask the human whether Cadre should treat it as greenfield or brownfield. This is a blocking question; do not draft or mutate Cadre artifacts until answered.
3. For greenfield setup, use explicit user intent as the primary product source and ask targeted questions for missing product goals, users, constraints, or stack decisions that would materially change the artifacts. Do not invent them. For brownfield setup, document the evidenced current state separately from desired changes; ask when code/history and user intent conflict or when inferred behavior may not be intentional.
4. If `.cadre/project.json` exists, read `setup`, its operation journal, Git status, and recent commits. If setup is incomplete, resume its last durable checkpoint using the workflow's interruption protocol; do not restart or overwrite it. Offer `$cadre-refresh` or `$cadre-status` only when setup is completed.
5. Read every template under `assets/project/.cadre/templates/`, the baseline files under `assets/project/.cadre/`, and `assets/styleguides/index.md`.
6. Draft these artifacts from repository evidence and user input:
   - `product.md`
   - `guidelines.md`
   - `tech-stack.md`
   - `styleguides/general.md`
   - one styleguide per language/framework actually listed in `tech-stack.md`
   - `workflow.md`
   - `project.json` and the initial generated `tracks.md`
7. Present the proposed `workflow.md` separately and explicitly ask whether the default workflow is acceptable or the human wants changes. Do not treat approval of other setup artifacts as workflow approval. Apply requested changes, show the revised workflow, and obtain explicit acceptance before continuing.
8. Select styleguides from `assets/styleguides/index.md` based on the approved tech stack. Always include `general.md`; layer language, framework, and build-tool defaults as documented. For each selected guide, ask whether to copy the default, amend it, or use a user-provided replacement. Read and preserve existing brownfield conventions; never overwrite them merely because a default exists. Present the final styleguide set for explicit approval.
9. Call out unknowns explicitly. Apply the workflow clarification gate to every unresolved choice that could materially change these artifacts. Present the remaining proposed artifacts or focused diffs and wait for approval. Do not create Cadre state before approval.
10. After approval, materialize the template tree, persist the approved `greenfield`/`brownfield` classification in `project.json`, copy only the approved default/user-provided styleguides into `.cadre/styleguides/`, and initialize `project.json.setup` as `in_progress`. Before each write, update its durable `checkpoint` and `artifactProgress`; retain the expected artifact commit, base commit, approved artifact list, approved repository root, and Git disposition (`existing` or `initialize`) in `setup.operation`. Replace placeholders and preserve all templates. Keep patterns empty except for the index and schema.
11. Reconcile the journaled Git disposition before artifact completion. For `existing`, verify the current worktree root still matches the approved root. For `initialize`, run `git init` at the approved project root, record a `git-initialized` checkpoint, and verify `git rev-parse --show-toplevel` resolves to that exact root. If Git is unavailable, initialization fails, or a different repository appears, stop with the journal intact; do not improvise or create a nested repository.
12. Run `node .cadre/bin/cadre-state.mjs validate` and show the result. Set the checkpoint to `commit-pending` only after Git and all approved artifacts are present and valid.
13. Commit the approved setup as `cadre(create): initialize project harness`. Store that SHA in `project.json.setup.commit`, clear `setup.operation`, set status/checkpoint to `completed`, regenerate `tracks.md`, and make a follow-up `cadre(create): record setup commit` state commit.

At every entry and before drafting anything new, reconcile an incomplete setup first:

- Journal present plus matching uncommitted artifacts: continue from `artifactProgress`, validate, and create the expected commit.
- Journal requires Git initialization and no worktree exists: initialize only the approved root, record the checkpoint, and continue; if the journal says Git was initialized but no matching worktree exists, stop on mismatch.
- Journal present plus clean tree and matching expected HEAD: treat the artifact commit as successful and record its SHA.
- Commit SHA already recorded plus uncommitted state bookkeeping: create the follow-up state commit.
- Journal/files/HEAD disagree: stop and show the mismatch; never guess, discard, or restart.

## Invariants

- All later commands must load `.cadre/workflow.md` before acting.
- All files are derived from checked-in templates.
- Every stateful flow records its current checkpoint before stopping so it can resume.
- Human approval gates every artifact and Cadre state mutation.
- Read-before-edit, plan-as-source-of-truth, verification, conventional commits, and phase/track manual verification are mandatory quality rules.
