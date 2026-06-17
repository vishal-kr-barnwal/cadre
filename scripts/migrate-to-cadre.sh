#!/usr/bin/env bash
# migrate-to-cadre.sh — migrate an existing project from the old "Conductor"
# naming to "Cadre". Renames conductor/ -> cadre/ and rewrites /conductor-*
# command references and conductor/ path references inside the moved files.
#
# Re-install the plugin afterward so your platform picks up the Cadre workflow
# skill (for example, `/plugin install cadre@cadre` in Claude Code).
#
# Usage:
#   bash scripts/migrate-to-cadre.sh [--dry-run]
#
# Idempotent: a no-op if cadre/ already exists.
set -euo pipefail

DRY=false
[ "${1:-}" = "--dry-run" ] && DRY=true
run() { if $DRY; then echo "[dry-run] $*"; else eval "$*"; fi; }
say() { printf '%s\n' "$*"; }

if [ -d cadre ]; then
  say "cadre/ already exists — already migrated, nothing to do."
  exit 0
fi
if [ ! -d conductor ]; then
  say "No conductor/ directory here. Run this from your project root."
  exit 1
fi

say "1/3  Renaming conductor/ -> cadre/"
run "git mv conductor cadre 2>/dev/null || mv conductor cadre"

say "2/3  Rewriting /conductor-* command refs and conductor/ paths inside cadre/"
while IFS= read -r f; do
  run "perl -pi -e 's{/conductor-}{/cadre-}g; s{conductor/}{cadre/}g; s/Conductor-Beads/Cadre/g; s/Conductor/Cadre/g' \"$f\""
done < <(grep -rIl 'conductor' cadre 2>/dev/null || true)

say "3/3  Updating .gitattributes merge-driver paths (if present)"
if [ -f .gitattributes ] && grep -q 'conductor/tracks' .gitattributes; then
  run "perl -pi -e 's{conductor/tracks}{cadre/tracks}g' .gitattributes"
fi

say ""
say "Done. Next:"
say "  • Reinstall the Cadre plugin so your platform gets the Cadre workflow skill"
say "    (Claude Code: '/plugin install cadre@cadre'; Codex: 'codex plugin add cadre@cadre')."
say "  • Commit the rename: git add -A && git commit -m 'chore: migrate conductor/ -> cadre/'"
$DRY && say "(dry-run — no changes were written)"
