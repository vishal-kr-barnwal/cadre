#!/usr/bin/env bash
#
# generate-commands.sh — Derive every supported platform's command set from the
# canonical Claude Code commands in `.claude/commands/conductor-*.md`.
#
# One source of truth (the Claude `.md` commands) is transformed into:
#   - Codex CLI         -> .codex/prompts/conductor-*.md
#   - Cursor            -> .cursor/commands/conductor-*.md
#   - Antigravity CLI   -> .agent/workflows/conductor-*.md
#   - GitHub Copilot    -> .github/prompts/conductor-*.prompt.md
#
# Each Claude command file has YAML frontmatter (`description:`, optional
# `argument-hint:`) followed by a Markdown body. The body uses the `$ARGUMENTS`
# placeholder and references `references/beads-error-handler.md`. This script
# adapts the frontmatter and argument placeholder to each platform's
# conventions and copies the shared reference file alongside the commands so
# every output directory is self-contained.
#
# Re-run after editing any `.claude/commands/conductor-*.md` to keep all
# platforms in sync. Generated files carry an "AUTO-GENERATED" marker; do not
# hand-edit them — edit the canonical Claude command and regenerate.
#
# Usage:
#   bash scripts/generate-commands.sh            # generate all platforms
#   bash scripts/generate-commands.sh --check    # fail if output is stale (CI)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SRC_DIR=".claude/commands"

# Agnostic reference: identical for every platform, copied as-is. Its master
# lives in the Claude skill (which uses it directly); generated platforms get a
# verbatim copy.
AGNOSTIC_REF=".claude/skills/conductor/references/beads-error-handler.md"

# Sliced references: multi-platform masters with <!-- AGENT:<name> --> blocks.
# Each platform receives a copy containing only the shared text plus its own
# AGENT block, so no bundle carries other tools' instructions.
SLICED_REFS=(
  "scripts/agent-refs/parallel-execution.md"
  "scripts/agent-refs/template-locator.md"
  "scripts/agent-refs/polyrepo-git.md"
  "scripts/agent-refs/conductor-sync.md"
)

TEMPLATES_SRC="templates"                  # canonical templates (single source)
SKILL_DIR=".claude/skills/conductor"       # Claude skill; templates bundled here

CODEX_DIR=".codex/prompts"
CURSOR_DIR=".cursor/commands"
ANTIGRAVITY_DIR=".agent/workflows"
COPILOT_DIR=".github/prompts"

# references/ directory for each platform (Claude uses the skill's references).
ref_dir_for() {
  case "$1" in
    claude)      echo "$SKILL_DIR/references" ;;
    codex)       echo "$CODEX_DIR/references" ;;
    cursor)      echo "$CURSOR_DIR/references" ;;
    antigravity) echo "$ANTIGRAVITY_DIR/references" ;;
    copilot)     echo "$COPILOT_DIR/references" ;;
  esac
}

# Per-platform one-line worker-dispatch sentence, substituted into the
# <!-- DISPATCH:start -->…<!-- DISPATCH:end --> region of conductor-implement.
dispatch_sentence() {
  case "$1" in
    claude)      echo 'Use the **`Task` tool**, one call per worker (calls are awaitable); see `references/parallel-execution.md`.' ;;
    codex)       echo 'Spawn parallel agents with the built-in `worker` agent type — one per task; "wait for all before continuing" (manage with `/agent`); see `references/parallel-execution.md`.' ;;
    cursor)      echo 'Use **`/multitask`** to run one subagent per task in parallel (git-worktree isolated); see `references/parallel-execution.md`.' ;;
    antigravity) echo 'Use the **Agent Manager** to spawn one dynamic subagent per task in the wave; see `references/parallel-execution.md`.' ;;
    copilot)     echo 'Use **`/fleet`** (Copilot CLI) to dispatch one subagent per task in parallel, or parallel subagents in VS Code; see `references/parallel-execution.md`.' ;;
  esac
}

# Phrase substituted for the literal `$ARGUMENTS` placeholder on platforms that
# do not perform `$ARGUMENTS` expansion (Cursor, Antigravity, Copilot). On these
# platforms any text typed after the slash command is appended to the prompt, so
# we describe that instead of using a token that would survive verbatim.
ARGS_PHRASE="the input provided with this command (the text typed after the command name)"

MODE="${1:-generate}"
GEN_ROOT=""
if [[ "$MODE" == "--check" ]]; then
  GEN_ROOT="$(mktemp -d)"
  trap 'rm -rf "$GEN_ROOT"' EXIT
fi

# out_path <relative-output-path> -> absolute path under repo (or temp in --check)
out_path() {
  if [[ -n "$GEN_ROOT" ]]; then
    printf '%s/%s' "$GEN_ROOT" "$1"
  else
    printf '%s/%s' "$REPO_ROOT" "$1"
  fi
}

# Extract the Markdown body (everything after the YAML frontmatter block).
# If the file has no leading `---`, the whole file is the body.
extract_body() {
  awk '
    BEGIN { in_fm = 0; started = 0; seen = 0 }
    NR == 1 && $0 == "---" { in_fm = 1; seen = 1; next }
    in_fm == 1 && $0 == "---" { in_fm = 0; started = 1; next }
    in_fm == 1 { next }
    {
      if (seen == 0) started = 1     # no frontmatter: print from line 1
      if (started == 1) {
        if (printing == 0 && $0 ~ /^[[:space:]]*$/) next  # trim leading blanks
        printing = 1
        print
      }
    }
  ' "$1"
}

# Extract the `description:` value from the frontmatter.
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

GEN_MARKER="AUTO-GENERATED by scripts/generate-commands.sh from .claude/commands/ — do not edit by hand."
REF_MARKER="AUTO-GENERATED by scripts/generate-commands.sh — edit the master in scripts/agent-refs/ instead."

write_file() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path"
}

# slice_ref <master> <platform> : emit shared lines plus only the matching
# <!-- AGENT:<platform> --> block, dropping other platforms' blocks and markers.
slice_ref() {
  awk -v keep="$2" '
    /<!-- \/AGENT:/ { inblock = 0; next }
    /<!-- AGENT:/   { line = $0; sub(/.*AGENT:/, "", line); sub(/[^a-z].*/, "", line); cur = line; inblock = 1; next }
    inblock == 1 && cur != keep { next }
    { print }
  ' "$1"
}

# apply_dispatch <platform> : on stdin, replace the
# <!-- DISPATCH:start -->…<!-- DISPATCH:end --> region with the platform's
# one-line worker-dispatch sentence. Commands without the markers pass through.
apply_dispatch() {
  awk -v repl="$(dispatch_sentence "$1")" '
    /<!-- DISPATCH:start -->/ { match($0, /^[ \t]*/); print substr($0, 1, RLENGTH) repl; skip = 1; next }
    /<!-- DISPATCH:end -->/   { skip = 0; next }
    skip == 1 { next }
    { print }
  '
}

generate_platform() {
  local platform="$1" src name desc body
  for src in "$SRC_DIR"/conductor-*.md; do
    name="$(basename "$src" .md)"            # e.g. conductor-setup
    desc="$(extract_description "$src")"
    body="$(extract_body "$src" | apply_dispatch "$platform")"

    case "$platform" in
      codex)
        # Codex CLI expands `$ARGUMENTS` natively; keep it. No frontmatter —
        # Codex treats the whole markdown file as the prompt body.
        {
          printf '<!-- %s -->\n' "$GEN_MARKER"
          printf '<!-- %s -->\n\n' "$desc"
          printf '%s\n' "$body"
        } | write_file "$(out_path "$CODEX_DIR/$name.md")"
        ;;
      cursor)
        # Cursor commands are plain Markdown with no frontmatter.
        {
          printf '<!-- %s -->\n\n' "$GEN_MARKER"
          printf '%s\n' "$body"
        } | sed "s|\$ARGUMENTS|$ARGS_PHRASE|g" \
          | write_file "$(out_path "$CURSOR_DIR/$name.md")"
        ;;
      antigravity)
        # Antigravity workflows require YAML frontmatter with a description.
        {
          printf -- '---\n'
          printf 'description: %s\n' "$desc"
          printf -- '---\n\n'
          printf '<!-- %s -->\n\n' "$GEN_MARKER"
          printf '%s\n' "$body"
        } | sed "s|\$ARGUMENTS|$ARGS_PHRASE|g" \
          | write_file "$(out_path "$ANTIGRAVITY_DIR/$name.md")"
        ;;
      copilot)
        # GitHub Copilot prompt files: `.prompt.md` with YAML frontmatter.
        {
          printf -- '---\n'
          printf 'description: %s\n' "$desc"
          printf 'agent: agent\n'
          printf -- '---\n\n'
          printf '<!-- %s -->\n\n' "$GEN_MARKER"
          printf '%s\n' "$body"
        } | sed "s|\$ARGUMENTS|$ARGS_PHRASE|g" \
          | write_file "$(out_path "$COPILOT_DIR/$name.prompt.md")"
        ;;
    esac
  done
}

# Bundle reference files into each platform's references/ dir. Sliced refs are
# specialized per platform (only that tool's AGENT block); the agnostic ref is
# copied verbatim. Claude is included so its skill carries the same slimmed refs.
copy_reference() {
  local platform refdir master name dest
  for platform in claude codex cursor antigravity copilot; do
    refdir="$(ref_dir_for "$platform")"
    for master in "${SLICED_REFS[@]}"; do
      name="$(basename "$master")"
      dest="$(out_path "$refdir/$name")"
      mkdir -p "$(dirname "$dest")"
      {
        printf '<!-- %s -->\n' "$REF_MARKER"
        slice_ref "$master" "$platform"
      } > "$dest"
    done
  done
  # Agnostic ref: Claude already holds the master in its references/; the four
  # generated platforms get a verbatim copy.
  for platform in codex cursor antigravity copilot; do
    refdir="$(ref_dir_for "$platform")"
    dest="$(out_path "$refdir/$(basename "$AGNOSTIC_REF")")"
    mkdir -p "$(dirname "$dest")"
    cp "$AGNOSTIC_REF" "$dest"
  done
}

# Bundle the canonical templates/ directory (workflow.md, code_styleguides/, …)
# with every command set so `conductor-setup` can find them after install. It is
# copied into each platform's command dir and into the Claude skill, matching the
# install locations that `conductor-setup`'s template-discovery step probes.
copy_templates() {
  local dir dest
  for dir in "$CODEX_DIR" "$CURSOR_DIR" "$ANTIGRAVITY_DIR" "$COPILOT_DIR" "$SKILL_DIR"; do
    dest="$(out_path "$dir/templates")"
    rm -rf "$dest"
    mkdir -p "$dest"
    cp -R "$TEMPLATES_SRC/." "$dest/"
  done
}

main() {
  local ref
  for ref in "$AGNOSTIC_REF" "${SLICED_REFS[@]}"; do
    if [[ ! -f "$ref" ]]; then
      echo "error: missing $ref" >&2
      exit 1
    fi
  done
  if [[ ! -d "$TEMPLATES_SRC" ]]; then
    echo "error: missing $TEMPLATES_SRC/ directory" >&2
    exit 1
  fi

  for platform in codex cursor antigravity copilot; do
    generate_platform "$platform"
  done
  copy_reference
  copy_templates

  local count stale d f master
  count="$(ls "$SRC_DIR"/conductor-*.md | wc -l | tr -d ' ')"

  if [[ "$MODE" == "--check" ]]; then
    stale=false
    for d in "$CODEX_DIR" "$CURSOR_DIR" "$ANTIGRAVITY_DIR" "$COPILOT_DIR" "$SKILL_DIR/templates"; do
      diff -rq "$GEN_ROOT/$d" "$REPO_ROOT/$d" >/dev/null 2>&1 || stale=true
    done
    for master in "${SLICED_REFS[@]}"; do
      f="$(basename "$master")"
      diff -q "$GEN_ROOT/$SKILL_DIR/references/$f" "$REPO_ROOT/$SKILL_DIR/references/$f" >/dev/null 2>&1 || stale=true
    done
    if ! $stale; then
      echo "✓ Generated commands and bundled templates are up to date."
    else
      echo "✗ Generated output is stale. Run: bash scripts/generate-commands.sh" >&2
      exit 1
    fi
  else
    echo "✓ Generated $count commands each for: Codex, Cursor, Antigravity, GitHub Copilot."
    echo "  Bundled references/ and templates/ into every command set + the Claude skill."
    echo "  .codex/prompts/ .cursor/commands/ .agent/workflows/ .github/prompts/ .claude/skills/conductor/templates/"
  fi
}

main
