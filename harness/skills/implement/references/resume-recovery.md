# Resume and recovery

Reconcile the implementation status receipt with worker identities, branches, `git worktree list`, worktree cleanliness, branch tips, commits, merges, and canonical HEAD. Never repeat a committed or integrated node.

- Existing matching worktree but missing `start`: retry `worktree_create` to record only the transition.
- Existing merge commit but missing integration transition: retry `integration` so it records the journal receipt.
- Removed verified worktree but node still integrated: retry `worktree_cleanup` to record completion.
- Dirty, conflicted, divergent, unexpected, or unreachable state: stop and present the mismatch.

Never reset, discard, reconstruct, force-delete, or silently restart. Use standalone `block`/`resume` checkpoints for interruption repair that cannot be completed by a composite call.

Read the persisted handoff for the current node and declared dependencies through `context_read` or focused `execution_status`. Preserve decisions, failed approaches, open questions, and next action. Missing handoffs mean "not recorded"; never infer them as historical facts. Reconcile source fingerprints, plan identity, journal evidence, and Git before using a handoff. Changed sources require reinspection, and observations never replace authorization. Recovery reaches only the last persisted checkpoint; a crash before recording may leave work that still needs investigation.

For policy-v2 Autonomous, follow focused `project_status.nextStep` to the installed implement or review skill and resume its durable checkpoint. Legacy Autonomous requires an explicit Track-or-Autonomous migration through refresh before new work; preserve verification, findings, and execution history.
