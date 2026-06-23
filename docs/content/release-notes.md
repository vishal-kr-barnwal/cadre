---
title: Release Notes
description: Changes in the latest Cadre release.
section: Reference
order: 9
---

# Release Notes

## 1.1.0 - 2026-06-23

Cadre 1.1.0 moves task memory and operational history into Cadre-owned packet
state, adds native formula runs, and records traceability for product and
control-plane commits.

### Compared With 1.0.0

| Area | What changed |
|------|--------------|
| Task memory | Beads-backed runtime state was replaced with native Cadre JSON and JSONL files written by Cadre packets. |
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
