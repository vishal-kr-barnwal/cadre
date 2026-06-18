# Messaging System

> Available since beads v0.30+

Beads supports messaging as a first-class issue type, enabling inter-agent and human-agent communication within the same system used for issue tracking.

## Architecture

| Component | Role |
|-----------|------|
| **Beads** | Data plane — stores messages as issues with `type: message` |
| **Orchestrator** | Control plane — routing, delivery, notifications |

Messages are issues with `type: message`, threading via `replies_to` dependencies, and ephemeral lifecycle via the `ephemeral` flag.

Mail commands (`bd mail`) delegate to an external mail provider (typically `gt mail` in Gas Town). Beads stores and threads the messages.

## When to Use Messaging

| Scenario | Use Messaging? | Why |
|----------|---------------|-----|
| Agent-to-agent coordination | Yes | Structured communication with threading |
| Human approval requests | Consider gates instead | `bd gate` is purpose-built for approvals |
| Status updates | No | Use `bd note <id> "..."` instead |
| Discussion on an issue | Yes | Thread replies to the issue |
| Cross-session handoff notes | Consider either | Messages for communication, notes for context |

## Message Lifecycle

```
Send → Open (unread) → Read (closed) → [Reply → Thread]
                                        [Ephemeral → Cleanup]
```

### Message Fields

| Field | Purpose |
|-------|---------|
| `type` | `message` |
| `sender` | Who sent the message |
| `assignee` | Recipient |
| `title` | Subject line |
| `description` | Message body |
| `status` | `open` (unread) / `closed` (read) |
| `ephemeral` | If true, eligible for bulk cleanup |

## Threading

Messages form threads via `replies_to` dependencies:

```bash
# View full conversation thread
bd show msg-123 --thread
```

Thread display shows sender, recipient, timestamp, subject, body, and reply depth (indented). Traces the `replies_to` chain to find the root message, then collects all replies via BFS.

## Setup

Configure the mail delegate (one-time):

```bash
# Environment variable (recommended for agents)
export BEADS_MAIL_DELEGATE="gt mail"

# Or per-project config
bd config set mail.delegate "gt mail"
```

## Event Hooks

Scripts in `.beads/hooks/` run after certain events:

| Hook | Trigger |
|------|---------|
| `on_create` | After `bd create` |
| `on_update` | After `bd update` |
| `on_close` | After `bd close` |

Hooks receive event data as JSON on stdin, enabling orchestrator integration without beads knowing about the orchestrator.

## CLI Reference

Run `bd mail --help` for send/inbox/read/reply commands.

## Related Resources

- [GRAPH_LINKS.md](GRAPH_LINKS.md) — relates_to, duplicates, supersedes, replies_to
- [ASYNC_GATES.md](ASYNC_GATES.md) — For approval workflows (alternative to messaging)
- [AGENTS.md](AGENTS.md) — Agent coordination patterns
