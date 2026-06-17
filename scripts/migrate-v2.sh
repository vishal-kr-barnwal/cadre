#!/usr/bin/env bash
# =============================================================================
# Conductor-Beads: v1 → v2 Migration Script
# =============================================================================
#
# Run this from the ROOT of your project (the repo that uses Conductor).
# Do NOT run from the Conductor-Beads tool repo itself.
#
# Usage:
#   bash /path/to/conductor-beads/scripts/migrate-v2.sh
#   bash /path/to/conductor-beads/scripts/migrate-v2.sh --dry-run
#
# What this fixes:
#   1. Flatten nested worker worktrees
#      OLD: .worktrees/<track_id>/worker_<N>_<name>
#      NEW: .worktrees/<track_id>_worker_<N>_<name>
#
#   2. Add .beads/** merge=ours to .gitattributes
#      Prevents git merge conflicts on Dolt DB files during PR merges.
#      Only applied if .beads/ is tracked by git (full integration mode).
#
#   3. Fix parallel_state.json files
#      Updates any stored worktree paths from nested to flat.
#
#   4. Warn about track branches missing scaffold files
#      Old behaviour created the branch BEFORE writing conductor files,
#      so the track branch may be missing spec.md / plan.md / metadata.json.
#      Provides the cherry-pick command to fix each affected track.
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
echo    "║  Conductor-Beads v1 → v2 Migration       ║"
echo -e "╚══════════════════════════════════════════╝${NC}\n"

# ── Prerequisite checks ───────────────────────────────────────────────────────
if [ ! -d ".git" ]; then
  err "No .git found. Run from the git repo root of your project."
  exit 1
fi

if [ ! -d "conductor" ]; then
  err "No conductor/ directory found. Is this a Conductor project?"
  exit 1
fi

CHANGES_MADE=0

# =============================================================================
# Fix 1: Flatten nested worker worktrees
# =============================================================================
step "Fix 1: Flatten nested worker worktrees"

# git worktree list --porcelain gives one block per worktree:
#   worktree /abs/path
#   HEAD <sha>
#   branch refs/heads/<name>
#   (blank line)
NESTED_COUNT=0

while IFS= read -r wt_path; do
  # Match: <project_root>/.worktrees/<track_id>/worker_<anything>
  if echo "$wt_path" | grep -qE '\.worktrees/[^/]+/worker_'; then
    NESTED_COUNT=$((NESTED_COUNT + 1))

    # Extract the relative path from project root
    rel_path=$(realpath --relative-to="$(pwd)" "$wt_path" 2>/dev/null || \
               python3 -c "import os; print(os.path.relpath('$wt_path'))" 2>/dev/null || \
               echo "$wt_path")

    # Build flat equivalent: .worktrees/<track_id>/worker_<N>_<name>
    #                      → .worktrees/<track_id>_worker_<N>_<name>
    flat_path=$(echo "$rel_path" | sed -E 's|\.worktrees/([^/]+)/worker_|.worktrees/\1_worker_|')

    warn "Nested worktree: $rel_path"
    info "  → Flat target:  $flat_path"

    if [ -d "$flat_path" ]; then
      warn "  Target already exists — skipping (already migrated?)"
      continue
    fi

    if $DRY_RUN; then
      dry "git worktree move \"$rel_path\" \"$flat_path\""
    else
      git worktree move "$rel_path" "$flat_path"
      ok "Moved: $rel_path → $flat_path"
      CHANGES_MADE=1
    fi
  fi
done < <(git worktree list --porcelain | grep '^worktree ' | awk '{print $2}')

if [ "$NESTED_COUNT" -eq 0 ]; then
  ok "No nested worker worktrees found."
fi

# =============================================================================
# Fix 2: Add .beads/** merge=ours to .gitattributes
# =============================================================================
step "Fix 2: Configure .gitattributes for Beads"

BEADS_TRACKED=false
if [ -d ".beads" ] && git ls-files --error-unmatch ".beads" > /dev/null 2>&1; then
  BEADS_TRACKED=true
elif git ls-files ".beads/" | grep -q .; then
  BEADS_TRACKED=true
fi

if $BEADS_TRACKED; then
  ATTR_FILE=".gitattributes"
  ATTR_LINE=".beads/** merge=ours"

  if [ -f "$ATTR_FILE" ] && grep -qF ".beads/**" "$ATTR_FILE"; then
    ok ".gitattributes already contains .beads/** rule."
  else
    if $DRY_RUN; then
      dry "append '$ATTR_LINE' to $ATTR_FILE"
    else
      # Ensure file ends with newline before appending
      [ -f "$ATTR_FILE" ] && [ -n "$(tail -c1 "$ATTR_FILE")" ] && echo "" >> "$ATTR_FILE"
      {
        echo "# Beads Dolt DB — keep main's version on merge; Dolt manages its own history"
        echo "$ATTR_LINE"
      } >> "$ATTR_FILE"
      git add "$ATTR_FILE"
      ok "Added '$ATTR_LINE' to $ATTR_FILE"
      CHANGES_MADE=1
    fi
  fi
else
  ok ".beads/ not git-tracked — .gitattributes not needed."
fi

# =============================================================================
# Fix 3: Update parallel_state.json files with old nested paths
# =============================================================================
step "Fix 3: Update parallel_state.json worktree paths"

PSTATE_COUNT=0

while IFS= read -r pstate_file; do
  # Check for old nested path pattern: .worktrees/<id>/worker_
  if grep -qE '"\.worktrees/[^/"]+/worker_' "$pstate_file" 2>/dev/null; then
    PSTATE_COUNT=$((PSTATE_COUNT + 1))
    warn "Old paths found in: $pstate_file"

    if $DRY_RUN; then
      dry "sed: replace .worktrees/<id>/worker_ → .worktrees/<id>_worker_ in $pstate_file"
    else
      sed -i.bak -E 's|\.worktrees/([^/"]+)/worker_|.worktrees/\1_worker_|g' "$pstate_file"
      rm -f "${pstate_file}.bak"
      git add "$pstate_file"
      ok "Updated paths in: $pstate_file"
      CHANGES_MADE=1
    fi
  fi
done < <(find . -name "parallel_state.json" -not -path "./.git/*" -not -path "./.worktrees/*")

if [ "$PSTATE_COUNT" -eq 0 ]; then
  ok "No parallel_state.json files needed updating."
fi

# =============================================================================
# Fix 4: Warn about track branches missing scaffold files
# =============================================================================
step "Fix 4: Check track branches for scaffold completeness"

MISSING_COUNT=0

if [ -d "conductor/tracks" ]; then
  while IFS= read -r metadata_file; do
    track_id=$(basename "$(dirname "$metadata_file")")

    # Extract git_branch from metadata.json using grep (no python dependency)
    git_branch=$(grep -o '"git_branch"[[:space:]]*:[[:space:]]*"[^"]*"' "$metadata_file" \
                 | grep -o '"[^"]*"$' | tr -d '"' 2>/dev/null || echo "")

    if [ -z "$git_branch" ]; then
      warn "Track '$track_id': no git_branch in metadata.json — skipping."
      continue
    fi

    # Check if branch exists locally
    if ! git show-ref --verify --quiet "refs/heads/$git_branch" 2>/dev/null; then
      info "Track '$track_id': branch '$git_branch' not found locally — skipping."
      continue
    fi

    # Check if spec.md exists on the track branch
    if ! git show "${git_branch}:conductor/tracks/${track_id}/spec.md" > /dev/null 2>&1; then
      MISSING_COUNT=$((MISSING_COUNT + 1))
      warn "Track '$track_id': branch '$git_branch' is MISSING conductor scaffold files."
      warn "  Cause: Old v1 behaviour created the branch before writing conductor files."
      warn "  Fix:   Find and cherry-pick the scaffold commit onto the track branch:"
      warn "           # Find the scaffold commit on main:"
      warn "           git log --oneline main -- conductor/tracks/${track_id}/"
      warn "           # Cherry-pick it onto the track branch:"
      warn "           git checkout ${git_branch}"
      warn "           git cherry-pick <scaffold-sha>"
      warn "           git checkout main"
      echo ""
    else
      ok "Track '$track_id': branch '$git_branch' has scaffold files."
    fi
  done < <(find conductor/tracks -name "metadata.json" \
           -not -path "*/archive/*" \
           -not -path "*/.git/*" \
           | sort)
fi

if [ "$MISSING_COUNT" -eq 0 ] && [ -d "conductor/tracks" ]; then
  ok "All track branches have scaffold files."
fi

# =============================================================================
# Commit
# =============================================================================
step "Committing changes"

if ! $DRY_RUN && [ "$CHANGES_MADE" -eq 1 ]; then
  git commit -m "conductor(migrate): v1 → v2 — flat worktrees, .gitattributes, path fixes"
  ok "Migration changes committed."
elif $DRY_RUN; then
  info "Dry-run complete — no changes written."
else
  ok "No changes needed — project already on v2 layout."
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗"
echo    "║  Migration complete.                      ║"
echo    "║                                           ║"
echo    "║  Recommended next steps:                  ║"
echo    "║  1. Review any track warnings above.      ║"
echo    "║  2. git push origin main                  ║"
echo    "║  3. Teammates: git pull && run this too.  ║"
echo -e "╚══════════════════════════════════════════╝${NC}"
echo ""
