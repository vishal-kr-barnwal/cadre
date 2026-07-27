# Cadre

Cadre is a file-backed, Git-aware delivery harness shared by Codex and Claude Code. It turns product context into resumable feature and bug tracks, requires human approval at every state-changing boundary, and carries learning forward phase by phase. Create/spec/plan operations journal their approved artifacts and Git checkpoints so an interrupted command continues before or after its commit instead of restarting.

Project creation separately asks for acceptance or changes to the default workflow and applicable styleguides. Bundled defaults cover Go, Java, Kotlin, Maven, Gradle, JavaScript, TypeScript, React, Dart, Flutter, Swift, SwiftUI, and Python; users may amend or replace any proposed guide.

## Install for local development

Node.js 18 or newer is required only for the installer and validator.

```sh
node scripts/install.mjs --agent all --scope project --target /path/to/project
```

This copies the same Agent Skills into `.agents/skills/` for Codex and `.claude/skills/` for Claude Code. Use `--scope user` to install into the current user's agent directories, or `--force` to replace an existing Cadre installation after reviewing the new version.

The repository is also a native plugin bundle:

- Codex reads `.codex-plugin/plugin.json` and the shared `skills/` directory.
- Claude Code reads `.claude-plugin/plugin.json` and the same `skills/` directory. During development, start it with `claude --plugin-dir /absolute/path/to/cadre`.

## Commands

Codex invokes skills as `$cadre-create`, `$cadre-track`, and so on. Claude Code project skills use `/cadre-create`; plugin-installed Claude skills are namespaced, for example `/cadre:cadre-create`.

| Command | Purpose |
| --- | --- |
| `create` | Classify greenfield/brownfield, then establish approved product, guideline, tech-stack, styleguide, workflow, template, and state artifacts. |
| `track` | Create or resume a feature/bug spec and phased plan, with its pattern seed embedded in incremental learning. |
| `implement` | Execute an approved plan with dependency gates, incremental learning, tests, and commits. |
| `review` | Review a ready track, record approved bugs, add remediation phases, or complete a clean track. |
| `revise` | Revise a non-completed/non-archived track and assess dependent-track impact. |
| `archive` | Archive a completed track, distill patterns, and reseed active tracks. |
| `refresh` | Refresh project context from user input and repository history. |
| `revert` | Prepare and execute an approved Git-aware phase or track revert. |
| `status` | Validate and summarize current state without mutation. |
| `wisp` | Perform exploration without mutating Cadre state. |

Run `npm test` and `npm run validate` before publishing changes to the harness.
