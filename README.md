![Cadre logo](docs/assets/cadre-logo.png)

# Cadre Harness Repository

This repository builds and packages the Cadre workflow harness. The Cadre
runtime, protocols, generated skills, plugin bundles, templates, and tests live
under [`harness/`](harness/). Public Markdown documentation for GitHub Pages
lives under [`docs/`](docs/index.md).

Root files are intentionally thin:

- `AGENTS.md` and `CLAUDE.md` describe how agents should work on this harness.
- `docs/` contains the canonical public documentation site.
- `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`
  register the generated plugins from `harness/plugins/`.
- `LICENSE` and `.gitignore` apply to the whole repository.

Use the harness package for development:

```bash
cd harness
pnpm check
```

Install the Codex plugin from this repository with:

```bash
codex plugin marketplace add vishal-kr-barnwal/Cadre --sparse .agents/plugins --sparse harness/plugins/cadre
codex plugin add cadre@cadre
```

Start with the [Cadre documentation](docs/index.md) for installation, workflow,
architecture, team, polyrepo, and troubleshooting details.
