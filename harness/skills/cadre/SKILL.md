---
name: cadre
description: |
  Context-driven development methodology for organized, spec-first coding. Use when:
  - Project has a `cadre/` directory
  - User mentions specs, plans, tracks, or context-driven development
  - Files like `cadre/tracks.json`, `cadre/product.json`, or `cadre/workflow.json` exist
  - User asks about project status, implementation progress, or track management
  - User wants to organize development work with TDD practices
  - User asks for a `cadre-*` workflow (setup, newtrack, implement, status, revert, validate, flag, revise, review, ship, land, archive, release, handoff, refresh, formula, artifacts)
  - User mentions documentation is outdated or wants to sync context with codebase changes
  - Project is a polyrepo control repo (`cadre/repos.json` with mode "polyrepo") spanning git-submodule product repos

  Interoperable across Claude Code and OpenAI Codex.
  Integrates with Beads for persistent task memory across sessions.
---

# Cadre Skill Shim

Cadre MCP is required for every Cadre workflow. Before acting, verify the MCP
runtime with `cadre_project` using `{"action":"ping"}`. If Cadre MCP tools or
resources are unavailable, halt and ask the user to install, enable, or restart
the Cadre plugin.

Load `cadre://skill-contract` for the authoritative `cadre.skill.v1` contract.
Use `cadre://workflow-protocols` to discover workflow protocol resources, then
load `cadre://workflow-protocol?workflow=<name>` for the active workflow.
References and template inventory are also MCP-served through Cadre resources.
