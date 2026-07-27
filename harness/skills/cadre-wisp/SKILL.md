---
name: cadre-wisp
description: Perform lightweight exploration, investigation, spikes, or questions without creating or mutating Cadre project/track state. Use for the wisp command when work is intentionally untracked; promote durable work into a track before implementation.
---

# Cadre Wisp

If `.cadre/workflow.md` exists, read it first and retain its safety, repository, human-review, and read-before-edit rules while bypassing its delivery-state mutations. Keep the exploration outside Cadre state: do not change `.cadre/`, track status, learning, patterns, or Cadre history.

1. Define the exploration question and expected disposable output.
2. Inspect relevant repository files. Before editing any existing file, read it and its directly relevant context; inspect the directory before creating a file.
3. Prefer read-only investigation and temporary files outside the repository. If persistent repository edits are requested, show the proposed scope and obtain approval; do not commit automatically.
4. Return findings, evidence, uncertainty, and a recommendation.
5. If the result should become product work, recommend `$cadre-track`; do not retroactively mutate Cadre state from the wisp.

Wisp bypasses delivery tracking, not safety, repository instructions, or read-before-edit discipline.
