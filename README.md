# Cadre Harness Repository

This repository builds and packages the Cadre workflow harness. The Cadre
runtime, protocols, generated skills, plugin bundles, templates, tests, and
documentation live under [`harness/`](harness/).

Root files are intentionally thin:

- `AGENTS.md` and `CLAUDE.md` describe how agents should work on this harness.
- `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`
  register the generated plugins from `harness/plugins/`.
- `LICENSE` and `.gitignore` apply to the whole repository.

Use the harness package for development:

```bash
cd harness
pnpm check
```
