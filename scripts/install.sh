#!/usr/bin/env bash
#
# install.sh — Install the Cadre skills for your AI coding CLIs.
#
# Detects the supported tools on this machine, lets you pick which ones to set
# up, and installs either globally (into your home config, e.g. ~/.claude/) or
# into a project directory (e.g. <project>/.claude/).
#
# Supported tools and what gets installed:
#   Claude Code        .claude/skills/
#   OpenAI Codex       .agents/skills/ (+ AGENTS.md for project installs)
#
# Usage:
#   bash scripts/install.sh                 # interactive
#   bash scripts/install.sh --all --global  # all detected tools, globally
#   bash scripts/install.sh --project=DIR --yes claude codex
#   bash scripts/install.sh --dry-run       # show what would happen, write nothing
#
# Options:
#   --global              Install into your home config (~/).
#   --project[=DIR]       Install into DIR (default: current directory).
#   --all                 Select every detected tool (implies --yes).
#   -y, --yes             Skip the confirmation prompt.
#   --dry-run             Print actions without copying anything.
#   -h, --help            Show this help.
#
# Positional args (claude codex) preselect tools and
# skip the interactive menu.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ALL_AGENTS="claude codex"

# ---------------------------------------------------------------- presentation
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=; DIM=; GREEN=; YELLOW=; RED=; CYAN=; RESET=
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
note() { printf '  %s•%s %s\n' "$DIM" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

show_help() { sed -n '3,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------- agent helpers
agent_label() {
  case "$1" in
    claude)      echo "Claude Code" ;;
    codex)       echo "OpenAI Codex" ;;
  esac
}

# Native scope of each tool, shown as a hint in the menu.
agent_native() {
  case "$1" in
    claude)      echo "global or project" ;;
    codex)       echo "global or project" ;;
  esac
}

# Returns success (0) if the tool looks installed: CLI on PATH or its config dir.
agent_detect() {
  case "$1" in
    claude)      command -v claude      >/dev/null 2>&1 || [ -d "$HOME/.claude" ] ;;
    codex)       command -v codex       >/dev/null 2>&1 || [ -d "$HOME/.codex" ] ;;
  esac
}

# Source directories each agent needs present in the repo before installing.
agent_sources() {
  case "$1" in
    claude)      echo ".claude/skills" ;;
    codex)       echo ".agents/skills" ;;
  esac
}

# --------------------------------------------------------------- copy utilities
copy_dir() {  # copy_dir <src-dir> <dest-dir> : copy contents of src into dest
  local src="$1" dest="$2"
  if $DRY_RUN; then note "[dry-run] mkdir -p $dest && cp -R $src/. $dest/"; return; fi
  mkdir -p "$dest"
  cp -R "$src/." "$dest/"
}

copy_file_safe() {  # copy_file_safe <src> <dest> : never overwrite an existing dest
  local src="$1" dest="$2"
  if [ -e "$dest" ]; then note "kept existing $dest (not overwritten)"; return; fi
  if $DRY_RUN; then note "[dry-run] cp $src $dest"; return; fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
}

# install_agent <agent> <base-dir> <scope: global|project>
install_agent() {
  local agent="$1" base="$2" scope="$3" src
  for src in $(agent_sources "$agent"); do
    [ -d "$REPO_ROOT/$src" ] || die "missing $src in repo. Run: bash scripts/generate-skills.sh"
  done

  case "$agent" in
    claude)
      copy_dir "$REPO_ROOT/.claude/skills"   "$base/.claude/skills"
      ok "Claude Code → $base/.claude/skills"
      ;;
    codex)
      copy_dir "$REPO_ROOT/.agents/skills" "$base/.agents/skills"
      ok "Codex → $base/.agents/skills"
      if [ "$scope" = project ]; then
        copy_file_safe "$REPO_ROOT/AGENTS.md" "$base/AGENTS.md"
      else
        note "Codex reads user skills from ~/.agents/skills; add AGENTS.md per project for context."
      fi
      ;;
  esac
}

# ------------------------------------------------------------------ argument parse
SCOPE=""
PROJECT_DIR=""
ASSUME_ALL=false
ASSUME_YES=false
DRY_RUN=false
PRESELECTED=""

for arg in "$@"; do
  case "$arg" in
    --global)       SCOPE="global" ;;
    --project)      SCOPE="project" ;;
    --project=*)    SCOPE="project"; PROJECT_DIR="${arg#*=}" ;;
    --all)          ASSUME_ALL=true; ASSUME_YES=true ;;
    -y|--yes)       ASSUME_YES=true ;;
    --dry-run)      DRY_RUN=true ;;
    -h|--help)      show_help; exit 0 ;;
    claude|codex) PRESELECTED="$PRESELECTED $arg" ;;
    *) die "unknown option: $arg (try --help)" ;;
  esac
done

# ------------------------------------------------------------------------ banner
say ""
say "${BOLD}${CYAN}Cadre installer${RESET}"
say "${DIM}Source: $REPO_ROOT${RESET}"
$DRY_RUN && warn "dry-run mode: no files will be written"
say ""

# ----------------------------------------------------------------- choose agents
SELECTED=""
add_selected() {  # append unique
  local a="$1"
  case " $SELECTED " in *" $a "*) return ;; esac
  SELECTED="$SELECTED $a"
}

if [ -n "$PRESELECTED" ]; then
  for a in $PRESELECTED; do add_selected "$a"; done
elif $ASSUME_ALL; then
  for a in $ALL_AGENTS; do agent_detect "$a" && add_selected "$a"; done
  [ -n "$SELECTED" ] || die "no supported CLIs detected to install"
else
  say "${BOLD}Detected AI coding CLIs:${RESET}"
  i=0
  for a in $ALL_AGENTS; do
    i=$((i + 1))
    if agent_detect "$a"; then status="${GREEN}detected${RESET}"; else status="${DIM}not detected${RESET}"; fi
    printf "  %d) %-20s %sscope: %s%s   %s\n" "$i" "$(agent_label "$a")" "$DIM" "$(agent_native "$a")" "$RESET" "$status"
  done
  say ""
  printf "Select tools to install — numbers (e.g. %s1 3%s), %sall%s for all detected, or %sq%s to quit: " "$BOLD" "$RESET" "$BOLD" "$RESET" "$BOLD" "$RESET"
  read -r reply
  case "$reply" in
    q|Q|"") say "Cancelled."; exit 0 ;;
    all|a)  for a in $ALL_AGENTS; do agent_detect "$a" && add_selected "$a"; done ;;
    *)
      reply="$(printf '%s' "$reply" | tr ',' ' ')"
      for tok in $reply; do
        case "$tok" in
          [1-2])
            n=0
            for a in $ALL_AGENTS; do
              n=$((n + 1))
              [ "$n" = "$tok" ] && add_selected "$a"
            done
            ;;
          *) warn "ignoring invalid choice: $tok" ;;
        esac
      done
      ;;
  esac
fi

SELECTED="$(printf '%s' "$SELECTED" | sed 's/^ *//')"
[ -n "$SELECTED" ] || { say "Nothing selected."; exit 0; }

# ------------------------------------------------------------------ choose scope
if [ -z "$SCOPE" ]; then
  say ""
  printf "Install %sscope%s — %s1%s) Global (~/)   %s2%s) Project: " "$BOLD" "$RESET" "$BOLD" "$RESET" "$BOLD" "$RESET"
  read -r screply
  case "$screply" in
    1|g|global)  SCOPE="global" ;;
    2|p|project) SCOPE="project" ;;
    *) die "invalid scope choice" ;;
  esac
fi

if [ "$SCOPE" = "global" ]; then
  BASE="$HOME"
else
  if [ -z "$PROJECT_DIR" ]; then
    say ""
    printf "Project directory [%s]: " "$PWD"
    read -r PROJECT_DIR
    PROJECT_DIR="${PROJECT_DIR:-$PWD}"
  fi
  # Expand a leading ~ and resolve to an absolute path.
  case "$PROJECT_DIR" in "~"*) PROJECT_DIR="$HOME${PROJECT_DIR#\~}" ;; esac
  [ -d "$PROJECT_DIR" ] || die "project directory does not exist: $PROJECT_DIR"
  PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
  BASE="$PROJECT_DIR"
  if [ "$BASE" = "$REPO_ROOT" ]; then
    warn "target is the Cadre repo itself — you probably want a different project."
  fi
fi

# ---------------------------------------------------------------------- confirm
say ""
say "${BOLD}About to install:${RESET}"
for a in $SELECTED; do note "$(agent_label "$a")"; done
say "  scope: ${BOLD}$SCOPE${RESET}  →  ${BOLD}$BASE${RESET}"
say ""

if ! $ASSUME_YES && ! $DRY_RUN; then
  printf "Proceed? [y/N]: "
  read -r confirm
  case "$confirm" in y|Y|yes|YES) ;; *) say "Cancelled."; exit 0 ;; esac
fi

# ---------------------------------------------------------------------- install
say ""
for a in $SELECTED; do
  install_agent "$a" "$BASE" "$SCOPE"
done

say ""
ok "Done. Ask the Cadre skill for ${BOLD}cadre-setup${RESET}${GREEN}${RESET} in your project to get started."
$DRY_RUN && warn "dry-run: nothing was actually written."
