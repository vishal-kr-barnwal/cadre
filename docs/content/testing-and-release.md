---
title: Testing And Release
description: Validate the runtime, package payload, native installers, and documentation before release.
section: Contributor Guide
order: 180
---

# Testing And Release

Release validation covers TypeScript, runtime behavior, skill/template/package
integrity, the npm payload, all three native clients, and the public docs.

## Harness Checks

```bash
pnpm --filter cadre-ai check
pnpm --filter cadre-ai test
pnpm --filter cadre-ai validate
```

- `check` runs strict TypeScript without emitting.
- `test` builds both bundles and runs CLI plus integration tests.
- `validate` builds and verifies manifests, marketplace catalogs, package
  identity, the sole `cadre-ai` bin, self-contained dependency policy, skills,
  agent isolation rules, templates, MCP configs, and absence of retired source.

## Package Inspection

```bash
pnpm --filter cadre-ai pack --dry-run
```

Confirm the payload contains manifests, MCP configs, skills, agents, immutable
templates, license, README, and both runtime bundles. It must not contain source
tests, development dependencies, `node_modules`, or a second binary alias.

## Documentation Checks

```bash
pnpm --filter cadre-docs check
```

This runs content validation, ESLint, TypeScript, the static Next.js build, and
rendered SEO/internal-link validation.
The docs package version and release notes must match `harness/package.json`.

## Native Installer Validation

Build locally and install for all supported clients:

```bash
pnpm --filter cadre-ai build
node harness/dist/cadre-cli.mjs doctor
node harness/dist/cadre-cli.mjs install --target all --scope user
codex plugin list --json
claude plugin list --json
zed --version
```

Verify:

- Codex and Claude report `cadre@cadre` installed and enabled at the candidate
  version (with installation cache-buster metadata where applicable);
- Codex launches `./dist/cadre-mcp.mjs` from the packaged plugin root;
- Claude launches `${CLAUDE_PLUGIN_ROOT}/dist/cadre-mcp.mjs`;
- Codex has the plugin-scoped MCP approval mode;
- Claude has both the `cadre` enabled server and `mcp__cadre__*` allow rule;
- Zed Agent has ten global `cadre-*` skills, an active Cadre context server, and exact
  `mcp:cadre:<tool>` allow entries;
- new Codex and Zed sessions plus a reloaded Claude session discover all ten
  workflows.

There is no current `install --check` mode. Native listing and a real skill/MCP
smoke test are the verification path. Zed has no plugin-list CLI, so verify its
Skills and MCP Server pages and run `/cadre-status` in a native Zed Agent thread.

## 4.0.0 Verification Record

The local 4.0.0 implementation passed 480 harness tests, type checking, package
validation, pack dry run and the complete documentation check. A native Codex
fixture completed 14 fresh sessions covering brownfield setup, interrupted track
drafting, revision during implementation, review and remediation, manual product
changes invalidating clean completion, archive interruption/recovery and refresh.
Its 26 tests passed, including 200,020 arithmetic oracle comparisons. All nine
receipts had exactly one verified commit and historical evidence was preserved.

The native workflow test used Autonomous approval and sequential execution with
synthetic fixture approvals. It did not change global installations and does not
replace the three-client installer/discovery/activation gate above. The detailed
record is `docs/development/cadre-4.0.0-native-flow.md` in the source repository.
Final 4.0.0 user-scope installation and activation passed for all three clients.
Codex completed a fresh read-only status smoke test; Claude reported a connected
Cadre server; Zed showed all ten skills and an active server. Packaged MCP bytes
matched the tested build, and narrow Cadre approval settings were verified.
See `docs/development/cadre-4.0.0-release.md` for the release validation record.

## Release Sequence

1. Update runtime, package, and both plugin manifest versions together; Zed
   adapters inherit the package version from the shared payload.
2. Update docs package version and release notes.
3. Install with the locked workspace dependencies.
4. Run harness check, tests, validation, and package inspection.
5. Run the complete docs check.
6. Validate local-build installation against Codex, Claude, and Zed.
7. Stop and fix any installer, listing, discovery, MCP, permission, or version
   mismatch before creating or publishing the release.

Publishing, tagging, pushing, and external release creation require explicit
user authorization; local validation does not imply it.


## Beta Tag Publishing

The existing `release.yml` workflow publishes pushed `beta-*` tags using npm
trusted publishing. Keep its workflow filename aligned with the package's npm
trusted-publisher configuration. No npm token belongs in the repository.

- `beta-4.1.0` requires candidate version `4.1.0-beta.0`.
- A later `beta-4.1.0-beta.1` requires candidate version `4.1.0-beta.1`.
- Update the runtime, harness/docs packages and both plugin manifests together,
  add the matching release-notes heading, and complete the release gates above.
- Push the tag on the validated commit: `git push origin beta-4.1.0`.
- The workflow checks the tag/version pair, runs harness checks, tests and package
  validation, then publishes with `--tag beta --provenance` and verifies the channel.
- Beta pushes leave npm's `latest` channel and production docs unchanged. Creating
  a GitHub prerelease is optional and does not publish a second time.
- Never move an existing release tag or reuse a published npm version. Fix a failed
  candidate and validate a new beta version when its contents need to change.

Users opt in with `npm install -g cadre-ai@beta` and then run the normal installer.
GitHub collaboration still requires separate project-level opt-in. For native
installer validation without changing personal installations, use a disposable
home and client configuration directories for all installer and client processes.
