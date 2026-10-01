# Cadre 3.9.1 release validation

Candidate validation on 2026-10-01. Required package, installation, native server activation, and documentation checks passed. Zed Agent is stable in this release.

## Source and package checks

All required local commands passed:

```sh
pnpm install --frozen-lockfile
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
pnpm --filter cadre-ai pack --dry-run
pnpm --filter cadre-docs check
pnpm --filter cadre-ai build
node harness/dist/cadre-cli.mjs doctor
```

The harness suite passed **118/118 tests**, with no failures or skips. Documentation checks include content, lint, types, and the static build. Doctor reports runtime 3.9.1 and 39/39 current templates. The package, native plugin manifests, runtime identity, and documentation package identify 3.9.1. Template set v5 and schema-2 state are unchanged.

New regression coverage verifies that an existing 3.9.0/v5 project validates, reports no required upgrade, and starts an approved execution without rewriting its project metadata. Unsupported versions still fail compatibility checks; older template contracts retain their approved refresh requirements.

## Lifecycle coverage

Disposable native Codex fixtures exercised all ten workflows and all eight approval/scheduling combinations: Governed, Phase, Track, and Autonomous, each with Sequential and Parallel scheduling. Nine fixtures ended valid and clean with 11 archived tracks and 56 uniquely verified, reachable receipt commits. No live workers or managed worktrees remained.

Additional paths covered planned revision, active task reversal and reimplementation, archived revision and completed revert successors, product rollback, batch archive, two context refreshes, the `auto` alias, and read-only exploration. Retries of committed operations preserve the original receipt and make zero changes. These fixtures used explicitly scoped test approvals and cover representative lifecycle paths, rather than every repository or conflict scenario.

## Installed candidate

The validated local build was installed with:

```sh
node harness/dist/cadre-cli.mjs install --target all --scope user
codex plugin list --json
claude plugin list --json
claude mcp list
zed --version
```

| Client | Candidate and activation evidence | Native workflow smoke |
| --- | --- | --- |
| Codex CLI 0.159.2 | `cadre@cadre` enabled at `3.9.1+codex.local-20261001T090819Z`; installed plugin launched its packaged MCP server | Passed: a fresh read-only session invoked project status on the existing 3.9.0/v5 fixture, reporting target 3.9.1, valid state, no warnings, and `upgradeRequired: false` |
| Claude Code 2.1.285 | `cadre@cadre` enabled at `3.9.1+claude.local-20261001T090819Z`; native MCP listing reports the packaged Cadre server connected | Server activation verified; no additional model-driven lifecycle run claimed |
| Zed CLI 1.22.0 | All ten global `cadre-*` skills discovered in native settings; Cadre server enabled with green status | Skill discovery and server activation verified. The disposable fixture remained in restricted mode; no additional model-driven workflow run claimed. |

All three installed `dist/cadre-mcp.mjs` files match the validated local build byte for byte. Codex retains Cadre-scoped MCP approval. Claude retains `enabledMcpjsonServers` and its Cadre tool allow entry. Zed has all 25 exact `mcp:cadre:<tool>` allow entries and ten valid owned skill symlinks. Installation preserves unrelated settings and keeps a backup of the previous marketplace payload.

## Homepage verification

The Digests badge previously inherited a light amber background in dark mode. A dedicated dark amber token fixes its contrast. Browser checks used bundled Playwright Chromium against the production static build at desktop 1440 × 1000 and mobile 390 × 844, switching themes through the homepage controls.

Dark-mode text contrast improved from approximately **1.01:1 to 14.40:1**. Light-mode contrast remains **16.64:1**. The badge is visible in all four viewport/theme combinations, with no horizontal overflow or browser console/page errors. Desktop and mobile screenshots were inspected and retained with the local release evidence.

## Publication gate

All repository release gates are satisfied: enabled candidate plugins, Zed skill discovery and active server, packaged server paths and narrow MCP approvals, and complete local checks. Additional native model-driven coverage is claimed only for Codex; Claude and Zed activation were verified separately.

Publication uses the signed release commit/tag and existing GitHub release workflow. The workflow publishes npm with provenance before deploying the documentation site. The GitHub release and workflow run provide the publication result; this document records pre-publication validation.
