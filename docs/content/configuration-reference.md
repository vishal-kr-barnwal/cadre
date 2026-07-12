---
title: Configuration Reference
description: Every generated cadre/config.json key, its default, behavior, affected workflows, and operating cautions.
section: Reference
order: 200
---

# Configuration Reference

This reference matches `harness/templates/config.json` for Cadre 2.1.0. Unless
noted otherwise, setup generates these values and maintainers may tune them in
the target project's `cadre/config.json`.

## Core And Sync Keys

| Key | Type / default | Accepted values and effect | Caution |
|---|---|---|---|
| `sync_mode` | string / `"local"` | `local` keeps the control plane local; `shared` enables shared-sync behavior. Affects workflow start sync, reviews, status, ship, and land. | Configure the control remote and branch before using shared mode. |
| `auto_open` | boolean / `false` | Setup-generated compatibility preference for opening generated artifacts. The v2.1 packet runtime does not use it as a publication gate. | Do not depend on it for review or approval. |
| `control_remote` | string / `"origin"` | Git remote used for shared control-plane operations. | Must identify the control repository remote, not a polyrepo product remote. |
| `control_branch` | string / `"main"` | Branch used for shared control-plane sync. | Coordinate branch protection and contributor access. |
| `pull_on_command_start` | boolean / `true` | Setup-generated sync preference. Current v2.1 workflow response logic gates actual sync by `sync_mode` and packet behavior. | Treat packet evidence as authoritative rather than assuming every command pulls. |

## Review And Publication Keys

| Key | Type / default | Effect | Caution |
|---|---|---|---|
| `require_second_reviewer` | boolean / `false` | A self-reviewed record is insufficient for publication when true. | Enable for protected delivery paths only after reviewer identity is reliable. |
| `allow_unreviewed_ship` | boolean / `false` | Allows publication without a recorded review verdict and emits a warning. | This weakens a core safety gate; keep false by default. |
| `allow_unpinned_review_ship` | boolean / `false` | Allows publication when review evidence lacks reviewed commit SHA data and emits a warning. | Can permit stale review evidence; keep false by default. |

## Provider Keys

| Key | Type / default | Accepted values and effect | Caution |
|---|---|---|---|
| `provider_mode` | string / `"local"` | `local`, `github`, or `gitlab`. Hosted modes require provider-aware publication evidence. | Use explicit configuration when remotes are ambiguous. |
| `provider_mcp_required` | boolean / `false` | Records whether provider MCP evidence is required. Setup sets it for GitHub/GitLab modes. | Provider policy is also derived from provider mode; do not use this key alone to bypass evidence. |
| `remote_host` | string / `""` | Explicit host used when selecting provider behavior. | Set it when multiple remotes prevent unambiguous detection. |

## Verification Keys

| Key | Type / default | Effect | Caution |
|---|---|---|---|
| `coverage_command` | string / `""` | Command used to gather configured coverage evidence. The runtime also recognizes compatibility aliases at the boundary. | Keep it deterministic, non-interactive, and valid from the resolved repository root. |

## Project-Skill Keys

| Key | Type / default | Effect | Caution |
|---|---|---|---|
| `project_skills.inline_rule_budget` | integer / `2400` | Bounds optional inline project-skill rule context returned in workflow packets. | Required rules are not silently truncated; narrow selectors before raising the budget. |

The runtime reports the effective budget, source, and requested value in
project-skill diagnostics when relevant.

## Traceability Keys

| Key | Type / default | Effect | Caution |
|---|---|---|---|
| `traceability.auto_product_commits` | boolean / `true` | Permits packet-owned product commits at supported completion boundaries. | Align with the repository's commit policy. |
| `traceability.auto_control_commits` | boolean / `true` | Permits packet-owned Cadre control-plane commits. | Review shared-sync behavior before disabling. |
| `traceability.auto_automation_commits` | boolean / `true` | Permits commits for supported packet-owned maintenance. | Audit unexpected automation changes rather than broadly disabling traceability. |
| `traceability.commit_local_wisps` | boolean / `false` | Includes local formula wisp runs in committed state when true. | Wisps are local and ignored by default. |
| `traceability.git_notes` | boolean / `true` | Records supported trace metadata as Git notes. | Ensure tools and hosting policy preserve the notes ref. |
| `traceability.notes_ref` | string / `"refs/notes/cadre"` | Selects the Git notes namespace. | Changing it splits trace history across refs. |
| `traceability.push_notes` | boolean / `true` | Allows supported publication flows to push the configured notes ref. | Confirm remote permissions and team expectations. |

## Merge Train Keys

| Key | Type / default | Effect | Caution |
|---|---|---|---|
| `merge_train.enabled` | boolean / `true` | Enables merge-train planning for supported team/polyrepo delivery. | Disable when the provider workflow does not use grouped publication. |
| `merge_train.auto_fire` | boolean / `true` | Allows an eligible train to advance automatically through packet-owned provider actions. | Provider and review gates still apply. |
| `merge_train.group_label_prefix` | string / `"cadre-track"` | Prefix used to group related provider work by track. | Keep stable so existing groups remain discoverable. |

## Recommended Baseline

Keep the generated template for most projects. Change sync, provider, and review
policy only after validating the target topology. Tune project-skill budget and
traceability from observed diagnostics, not hypothetical context pressure.
