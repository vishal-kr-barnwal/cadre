---
title: Troubleshooting
description: Common install, MCP, provider, LSP, DAP, and plugin-generation failures.
section: Operations
order: 130
---

# Troubleshooting

Use this guide when Cadre setup, workflows, provider evidence, plugin
generation, code intelligence, or assisted debugging do not behave as expected.

## Native State Looks Stale

Symptom:

```text
status or handoff data looks out of date
```

Fix:

- Run `cadre-validate`.
- Check `cadre/events.jsonl`, `cadre/messages/*.jsonl`, and `cadre/tracks.json`
  through Cadre packets rather than editing them by hand.
- If setup never created native state, rerun `cadre-setup` with reviewed
  structured payloads.

## Refresh Stops At Analysis Or Evidence Collection

Symptoms:

- The first `cadre-refresh` call returns `stage:"refresh_analysis"` instead of
  changing files.
- A selected semantic level returns `stage:"refresh_evidence"` and lists a
  missing `proposedContext` field.

This is the intended refresh lifecycle. Cadre analyzes before it asks what to
refresh, and recommendations are not authorization.

Fix:

1. Present the returned multi-select prompt and pass the chosen ids as
   `refreshLevels`.
2. Cadre filters the selected levels into product, product guidelines, grouped
   technical, workflow, and patterns. For only the semantic documents in the
   active stage, inspect the repository and supply substantive
   `proposedContext`; an LSP-only technical stage can use Cadre's analyzed
   configuration. The technical stage groups selected tech stack, style
   guides, repository topology, and LSP files as one atomic set.
3. Review and approve that active file set. Later selected stages remain
   pending and unmaterialized; continue the same session until Cadre returns
   the final execution call.

Choose `diagnostics` for an analysis-only run. `projections` is explicit
execution-only maintenance. A selected LSP configuration participates in the
grouped technical review. Do not copy setup templates or pass empty objects to
satisfy a semantic evidence request.

## A Workflow Refuses To Create A Placeholder

Symptoms:

- New-track or revise returns intent clarification even though `{}` objects
  were supplied.
- Handoff requests substantive `handoffText`.
- Release requests completed-track evidence or substantive `releaseNotes`.

Cadre no longer writes default artifacts before it has workflow-specific
evidence. Supply meaningful project content requested by `intent_prompts`, then
continue the same workflow using the exact returned `decision.resume` data.
Clarification before the first review stage does not create target previews or
an approval session. If a session already exists, clarification keeps that same
session; resume it with `approval: {session_id}` and the requested input, which
does not approve the current stage.

## A Staged Workflow Repeats Or Generates Future Files

Symptoms:

- Setup returns to product after asking for guidelines or technical evidence.
- New-track or revise alternates between spec and plan approval.
- Files for later stages appear before the active stage is approved.
- A session-only resume appears to approve a stage.

Fix:

1. Keep the original session for clarification and formatting pauses. Continue
   with the exact returned `decision.resume` data or call shape after adding
   only the requested content. A clarification may return an approval fragment;
   reference formatting may return full tool arguments.
2. To resume without approval, send only `approval: {session_id}`. Never add
   `stage`, `stage_hash`, `stage_revision`, `approved_stages`, or `complete`
   until the user explicitly approves the active atomic file set.
3. After approval, send the exact returned `stage`, `stage_hash`,
   `stage_revision`, and cumulative `approved_stages` prefix. Do not construct a
   future prefix or reuse a stamp after the current stage changes.
4. Review only the stage returned by the current decision: `decision.stage`
   for approval, or `decision.current_stage` while clarifying or formatting.
   Later stages must remain pending and unmaterialized. After the last
   approval, execute only the exact returned `next` call.

## A Corrected Payload Overlaps An Existing Preview

Symptoms:

- Cadre reports an overlapping reviewed approval.
- Preview replacement or cancellation reports worktree, index, or HEAD drift.
- A corrected request still shows files from an earlier staged review.

Fix:

- Inspect the target paths with `git diff` and `git status`.
- If the earlier preview is untouched and wholly unapproved, rerun the
  corrected payload; Cadre supersedes it and restores its baseline
  automatically.
- If any stage was approved, resume that session or cancel it through the same
  workflow with `approval: {session_id}` or cancel it with
  `approval: {session_id, cancel:true}`.
- If a file was edited, staged, or committed, preserve that work and reconcile
  it deliberately. Cadre will not overwrite it or silently roll Git state
  backward.

Cancellation is atomic and Git-aware. When it cannot restore every target
safely, it keeps the approval session for recovery. Do not remove approval
session files manually.

## Cadre MCP Is Unavailable

Symptoms:

- The agent cannot call Cadre MCP tools.
- A workflow says Cadre MCP is required.
- A direct `cadre_workflow` call is unavailable or fails before returning an envelope.

Fix:

1. Confirm the global package is installed:

   ```bash
   npm install -g cadre-ai
   cadre doctor
   ```

2. Confirm client plugin wiring:

   ```bash
   cadre install --check
   ```

3. Restart the agent/client so plugin MCP configuration is reloaded.
4. Run the workflow again.

Cadre workflows do not have a prompt-side degraded mode. If MCP is unavailable,
repair plugin/runtime wiring instead of editing Cadre files manually.

## Wrong Project Root

Symptoms:

- Cadre cannot find `cadre/`.
- A workflow appears to inspect the wrong checkout.
- Status output does not match the active project.

Fix:

- Pass a per-call `root` argument pointing at the project root or any path
  inside it.
- Ask for Cadre doctor/root diagnostics.

One MCP process can serve multiple projects. Cadre depends on the per-call root,
not the server's remembered cwd.

## Plugin Generation Fails

Symptoms:

- `pnpm check` reports that plugin bundles cannot be produced.
- `pnpm --filter cadre-ai generate` fails while writing local validation
  fixtures.
- `cadre install --check` reports missing or stale installed plugin files.

Fix:

```bash
pnpm --filter cadre-ai generate
pnpm --filter cadre-ai check
```

Edit master sources only:

- `harness/skills/cadre/SKILL.md`
- `harness/skills/cadre/protocols/`
- `harness/scripts/agent-refs/`
- `harness/templates/`
- `harness/src/`
- root `docs/` for public documentation

Do not treat generated bundles under `harness/.agents/`, `harness/.claude/`,
`harness/.claude-plugin/`, or `harness/plugins/` as source files. They are
ignored local fixtures and can be recreated at any time.

## Provider Evidence Is Pending

Symptoms:

- Review returns `pending_provider`.
- Ship or land refuses to proceed.
- Cadre reports required GitHub/GitLab evidence.

Fix:

1. Use the matching provider MCP to inspect PR/MR reviews and CI checks.
2. Write normalized evidence back through Cadre packets.
3. Re-run review, ship, or land.

If `provider_mode` is `github` or `gitlab`, hosted evidence must come from the
matching provider MCP. Local shell provider commands are not the workflow
fallback.

## Review Gate Blocks Ship Or Land

Symptoms:

- `cadre-ship` or `cadre-land` refuses because review is missing or stale.
- Blocking findings remain.
- The reviewed commit does not match current head.

Fix:

- Run `cadre-review`.
- Resolve blocking findings.
- Record the final verdict through Cadre packets.
- Re-run ship or land.

Cadre rechecks the gate immediately before publication.

## LSP Is Skipped

Symptoms:

- Review says LSP/code intelligence was skipped.
- `cadre/lsp.json` is absent.
- Language server commands are missing.

Fix:

```text
cadre-refresh --lsp
```

Install any recommended language-server commands, then allow Cadre to write or
append `cadre/lsp.json`.

Alternate configs must use a relative `cadre/lsp-*.json` name. Cadre rejects
paths outside the project control plane and symlink-selected configs.

LSP is optional unless your team's review policy explicitly requires it.

## DAP Debugging Is Skipped

Symptoms:

- `cadre-debug` reports that no DAP configuration is available.
- `cadre://dap-status` shows missing adapter commands.
- A snapshot times out before a stopped or terminated event.

Fix:

```text
cadre_workflow {"root":"/path/to/project","workflow":"debug","input":{},"execute":false}
```

Review the reported adapter state, install missing adapter commands, and invoke
only the returned `next` call if Cadre offers a configuration step. Allow Cadre
to write or append `cadre/dap.json` only through that packet-owned path.
Alternate configs must use a relative `cadre/dap-*.json` name; adapter commands
come from that file rather than inline workflow input.

DAP is adapter-driven. Cadre can run a bounded snapshot for any configured
adapter, but it does not install debugger adapters automatically and v1 does not
provide a full interactive stepping session.

## Parallel Work Does Not Dispatch

Common causes:

- Phase is sequential by default.
- Missing `<!-- execution: parallel -->`.
- Phase dependencies are not complete.
- Task dependencies are not complete.
- File claims overlap.
- Worker state has unresolved failures or conflicts.

Fix:

- Ask for `cadre-status` or the `cadre://parallel-state` resource.
- Run `cadre-validate` to inspect plan annotations.
- Revise the plan if dependencies or file claims are wrong.

## Polyrepo Preflight Fails

Common causes:

- Submodule is not initialized.
- `cadre/repos.json` and `.gitmodules` disagree.
- A product repo branch is behind its base.
- Provider mode or merge-train token is incomplete.
- Product repo merge settings do not allow merge commits.

Fix:

- Run `cadre-validate`.
- Run the polyrepo preflight returned by `cadre-land`.
- Fix submodule, branch, provider, or merge settings before opening PR/MR
  groups.

## Shared Sync Conflicts

Symptoms:

- Control-plane sync fails.
- Native event/message state cannot sync cleanly.
- Merge driver warnings appear.

Fix:

- Follow only the packet's typed `next` call; do not reconstruct sync steps from prose.
- Ensure the `ours` merge driver is registered.
- Resolve intentional conflicts in human-authored files such as specs and
  plans.
- Rerun `cadre-validate`.

Do not text-merge native state files by hand.

## Harness Development Checks

For changes in this repository:

```bash
pnpm --filter cadre-ai exec node --test scripts/protocol-packet-only.test.js
pnpm --filter cadre-ai generate
pnpm --filter cadre-ai check
```

For narrow runtime changes, run the relevant `node --test` file first, then the
full check before handoff.
