# Governed mode

Governed mode requires human review of each regular task diff before its commit, every conflict resolution, each manual-verification barrier, and each integration or other material mutation required by the approved workflow.

Record a ready diff as `awaiting_approval` with verification evidence, present it once, and proceed only after explicit approval. Bind integration approval to the `integration` prepare digest. After approval call the same tool with only `request: { mode: "apply", proposalToken }`; changed content or Git/state drift requires a fresh prepare and decision.

Do not convert deterministic bookkeeping or cleanup following the approved unchanged operation into another decision.
