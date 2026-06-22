---
title: Troubleshooting
description: Common install, MCP, provider, LSP, and plugin-generation failures.
section: Support
order: 8
---

# Troubleshooting

Use this guide when Cadre setup, workflows, provider evidence, plugin
generation, or code intelligence do not behave as expected.

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

## Cadre MCP Is Unavailable

Symptoms:

- The agent cannot call Cadre MCP tools.
- A workflow says Cadre MCP is required.
- `cadre_project` ping fails.

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

LSP is optional unless your team's review policy explicitly requires it.

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

- Follow the packet's sync pre/post next actions.
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
