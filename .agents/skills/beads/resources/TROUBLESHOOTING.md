# Troubleshooting Guide

Common issues encountered when using bd and how to resolve them.

## Contents

- [Embedded Dolt Locking](#embedded-dolt-locking)
- [Status Updates and Sync](#status-updates-and-sync)
- [Version Requirements](#version-requirements)
- [Database Not Initialized](#database-not-initialized)
- [External Trackers](#external-trackers)

---

## Embedded Dolt Locking

### Symptom
```bash
bd create "Test"
# Error: database is locked
# OR: Error: database is being used by another process
```

### Root Cause
In **bd v1.0.0+**, the embedded Dolt driver runs in-process. If multiple AI agents or CLI instances try to access the `.beads/beads.db` simultaneously, SQLite locking may occur.

### Resolution

1. **Wait**: SQLite locks are usually brief.
2. **Check for orphans**: Ensure no background `bd` processes are hung.
   ```bash
   ps aux | grep bd
   ```
3. **Use single agent**: Avoid running multiple independent agents in the same Beads-enabled project concurrently if they both write to the database.

---

## Status Updates and Sync

### Symptom
```bash
bd note issue-1 "Work done"
bd show issue-1
# Shows: Note missing (sometimes in networked environments)
```

### Root Cause
While embedded mode is mostly immediate, some environments (like Cloud Workstations or shared volumes) may have filesystem latency.

### Resolution

1. **Force Push**:
   ```bash
   bd dolt push
   ```
2. **Wait 5s**: Let the filesystem settle.

---

## Version Requirements

### Minimum Version (v1.0.2)

**Issue:** `bd note` command not found or issue types (story, spike) missing.

**Fix:** Upgrade to **bd v1.0.2+**

**Check version:**
```bash
bd version
```

**Upgrade:**
```bash
curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash
```

---

## Database Not Initialized

### Symptom
```bash
bd create "Test"
# Error: beads database not found
```

### Resolution

**Initialize bd in the project:**
```bash
bd init <prefix>
```

---

## External Trackers

### Link to GitHub/Jira
```bash
bd update <id> --external-ref "gh-123"
bd show <id> --json  # See full mapping
```

---

## Getting Help

### Debug Checklist
```bash
bd version
bd doctor
bd status --json
```

### Report to Beads GitHub
1. **Check issues:** https://github.com/gastownhall/beads/issues
2. **Create new issue** with version and environment details.
