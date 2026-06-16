#!/usr/bin/env bash
#
# cadre-regen-index.sh — Rebuild cadre/tracks.md as a DERIVED index from each
# track's metadata.json.status (the single source of truth).
#
# This is the implementation behind `/cadre-status --regen-index`. Every command
# that changes a track's status writes the new value to that track's metadata.json
# and then calls this script, rather than hand-editing a marker in tracks.md.
#
# Properties: idempotent (running it twice leaves tracks.md byte-identical), pure
# bash + jq, and bd-independent. It rebuilds ONLY the region between the sentinel
# comments and preserves any human-authored preamble/trailer verbatim.
#
# Status -> marker:  new=[ ]  in_progress=[~]  completed=[x]  blocked=[!]  skipped=[-]
# A missing/unknown status defaults to new -> [ ] (back-compat).
#
# Usage:
#   bash cadre-regen-index.sh [project_root]   # default project_root: current dir
#
# Portability note: the regenerated body is passed to awk via a temp FILE (not
# `awk -v`) because BSD/macOS awk rejects multi-line -v values. The no-markers
# branch uses `tail -c 1` to detect a missing trailing newline on the preamble.
set -euo pipefail

ROOT="${1:-.}"
TRACKS_DIR="$ROOT/cadre/tracks"
F="$ROOT/cadre/tracks.md"
START='<!-- cadre:index:start -->'
END='<!-- cadre:index:end -->'

command -v jq >/dev/null 2>&1 || { echo "cadre-regen-index: jq is required" >&2; exit 1; }

# Emit one "## [marker] Track: <name>" line per track, sorted deterministically by
# path (the dir is named for the track id, so this is a stable track_id order).
gen_body() {
  local md
  for md in $(ls "$TRACKS_DIR"/*/metadata.json 2>/dev/null | sort); do
    jq -r '
      {new:"[ ]", in_progress:"[~]", completed:"[x]",
       blocked:"[!]", skipped:"[-]"} as $m
      | "## \($m[(.status // "new")] // "[ ]") Track: \(.name // .track_id)"
    ' "$md"
  done
}

bodyf="$(mktemp)"; gen_body > "$bodyf"
tmp="$(mktemp)"
if [ -f "$F" ] && grep -qF "$START" "$F" && grep -qF "$END" "$F"; then
  # Markers present: replace only the body between them; keep preamble + trailer.
  awk -v s="$START" -v e="$END" -v bf="$bodyf" '
    index($0,s){print; while((getline line < bf) > 0) print line; close(bf); skip=1; next}
    index($0,e){skip=0}
    !skip{print}
  ' "$F" > "$tmp"
else
  # No markers: keep the whole existing file (if any) as preamble, append a fresh
  # marked region. Guard the boundary so START isn't glued onto the last line.
  {
    if [ -f "$F" ]; then
      cat "$F"
      [ -s "$F" ] && [ -n "$(tail -c 1 "$F")" ] && printf '\n'
    fi
    printf '%s\n' "$START"; cat "$bodyf"; printf '%s\n' "$END"
  } > "$tmp"
fi
mkdir -p "$(dirname "$F")"
mv "$tmp" "$F"; rm -f "$bodyf"

n="$(ls "$TRACKS_DIR"/*/metadata.json 2>/dev/null | wc -l | tr -d ' ')"
echo "Regenerated $F index from $n tracks' metadata (preamble preserved)."
