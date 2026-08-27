---
title: Installation
description: Install, update, verify, and remove stable Codex/Claude integrations and the Zed Agent beta.
section: Start Here
order: 20
---

# Installation

Cadre installs at user scope. The OpenAI Codex and Claude Code integrations are
stable. Native Zed Agent support is beta in Cadre 3.5.1. The published package
and executable are named `cadre-ai`.

## Requirements

- Node.js 18 or newer
- Git
- OpenAI Codex, Claude Code, or Zed

## Install The CLI And Client Integration

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
cadre-ai install --target zed
cadre-ai install --target all
```

The installer supports user scope only. It:

1. Packages the installed skills, generated Zed adapters, worker definitions,
   manifests, MCP runtime, and immutable templates into a shared local payload.
2. Registers and installs `cadre@cadre` for Codex/Claude, or links global
   `cadre-*` skills and configures Zed's custom Cadre MCP server.
3. Verifies each selected integration through the native state available from
   that client.
4. Adds narrow Cadre-only MCP approval settings unless
   `--prompt-mcp-tools` is supplied.

The generated marketplace lives at `~/.cadre/marketplaces/cadre`. Replacing an
existing owned marketplace retains its prior payload as a timestamped backup.
Zed skill links live under `~/.agents/skills/cadre-*`, and its MCP entry lives
in `~/.config/zed/settings.json`.

## Reload The Client

After installing or updating:

- Start a new Codex conversation.
- In Claude Code, run `/reload-plugins` or start a new session.
- In Zed (beta), open a new Agent thread and confirm Cadre is active under AI → MCP
  Servers. Zed reloads global skills live.

Confirm installation with the native clients:

```bash
codex plugin list --json
claude plugin list --json
```

Codex and Claude should report `cadre@cadre` installed and enabled.
For Zed, open AI → Skills to confirm all ten `cadre-*` skills and AI → MCP
Servers to confirm that `cadre` is active.

## MCP Permission Behavior

The default installer changes only Cadre-specific client settings:

- Codex receives `default_tools_approval_mode = "approve"` under
  `plugins."cadre@cadre".mcp_servers.cadre`.
- Claude receives `cadre` in `enabledMcpjsonServers` and `mcp__cadre__*` in
  `permissions.allow`.
- Zed (beta) receives one exact `mcp:cadre:<tool>` entry with `default: "allow"` for
  every Cadre MCP tool.

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
Zed does not advertise MCP form elicitation, so it uses the same one-question
chat fallback. Other unsupported or policy-rejected form requests behave the
same way. Tool pre-approval and form elicitation policy are separate.

To retain per-call MCP prompts:

```bash
cadre-ai install --prompt-mcp-tools
```

## Installer Options

| Option | Effect |
|---|---|
| `--target auto\|all\|codex\|claude\|zed` | Select clients; install defaults to `auto`. |
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

Uninstall removes the selected native plugin registrations or Zed-owned skill
links and matching context-server entry. With target `all`, it also removes
owned Cadre marketplace payloads and backups. A single-client uninstall retains
the shared marketplace for other clients. Client approval settings are
preserved rather than broadly rewriting user configuration.

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
