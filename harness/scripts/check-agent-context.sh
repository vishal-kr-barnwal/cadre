#!/usr/bin/env bash
#
# Guard against AGENTS.md falling behind CLAUDE.md on Cadre's team-scale
# operating rules. This is intentionally a semantic smoke test instead of a full
# file diff: the two files target different agent surfaces, but both must carry
# the same safety-critical concepts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

check() {
  local file="$1" pattern="$2" label="$3"
  if ! grep -Eq -- "$pattern" "$file"; then
    echo "error: $file is missing required context: $label" >&2
    exit 1
  fi
}

for file in AGENTS.md CLAUDE.md; do
  [ -f "$file" ] || { echo "error: missing $file" >&2; exit 1; }
  check "$file" 'metadata\.json\.status' 'metadata status is source of truth'
  check "$file" 'tracks\.json.*generated|generated.*tracks\.json' 'tracks.json is generated'
  check "$file" 'review_seq|reviewed_sha' 'structured review gate fields'
  check "$file" 'require_second_reviewer' 'second-review enforcement'
  check "$file" '--available|--unowned' 'available work board'
  check "$file" 'ownership guard|Ownership Guard' 'topology-independent ownership guard'
  check "$file" 'merge\.ours\.driver true' 'merge driver registration'
  check "$file" 'product code.*local|Product code.*local' 'product code stays local until ship/land'
done

echo "AGENTS.md and CLAUDE.md contain the required team-scale context markers."
