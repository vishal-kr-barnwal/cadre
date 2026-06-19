# Harness Context (AGENTS.md)

> Agent context for **OpenAI Codex** when working on this repository.
> Claude Code reads `CLAUDE.md`, which mirrors these root-level conventions.

This repository is the **Cadre harness/package repository**, not a target
project that has been initialized with Cadre. Do not create or operate on a
root `cadre/` control plane here unless the user explicitly asks to test setup
behavior in a fixture.

## Repository Shape

- Cadre implementation lives in `harness/`.
- Root `docs/` contains the canonical public GitHub Pages Markdown docs.
- Root `README.md` is a thin pointer to the harness package.
- Root `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`
  are plugin registration shims that point to `harness/plugins/`.
- Root `AGENTS.md` and `CLAUDE.md` describe harness development behavior.

## Harness Development

Run package commands from `harness/`:

```bash
cd harness
pnpm check
```

Edit master sources, not generated bundles:

- `harness/skills/cadre/SKILL.md`
- `harness/skills/cadre/protocols/`
- `harness/scripts/agent-refs/`
- `harness/templates/`
- `harness/src/`
- root `docs/` for public documentation

Generated outputs under `harness/.agents/`, `harness/.claude/`,
`harness/plugins/`, and harness marketplace files are rebuilt with:

```bash
cd harness
pnpm generate
```

Runtime JavaScript under `harness/scripts/` and `harness/templates/scripts/`
is built from TypeScript in `harness/src/` by `pnpm build`.

## Commit Policy

When the user asks for implementation commits, use small local commits with
clear messages. Do not push unless explicitly requested. Preserve unrelated
worktree changes and never rewrite existing user work without instruction.

## Testing

Before reporting completion for harness changes, prefer:

```bash
cd harness
pnpm check
```

For narrow changes, run the relevant targeted `node --test` command first, then
run the full harness check before the final handoff.
