# Cadre Template Assets

Cadre ships starter templates for workflow policy, project patterns, track
learnings, Beads configuration, and language style guides. These assets are
consumed by Cadre MCP packets. Agents should not locate template directories or
copy template files by hand during workflows.

The setup packet returns a template manifest with template ids, source paths,
target paths, purpose, and scope. Use that manifest for explanation and review;
do not infer setup writes by scanning the plugin cache or harness checkout.

## Packet Ownership

- `cadre_workflow` with `workflow: "setup"` reports available setup evidence,
  detected style guides, and missing payload.
- `cadre_workflow` with `workflow: "setup_scaffold"` and `execute:true` writes
  the setup scaffold from bundled templates and confirmed setup payload.
- `cadre_workflow` with `workflow: "newtrack"` writes per-track files, including
  template-backed track learnings.
- `cadre_intel` owns LSP setup, warm review, cold review, and daemon status
  checks.
- `cadre_mutate` owns derived index refreshes and other Cadre state mutations.

## Style Guides

Setup always selects the general style guide when available, adds guides derived
from structured `techStack` JSON, and unions any explicit `styleGuideIds` passed
to the packet.
The setup packet returns `styleGuides.detected`, `styleGuides.selected`,
`styleGuides.written`, `styleGuides.skipped`, and `styleGuides.missing`.

If `styleGuides.missing` is non-empty or the packet returns `ok:false`, halt and
surface the packet error. Do not replace the packet with manual copying.

## Agent Use

Use template references only to understand what the packet-created files mean.
All setup, new-track, LSP, style-guide, Beads, and index writes are packet-owned.
