---
title: Installation
description: Install, update, verify, and remove Cadre for Codex and Claude Code.
section: Start Here
order: 20
---

# Installation

Cadre 3.0 installs as a native user plugin for OpenAI Codex, Claude Code, or
both. The published package and executable are named `cadre-ai`.

## Requirements

- Node.js 18 or newer
- Git
- OpenAI Codex, Claude Code, or both

## Install The CLI And Plugin

```bash
npm install -g cadre-ai
cadre-ai doctor
cadre-ai install
```

With no target, installation auto-detects available clients. Select a client
explicitly when needed:

```bash
cadre-ai install --target codex
cadre-ai install --target claude
cadre-ai install --target all
```

The installer supports user scope only. It:

1. Packages the installed skills, worker definitions, manifests, MCP runtime,
   and immutable templates into a local dual-client marketplace.
2. Registers that marketplace and installs `cadre@cadre`.
3. Verifies that each selected client reports the plugin installed and enabled.
4. Adds narrow Cadre-only MCP approval settings unless
   `--prompt-mcp-tools` is supplied.

The generated marketplace lives at `~/.cadre/marketplaces/cadre`. Replacing an
existing owned marketplace retains its prior payload as a timestamped backup.

## Reload The Client

After installing or updating:

- Start a new Codex conversation.
- In Claude Code, run `/reload-plugins` or start a new session.

Confirm installation with the native clients:

```bash
codex plugin list --json
claude plugin list --json
```

Both should report `cadre@cadre` installed and enabled.

## MCP Permission Behavior

The default installer changes only Cadre-specific client settings:

- Codex receives `default_tools_approval_mode = "approve"` under
  `plugins."cadre@cadre".mcp_servers.cadre`.
- Claude receives `cadre` in `enabledMcpjsonServers` and `mcp__cadre__*` in
  `permissions.allow`.

Existing comments and unrelated settings are preserved. The installer never
removes or overrides a Claude deny rule; a deny rule that blocks Cadre stops
installation with a corrective error.

These client settings suppress repetitive prompts for Cadre's own MCP calls.
They do not approve Cadre lifecycle proposals or unrelated shell, network,
filesystem, container, dependency, or server operations.

Cadre uses MCP form elicitation for concise clarifications and bound human
decisions when the client supports it. Claude Code displays these forms without
additional configuration. Codex displays them under an interactive approval
policy. Codex Full Access reports the non-interactive `never` policy, so Cadre
does not attempt a form there and asks the same short question once in chat.
Other unsupported or policy-rejected form requests use the same fallback. Tool
pre-approval and form elicitation policy are separate.

To retain per-call MCP prompts:

```bash
cadre-ai install --prompt-mcp-tools
```

## Installer Options

| Option | Effect |
|---|---|
| `--target auto\|all\|codex\|claude` | Select clients; install defaults to `auto`. |
| `--scope user` | Explicitly select the only supported scope. |
| `--replace-marketplace` | Replace a conflicting marketplace named `cadre`. |
| `--prompt-mcp-tools` | Skip Cadre MCP approval configuration. |
| `--prepare-only` | Package the marketplace without registering clients. |
| `--marketplace-root PATH` | Override the marketplace path; it must end in `cadre`. |
| `--cachebuster TOKEN` | Supply an installation cache-buster. |
| `--dry-run` | Report intended preparation and client installation. |

`--force` aliases `--replace-marketplace`; `--agent` aliases `--target` for
compatibility. There is no current installer `--check` mode.

## Update

```bash
npm install -g cadre-ai@latest
cadre-ai doctor
cadre-ai install
```

Use `--replace-marketplace` only when a marketplace already named `cadre`
points at a different location that you have reviewed and intend to replace.

## Uninstall

```bash
cadre-ai uninstall --target all
```

Uninstall removes the selected native plugin registrations. With target `all`,
it also removes owned Cadre marketplace payloads and backups. A single-client
uninstall retains the shared marketplace for the other client. Client approval
settings are preserved rather than broadly rewriting user configuration.

## Install From A Source Checkout

From the repository root:

```bash
pnpm install
pnpm --filter cadre-ai build
node harness/dist/cadre-cli.mjs doctor
node harness/dist/cadre-cli.mjs install --target all
```

Use this path for harness development and release validation, not for normal
package upgrades.
