#!/usr/bin/env bash
#
# generate-skills.sh — Build the Claude and Codex plugin bundles from the
# master Cadre skill protocol sources.
#
# One source of truth is transformed into:
#   - Claude skill build artifact -> .claude/skills/cadre/{protocols,references,templates}
#   - Codex skill build artifact  -> .agents/skills/cadre/{protocols,references,templates}
#   - Claude plugin marketplace -> .claude-plugin/marketplace.json + plugins/cadre-claude/
#   - Codex plugin marketplace  -> .agents/plugins/marketplace.json + plugins/cadre/
#
# Edit the source skill in `skills/cadre/SKILL.md`, protocol sources in
# `skills/cadre/protocols/cadre-*.md`, reference masters in
# `scripts/agent-refs/`, templates in `templates/`, and runtime TypeScript in
# `src/`. Runtime JavaScript under `scripts/` is built from `src/` by
# `pnpm build`. Generated files carry an AUTO-GENERATED marker;
# do not hand-edit generated bundles.
#
# Usage:
#   pnpm generate
#   pnpm check
#   CADRE_SKIP_RUNTIME_BUILD=1 bash scripts/generate-skills.sh
#   bash scripts/generate-skills.sh --check
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_REPO="$(cd "$REPO_ROOT/.." && pwd)"
cd "$REPO_ROOT"

SOURCE_SKILL_FILE="skills/cadre/SKILL.md"
SOURCE_PROTOCOL_DIR="skills/cadre/protocols"

# Agnostic references: identical for every platform.
AGNOSTIC_REFS=(
  "scripts/agent-refs/beads-error-handler.md"
  "scripts/agent-refs/beads-integration.md"
)

# Sliced references: multi-platform masters with <!-- AGENT:<name> --> blocks.
SLICED_REFS=(
  "scripts/agent-refs/parallel-execution.md"
  "scripts/agent-refs/template-locator.md"
  "scripts/agent-refs/polyrepo-git.md"
  "scripts/agent-refs/cadre-sync.md"
  "scripts/agent-refs/ownership-guard.md"
  "scripts/agent-refs/mcp-contract.md"
  "scripts/agent-refs/provider-evidence.md"
  "scripts/agent-refs/team-ops.md"
)

TEMPLATES_SRC="templates"
CLAUDE_SKILL_DIR=".claude/skills/cadre"
CODEX_SKILL_DIR=".agents/skills/cadre"
CLAUDE_PLUGIN_DIR="plugins/cadre-claude"
CODEX_PLUGIN_DIR="plugins/cadre"
CLAUDE_PLUGIN_MARKETPLACE=".claude-plugin/marketplace.json"
CODEX_PLUGIN_MARKETPLACE=".agents/plugins/marketplace.json"
ROOT_CLAUDE_PLUGIN_MARKETPLACE=".claude-plugin/marketplace.json"
ROOT_CODEX_PLUGIN_MARKETPLACE=".agents/plugins/marketplace.json"

PLUGIN_NAME="cadre"
PLUGIN_VERSION="2.0.0"
PLUGIN_DESCRIPTION="Skill-first Cadre workflows with bundled MCP tooling for context-driven development."
PLUGIN_AUTHOR_NAME="Vishal Barnwal"
PLUGIN_AUTHOR_URL="https://github.com/vishal-kr-barnwal"
PLUGIN_HOMEPAGE="https://github.com/vishal-kr-barnwal/Cadre"
PLUGIN_REPOSITORY="https://github.com/vishal-kr-barnwal/Cadre"
PLUGIN_LICENSE="Apache-2.0"

CLAUDE_PROTOCOL_DIR="$CLAUDE_SKILL_DIR/protocols"
CODEX_PROTOCOL_DIR="$CODEX_SKILL_DIR/protocols"

MODE="${1:-generate}"
GEN_ROOT=""
if [[ "$MODE" == "--check" ]]; then
  GEN_ROOT="$(mktemp -d)"
  trap 'rm -rf "$GEN_ROOT"' EXIT
fi

out_path() {
  if [[ -n "$GEN_ROOT" ]]; then
    printf '%s/%s' "$GEN_ROOT" "$1"
  else
    printf '%s/%s' "$REPO_ROOT" "$1"
  fi
}

out_root_path() {
  if [[ -n "$GEN_ROOT" ]]; then
    printf '%s/root/%s' "$GEN_ROOT" "$1"
  else
    printf '%s/%s' "$ROOT_REPO" "$1"
  fi
}

extract_body() {
  awk '
    BEGIN { in_fm = 0; started = 0; seen = 0 }
    NR == 1 && $0 == "---" { in_fm = 1; seen = 1; next }
    in_fm == 1 && $0 == "---" { in_fm = 0; started = 1; next }
    in_fm == 1 { next }
    {
      if (seen == 0) started = 1
      if (started == 1) {
        if (printing == 0 && $0 ~ /^[[:space:]]*$/) next
        printing = 1
        print
      }
    }
  ' "$1"
}

extract_description() {
  awk '
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm == 1 && /^description:/ {
      sub(/^description:[[:space:]]*/, "")
      gsub(/^"|"$/, "")
      print
      exit
    }
    in_fm == 1 && $0 == "---" { exit }
  ' "$1"
}

dispatch_sentence() {
  case "$1" in
    claude) echo 'Use the generated `cadre-worker` plugin agent when available, otherwise the **`Task` tool**, one call per worker; see `references/parallel-execution.md`.' ;;
    codex)  echo 'Use tool discovery for `multi_agent_v1.spawn_agent`; if unavailable, follow packet alternate dispatch instructions or halt with `dispatch-unavailable`; see `references/parallel-execution.md`.' ;;
  esac
}

apply_dispatch() {
  awk -v repl="$(dispatch_sentence "$1")" '
    /<!-- DISPATCH:start -->/ { match($0, /^[ \t]*/); print substr($0, 1, RLENGTH) repl; skip = 1; next }
    /<!-- DISPATCH:end -->/   { skip = 0; next }
    skip == 1 { next }
    { print }
  '
}

write_file() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path"
}

copy_tree_with_links() {
  local source="$1" dest="$2" dir file rel
  rm -rf "$dest"
  mkdir -p "$dest"
  while IFS= read -r -d '' dir; do
    rel="${dir#"$source"/}"
    [[ "$rel" == "$dir" ]] && rel=""
    mkdir -p "$dest/$rel"
  done < <(find "$source" -type d -print0)
  while IFS= read -r -d '' file; do
    rel="${file#"$source"/}"
    mkdir -p "$(dirname "$dest/$rel")"
    if ! ln "$file" "$dest/$rel" 2>/dev/null; then
      cp -p "$file" "$dest/$rel"
    fi
  done < <(find "$source" -type f -print0)
}

SKILL_MARKER="AUTO-GENERATED by scripts/generate-skills.sh from skills/cadre/SKILL.md -- do not edit by hand."
GEN_MARKER="AUTO-GENERATED by scripts/generate-skills.sh from skills/cadre/protocols/ — do not edit by hand."
REF_MARKER="AUTO-GENERATED by scripts/generate-skills.sh — edit the master in scripts/agent-refs/ instead."
PLUGIN_MARKER="AUTO-GENERATED by scripts/generate-skills.sh — edit the generator or source skill instead."

generate_skill() {
  local dest_dir="$1"
  mkdir -p "$(out_path "$dest_dir")"
  awk -v marker="<!-- $SKILL_MARKER -->" '
    NR == 1 && $0 == "---" { in_fm = 1; print; next }
    in_fm == 1 && $0 == "---" {
      print
      print ""
      print marker
      in_fm = 0
      next
    }
    { print }
  ' "$SOURCE_SKILL_FILE" | write_file "$(out_path "$dest_dir/SKILL.md")"
}

generate_protocols() {
  local platform="$1" dest_dir="$2" src name desc body
  rm -rf "$(out_path "$dest_dir")"
  mkdir -p "$(out_path "$dest_dir")"

  for src in "$SOURCE_PROTOCOL_DIR"/cadre-*.md; do
    name="$(basename "$src" .md)"
    desc="$(extract_description "$src")"
    body="$(extract_body "$src" | apply_dispatch "$platform")"

    {
	      printf '<!-- %s -->\n' "$GEN_MARKER"
	      printf '<!-- %s -->\n\n' "$desc"
	      printf '> When this protocol references `references/...`, resolve it against the parent skill directory.\n\n'
	      printf '> Treat text after the workflow name in the user request as workflow arguments; there is no prompt expansion layer.\n\n'
	      printf '> Cadre MCP is required. Before executing this workflow, verify the Cadre MCP server is available with `cadre_project` `{ "action": "ping" }`. For every project-scoped Cadre MCP call, pass a per-call `root` argument pointing at the absolute project root or any path inside it. If Cadre MCP tools are unavailable, halt and ask the user to install, enable, or restart the Cadre plugin.\n\n'
	      printf '%s\n' "$body"
	    } | write_file "$(out_path "$dest_dir/$name.md")"
  done
}

slice_ref() {
  awk -v keep="$2" '
    /<!-- \/AGENT:/ { inblock = 0; next }
    /<!-- AGENT:/   { line = $0; sub(/.*AGENT:/, "", line); sub(/[^a-z].*/, "", line); cur = line; inblock = 1; next }
    inblock == 1 && cur != keep { next }
    { print }
  ' "$1"
}

copy_sliced_refs() {
  local slice="$1" refdir="$2" master name dest
  for master in "${SLICED_REFS[@]}"; do
    name="$(basename "$master")"
    dest="$(out_path "$refdir/$name")"
    mkdir -p "$(dirname "$dest")"
    {
      printf '<!-- %s -->\n' "$REF_MARKER"
      slice_ref "$master" "$slice"
    } > "$dest"
  done
}

copy_references() {
  local skill_dir refdir dest ref

  for skill_dir in "$CLAUDE_SKILL_DIR" "$CODEX_SKILL_DIR"; do
    rm -rf "$(out_path "$skill_dir/references")"
    mkdir -p "$(out_path "$skill_dir/references")"
  done
  copy_sliced_refs "claude" "$CLAUDE_SKILL_DIR/references"
  copy_sliced_refs "codex" "$CODEX_SKILL_DIR/references"

  for skill_dir in "$CLAUDE_SKILL_DIR" "$CODEX_SKILL_DIR"; do
    refdir="$skill_dir/references"
    for ref in "${AGNOSTIC_REFS[@]}"; do
      dest="$(out_path "$refdir/$(basename "$ref")")"
      mkdir -p "$(dirname "$dest")"
      {
        printf '<!-- %s -->\n' "$REF_MARKER"
        cat "$ref"
      } > "$dest"
    done
  done
}

copy_templates() {
  local claude_dest codex_dest
  claude_dest="$(out_path "$CLAUDE_SKILL_DIR/templates")"
  codex_dest="$(out_path "$CODEX_SKILL_DIR/templates")"
  rm -rf "$claude_dest" "$codex_dest"
  mkdir -p "$claude_dest"
  cp -R "$TEMPLATES_SRC/." "$claude_dest/"
  copy_tree_with_links "$claude_dest" "$codex_dest"
}

copy_skill_tree() {
  local src="$1" dest="$2" source_path
  rm -rf "$(out_path "$dest")"
  mkdir -p "$(dirname "$(out_path "$dest")")"
  if [[ -n "$GEN_ROOT" && -d "$GEN_ROOT/$src" ]]; then
    source_path="$GEN_ROOT/$src"
  else
    source_path="$REPO_ROOT/$src"
  fi
  copy_tree_with_links "$source_path" "$(out_path "$dest")"
}

copy_plugin_scripts() {
  local plugin_dir="$1" source_dir="$2" dest
  dest="$(out_path "$plugin_dir/scripts")"
  rm -rf "$dest"
  mkdir -p "$dest/mcp"
  if [[ "$source_dir" == "$REPO_ROOT/scripts" ]]; then
    cp -p "$source_dir/cadre-core.js" "$dest/cadre-core.js"
    cp -p "$source_dir/cadre-job-runner.js" "$dest/cadre-job-runner.js"
    cp -p "$source_dir/cadre-lsp-setup.js" "$dest/cadre-lsp-setup.js"
    cp -p "$source_dir/cadre-lsp-review.js" "$dest/cadre-lsp-review.js"
    cp -p "$source_dir/cadre-lsp-daemon.js" "$dest/cadre-lsp-daemon.js"
    cp -p "$source_dir/mcp/cadre-server.js" "$dest/mcp/cadre-server.js"
  else
    copy_tree_with_links "$source_dir" "$dest"
  fi
  chmod +x "$dest/cadre-core.js" "$dest/cadre-job-runner.js" "$dest/cadre-lsp-setup.js" \
    "$dest/cadre-lsp-review.js" "$dest/cadre-lsp-daemon.js" "$dest/mcp/cadre-server.js"
}

build_runtime() {
  if [[ "${CADRE_SKIP_RUNTIME_BUILD:-}" == "1" || "$MODE" == "--check" ]]; then
    return
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "error: pnpm is required to build Cadre runtime bundles from src/" >&2
    exit 1
  fi
  pnpm -s build:runtime
}

plugin_manifest_json() {
  local platform="$1"
  case "$platform" in
    codex)
      cat <<JSON
{
  "name": "$PLUGIN_NAME",
  "version": "$PLUGIN_VERSION",
  "description": "$PLUGIN_DESCRIPTION",
  "author": {
    "name": "$PLUGIN_AUTHOR_NAME",
    "url": "$PLUGIN_AUTHOR_URL"
  },
  "homepage": "$PLUGIN_HOMEPAGE",
  "repository": "$PLUGIN_REPOSITORY",
  "license": "$PLUGIN_LICENSE",
  "keywords": [
    "cadre",
    "context-driven-development",
    "skills",
    "beads",
    "mcp"
  ],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Cadre",
    "shortDescription": "Skill-first planning, tracks, reviews, and MCP tools.",
    "longDescription": "Cadre packages context-driven development workflows for Codex: setup, newtrack, implement, review, ship, land, archive, release, status, validation, and handoff.",
    "developerName": "$PLUGIN_AUTHOR_NAME",
    "category": "Productivity",
    "capabilities": [
      "Read",
      "Write",
      "Interactive"
    ],
    "defaultPrompt": [
      "Set up this repo with Cadre.",
      "Show Cadre team status.",
      "Review the current Cadre track."
    ],
    "brandColor": "#10A37F"
  }
}
JSON
      ;;
    claude)
      cat <<JSON
{
  "name": "$PLUGIN_NAME",
  "displayName": "Cadre",
  "version": "$PLUGIN_VERSION",
  "description": "$PLUGIN_DESCRIPTION",
  "author": {
    "name": "$PLUGIN_AUTHOR_NAME",
    "url": "$PLUGIN_AUTHOR_URL"
  },
  "homepage": "$PLUGIN_HOMEPAGE",
  "repository": "$PLUGIN_REPOSITORY",
  "license": "$PLUGIN_LICENSE",
  "keywords": [
    "cadre",
    "context-driven-development",
    "skills",
    "beads",
    "mcp"
  ],
  "skills": "./skills/",
  "agents": "./agents/",
  "mcpServers": "./mcp-config.json"
}
JSON
      ;;
  esac
}

write_plugin_manifest() {
  local platform="$1" plugin_dir="$2" manifest_dir
  case "$platform" in
    codex) manifest_dir="$(out_path "$plugin_dir/.codex-plugin")" ;;
    claude) manifest_dir="$(out_path "$plugin_dir/.claude-plugin")" ;;
  esac
  mkdir -p "$manifest_dir"
  plugin_manifest_json "$platform" > "$manifest_dir/plugin.json"
}

write_plugin_mcp_config() {
  local target="$1"
  cat > "$(out_path "$target")" <<'JSON'
{
  "mcpServers": {
    "cadre": {
      "command": "node",
      "args": [
        "./scripts/mcp/cadre-server.js"
      ],
      "cwd": "."
    }
  }
}
JSON
}

write_plugin_mcp_config_for_platform() {
  local platform="$1" plugin_dir="$2"
  case "$platform" in
    codex) write_plugin_mcp_config "$plugin_dir/.mcp.json" ;;
    claude) write_plugin_mcp_config "$plugin_dir/mcp-config.json" ;;
  esac
}

write_plugin_readme() {
  local plugin_dir="$1" platform="$2"
  cat > "$(out_path "$plugin_dir/README.md")" <<EOF
<!-- $PLUGIN_MARKER -->

# Cadre $platform Plugin

This generated plugin packages the Cadre skill, workflow protocols, templates,
and MCP server for $platform. Edit the master workflow sources under
\`skills/cadre/protocols/\`, runtime TypeScript under \`src/\`, then run:

\`\`\`bash
pnpm generate
\`\`\`

The LSP setup and review helpers are bundled under \`scripts/\` so Cadre
workflows can copy or invoke them. They are not auto-registered as plugin LSP
servers because Cadre configures per-project language servers in
\`cadre/lsp.json\`.

Cadre MCP is a required runtime. Use \`cadre_project\` with
\`{"action":"ping"}\` to verify the server is available. All project-scoped MCP
tools require a per-call \`root\` argument.
The server normalizes that path by walking upward to the nearest directory
containing \`cadre/\`, so callers may pass either the project root or a path
inside it. Use \`cadre_project\` with \`{"action":"root"}\` and \`root\` to
inspect the resolved project root.
EOF
}

write_marketplace_json() {
  local platform="$1" target="$2" source_path="$3"
  case "$platform" in
    codex)
      cat > "$target" <<JSON
{
  "name": "$PLUGIN_NAME",
  "interface": {
    "displayName": "Cadre"
  },
  "plugins": [
    {
      "name": "$PLUGIN_NAME",
      "source": {
        "source": "local",
        "path": "$source_path"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
JSON
      ;;
    claude)
      cat > "$target" <<JSON
{
  "name": "$PLUGIN_NAME",
  "owner": {
    "name": "$PLUGIN_AUTHOR_NAME"
  },
  "description": "Cadre skill-first workflows for Claude Code.",
  "plugins": [
    {
      "name": "$PLUGIN_NAME",
      "source": "$source_path",
      "description": "$PLUGIN_DESCRIPTION",
      "version": "$PLUGIN_VERSION",
      "author": {
        "name": "$PLUGIN_AUTHOR_NAME"
      },
      "category": "productivity",
      "tags": [
        "cadre",
        "skills",
        "mcp",
        "context-driven-development"
      ]
    }
  ]
}
JSON
      ;;
  esac
}

write_claude_worker_agent() {
  local agent_dir
  agent_dir="$(out_path "$CLAUDE_PLUGIN_DIR/agents")"
  mkdir -p "$agent_dir"
  cat > "$agent_dir/cadre-worker.md" <<'EOF'
---
name: cadre-worker
description: Execute one packet-assigned Cadre parallel worker task inside its provided worktree, then return structured evidence to the coordinator.
isolation: worktree
skills:
  - cadre
---

You are a Cadre parallel worker. Execute only the task in the packet payload from
the coordinator. Work only in the provided repo/worktree and only on assigned
product files. Do not edit Cadre control-plane files, Beads state, provider
state, worker topology, merge state, or cleanup state.

Run the task's relevant product verification and commit product changes locally
when the worker prompt asks for commit evidence. Return structured evidence:
worker id, task key, repo, commit SHA, tests run, coverage when available, files
changed, summary, and blockers. If implementation fails, return failure evidence
instead of repairing Cadre state yourself.
EOF
}

validate_generated_plugins() {
  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const checks = [
  ["plugins/cadre/.codex-plugin/plugin.json", ["name", "version", "skills", "mcpServers"]],
  ["plugins/cadre/.mcp.json", ["mcpServers"]],
  ["plugins/cadre-claude/.claude-plugin/plugin.json", ["name", "version", "skills", "mcpServers"]],
  ["plugins/cadre-claude/mcp-config.json", ["mcpServers"]],
];

for (const [rel, keys] of checks) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Error(`missing ${rel}`);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of keys) {
    if (!(key in json)) throw new Error(`${rel} missing ${key}`);
  }
}

const codexManifest = JSON.parse(fs.readFileSync(path.join(root, "plugins/cadre/.codex-plugin/plugin.json"), "utf8"));
if (codexManifest.skills !== "./skills/") throw new Error("Codex plugin manifest has wrong skills path");
if (codexManifest.mcpServers !== "./.mcp.json") throw new Error("Codex plugin manifest has wrong MCP path");
const codexMcp = JSON.parse(fs.readFileSync(path.join(root, "plugins/cadre/.mcp.json"), "utf8"));
if (codexMcp.mcpServers?.cadre?.args?.[0] !== "./scripts/mcp/cadre-server.js") {
  throw new Error("Codex MCP config has wrong runtime path");
}
const claudeManifest = JSON.parse(fs.readFileSync(path.join(root, "plugins/cadre-claude/.claude-plugin/plugin.json"), "utf8"));
if (claudeManifest.skills !== "./skills/") throw new Error("Claude plugin manifest has wrong skills path");
if (claudeManifest.agents !== "./agents/") throw new Error("Claude plugin manifest has wrong agents path");
if (claudeManifest.mcpServers !== "./mcp-config.json") throw new Error("Claude plugin manifest has wrong MCP path");
const claudeMcp = JSON.parse(fs.readFileSync(path.join(root, "plugins/cadre-claude/mcp-config.json"), "utf8"));
if (claudeMcp.mcpServers?.cadre?.args?.[0] !== "./scripts/mcp/cadre-server.js") {
  throw new Error("Claude MCP config has wrong runtime path");
}
for (const field of ["name", "version", "description", "homepage", "repository", "license"]) {
  if (codexManifest[field] !== claudeManifest[field]) {
    throw new Error(`Plugin manifests diverged on ${field}`);
  }
}
if (JSON.stringify(codexManifest.keywords) !== JSON.stringify(claudeManifest.keywords)) {
  throw new Error("Plugin manifests diverged on keywords");
}
if (codexManifest.author?.name !== claudeManifest.author?.name) {
  throw new Error("Plugin manifests diverged on author name");
}
if (codexManifest.interface?.displayName !== "Cadre") {
  throw new Error("Codex plugin manifest missing interface display name");
}
if (!codexManifest.interface || "agents" in codexManifest) {
  throw new Error("Codex plugin manifest contains Claude-only fields");
}
if (!claudeManifest.displayName || claudeManifest.displayName !== "Cadre") {
  throw new Error("Claude plugin manifest missing display name");
}
if (!("agents" in claudeManifest) || claudeManifest.agents !== "./agents/") {
  throw new Error("Claude plugin manifest missing agents path");
}
for (const text of [JSON.stringify(codexMcp), JSON.stringify(claudeMcp)]) {
  if (text.includes("${PLUGIN_ROOT}") || text.includes("${CLAUDE_PLUGIN_ROOT}")) {
    throw new Error("Generated MCP config still contains placeholder paths");
  }
}

const harnessCodexMarketplace = JSON.parse(fs.readFileSync(path.join(root, ".agents/plugins/marketplace.json"), "utf8"));
if (harnessCodexMarketplace.plugins?.[0]?.source?.path !== "./plugins/cadre") {
  throw new Error("Harness Codex marketplace has wrong plugin path");
}
const harnessClaudeMarketplace = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/marketplace.json"), "utf8"));
if (harnessClaudeMarketplace.plugins?.[0]?.source !== "./plugins/cadre-claude") {
  throw new Error("Harness Claude marketplace has wrong plugin path");
}
const repoRoot = path.resolve(root, "..");
const rootCodexMarketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, ".agents/plugins/marketplace.json"), "utf8"));
if (rootCodexMarketplace.plugins?.[0]?.source?.path !== "./harness/plugins/cadre") {
  throw new Error("Root Codex marketplace has wrong plugin path");
}
const rootClaudeMarketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin/marketplace.json"), "utf8"));
if (rootClaudeMarketplace.plugins?.[0]?.source !== "./harness/plugins/cadre-claude") {
  throw new Error("Root Claude marketplace has wrong plugin path");
}

for (const rel of [
  "plugins/cadre/skills/cadre/SKILL.md",
  "plugins/cadre/scripts/mcp/cadre-server.js",
  "plugins/cadre-claude/skills/cadre/SKILL.md",
  "plugins/cadre-claude/scripts/mcp/cadre-server.js",
  "plugins/cadre-claude/agents/cadre-worker.md",
]) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`missing ${rel}`);
}
NODE
}

write_marketplaces() {
  mkdir -p "$(dirname "$(out_path "$CODEX_PLUGIN_MARKETPLACE")")"
  write_marketplace_json "codex" "$(out_path "$CODEX_PLUGIN_MARKETPLACE")" "./plugins/cadre"
  mkdir -p "$(dirname "$(out_path "$CLAUDE_PLUGIN_MARKETPLACE")")"
  write_marketplace_json "claude" "$(out_path "$CLAUDE_PLUGIN_MARKETPLACE")" "./plugins/cadre-claude"
}

write_root_marketplaces() {
  mkdir -p "$(dirname "$(out_root_path "$ROOT_CODEX_PLUGIN_MARKETPLACE")")"
  write_marketplace_json "codex" "$(out_root_path "$ROOT_CODEX_PLUGIN_MARKETPLACE")" "./harness/plugins/cadre"
  mkdir -p "$(dirname "$(out_root_path "$ROOT_CLAUDE_PLUGIN_MARKETPLACE")")"
  write_marketplace_json "claude" "$(out_root_path "$ROOT_CLAUDE_PLUGIN_MARKETPLACE")" "./harness/plugins/cadre-claude"
}

generate_plugins() {
  rm -rf "$(out_path "$CODEX_PLUGIN_DIR")" "$(out_path "$CLAUDE_PLUGIN_DIR")"

  generate_plugin_bundle() {
    local skill_dir="$1" plugin_dir="$2" script_source="$3" script_mode="${4:-copy}"
    copy_skill_tree "$skill_dir" "$plugin_dir/skills/cadre"
    copy_plugin_scripts "$plugin_dir" "$script_source" "$script_mode"
  }

  generate_plugin_bundle "$CODEX_SKILL_DIR" "$CODEX_PLUGIN_DIR" "$REPO_ROOT/scripts" "copy"
  generate_plugin_bundle "$CLAUDE_SKILL_DIR" "$CLAUDE_PLUGIN_DIR" "$(out_path "$CODEX_PLUGIN_DIR/scripts")" "link"

  write_plugin_manifest "codex" "$CODEX_PLUGIN_DIR"
  write_plugin_mcp_config_for_platform "codex" "$CODEX_PLUGIN_DIR"
  write_plugin_manifest "claude" "$CLAUDE_PLUGIN_DIR"
  write_plugin_mcp_config_for_platform "claude" "$CLAUDE_PLUGIN_DIR"
  write_claude_worker_agent
  write_plugin_readme "$CODEX_PLUGIN_DIR" "Codex"
  write_plugin_readme "$CLAUDE_PLUGIN_DIR" "Claude Code"
  write_marketplaces
  write_root_marketplaces
  if [[ -z "$GEN_ROOT" ]]; then
    validate_generated_plugins
  fi
}

main() {
  local ref count stale d f master pair src name

  if [[ ! -d "$SOURCE_PROTOCOL_DIR" ]]; then
    echo "error: missing $SOURCE_PROTOCOL_DIR/ directory" >&2
    exit 1
  fi
  if [[ ! -f "$SOURCE_SKILL_FILE" ]]; then
    echo "error: missing $SOURCE_SKILL_FILE" >&2
    exit 1
  fi
  if [[ ! -d "$TEMPLATES_SRC" ]]; then
    echo "error: missing $TEMPLATES_SRC/ directory" >&2
    exit 1
  fi
  for ref in "${AGNOSTIC_REFS[@]}" "${SLICED_REFS[@]}"; do
    if [[ ! -f "$ref" ]]; then
      echo "error: missing $ref" >&2
      exit 1
    fi
  done

  build_runtime

  generate_skill "$CLAUDE_SKILL_DIR"
  generate_skill "$CODEX_SKILL_DIR"
  generate_protocols "claude" "$CLAUDE_PROTOCOL_DIR"
  generate_protocols "codex" "$CODEX_PROTOCOL_DIR"
  copy_references
  copy_templates
  generate_plugins

  count="$(ls "$SOURCE_PROTOCOL_DIR"/cadre-*.md | wc -l | tr -d ' ')"

  if [[ "$MODE" == "--check" ]]; then
    stale=false
    check_generated_dir() {
      local path="$1"
      if ! diff -rq "$GEN_ROOT/$path" "$REPO_ROOT/$path" >/dev/null 2>&1; then
        echo "stale: $path" >&2
        diff -rq "$GEN_ROOT/$path" "$REPO_ROOT/$path" >&2 || true
        stale=true
      fi
    }
    check_generated_file() {
      local path="$1"
      if ! diff -q "$GEN_ROOT/$path" "$REPO_ROOT/$path" >/dev/null 2>&1; then
        echo "stale: $path" >&2
        diff -q "$GEN_ROOT/$path" "$REPO_ROOT/$path" >&2 || true
        stale=true
      fi
    }
    check_generated_root_file() {
      local path="$1"
      if ! diff -q "$GEN_ROOT/root/$path" "$ROOT_REPO/$path" >/dev/null 2>&1; then
        echo "stale: ../$path" >&2
        diff -q "$GEN_ROOT/root/$path" "$ROOT_REPO/$path" >&2 || true
        stale=true
      fi
    }
    for d in "$CLAUDE_PROTOCOL_DIR" "$CODEX_PROTOCOL_DIR" "$CLAUDE_SKILL_DIR/templates" "$CODEX_SKILL_DIR/templates" "$CLAUDE_PLUGIN_DIR" "$CODEX_PLUGIN_DIR"; do
      check_generated_dir "$d"
    done
    check_generated_file "$CLAUDE_SKILL_DIR/SKILL.md"
    check_generated_file "$CODEX_SKILL_DIR/SKILL.md"
    for master in "${SLICED_REFS[@]}"; do
      f="$(basename "$master")"
      check_generated_file "$CLAUDE_SKILL_DIR/references/$f"
      check_generated_file "$CODEX_SKILL_DIR/references/$f"
    done
    for ref in "${AGNOSTIC_REFS[@]}"; do
      f="$(basename "$ref")"
      check_generated_file "$CLAUDE_SKILL_DIR/references/$f"
      check_generated_file "$CODEX_SKILL_DIR/references/$f"
    done
    check_generated_file "$CODEX_PLUGIN_MARKETPLACE"
    check_generated_file "$CLAUDE_PLUGIN_MARKETPLACE"
    check_generated_root_file "$ROOT_CODEX_PLUGIN_MARKETPLACE"
    check_generated_root_file "$ROOT_CLAUDE_PLUGIN_MARKETPLACE"

    if ! $stale; then
      echo "✓ Generated plugin bundles are up to date."
    else
      echo "✗ Generated skill/plugin output is stale. Run: pnpm generate" >&2
      exit 1
    fi
  else
    echo "✓ Generated $count workflow protocols for Claude and Codex plugin bundles."
    echo "  .claude/skills/cadre/ .agents/skills/cadre/ (build artifacts)"
    echo "  plugins/cadre-claude/ plugins/cadre/"
  fi
}

main
