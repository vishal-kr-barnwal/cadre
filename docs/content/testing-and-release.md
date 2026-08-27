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

This runs content validation, ESLint, TypeScript, and the static Next.js build.
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
- The Zed beta has ten global `cadre-*` skills, an active Cadre context server, and exact
  `mcp:cadre:<tool>` allow entries;
- new Codex and Zed sessions plus a reloaded Claude session discover all ten
  workflows.

There is no current `install --check` mode. Native listing and a real skill/MCP
smoke test are the verification path. Zed has no plugin-list CLI, so verify its
Skills and MCP Server pages and run `/cadre-status` in a native Zed Agent thread.

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
