# Governed mode

Governed mode requires human review of each regular task diff before its commit, every conflict resolution, each manual-verification barrier, and each integration or other material mutation required by the approved workflow.

Present a ready diff once and proceed only after explicit approval. The checkpoint API has no standalone `awaiting_approval` event: preserve a paused, uncommitted task with `event: "block"`, its verification and handoff, and a blocker explaining the pending task-diff approval. After approval use the returned `resume` guidance before recording the approved commit or completing its group. Never invent an event or record authorization before the decision. Bind integration approval to the `integration` prepare digest. After approval call the same tool with only `request: { mode: "apply", proposalToken }`; changed content or Git/state drift requires a fresh prepare and decision.

Do not convert deterministic bookkeeping or cleanup following the approved unchanged operation into another decision.
