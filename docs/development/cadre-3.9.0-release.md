# Cadre 3.9.0 release validation

Candidate validation on 2026-09-25. Required package, installation and native server activation checks passed. Additional model-driven smoke limitations are recorded separately below.

## Source and package checks

All required local commands passed:

```sh
pnpm install --frozen-lockfile
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
pnpm --filter cadre-ai pack --dry-run
pnpm --filter cadre-docs check
node harness/dist/cadre-cli.mjs doctor
```

The harness suite passed **111/111 tests**, with no failures or skips. Documentation checks cover content, lint, types and the static build. Doctor reports runtime 3.9.0 and 39/39 current templates. Published v1–v4 templates are unchanged. The package, plugin manifests, runtime identity and documentation package all identify 3.9.0.

The [efficiency audit](cadre-efficiency.md) records the earlier disposable native Codex sessions across all ten workflows, six-commit lifecycle, recovery and remediation, and separate call/byte/time/token measurements.

## Installed candidate

The local build was installed using the repository's required release command:

```sh
node harness/dist/cadre-cli.mjs install --target all --scope user
```

This updates the user's installed runtime and skills. It does not migrate FRM, Dhivon or any other project, and it does not rewrite their Git histories. Installation retained a backup of the previous marketplace payload.

| Client | Candidate and activation evidence | Native workflow smoke |
| --- | --- | --- |
| Codex | `cadre@cadre` enabled at `3.9.0+codex.local-20260925T090131Z`; server launched by the installed plugin | Passed: status and template retrieval in the disposable lifecycle fixture; target runtime 3.9.0, v5 templates, all ten skills discovered |
| Claude Code | `cadre@cadre` enabled at `3.9.0+claude.local-20260925T090131Z`; native `claude mcp list` reports the packaged Cadre server connected | Additional model-driven smoke blocked by an expired OAuth session; no successful workflow invocation claimed |
| Zed 1.20.2 | All ten `cadre-*` skills discovered; Cadre server enabled with green status in MCP settings | Additional task-level smoke could not invoke MCP tools in the restricted disposable fixture; no successful workflow invocation claimed. Restricted mode was preserved. |

All three installed `dist/cadre-mcp.mjs` files match the validated local build byte for byte. Codex retains Cadre-scoped MCP approval; Claude retains the Cadre plugin/tool allow entries and `enabledMcpjsonServers`; Zed has all 25 exact `mcp:cadre:<tool>` entries and ten valid owned skill symlinks. Unrelated client settings were preserved.

The Codex fixture correctly reports `PROJECT_REFRESH_REQUIRED` from its development runtime 3.8.0 to 3.9.0, with structurally valid state and no stale memory. No refresh or mutation was performed by the installed-plugin check.

## Publication gate

The repository's required release gates are satisfied: enabled candidate plugins, Zed skill discovery and active server, packaged server paths and narrow MCP approval entries, and all local checks. Claude's model authentication and Zed's restricted fixture limit the additional workflow smoke tests; they do not invalidate the separately verified server activation checks. The user explicitly requested publication after these limitations were reported.

Publication uses a signed release commit/tag and the existing GitHub release workflow. That workflow publishes npm with provenance before deploying the documentation site. The GitHub release and its workflow run provide the final publication result; this document records pre-publication validation.
