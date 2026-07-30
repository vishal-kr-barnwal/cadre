---
name: wisp
description: Perform lightweight exploration, investigation, spikes, or questions without creating or mutating Cadre project/track state. Use for the wisp command when work is intentionally untracked; promote durable work into a track before implementation.
---

# Cadre Wisp

If `.cadre/workflow.md` exists, read it first and retain its safety, repository, human-review, and read-before-edit rules while bypassing its delivery-state mutations. You may call the read-only `project_status` tool and use its embedded validation for context, but MCP availability is not required for a stateless exploration. Keep the exploration outside Cadre state: except for ignored disposable output under `.cadre/wisps/`, do not change `.cadre/`, track status, learning, patterns, or Cadre history.

1. Define the exploration question and expected disposable output. When persistent disposable output is useful, use `.cadre/wisps/<timestamp>-<slug>/`; `.cadre/.gitignore` must exclude it from Git.
2. Inspect relevant repository files. Before editing any existing file, read it and its directly relevant context; inspect the directory before creating a file.
3. Prefer read-only investigation and temporary files outside the repository. Standard Wisp has zero approval prompts. Wisp files under `.cadre/wisps/` never enter Cadre state or commits. Promote requested persistent product changes into `$track`; only when the human explicitly insists on an untracked persistent edit, present one exact scope approval and do not commit automatically.
4. Return findings, evidence, uncertainty, and a recommendation.
5. If the result should become product work, recommend `$track`; do not retroactively mutate Cadre state from the wisp.

Wisp bypasses delivery tracking, not safety, repository instructions, or read-before-edit discipline.
