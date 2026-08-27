---
name: wisp
description: Perform lightweight exploration, investigation, spikes, or questions without creating or mutating Cadre project/track state. Use for the wisp command when work is intentionally untracked; promote durable work into a track before implementation.
---

# Cadre Wisp

If `.cadre/workflow.md` exists, read it first and retain its safety, repository, human-review, and read-before-edit rules while bypassing its delivery-state mutations. You may call the read-only `project_status` tool and use its embedded validation for context, but MCP availability is not required for a stateless exploration. Keep the exploration outside Cadre state: except for ignored disposable output under `.cadre/wisps/`, do not change `.cadre/`, track status, learning, patterns, or Cadre history.

When the exploration needs a material clarification and the Cadre MCP is available, show concise context. Inspect the active host policy before calling `workflow_elicit`: if the task context reports approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise prefer `workflow_elicit` with at most three questions. If it returns `fallback_required`, or immediately returns `declined` while the task explicitly reports policy `never`, ask the same short question once in chat; the latter is policy rejection, not a human decline. Never request secrets or retry the form. Standard Wisp still has no approval form unless the human explicitly insists on an untracked persistent edit.

1. Define the exploration question and expected disposable output. Use `.cadre/wisps/<timestamp>-<slug>/` only when an initialized project already has a regular `.cadre/.gitignore` containing `/wisps/`. Otherwise use an OS temporary directory and never create `.cadre` for a wisp.
2. Inspect relevant repository files. Before editing any existing file, read it and its directly relevant context; inspect the directory before creating a file.
3. Prefer read-only investigation and temporary files outside the repository. Standard Wisp has zero approval prompts. Wisp files never enter Cadre state or commits. Promote requested persistent product changes into the Cadre track workflow; only when the human explicitly insists on an untracked persistent edit, present one exact scope approval and do not commit automatically.
4. Return findings, evidence, uncertainty, and a recommendation.
5. If the result should become product work, recommend the Cadre track workflow; do not retroactively mutate Cadre state from the wisp.

Wisp bypasses delivery tracking, not safety, repository instructions, or read-before-edit discipline.
