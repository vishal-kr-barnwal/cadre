---
title: Release Notes
description: Changes in the latest Cadre release.
section: Reference
order: 9
---

# Release Notes

## Unreleased

Cadre adds install-time support for GitHub Copilot and Google Antigravity
alongside Codex and Claude. The new bundles stay thin MCP entrypoints, Copilot
project scope writes `.github/skills/cadre/SKILL.md`, and Antigravity CLI gets
the Cadre-only `mcp(cadre/*)` allow rule.

## 1.1.2 - 2026-06-23

Cadre 1.1.2 bootstraps Cadre-only MCP tool approvals for Codex and Claude so
`cadre-setup` and later packet workflows can run without repeated Cadre MCP
permission prompts.

### Compared With 1.1.1

| Area | What changed |
|------|--------------|
| Client approvals | `cadre install` configures Codex and Claude to allow Cadre MCP packet tools without repeated prompts. |
| Claude refresh | Existing Claude Code installs now refresh the cached `cadre@cadre` plugin after the local marketplace is rewritten. |
| Install checks | `cadre install --check` validates the approval bootstrap for both native clients. |
| Setup flow | `cadre-setup` guidance now points users back to `cadre install` when Cadre MCP approvals are still noisy. |
| Safety boundary | The bootstrap is Cadre-only and does not approve shell commands, edits, other plugins, or non-Cadre MCP servers. |

### Upgrade Notes

Existing installs can update with the normal npm path:

```bash
npm install -g cadre-ai@1.1.2
cadre install
```

The GitHub release for `release-1.1.2` publishes `cadre-ai@1.1.2` through npm
Trusted Publishing after the release workflow validates the harness package.

## 1.1.1 - 2026-06-23

Cadre 1.1.1 is a patch release for docs rendering, install-time plugin
registration, and native release validation.

### Compared With 1.1.0

| Area | What changed |
|------|--------------|
| Docs rendering | Fenced `mermaid` diagrams in the Next.js docs render as SVG diagrams, with top-to-bottom flow on mobile. |
| Installer | Codex and Claude marketplaces now reference the locally written Cadre plugin with relative `./plugins/cadre` sources. |
| Release validation | Release instructions now require real native installs for both Codex and Claude before publishing. |
| CLI polish | Install-time client detection no longer emits the Node 26 child-process deprecation warning. |

### Upgrade Notes

Existing installs can update with the normal npm path:

```bash
npm install -g cadre-ai@1.1.1
cadre install
```

The GitHub release for `release-1.1.1` publishes `cadre-ai@1.1.1` through npm
Trusted Publishing after the release workflow validates the harness package.

## 1.1.0 - 2026-06-23

Cadre 1.1.0 moves task memory and operational history into Cadre-owned packet
state, adds native formula runs, and records traceability for product and
control-plane commits.

### Compared With 1.0.0

| Area | What changed |
|------|--------------|
| Task memory | The external task-memory runtime was replaced with native Cadre JSON and JSONL files written by Cadre packets. |
| Formula workflows | `cadre-formula` now supports reusable formulas and git-ignored local wisps. |
| Traceability | Task completion, product commits, Cadre control-plane commits, publication records, and git notes are linked through Cadre commit traces. |
| Team status | Status, team, and fleet views now include native events, messages, formula state, ownership, leases, and review evidence. |
| Templates | Setup templates initialize native state directories and merge attributes for packet-owned files. |

### Upgrade Notes

Existing installs can update with the normal npm path:

```bash
npm install -g cadre-ai@1.1.0
cadre install
```

For target projects initialized before native state, rerun `cadre-setup` only
when setup never created native state files. Otherwise use `cadre-refresh` or
`cadre-artifacts sync` when generated projections need to catch up with the
current packet-owned JSON state.

### Release Automation

The GitHub release for `release-1.1.0` publishes `cadre-ai@1.1.0` through npm
Trusted Publishing, then runs the docs lint, typecheck, build, and Cloudflare
Pages deployment pipeline.
