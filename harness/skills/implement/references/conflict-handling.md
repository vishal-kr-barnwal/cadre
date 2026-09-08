# Conflict handling

When integration reports a conflict, record `conflicted` and preserve the worktree. Resolve task conflicts in the phase integration worktree and phase conflicts in main. Read every conflicted file and both sides, explain the chosen resolution, and rerun combined verification.

In governed mode, present the exact resolution for approval. In phase/track/autonomous mode, apply only an unambiguous in-scope resolution; stop for clarification if product intent, scope, compatibility, or authority is material. Use standalone checkpoints to record recovery and the verified resulting integration. Never force-delete, reset, or silently choose a side.
