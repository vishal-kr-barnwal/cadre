# Cadre

Cadre is a file-backed, Git-aware delivery harness shared by Codex and Claude Code. It turns product context into resumable feature and bug tracks, requires human approval at every state-changing boundary, and carries learning forward phase by phase. Create/spec/plan operations journal their approved artifacts and Git checkpoints so an interrupted command continues before or after its commit instead of restarting.

Each track's `state.json` is canonical. `project.json` does not duplicate track records, directory paths are derived from track status and ID, and generated `tracks.md` omits dependency and path data.

Project creation separately asks for acceptance or changes to the default workflow and applicable styleguides. Bundled defaults cover Go, Java, Kotlin, Maven, Gradle, HTML/CSS, JavaScript, TypeScript, React, Dart, Flutter, Swift, SwiftUI, and Python; users may amend or replace any proposed guide.

## Install as a user plugin

Node.js 18 or newer plus the `codex` and/or `claude` CLI is required. The installer builds one local dual-product marketplace, registers it, and installs Cadre at user scope so it is available across projects.

```sh
node scripts/install.mjs --agent all
```

Use `--agent codex` or `--agent claude` to install for only one product. The prepared marketplace lives at `~/.cadre/marketplaces/cadre`; an existing marketplace with the same name at another location is never replaced unless `--replace-marketplace` is explicitly supplied. Previous locally prepared Cadre marketplace payloads are retained as timestamped backups during updates.

The packaged plugin keeps the shared skills and is ready to include plugin-scoped MCP, hook, script, asset, command, agent, or server components when those files are added later. After installation, start a new Codex conversation and run `/reload-plugins` in Claude Code.

For package-only validation without registering or installing anything:

```sh
node scripts/install.mjs --agent all --prepare-only --marketplace-root /tmp/cadre
```

## Commands

Plugin-installed skills use the Cadre namespace exactly once: `$cadre:create` and `$cadre:track` in Codex, or `/cadre:create` and `/cadre:track` in Claude Code.

| Command | Purpose |
| --- | --- |
| `create` | Classify greenfield/brownfield, initialize Git when absent, then establish approved product, guideline, tech-stack, styleguide, workflow, template, and state artifacts. |
| `track` | Create or resume a feature/bug spec and phased plan, with its pattern seed embedded in incremental learning. |
| `implement` | Execute an approved plan with dependency gates, incremental learning, tests, and commits. |
| `review` | Review a ready track, record approved bugs, add remediation phases, or complete a clean track. |
| `revise` | Revise a non-completed/non-archived track and assess dependent-track impact. |
| `archive` | Archive one or more completed tracks as a resumable batch, distill patterns, and reseed active tracks. |
| `refresh` | Refresh project context from user input and repository history. |
| `revert` | Prepare and execute an approved Git-aware phase or track revert. |
| `status` | Validate and summarize current state without mutation. |
| `wisp` | Perform exploration without mutating Cadre state. |

Run `npm test` and `npm run validate` before publishing changes to the harness.
