# Resume and recovery

Reconcile the implementation status receipt with worker identities, branches, `git worktree list`, worktree cleanliness, branch tips, commits, merges, and canonical HEAD. Never repeat a committed or integrated node.

- Existing matching worktree but missing `start`: retry `worktree_create` to record only the transition.
- Existing merge commit but missing integration transition: retry `integration` so it records the journal receipt.
- Removed verified worktree but node still integrated: retry `worktree_cleanup` to record completion.
- Dirty, conflicted, divergent, unexpected, or unreachable state: stop and present the mismatch.

Never reset, discard, reconstruct, force-delete, or silently restart. Use standalone `block`/`resume` checkpoints for interruption repair that cannot be completed by a composite call.
