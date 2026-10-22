# Cadre 4.1.0-beta.0 release validation

Validated on 2026-10-22 in an isolated worktree. The original checkout and
personal Cadre installations were not updated.

## Release contract

Pushing `beta-4.1.0` publishes `cadre-ai@4.1.0-beta.0` under npm's `beta`
dist-tag. The existing `release.yml` retains its trusted-publisher identity.
Stable GitHub releases continue publishing to `latest`; GitHub prereleases and
release events for beta tags do not publish. Beta tag pushes skip production
documentation deployment. Later candidates use unique tags and versions, such
as `beta-4.1.0-beta.1` and `4.1.0-beta.1`.

The workflow validates the tag/version pair, type checks, runs the full harness
suite, validates and packs the package, publishes with provenance, and checks
registry visibility. Channel resolution rejects malformed tags, mismatched
versions, and attempts to publish a prerelease through the stable channel.

## Compatibility and local validation

Existing 4.0.0 project state remains accepted alongside compatible 3.9.x state.
Eight added 4.0.0/v6 lifecycle cases cover every approval mode and both schedules,
distributed across Codex, Claude and Zed. They complete implementation, review
and archive without a refresh, preserving project version labels and workflow
bytes. GitHub mode remains separately opt-in.

The final full harness suite passed all 519 tests locally and in GitHub Actions.
Frozen dependency installation, TypeScript, package validation, pack dry run,
doctor, release-channel tests and workflow actionlint passed. The documentation
check passed content validation, lint, types, static export and SEO validation
across 25 pages and 1,456 internal links.

## Isolated native installation

Ran `install --target all --scope user` with a disposable child-process home,
Cadre marketplace, Codex home and Claude configuration. No mock client binaries
were used. Zed used a separate `--user-data-dir`; its config directory linked to
the installer-generated sandbox settings.

- Codex reported the enabled candidate with installation cache-buster metadata.
  A fresh read-only native session discovered all ten skills and invoked the
  packaged `project_status`, reporting runtime `4.1.0-beta.0` and the expected
  uninitialized empty fixture. It created no project state.
- Claude reported the enabled candidate and its native MCP health check reported
  the packaged Cadre server connected.
- Zed 1.23.3 showed all ten `cadre-*` skills and an enabled, green Cadre MCP
  server. The fixture remained in restricted mode. No model-driven Zed lifecycle
  run is claimed.

All three installed MCP bundles matched the candidate build byte for byte.
Verified Codex plugin-scoped approval, Claude's enabled server and Cadre tool
allow rule, and Zed's 24 exact tool approvals and ten skill links.

## Publication evidence

The initial tag-triggered run stopped before publication: 518/519 tests passed,
but npm 12 changed `pack --json` from an array to a package-keyed object. The
archive contained the bundles; the test parser incorrectly reported them missing.
The packaging assertion now supports both formats, verified against npm 11.20.0
and 12.2.1. The release workflow pins the locally validated npm 11.20.0. Runtime
and package contents are unchanged by this correction.

The [retry run](https://github.com/vishal-kr-barnwal/cadre/actions/runs/39722296587)
passed all 519 tests and published with signed provenance. npm accepted the upload
but processed it asynchronously for several minutes. The original 60-second
post-publication visibility check timed out, leaving that run marked failed.
Publication subsequently became available and was independently verified.

The registry confirms `beta: 4.1.0-beta.0` and unchanged `latest: 4.0.0`.
Downloaded the exact published package into a temporary directory and verified
both plugin manifests, sole executable, absence of production dependencies,
version output, doctor, self-contained runtime and all 39 required templates.
The registry exposes a SLSA provenance attestation for this version.

Future releases use a separate availability-verification job with a roughly
15-minute processing window. Its success-after-delay and bounded stale-channel
failure paths were exercised, and actionlint passed. Failed verification can be
retried without rerunning a successful publish job. The published beta tag stays
at its accepted source commit. Installing the beta does not enable GitHub mode.
