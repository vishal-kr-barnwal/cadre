# Cadre Contributor Guidance

Before editing an existing file, read it and its directly relevant context. Before creating a file, inspect its target directory and nearby conventions. Never make changes from guessed contents.

Cadre is a Node.js 18+ plugin bundle shared by Codex and Claude Code. Maintained runtime, build, installer, validator, and test sources are TypeScript. The release payload contains the compiled MCP module and immutable template set, without development dependencies. Keep skill frontmatter compatible with the Agent Skills standard. Put agent-specific UI metadata only under `agents/` or the corresponding plugin manifest.

Run these checks after changes:

```sh
npm test
npm run validate
```

Keep `.cadre/workflow.md` authoritative for lifecycle rules. All stateful command skills must load it and use the plugin-scoped Cadre MCP. Immutable templates live under `templates/<version>/` and are exposed by the MCP; never copy the runtime or template catalog into a project's `.cadre/`. State changes must remain human-approved, digest-gated where deterministic tools apply, and resumable.
