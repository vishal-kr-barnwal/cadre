---
description: Create context handoff for transferring implementation to next section/session
---

# Conductor Handoff

Create a comprehensive context handoff document when you need to transfer implementation progress to a new section or session. Essential for large tracks that span multiple AI context windows.

## 1. Identify Active Track
- Find track marked `[~]` in `conductor/tracks.md`
- If no active track, ask user to specify or halt
- Load `spec.md`, `plan.md`, and `implement_state.json`
- Read `metadata.json` — check for `worktree_path` field (indicates parallel execution may be in progress)

## 1a. Parallel Execution Check

If `metadata.json` has a `worktree_path` field (or a `repos` map in polyrepo mode):
- Run `git worktree list` to check which worker worktrees are still active
  (**polyrepo:** run `git -C <submodule_path> worktree list` for each repo in the
  `repos` map — worker worktrees live under `.worktrees/<track_id>/<repo>_worker_*`)
- If active worktrees exist:
  > "⚠️ This track has parallel workers currently running:"
  > [List active worktrees from `git worktree list`]
  > 
  > "A) Wait for workers to complete before handoff"
  > "B) Create handoff anyway (workers will continue in their worktrees)"
  > "C) Cancel handoff"

  - If A: Poll `bd ready --parent <epic_id>` until it returns empty (all tasks closed/blocked), then proceed
  - If B: Include active worktree list and `bd show <epic_id>` notes in handoff document
  - If C: HALT

## 2. Gather Handoff Context

**Progress Analysis:**
- Count completed `[x]`, in-progress `[~]`, pending `[ ]` tasks
- Calculate overall percentage
- Identify current phase and task position

**Recent Changes:**
```bash
git log --oneline -10
git diff --name-only HEAD~5
```

**Unresolved Issues:**
- Check for `[!]` blocked markers in plan.md
- Read `blockers.md` if exists
- Ask user for any pending decisions or important context

## 3. Update Implementation State

Update `conductor/tracks/<track_id>/implement_state.json` with section tracking:
```json
{
  "current_phase": "...",
  "current_phase_index": 1,
  "current_task_index": 3,
  "completed_phases": ["Phase 1"],
  "section_count": 2,
  "last_handoff": "<ISO timestamp>",
  "handoff_history": [
    {
      "section": 1,
      "timestamp": "...",
      "phase_at_handoff": "...",
      "task_at_handoff": 5,
      "handoff_file": "handoff_<timestamp>.md"
    }
  ],
  "status": "handed_off"
}
```

## 4. Create Handoff Document

Create `conductor/tracks/<track_id>/handoff_<YYYYMMDD_HHMMSS>.md` with:

- **Header:** Track info, section number, timestamp, link to previous handoff
- **Thread URL:** Current Amp thread URL ($AMP_CURRENT_THREAD_ID) for context retrieval
- **Git Branch:** `git_branch` from `metadata.json` (e.g., `track/<track_id>`)
- **Worktree Path:** `worktree_path` from `metadata.json` (if track has a dedicated worktree)
- **Repos (polyrepo):** if `metadata.json` has a `repos` map, include a per-repo
  table — repo name, `submodule_path`, `git_branch`, `worktree_path`, and each
  repo's `git -C <submodule_path> log --oneline -3` — so the next session can
  resume work in the right repo. Note the `sync_mode` and `pr_provider` from
  `config.json`.
- **Beads Context:** Output of `bd show <epic_id>` — COMPLETED/IN PROGRESS/NEXT/KEY DECISIONS from epic notes
- **Progress Summary:** Overall %, current phase/task, completed/remaining tasks
- **Parallel Execution State:** (if applicable) Active worktrees from `git worktree list`, `bd ready --parent` output
- **Key Implementation Decisions:** Important choices made during this section
- **Code Changes Summary:** Files modified, new files, recent commits
- **Learnings Extracted:** Key patterns/gotchas from `learnings.md` this section
- **Unresolved Issues:** Blockers, pending decisions, questions
- **Context for Next Section:** Critical info, architecture notes, testing status
- **Next Steps:** Immediate tasks, upcoming phase work
- **Resume Instructions:** Commands and specific actions to continue

### 4a. Extract Learnings for Handoff

Before creating handoff document:
1. **Read `learnings.md`:** Load `conductor/tracks/<track_id>/learnings.md`
2. **Extract Recent Learnings:** Filter entries from current section (since last handoff)
3. **Summarize for Handoff:**
   - Key patterns discovered
   - Gotchas encountered
   - Context that next session needs
4. **Include in Handoff Document:**
   ```markdown
   ## Learnings from This Section
   
   ### Patterns Discovered
   - <pattern 1>
   - <pattern 2>
   
   ### Gotchas Encountered
   - <gotcha 1>
   
   ### Context for Next Session
   - <context 1>
   ```

## 5. Commit Handoff

```bash
git add conductor/tracks/<track_id>/
git commit -m "conductor(handoff): Create section <N> handoff for <track_id>

Progress: <X>% complete
Phase: <current_phase>
Next: <next_task_brief>"
```

## 6. Present Summary

Display:
- Handoff document location
- Resume command (`/conductor-implement <track_id>`)
- Next action to take
- Options: End session, Continue, View full document

## When to Use

- Before ending a long implementation session
- When context window is getting full
- At phase boundaries with significant remaining work
- When transferring work to a different session/agent
- After 5+ tasks completed without a checkpoint

---

## 9. BEADS HANDOFF SYNC

**PROTOCOL: Save handoff context to Beads for compaction-proof resumability.**

1. **Availability Check:**
   - Run the standard Beads availability check (see `references/beads-error-handler.md`)
   - If `BEADS_AVAILABLE=false`: skip this section silently

2. **Save Context to Beads with Full Structure:**
   ```bash
   bd note <epic_id> "COMPLETED: Tasks 1-N (<progress>% of track)
   KEY DECISIONS: [list major decisions from this section]
   IN PROGRESS: <current_task>
   NEXT: <next_task>
   BLOCKER: <if any>
   DISCOVERED: <new issues found, with beads IDs>
   GIT_BRANCH: track/<track_id>
   WORKTREE: <worktree_path from metadata.json, if set>
   HANDOFF: Section <N> saved at conductor/tracks/<track_id>/handoff_<timestamp>.md" --json
   ```
   - If any `bd` command fails: Follow Beads Error Handler Protocol (see `references/beads-error-handler.md`)

3. **Parallel Workers Handoff (if active worktrees exist):**
   - For each open worker task (from `bd ready --parent <id>` or tasks still `in_progress`):
     ```bash
     bd note <worker_beads_task_id> "HANDOFF: Worker state saved
     WORKTREE: .worktrees/<track_id>_worker_<N>_<name>
     BRANCH: track_<track_id>_worker_<N>_<name>
     STATUS: <in_progress|pending>
     PROGRESS: <description of work done so far>" --json
     ```
     - **Polyrepo:** use the per-repo worker shape instead —
       `WORKTREE: .worktrees/<track_id>/<repo>_worker_<N>_<name>` and add a
       `REPO: <repo>` line so the next session resumes in the right submodule.
   - Update epic with parallel state summary:
     ```bash
     bd note <epic_id> "PARALLEL_HANDOFF: <N> workers active
     ACTIVE_WORKTREES: <list from git worktree list>
     READY_NEXT: <output of bd ready --parent <id>>" --json
     ```

4. **Format for Compaction Recovery:**
   Notes should be self-contained - no conversation context assumed.
   Include technical specifics, not vague progress.

5. **Force Sync to Remote:**
   ```bash
   bd dolt push  # Ensures changes reach remote immediately
   ```
   - **Polyrepo + `sync_mode: "shared"`:** also push the control plane
     (`git push <control_remote> <control_branch>`) so a teammate can pick up the
     handoff — see `references/conductor-sync.md`. Product code stays local.

**Benefit:** Beads notes survive context compaction, enabling seamless session resume.
