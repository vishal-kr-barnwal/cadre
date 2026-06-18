# Graph Links

> Available since beads v0.30+

Beads supports several types of links between issues to create a knowledge graph. These links enable rich querying and traversal beyond simple blocking dependencies.

## Link Types Overview

| Link Type | Command | Blocking? | Direction | Use Case |
|-----------|---------|-----------|-----------|----------|
| `blocks` | `bd dep add` | Yes | One-way | Hard dependency |
| `parent_id` | Auto (epics) | No | One-way (hierarchical) | Epic/subtask |
| `relates_to` | `bd dep relate` | No | Bidirectional | "See also" connections |
| `replies_to` | `bd mail reply` | No | One-way | Message threading |
| `duplicate_of` | `bd duplicate` | No | One-way | Consolidate duplicates |
| `superseded_by` | `bd supersede` | No | One-way | Version chains |
| `discovered_from` | `bd dep add --type discovered-from` | No | One-way | Work trail tracking |

Only `blocks` dependencies affect the ready work queue.

## When to Use Each Link Type

### relates_to — Loose Associations

Bidirectional "see also" links. Not blocking, not hierarchical.

**Use for:**
- Cross-referencing related features
- Linking bugs to associated tasks
- Building knowledge graphs

**Decision:** "Are these issues connected but neither blocks the other?" → `bd dep relate`

### duplicate_of — Consolidate Reports

Marks an issue as a duplicate of a canonical issue.

**Use for:**
- Bug triage — consolidate duplicate reports
- Preventing duplicate work

**Decision:** "Is this the same issue reported differently?" → `bd duplicate`

### supersedes — Version Chains

Marks an issue as superseded by a newer version. Old issue is **automatically closed**.

**Use for:**
- Design document versions (RFC v1 → v2 → v3)
- Spec evolution
- Artifact versioning

**Decision:** "Is this a newer version of an existing issue?" → `bd supersede`

### replies_to — Conversation Threading

Creates message threads, similar to email conversations.

**Use for:**
- Agent-to-agent message threads
- Discussion chains on issues

See [MESSAGING.md](MESSAGING.md) for full messaging details.

## Schema Fields

| Field | Type | Description |
|-------|------|-------------|
| `replies_to` | string | ID of parent message (threading) |
| `relates_to` | []string | IDs of related issues (bidirectional) |
| `duplicate_of` | string | ID of canonical issue |
| `superseded_by` | string | ID of replacement issue |

## Decision Tree

```
What relationship exists between these issues?
│
├─ One blocks the other → bd dep add (blocking dependency)
├─ They're the same issue → bd duplicate <dup> --of <canonical>
├─ One replaces the other → bd supersede <old> --with <new>
├─ They're related but independent → bd dep relate <id1> <id2>
├─ One was discovered during the other → bd dep add --type discovered-from
└─ One is a reply to the other → bd mail reply (messaging)
```

## Best Practices

- **Use `relates_to` sparingly** — Too many links become noise
- **Prefer specific link types** — `duplicate_of` is clearer than generic `relates_to`
- **Keep threads shallow** — Deep reply chains are hard to follow
- **Document supersedes chains** — Note why the version changed
- **Query before creating duplicates** — `bd search` first

## CLI Reference

Run `bd dep relate --help`, `bd supersede --help`, `bd duplicate --help` for specific usage.

## Related Resources

- [MESSAGING.md](MESSAGING.md) — Mail commands and threading
- [DEPENDENCIES.md](DEPENDENCIES.md) — Blocking dependencies deep dive
- [MOLECULES.md](MOLECULES.md) — Proto definitions and templates
