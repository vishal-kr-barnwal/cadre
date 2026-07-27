# Cadre Contributor Guidance

Before editing an existing file, read it and its directly relevant context. Before creating a file, inspect its target directory and nearby conventions. Never make changes from guessed contents.

Cadre is a dependency-free Node.js 18+ plugin bundle shared by Codex and Claude Code. Keep skill frontmatter compatible with the Agent Skills standard. Put agent-specific UI metadata only under `agents/` or the corresponding plugin manifest.

Run these checks after changes:

```sh
npm test
npm run validate
```

Keep `.cadre/workflow.md` authoritative for lifecycle rules. All command skills must load it before stateful work, all generated project artifacts must come from `skills/create/assets/project/.cadre/templates/`, and state changes must remain human-approved and resumable.
