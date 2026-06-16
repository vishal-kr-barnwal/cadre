#!/usr/bin/env bash
# =============================================================================
# Conductor-Beads: Command Compaction Migration
# =============================================================================
#
# Run this from the ROOT of your project (the repo that uses Conductor).
# Do NOT run from the Conductor-Beads tool repo itself.
#
# Usage:
#   bash /path/to/conductor-beads/scripts/migrate-commands.sh
#   bash /path/to/conductor-beads/scripts/migrate-commands.sh --dry-run
#
# What this does:
#   Five commands were retired and folded into others. This rewrites any
#   references to the old command names inside your conductor/ files
#   (learnings.md, handoff_*.md, blockers.md, skipped.md, revisions.md, notes):
#
#     /conductor-block    →  /conductor-flag blocked
#     /conductor-skip     →  /conductor-flag skipped
#     /conductor-export   →  /conductor-status --export
#     /conductor-distill  →  /conductor-formula create
#     /conductor-wisp     →  /conductor-formula wisp
#
#   The command *definitions* live in the Conductor-Beads tool repo and are
#   updated by upgrading the tool — this script only fixes references that you
#   wrote into your own project's conductor/ documents. It is idempotent.
# =============================================================================

set -euo pipefail

# ── Flags ────────────────────────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()   { echo -e "${RED}[err]${NC}   $*"; }
step()  { echo -e "\n${BOLD}── $* ──${NC}"; }
dry()   { echo -e "${YELLOW}[dry-run]${NC} would: $*"; }

if $DRY_RUN; then
  echo -e "\n${YELLOW}DRY-RUN MODE — no changes will be written${NC}"
fi

echo -e "\n${BOLD}╔══════════════════════════════════════════╗"
echo    "║  Conductor-Beads: Command Compaction      ║"
echo -e "╚══════════════════════════════════════════╝${NC}\n"

# ── Prerequisite checks ───────────────────────────────────────────────────────
if [ ! -d "conductor" ]; then
  err "No conductor/ directory found. Is this a Conductor project?"
  exit 1
fi

# Rename map: old token → replacement. Order matters only in that no replacement
# value contains any old token, so the pass is single-shot and idempotent.
# Each entry: "OLD|||NEW"
RENAMES=(
  "/conductor-block|||/conductor-flag blocked"
  "/conductor-skip|||/conductor-flag skipped"
  "/conductor-export|||/conductor-status --export"
  "/conductor-distill|||/conductor-formula create"
  "/conductor-wisp|||/conductor-formula wisp"
)

# Build a single sed program from the rename map (escaping | in the addresses).
SED_PROG=""
for entry in "${RENAMES[@]}"; do
  old="${entry%%|||*}"
  new="${entry##*|||}"
  # Use a delimiter unlikely to appear in command names.
  SED_PROG+="s@${old}@${new}@g;"
done

step "Scanning conductor/ for retired command references"

CHANGES_MADE=0
TOUCHED=0

# Match any retired token as a whole-ish reference.
GREP_PAT='/conductor-(block|skip|export|distill|wisp)'

while IFS= read -r f; do
  if grep -qE "$GREP_PAT" "$f" 2>/dev/null; then
    TOUCHED=$((TOUCHED + 1))
    hits=$(grep -cE "$GREP_PAT" "$f" 2>/dev/null || echo 0)
    warn "$f ($hits reference(s))"
    if $DRY_RUN; then
      dry "rewrite retired command names in $f"
    else
      sed -i.bak -E "$SED_PROG" "$f"
      rm -f "${f}.bak"
      git add "$f" 2>/dev/null || true
      ok "Rewrote: $f"
      CHANGES_MADE=1
    fi
  fi
done < <(find conductor -type f \
           \( -name "*.md" -o -name "*.json" -o -name "*.txt" \) \
           -not -path "*/.git/*")

if [ "$TOUCHED" -eq 0 ]; then
  ok "No retired command references found — nothing to migrate."
fi

# ── Commit ─────────────────────────────────────────────────────────────────--
step "Committing changes"

if ! $DRY_RUN && [ "$CHANGES_MADE" -eq 1 ]; then
  if [ -d ".git" ]; then
    git commit -m "conductor(migrate): rename retired commands (flag/status --export/formula)" || \
      warn "Nothing staged to commit (changes may already be committed)."
    ok "Migration changes committed."
  else
    ok "Files rewritten (no .git here — commit manually if needed)."
  fi
elif $DRY_RUN; then
  info "Dry-run complete — no changes written."
else
  ok "No changes needed — project already uses the new command names."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}New command surface:${NC}"
echo "  /conductor-flag <blocked|skipped>     (was: block, skip)"
echo "  /conductor-status --export            (was: export)"
echo "  /conductor-formula create <track_id>  (was: distill)"
echo "  /conductor-formula wisp [formula]     (was: wisp)"
echo ""
echo -e "${BOLD}New SDLC commands:${NC} /conductor-review, /conductor-ship, /conductor-release"
echo ""
